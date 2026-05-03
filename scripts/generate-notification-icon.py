#!/usr/bin/env python3
"""
Generate the Android notification small-icon set (ic_stat_padelnachos)
from the transparent paddle PNG.

Android masks notification small icons: any opaque pixel becomes pure
white (in default tint mode), any transparent pixel stays transparent.
So we pre-bake that — load the source, set every opaque RGB to white
while preserving alpha, then resize to each density bucket.

Sizes per Android material guidelines:
  mdpi    24x24
  hdpi    36x36
  xhdpi   48x48
  xxhdpi  72x72
  xxxhdpi 96x96
"""

from pathlib import Path
from PIL import Image

SRC = Path("public/padelNachos - Branding/Padel Nachoss transparent background_1.png")
NAME = "ic_stat_padelnachos"
RES_ROOT = Path("android/app/src/main/res")

DENSITIES = {
    "drawable-mdpi": 24,
    "drawable-hdpi": 36,
    "drawable-xhdpi": 48,
    "drawable-xxhdpi": 72,
    "drawable-xxxhdpi": 96,
}

# Threshold below which alpha is treated as transparent — drops anti-alias
# wisps that would render as ghost pixels at tiny sizes.
ALPHA_CUTOFF = 32


def to_silhouette(im: Image.Image) -> Image.Image:
    """White-on-transparent silhouette."""
    im = im.convert("RGBA")
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    pixels = im.load()
    out_pixels = out.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = pixels[x, y]
            if a >= ALPHA_CUTOFF:
                out_pixels[x, y] = (255, 255, 255, a)
    return out


def main() -> None:
    src = Image.open(SRC)
    print(f"loaded {SRC} {src.size}")

    silhouette = to_silhouette(src)
    print("silhouette built")

    for folder, size in DENSITIES.items():
        target_dir = RES_ROOT / folder
        target_dir.mkdir(parents=True, exist_ok=True)
        resized = silhouette.resize((size, size), Image.LANCZOS)
        out_path = target_dir / f"{NAME}.png"
        resized.save(out_path, "PNG", optimize=True)
        print(f"  → {out_path} ({size}x{size})")


if __name__ == "__main__":
    main()
