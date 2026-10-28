#!/usr/bin/env python3
"""Membuat og-cover.png versi 1.0 (design system Seimbang).

Alasan ada skrip, bukan gambar jadi yang ditempel: cover lama masih memakai
palet 0.9 (krem + oranye). Preview link adalah hal pertama yang dilihat orang
di WhatsApp, jadi kalau warnanya beda dari aplikasinya, produknya terlihat dua.
Dengan skrip, warna diambil dari DESIGN_SYSTEM dan bisa dibuat ulang kapan saja.

Jalankan: python3 scripts/make-og-cover.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Token dari frontend/src/design-system.css
BG = (242, 246, 246)          # --ds-bg
BG_DEEP = (232, 239, 239)     # --ds-bg-deep
SURFACE = (255, 255, 255)     # --ds-surface
NAVY = (20, 47, 58)           # --ds-navy
TEAL = (8, 118, 101)          # --ds-teal
TEAL_DEEP = (10, 93, 80)
MINT = (230, 242, 239)        # --ds-mint
MUTED = (74, 92, 94)
BORDER = (214, 226, 226)

W, H = 1200, 630
FONT_DIR = Path("/usr/share/fonts/truetype/noto")
OUT = Path(__file__).resolve().parent.parent / "frontend" / "public" / "og-cover.png"


def font(size: int, weight: str = "Regular") -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_DIR / f"NotoSans-{weight}.ttf"), size)


def receipt_glyph(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int) -> None:
    """Struk dengan tepi bawah bergerigi, putih di atas kotak teal."""
    draw.rounded_rectangle([x, y, x + w, y + h - 10], radius=6, fill=SURFACE)
    teeth = 5
    step = w / teeth
    for i in range(teeth):
        left = x + i * step
        draw.polygon(
            [(left, y + h - 12), (left + step / 2, y + h), (left + step, y + h - 12)],
            fill=SURFACE,
        )
    # tiga baris teks struk
    line_w = int(w * 0.52)
    for i, offset in enumerate((16, 30, 44)):
        draw.rounded_rectangle(
            [x + 12, y + offset, x + 12 + (line_w if i < 2 else int(line_w * 0.6)), y + offset + 5],
            radius=3,
            fill=TEAL,
        )


def card(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, initials: str, name: str, amount: str) -> None:
    draw.rounded_rectangle([x, y + 3, x + w, y + h + 3], radius=28, fill=BG_DEEP)
    draw.rounded_rectangle([x, y, x + w, y + h], radius=28, fill=SURFACE, outline=BORDER, width=2)
    badge = 52
    bx, by = x + 20, y + (h - badge) // 2
    draw.rounded_rectangle([bx, by, bx + badge, by + badge], radius=14, fill=MINT)
    f_init = font(20, "Bold")
    tw = draw.textbbox((0, 0), initials, font=f_init)
    draw.text((bx + (badge - (tw[2] - tw[0])) / 2, by + (badge - (tw[3] - tw[1])) / 2 - 3), initials, font=f_init, fill=TEAL)
    draw.text((bx + badge + 18, y + h / 2 - 17), name, font=font(27, "Bold"), fill=NAVY)
    f_amt = font(27, "Bold")
    aw = draw.textbbox((0, 0), amount, font=f_amt)
    draw.text((x + w - 24 - (aw[2] - aw[0]), y + h / 2 - 17), amount, font=f_amt, fill=NAVY)


def main() -> None:
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    # logo
    draw.rounded_rectangle([80, 72, 176, 168], radius=24, fill=TEAL)
    draw.rounded_rectangle([80, 72, 176, 140], radius=24, fill=TEAL_DEEP)
    receipt_glyph(draw, 100, 90, 56, 62)
    draw.text((202, 84), "Bagiin", font=font(64, "Bold"), fill=NAVY)

    # judul
    draw.text((80, 208), "Bagi bill bareng", font=font(72, "Bold"), fill=NAVY)
    draw.text((80, 292), "tanpa ribet.", font=font(72, "Bold"), fill=TEAL)

    # penjelasan
    body = font(30)
    draw.text((80, 424), "Foto struk, bagikan tautan,", font=body, fill=MUTED)
    draw.text((80, 466), "semua memilih itemnya sendiri.", font=body, fill=MUTED)
    draw.text((80, 508), "Pajak terbagi otomatis. Tanpa akun.", font=body, fill=MUTED)

    draw.text((80, 576), "bagiin-react.ardhiqi.com", font=font(27, "Bold"), fill=TEAL)

    # kartu hasil
    cards = [
        ("BU", "Budi", "Rp 81.667"),
        ("DI", "Dina", "Rp 122.500"),
        ("CI", "Cici", "Rp 41.333"),
    ]
    top, gap, ch, cw, cx = 169, 15, 92, 384, 736
    for i, (initials, name, amount) in enumerate(cards):
        card(draw, cx, top + i * (ch + gap), cw, ch, initials, name, amount)

    img.save(OUT, optimize=True)
    print(f"ditulis: {OUT} ({img.size[0]}x{img.size[1]})")


if __name__ == "__main__":
    main()
