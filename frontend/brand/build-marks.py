#!/usr/bin/env python3
"""Sumber geometri mark Bagiin: dua kartu struk bertumpuk (navy + amber).

Kenapa skrip, bukan SVG manual: mark ini harus konsisten di tujuh ukuran dan
tiga varian (tile, transparan, maskable). Menulisnya tangan berarti suatu hari
salah satu varian punya radius atau offset yang beda 2 unit, dan tidak ada yang
sadar sampai favicon terlihat aneh di 16 px.

Menjalankan: python3 frontend/brand/build-marks.py
Hasil: frontend/public/{favicon.svg,logo.svg,icon-maskable-src.svg} + brand/favicon-16.svg
"""
import pathlib

NAVY = "#142F3A"
AMBER = "#C98A2E"
PAPER = "#FBFAF6"

HERE = pathlib.Path(__file__).resolve().parent
PUB = HERE.parent / "public"


def card(x, y, w, h, rx, fill, teeth=3, tooth_h=30.0):
    """Kartu sudut membulat dengan tepi bawah bergerigi (opsional)."""
    body_h = h - (tooth_h if teeth else 0)
    d = [f"M {x} {y + rx}", f"a {rx} {rx} 0 0 1 {rx} -{rx}",
         f"h {w - 2 * rx}", f"a {rx} {rx} 0 0 1 {rx} {rx}",
         f"v {body_h - rx}"]
    if teeth:
        n = teeth * 2
        step = w / n
        pts = [(x + w - step * i, y + body_h + (tooth_h if i % 2 == 0 else 0.0))
               for i in range(n + 1)]
        d.append(f"L {pts[0][0]:.2f} {pts[0][1]:.2f}")
        for px, py in pts[1:]:
            d.append(f"L {px:.2f} {py:.2f}")
    else:
        d.append(f"L {x + w} {y + body_h}")
    d.append(f"L {x} {y + body_h}")
    d.append("Z")
    return f'<path d="{" ".join(d)}" fill="{fill}"/>'


def build(teeth=3, maskable=False, offset=(0, 0), tile=True):
    pad = 104 if maskable else 0          # 72% safe area untuk ikon maskable
    s = (512 - 2 * pad) / 512.0
    ox, oy = offset
    parts = []
    if tile:
        parts.append(f'<rect width="512" height="512" rx="{0 if maskable else 112}" fill="{PAPER}"/>')
    parts += [
        f'<g transform="translate({pad} {pad}) scale({s})">',
        card(104, 84, 210, 290, 44, NAVY, teeth=teeth),
        card(202 + ox, 156 + oy, 206, 272, 44, AMBER, teeth=teeth),
        "</g>",
    ]
    return "\n".join(parts)


def svg(body):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" '
            'role="img" aria-label="Bagiin">\n' + body + "\n</svg>\n")


PUB.mkdir(parents=True, exist_ok=True)
(PUB / "favicon.svg").write_text(svg(build(teeth=3)))
(PUB / "logo.svg").write_text(svg(build(teeth=3, tile=False)))
(PUB / "icon-maskable-src.svg").write_text(svg(build(teeth=3, maskable=True)))
# 16 px: tanpa gerigi (gerigi = subpiksel) dan kartu depan digeser 18/14,
# karena di 16 px tumpang tindih versi besar terbaca menyatu.
(HERE / "favicon-16.svg").write_text(svg(build(teeth=0, offset=(18, 14))))
print("mark ditulis:", ", ".join(sorted(p.name for p in PUB.glob("*.svg"))), "+ brand/favicon-16.svg")
