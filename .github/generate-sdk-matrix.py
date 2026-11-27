"""Pin one official SDK per published package architecture and supported release."""

from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from time import sleep
from urllib.error import HTTPError, URLError
from urllib.request import urlopen


RELEASES = {
    "openwrt": ("23.05.6", "24.10.8", "25.12.6"),
    "immortalwrt": ("23.05.7", "24.10.7", "25.12.1", "25.12.2"),
}
PREFERRED_TARGETS = ("ramips/mt7621", "ath79/generic", "ipq40xx/generic",
                     "mediatek/filogic", "x86/64", "starfive/generic", "loongarch64/generic")
# These Malta SDKs can ship without profiles.json. The target.mk files define
# the endianness and CPU family used in the corresponding package indexes.
MALTA_ARCHITECTURES = {"malta/be64": "mips64_mips64r2", "malta/le64": "mips64el_mips64r2"}
SDK_NAME = re.compile(r"[\da-f]{64}\s+\*?([^\s]+-sdk-[^\s]+\.Linux-x86_64\.tar\.(?:xz|zst|gz))")


def fetch(url, optional=False):
    for attempt in range(3):
        try:
            with urlopen(url, timeout=20) as response:
                return response.read().decode()
        except HTTPError as error:
            if error.code == 404 and optional:
                return None
            if error.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise
        except (URLError, TimeoutError):
            if attempt == 2:
                raise
        sleep(2 ** attempt)


class DirectoryIndex(HTMLParser):
    def __init__(self):
        super().__init__()
        self.entries = set()

    def handle_starttag(self, tag, attrs):
        href = dict(attrs).get("href") or ""
        if tag == "a" and re.fullmatch(r"[\w.+-]+/", href) and href != "../":
            self.entries.add(href.rstrip("/"))


def directories(url):
    index = DirectoryIndex()
    index.feed(fetch(url))
    if not index.entries:
        raise ValueError(f"No directories in {url}")
    return sorted(index.entries)


def subtargets(item):
    base, target = item
    return [(base, f"{target}/{subtarget}") for subtarget in directories(f"{base}targets/{target}/")]


def profile(item):
    base, target = item
    url = f"{base}targets/{target}/"
    metadata = fetch(url + "profiles.json", optional=True)
    if metadata:
        arch = json.loads(metadata).get("arch_packages")
        if arch:
            return base, target, arch
    if target in MALTA_ARCHITECTURES:
        return base, target, MALTA_ARCHITECTURES[target]
    return None


def sdk_row(project, version, base, target, arch):
    url = f"{base}targets/{target}/"
    checksums = fetch(url + "sha256sums", optional=True) or ""
    for line in checksums.splitlines():
        match = SDK_NAME.fullmatch(line)
        if match:
            return {
                "name": f"{project}-{version}-{target.replace('/', '-')}",
                "architecture": arch,
                "format": "apk" if version.startswith("25.12.") else "ipk",
                "sdk": url + match[1],
                "sha256": line.split()[0],
            }
    return None


def target_priority(target):
    return (PREFERRED_TARGETS.index(target) if target in PREFERRED_TARGETS else len(PREFERRED_TARGETS), target)


def architecture_row(item):
    (project, version, base), arch, targets = item
    for target in sorted(targets, key=target_priority):
        row = sdk_row(project, version, base, target, arch)
        if row:
            return row
    return None


def main():
    releases = [(project, version, f"https://downloads.{project}.org/releases/{version}/")
                for project, versions in RELEASES.items() for version in versions]
    with ThreadPoolExecutor(max_workers=24) as pool:
        architectures = list(pool.map(directories, (base + "packages/" for _, _, base in releases)))
        targets = pool.map(directories, (base + "targets/" for _, _, base in releases))
        target_pairs = [(base, target) for (_, _, base), names in zip(releases, targets) for target in names]
        profile_pairs = [pair for group in pool.map(subtargets, target_pairs) for pair in group]
        candidates = {base: {} for _, _, base in releases}
        for result in pool.map(profile, profile_pairs):
            if result:
                base, target, arch = result
                candidates[base].setdefault(arch, []).append(target)
        inputs = [(release, arch, candidates[release[2]].get(arch, ()))
                  for release, expected in zip(releases, architectures) for arch in expected]
        rows = list(pool.map(architecture_row, inputs))
    missing = [f"{release[0]} {release[1]} {arch}"
               for (release, arch, _), row in zip(inputs, rows) if row is None]
    if missing:
        raise ValueError("No official Linux x86_64 SDK for: " + ", ".join(missing))
    for (project, version, _), expected in zip(releases, architectures):
        print(f"{project} {version}: {len(expected)} architectures")
    output = Path(__file__).with_name("sdk-matrix.json")
    output.write_text(json.dumps({"include": rows}, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
