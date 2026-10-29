#!/usr/bin/env python3
"""Build/check the unpacked Scout download from tracked runtime source."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "extensions/scouting-video-overlay"


def package():
    version = json.loads((SOURCE / "manifest.json").read_text())["version"]
    tracked = subprocess.check_output(
        ["git", "ls-files", "-z", "extensions/scouting-video-overlay"], cwd=ROOT
    ).decode().split("\0")
    entries = {}
    for name in filter(None, tracked):
        file = ROOT / name
        relative = file.relative_to(SOURCE)
        if relative.parts[0] in {"assets", "generated"} or (
            len(relative.parts) == 1
            and file.suffix in {".mjs", ".js", ".css", ".html", ".json"}
        ):
            entries["padel-nachos-scout/" + relative.as_posix()] = file.read_bytes()
    for name in ("Install-on-Mac.command", "Install-on-Windows.cmd", "START-HERE.html"):
        entries[name] = (SOURCE / "distribution" / name).read_bytes().replace(
            b"{{VERSION}}", version.encode()
        )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(entries.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = (0o100755 if name.endswith(".command") else 0o100644) << 16
            archive.writestr(info, data)
    return version, buffer.getvalue(), len(entries)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if published files differ from source")
    args = parser.parse_args()
    version, data, count = package()
    name = f"padel-nachos-scout-{version}"
    directory = ROOT / "apps/ops/public/downloads"
    outputs = {
        directory / (name + ".zip"): data,
        directory / (name + ".sha256"): (hashlib.sha256(data).hexdigest() + "  " + name + ".zip\n").encode(),
    }
    header = (ROOT / "apps/ops/src/components/shell/GlobalHeader.tsx").read_text()
    if f"/downloads/{name}.zip" not in header:
        raise SystemExit("Admin download link must match manifest version")
    for path, contents in outputs.items():
        if args.check:
            if not path.exists() or path.read_bytes() != contents:
                raise SystemExit(f"Stale package: {path.relative_to(ROOT)}; run python3 scripts/package-scout.py")
        else:
            path.write_bytes(contents)
    print(f"Scout {version}: {count} files; {'verified' if args.check else 'packaged'} SHA-256 {hashlib.sha256(data).hexdigest()}")
