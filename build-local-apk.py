import argparse
import gzip
import hashlib
import io
import os
from pathlib import Path
import tarfile

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
OUT = args.output
OUT.mkdir(parents=True, exist_ok=True)
VERSION = "0.5.2-r1"
ARCH = "mipsel_24kc"


def entry(name, content, mode=0o644):
    info = tarfile.TarInfo(name)
    info.mode = mode
    info.uid = info.gid = 0
    info.uname = info.gname = "root"
    info.size = len(content)
    return info, content


def archive(entries, *, complete):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.PAX_FORMAT) as tar:
        for info, content in entries:
            tar.addfile(info, io.BytesIO(content))
        end = buf.tell()
    return gzip.compress(buf.getvalue() if complete else buf.getvalue()[:end], mtime=0)


def build(package, description, dependencies, files):
    directories = set()
    entries = []
    for dest, source, mode in sorted(files):
        for parent in Path(dest).parents:
            if str(parent) == "." or parent.as_posix() in directories:
                continue
            directories.add(parent.as_posix())
        info, data = entry(dest, source.read_bytes(), mode)
        info.pax_headers["APK-TOOLS.checksum.SHA1"] = hashlib.sha1(data).hexdigest()
        entries.append((info, data))
    dir_entries = []
    for dest in sorted(directories):
        info, data = entry(dest, b"", 0o755)
        info.type = tarfile.DIRTYPE
        dir_entries.append((info, data))
    data_block = archive(dir_entries + entries, complete=True)
    metadata = [
        f"pkgname = {package}",
        f"pkgver = {VERSION}",
        f"pkgdesc = {description}",
        f"arch = {ARCH}",
        "license = GPL-3.0-only",
        f"size = {sum(len(data) for _, data in entries)}",
        f"origin = {package}",
        *[f"depend = {depend}" for depend in dependencies],
        f"datahash = {hashlib.sha256(data_block).hexdigest()}",
        "",
    ]
    control_entries = [entry(".PKGINFO", "\n".join(metadata).encode())]
    if package == "blcu-portal":
        control_entries.append(entry(".post-install", b"#!/bin/sh\n/etc/init.d/blcu-portal enable\n", 0o755))
        control_entries.append(entry(".pre-deinstall", b"#!/bin/sh\n/etc/init.d/blcu-portal stop\n/etc/init.d/blcu-portal disable\n", 0o755))
    (OUT / f"{package}-{VERSION}.apk").write_bytes(
        archive(control_entries, complete=False) + data_block
    )


build("blcu-portal", "BLCU campus portal service", ["python3", "curl", "ca-bundle", "ubus"], [
    ("usr/bin/blcu-portal", ROOT / "files/blcu-portal", 0o755),
    ("etc/init.d/blcu-portal", ROOT / "files/blcu-portal.init", 0o755),
    ("etc/config/blcu-portal", ROOT / "files/blcu-portal.config", 0o600),
])
luci = ROOT / "luci"
build("luci-app-blcu-portal", "LuCI for BLCU campus portal", ["luci-base", "rpcd", "blcu-portal"], [
    (p.relative_to(luci / "root").as_posix(), p, 0o755 if os.access(p, os.X_OK) else 0o644)
    for p in (luci / "root").rglob("*") if p.is_file()
] + [
    ("www/" + p.relative_to(luci / "htdocs").as_posix(), p, 0o644)
    for p in (luci / "htdocs").rglob("*") if p.is_file()
])
