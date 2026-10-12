#!/usr/bin/env python3
"""Bump the app version in every source of truth at once (Cargo, Tauri config,
frontend, Cargo lockfile). The updater compares the running build's version,
so a mismatch means missed updates. Usage: scripts/bump-version.sh X.Y.Z"""
import re
import sys
from pathlib import Path

FILES = [
    "src-tauri/tauri.conf.json",
    "frontend/package.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
]


def main() -> None:
    if len(sys.argv) != 2 or not re.fullmatch(r"\d+\.\d+\.\d+", sys.argv[1].lstrip("v")):
        sys.exit("usage: scripts/bump-version.sh X.Y.Z")
    v = sys.argv[1].lstrip("v")
    root = Path(__file__).resolve().parent.parent
    for rel in FILES:
        path = root / rel
        text = path.read_text()
        if rel.endswith("Cargo.lock"):
            # Same version, koutube stanza only: keeps `cargo --locked` green.
            text, n = re.subn(
                r'(?m)(?<=\[\[package\]\]\nname = "koutube"\nversion = ")[^"]*',
                v,
                text,
                count=1,
            )
        elif rel.endswith(".toml"):
            text, n = re.subn(r'(?m)^version = "[^"]*"', f'version = "{v}"', text, count=1)
        else:
            text, n = re.subn(r'"version": "[^"]*"', f'"version": "{v}"', text, count=1)
        if n != 1:
            sys.exit(f"refusing: expected 1 version in {rel}, found {n}")
        path.write_text(text)
    print(f"version -> {v} ({', '.join(FILES)})")


if __name__ == "__main__":
    main()
