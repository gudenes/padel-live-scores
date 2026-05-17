#!/usr/bin/env python3
"""
Generate the full iOS App Icon set into ios/App/App/Assets.xcassets/AppIcon.appiconset.

iOS bundles a Contents.json manifest plus one PNG per device/size combo.
The marketing icon (1024×1024) is what App Store Connect shows on the
listing; the rest are used by the OS for home screen, settings,
Spotlight, notifications, etc.

Source: public/padelNachos - Branding/Padel Nachos tranparent background.png
        — re-rendered onto a #0A0A0A black canvas with 10% padding so the
        round-rect mask from iOS doesn't crop the logo.

Run:
    python3 scripts/generate-ios-icons.py
"""

import json
from pathlib import Path
from PIL import Image

SRC_LOGO = Path("public/padelNachos - Branding/Padel Nachos tranparent background.png")
OUT_DIR = Path("ios/App/App/Assets.xcassets/AppIcon.appiconset")

BG = (10, 10, 10)
PADDING_PCT = 0.10  # 10% inset so iOS round-rect mask never clips the logo

# (size_in_pt, scale, role, idiom) — iOS spec for iPhone + iPad
# `role`/`idiom` map to Apple's Asset Catalog schema; flat list because
# iOS 14+ groups them this way in Contents.json.
ICON_SPEC = [
    # iPhone
    (20, 2, "iphone", "iphone-20-2x.png"),
    (20, 3, "iphone", "iphone-20-3x.png"),
    (29, 2, "iphone", "iphone-29-2x.png"),
    (29, 3, "iphone", "iphone-29-3x.png"),
    (40, 2, "iphone", "iphone-40-2x.png"),
    (40, 3, "iphone", "iphone-40-3x.png"),
    (60, 2, "iphone", "iphone-60-2x.png"),
    (60, 3, "iphone", "iphone-60-3x.png"),
    # iPad
    (20, 1, "ipad", "ipad-20-1x.png"),
    (20, 2, "ipad", "ipad-20-2x.png"),
    (29, 1, "ipad", "ipad-29-1x.png"),
    (29, 2, "ipad", "ipad-29-2x.png"),
    (40, 1, "ipad", "ipad-40-1x.png"),
    (40, 2, "ipad", "ipad-40-2x.png"),
    (76, 1, "ipad", "ipad-76-1x.png"),
    (76, 2, "ipad", "ipad-76-2x.png"),
    (83.5, 2, "ipad", "ipad-83.5-2x.png"),
    # App Store marketing icon (used in listing + TestFlight)
    (1024, 1, "ios-marketing", "ios-marketing-1024-1x.png"),
]


def render_icon(size_px: int, dest: Path) -> None:
    canvas = Image.new("RGBA", (size_px, size_px), BG + (255,))
    logo = Image.open(SRC_LOGO).convert("RGBA")
    inset = int(size_px * PADDING_PCT)
    inner = size_px - 2 * inset
    # Preserve aspect ratio
    w, h = logo.size
    scale = inner / max(w, h)
    logo_resized = logo.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    # Center
    x = (size_px - logo_resized.width) // 2
    y = (size_px - logo_resized.height) // 2
    canvas.paste(logo_resized, (x, y), logo_resized)
    # 1024 marketing icon must be opaque (no alpha) — App Store Connect
    # rejects PNG with alpha. Strip it for that variant; keep RGBA elsewhere
    # so iOS round-rect masking has a clean edge.
    if size_px == 1024:
        canvas = canvas.convert("RGB")
    canvas.save(dest, "PNG", optimize=True)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    contents = {"images": [], "info": {"author": "xcode", "version": 1}}
    for size_pt, scale, idiom, filename in ICON_SPEC:
        size_px = int(round(size_pt * scale))
        path = OUT_DIR / filename
        render_icon(size_px, path)
        contents["images"].append({
            "size": f"{size_pt}x{size_pt}",
            "idiom": idiom,
            "filename": filename,
            "scale": f"{scale}x",
        })
        print(f"  → {filename} ({size_px}×{size_px})")
    (OUT_DIR / "Contents.json").write_text(json.dumps(contents, indent=2))
    print(f"\n✓ {len(ICON_SPEC)} icons written to {OUT_DIR}")


if __name__ == "__main__":
    main()
