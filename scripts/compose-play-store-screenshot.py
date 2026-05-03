#!/usr/bin/env python3
"""
Compose a single Play Store screenshot from a raw app capture.

Layout (1080x1920 portrait):
  ┌────────────────────────────┐
  │ [LOGO]            [poly]   │  60px top
  │                            │
  │ HEADLINE 2 LINES           │  ~280px
  │ ────                       │
  │ Sub-headline               │
  │                            │
  ├────────────────────────────┤
  │                            │
  │   [CENTERED SCREENSHOT]    │  ~1500px tall
  │ [poly]                     │
  └────────────────────────────┘

Usage:
  python3 scripts/compose-play-store-screenshot.py \\
    --raw assets/play-store/raw/06-ranking.png \\
    --headline "Track the top 100." \\
    --sub "Official + race rankings, men and women." \\
    --out assets/play-store/screenshots/preview.png
"""

import argparse
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


# Brand tokens — mirror globals.css and Android colors.xml
BG_BLACK = (10, 10, 10)        # #0A0A0A
LIME = (126, 211, 33)          # #7ED321
ORANGE = (245, 166, 35)        # #F5A623
WHITE = (255, 255, 255)

# Canvas
W, H = 1080, 1920

# Layout constants
HEADER_H = 380
SCREENSHOT_AREA_TOP = HEADER_H
SCREENSHOT_AREA_BOTTOM = H - 60
SCREENSHOT_AREA_H = SCREENSHOT_AREA_BOTTOM - SCREENSHOT_AREA_TOP

MARGIN_X = 80
TOP_MARGIN = 50

# Brand assets
LOGO_PATH = Path("public/padelNachos - Branding/Padel Nachos tranparent background.png")
LOGO_HEIGHT = 130

# Fonts — fall back through a list if a specific one is missing
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


def draw_chunky_polygon(draw: ImageDraw.ImageDraw, points: list[tuple[int, int]], color: tuple) -> None:
    draw.polygon(points, fill=color)


def draw_corner_accents(draw: ImageDraw.ImageDraw) -> None:
    """Polygon accents in two corners — playful, brand-consistent angular shapes."""
    # Top-right: large skewed lime polygon, partially off-canvas
    tr_points = [
        (W - 280, 0),
        (W + 60, 0),
        (W + 60, 110),
        (W - 200, 80),
    ]
    draw.polygon(tr_points, fill=LIME)
    # Top-right inner: orange stripe overlay (chunky double-layer)
    tr_orange = [
        (W - 220, 30),
        (W + 60, 50),
        (W + 60, 80),
        (W - 180, 60),
    ]
    draw.polygon(tr_orange, fill=ORANGE)

    # Bottom-left: angled lime stripe
    bl_points = [
        (-60, H - 50),
        (180, H - 80),
        (220, H - 30),
        (-60, H + 20),
    ]
    draw.polygon(bl_points, fill=LIME)


def draw_accent_under_headline(draw: ImageDraw.ImageDraw, x: int, y: int) -> None:
    """Skewed parallelogram accent — brand's signature chunky polygon."""
    skew = 14
    w, h = 90, 8
    points = [(x, y), (x + w, y), (x + w - skew, y + h), (x - skew, y + h)]
    draw.polygon(points, fill=LIME)


def compose(raw_path: Path, headline: str, sub: str, out: Path) -> None:
    canvas = Image.new("RGB", (W, H), BG_BLACK)
    draw = ImageDraw.Draw(canvas, "RGBA")

    # ─── Corner polygon accents (drawn first so the logo sits on top) ───
    draw_corner_accents(draw)

    # ─── Top wordmark (actual Padel Nachos logo, transparent bg) ─────────
    if LOGO_PATH.exists():
        logo = Image.open(LOGO_PATH).convert("RGBA")
        # Scale to fixed height
        scale = LOGO_HEIGHT / logo.height
        logo_resized = logo.resize((int(logo.width * scale), LOGO_HEIGHT), Image.LANCZOS)
        canvas.paste(logo_resized, (MARGIN_X, TOP_MARGIN), logo_resized)
    else:
        # Fallback to text wordmark
        wordmark_font = load_font(FONT_CANDIDATES_BOLD, 28)
        draw.text((MARGIN_X, TOP_MARGIN), "PADEL NACHOS", fill=LIME, font=wordmark_font)

    # ─── Headline (2 lines max) ──────────────────────────────────────────
    headline_font = load_font(FONT_CANDIDATES_BOLD, 76)
    headline_y = TOP_MARGIN + LOGO_HEIGHT + 30
    headline_lines = wrap_text(headline, headline_font, draw, W - 2 * MARGIN_X)
    line_h = 90
    for i, line in enumerate(headline_lines[:2]):
        draw.text((MARGIN_X, headline_y + i * line_h), line, fill=WHITE, font=headline_font)

    # ─── Lime accent stripe under the headline ───────────────────────────
    accent_y = headline_y + min(len(headline_lines), 2) * line_h + 8
    draw_accent_under_headline(draw, MARGIN_X, accent_y)

    # ─── Sub-headline ────────────────────────────────────────────────────
    sub_font = load_font(FONT_CANDIDATES_REGULAR, 36)
    sub_y = accent_y + 28
    draw.text((MARGIN_X, sub_y), sub, fill=(200, 200, 200), font=sub_font)

    # ─── Screenshot — scaled to fit, centered ────────────────────────────
    raw = Image.open(raw_path).convert("RGBA")
    raw_w, raw_h = raw.size
    scale = SCREENSHOT_AREA_H / raw_h
    target_w, target_h = int(raw_w * scale), int(raw_h * scale)
    raw_resized = raw.resize((target_w, target_h), Image.LANCZOS)
    px = (W - target_w) // 2
    py = SCREENSHOT_AREA_TOP
    canvas.paste(raw_resized, (px, py), raw_resized)
    # Thin lime accent line at the top of the screenshot
    draw.rectangle([px, py, px + target_w, py + 4], fill=LIME)

    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out, "PNG", optimize=True)
    print(f"saved {out} ({W}x{H})")


def wrap_text(text: str, font, draw, max_w: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for w in words:
        candidate = (current + " " + w).strip()
        bbox = draw.textbbox((0, 0), candidate, font=font)
        if bbox[2] - bbox[0] > max_w and current:
            lines.append(current)
            current = w
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True, type=Path)
    ap.add_argument("--headline", required=True)
    ap.add_argument("--sub", required=True)
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()
    compose(args.raw, args.headline, args.sub, args.out)


if __name__ == "__main__":
    main()
