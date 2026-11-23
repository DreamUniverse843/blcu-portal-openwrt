import re
import sys
from pathlib import Path

tag = sys.argv[1]
version = tag.removeprefix("v")
changelog = Path("CHANGELOG.md").read_text(encoding="utf-8")
section = re.search(r"^## " + re.escape(version) + r"\s*\n(.*?)(?=^## |\Z)",
                    changelog, flags=re.M | re.S)
if not section or not section.group(1).strip():
    raise SystemExit(f"No changelog for {tag}")
print(section.group(1).strip())
