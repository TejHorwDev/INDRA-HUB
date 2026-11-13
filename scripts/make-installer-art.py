#!/usr/bin/env python3
"""
Builds the Windows installer's artwork from code, so it can be regenerated and
reviewed instead of living as a mystery binary.

Outputs (all committed, all consumed by electron-builder):

  build/icon.ico               app icon: shortcuts, taskbar, Setup.exe itself
  build/installerHeader.ico    the small mark beside the wizard's page titles
  build/installerSidebar.bmp   164x314, the wizard's welcome/finish panel
  build/uninstallerSidebar.bmp same, for the uninstaller
  build/installerHeader.bmp    150x57, the strip above every wizard page
  artifacts/installer-preview-*.png   just for looking at, not part of the build

The mark is a bolt — Indra is the one who throws it — drawn as one filled
polygon so it stays legible at 16 pixels. Monochrome, like the app.

    python3 scripts/make-installer-art.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
PREVIEWS = ROOT / "artifacts"

INK = (11, 11, 11)
PAPER = (255, 255, 255)
QUIET = (138, 138, 138)
HAIRLINE = (229, 229, 229)

FONT_DIR = Path("/opt/freestyle/python/lib/python3.12/site-packages/matplotlib/mpl-data/fonts/ttf")

# The bolt, in a 256-unit square. Six points: a wide top, a kicked middle and a
# sharp tail, which is what stops it reading as a flag at small sizes.
BOLT = [(163, 12), (79, 146), (124, 146), (93, 244), (181, 104), (133, 104)]


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_DIR / name), size)


BOLT_BOX = (79, 12, 181, 244)  # what the polygon above actually covers


def bolt(draw: ImageDraw.ImageDraw, cx: float, cy: float, height: float, fill) -> None:
    """Draws the mark centred on (cx, cy) at a given height, whatever its box."""
    x0, y0, x1, y1 = BOLT_BOX
    scale = height / (y1 - y0)
    ox = cx - ((x0 + x1) / 2) * scale
    oy = cy - ((y0 + y1) / 2) * scale
    draw.polygon([(ox + px * scale, oy + py * scale) for px, py in BOLT], fill=fill)


def spaced(draw, xy, text, fnt, fill, tracking=0.0, anchor_right=None):
    """Text with letter spacing — PIL has none, and the look depends on it."""
    widths = [draw.textlength(ch, font=fnt) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x = (anchor_right - total) if anchor_right is not None else xy[0]
    for ch, w in zip(text, widths):
        draw.text((x, xy[1]), ch, font=fnt, fill=fill)
        x += w + tracking
    return total


def main() -> None:
    BUILD.mkdir(exist_ok=True)
    PREVIEWS.mkdir(exist_ok=True)

    # ---- app icon -------------------------------------------------------
    size = 1024
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(icon)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * 0.22), fill=INK)
    bolt(d, size / 2, size / 2, size * 0.66, PAPER)
    # Centre the mark: the polygon spans 79..181 horizontally of 256.
    icon.save(BUILD / "icon.ico", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    icon.resize((512, 512), Image.LANCZOS).save(PREVIEWS / "installer-preview-icon.png")

    # The wizard's little header icon sits on white, so it is the mark alone.
    header_icon = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    hd = ImageDraw.Draw(header_icon)
    hd.rounded_rectangle((0, 0, 63, 63), radius=14, fill=INK)
    bolt(hd, 32, 32, 40, PAPER)
    header_icon.save(BUILD / "installerHeader.ico", sizes=[(64, 64), (48, 48), (32, 32)])

    # ---- sidebar 164x314 ------------------------------------------------
    side = Image.new("RGB", (164, 314), INK)
    sd = ImageDraw.Draw(side)

    bolt(sd, 46, 58, 58, PAPER)

    spaced(sd, (24, 96), "INDRA", font("DejaVuSans-Bold.ttf", 30), PAPER, tracking=1.0)
    spaced(sd, (24, 132), "HUB", font("DejaVuSans-Bold.ttf", 30), PAPER, tracking=1.0)

    sd.line((24, 190, 64, 190), fill=QUIET, width=1)

    spaced(sd, (24, 204), "DESKTOP", font("DejaVuSansMono-Bold.ttf", 9), QUIET, tracking=1.8)
    spaced(sd, (24, 218), "WORKSPACE", font("DejaVuSansMono-Bold.ttf", 9), QUIET, tracking=1.8)

    spaced(sd, (24, 282), "TEJHORWDEV", font("DejaVuSansMono-Bold.ttf", 7), QUIET, tracking=1.4)

    side.save(BUILD / "installerSidebar.bmp")
    side.save(BUILD / "uninstallerSidebar.bmp")
    side.save(PREVIEWS / "installer-preview-sidebar.png")

    # ---- header 150x57 --------------------------------------------------
    header = Image.new("RGB", (150, 57), PAPER)
    hdr = ImageDraw.Draw(header)
    header.paste((0, 0, 0), (0, 0, 150, 57)) if False else None
    bold = font("DejaVuSans-Bold.ttf", 10)
    word = "INDRA HUB"
    tracking = 0.9
    width = sum(hdr.textlength(c, font=bold) for c in word) + tracking * (len(word) - 1)
    right = 150 - 12
    left = right - width
    bolt(hdr, left - 9, 28, 22, INK)
    spaced(hdr, (left, 23), word, bold, INK, tracking=tracking)
    hdr.line((0, 56, 149, 56), fill=HAIRLINE, width=1)
    header.save(BUILD / "installerHeader.bmp")
    header.resize((300, 114), Image.NEAREST).save(PREVIEWS / "installer-preview-header.png")

    for name in (
        "icon.ico",
        "installerHeader.ico",
        "installerSidebar.bmp",
        "uninstallerSidebar.bmp",
        "installerHeader.bmp",
    ):
        path = BUILD / name
        print(f"{name:26} {path.stat().st_size:>7} bytes")


if __name__ == "__main__":
    main()
