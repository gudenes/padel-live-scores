#!/usr/bin/env python3
"""
Compose the Play Store Feature Graphic — 1024×500 banner shown at the top
of the Play listing.

Layout (1024×500 landscape):
  ┌─────────────────────────────────────────────┐
  │ [poly]                            [LOGO]    │
  │                                             │
  │   FOLLOW EVERY POINT                        │
  │   ──                                        │
  │   Live padel scores, rankings & news.       │
  │                                             │
  │ [poly]                                      │
  └─────────────────────────────────────────────┘

The logo + accents mirror the screenshot designs so the listing reads as
one coherent piece.

Usage:
  python3 scripts/compose-feature-graphic.py
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


# Brand tokens — mirror globals.css and Android colors.xml
BG_BLACK = (10, 10, 10)
LIME = (126, 211, 33)
ORANGE = (245, 166, 35)
WHITE = (255, 255, 255)

# Canvas — Play Store feature graphic spec
W, H = 1024, 500

MARGIN_X = 56
MARGIN_Y = 48

# Brand assets
LOGO_PATH = Path("public/padelNachos - Branding/Padel Nachos tranparent background.png")
LOGO_HEIGHT = 90  # smaller than screenshot version since canvas is short

OUT = Path("assets/play-store/feature-graphic.png")


FONT_CANDIDATES_BOLD = [
    "/System/Library/Fonts/SFNS.ttf",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial Bold.ttf",
]
FONT_CANDIDATES_REGULAR = [
    "/System/Library/Fonts/SFNS.ttf",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
]


def load_font(candidates: list[str], size: int) -> ImageFont.FreeTypeFont:
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def draw_corner_accents(draw: ImageDraw.ImageDraw) -> None:
    """Two angular polygon clusters — top-right + bottom-left — to mirror
    the screenshots and bracket the headline diagonally."""
    # Top-right lime slab, partly off-canvas
    tr_lime = [
        (W - 240, 0),
        (W + 60, 0),
        (W + 60, 100),
        (W - 160, 70),
    ]
    draw.polygon(tr_lime, fill=LIME)
    # Top-right orange stripe overlay
    tr_orange = [
        (W - 180, 28),
        (W + 60, 46),
        (W + 60, 72),
        (W - 140, 56),
    ]
    draw.polygon(tr_orange, fill=ORANGE)

    # Bottom-left lime stripe
    bl_lime = [
        (-60, H - 70),
        (220, H - 100),
        (260, H - 50),
        (-60, H + 20),
    ]
    draw.polygon(bl_lime, fill=LIME)


def draw_accent_under_headline(draw: ImageDraw.ImageDraw, x: int, y: int) -> None:
    """Skewed parallelogram — brand's signature accent."""
    skew = 12
    w, h = 80, 7
    points = [(x, y), (x + w, y), (x + w - skew, y + h), (x - skew, y + h)]
    draw.polygon(points, fill=LIME)


def compose() -> None:
    canvas = Image.new("RGB", (W, H), BG_BLACK)
    draw = ImageDraw.Draw(canvas, "RGBA")

    # Polygon accents first (logo sits on top)
    draw_corner_accents(draw)

    # Logo top-left
    if LOGO_PATH.exists():
        logo = Image.open(LOGO_PATH).convert("RGBA")
        scale = LOGO_HEIGHT / logo.height
        logo_resized = logo.resize((int(logo.width * scale), LOGO_HEIGHT), Image.LANCZOS)
        canvas.paste(logo_resized, (MARGIN_X, MARGIN_Y), logo_resized)

    # Headline — vertically centered in the middle band
    headline_font = load_font(FONT_CANDIDATES_BOLD, 64)
    headline = "FOLLOW EVERY POINT"
    bbox = draw.textbbox((0, 0), headline, font=headline_font)
    headline_h = bbox[3] - bbox[1]
    headline_y = (H - headline_h) // 2 - 20
    draw.text((MARGIN_X, headline_y), headline, fill=WHITE, font=headline_font)

    # Lime accent under the headline
    accent_y = headline_y + headline_h + 20
    draw_accent_under_headline(draw, MARGIN_X, accent_y)

    # Sub-headline
    sub_font = load_font(FONT_CANDIDATES_REGULAR, 28)
    sub_y = accent_y + 28
    draw.text((MARGIN_X, sub_y), "Live padel scores, rankings & news.", fill=(200, 200, 200), font=sub_font)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT, "PNG", optimize=True)
    print(f"saved {OUT} ({W}x{H})")


if __name__ == "__main__":
    compose()
