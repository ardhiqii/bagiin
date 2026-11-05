#!/usr/bin/env python3
"""Bikin 24 frame rata dari sekumpulan frame asli yang jaraknya tidak rata.

Kenapa perlu: model gambar bisa menjaga benda yang sama kalau tiap frame dibuat
sebagai **edit** dari frame sebelumnya (terbukti: tepi bawah tetap di y=1070,
lebar cuma bergeser 4%), tetapi ia **tidak bisa** diminta "lipat 3,5% lebih" —
hasilnya kadang berhenti (dua frame hampir sama), kadang melompat 88 px. Kalau
frame-frame itu diputar apa adanya, geraknya tersendat lalu melompat.

Jadi: frame asli dipakai sebagai art, dan **jaraknya diratakan** dengan mencampur
dua frame yang mengapit tiap target. Kalau celahnya lebar, campuran terlihat
sedikit dobel — dicatat, bukan disembunyikan; yang dihilangkan adalah lompatan.

Pemakaian:
    python3 scripts/ratakan-frame.py --folder /tmp/fold-edit --pola 'e*.png' \
        --jumlah 24 --keluar /tmp/rata
"""
import argparse
import glob
import os

from PIL import Image


def ukuran_benda(path, ukur):
    """Seberapa jauh gerakannya jalan. Untuk lipatan: baris teratas benda (kertas
    makin pendek). Untuk benda yang berputar seperti koin: lebarnya."""
    im = Image.open(path).convert('RGB')
    px = im.load()
    xs, ys = [], []
    for y in range(0, im.height):
        for x in range(0, im.width):
            r, g, b = px[x, y]
            if abs(r - 255) + abs(g - 255) + abs(b - 255) > 40:
                xs.append(x)
                ys.append(y)
    if not xs:
        return 0
    return min(ys) if ukur == 'atas' else (max(xs) - min(xs))


def transparan(path):
    im = Image.open(path).convert('RGB')
    px = im.load()
    bg = px[2, 2]
    xs, ys = [], []
    for y in range(im.height):
        for x in range(im.width):
            r, g, b = px[x, y]
            if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > 40:
                xs.append(x)
                ys.append(y)
    im = im.crop((min(xs), min(ys), max(xs) + 1, max(ys) + 1))
    latar = Image.new('RGB', im.size, (255, 255, 255))
    latar.paste(im, (0, 0))
    return latar


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--folder', required=True)
    p.add_argument('--pola', default='*.png')
    p.add_argument('--jumlah', type=int, default=24)
    p.add_argument('--keluar', required=True)
    p.add_argument('--ukur', choices=['atas', 'lebar'], default='atas',
                   help='atas: tinggi benda (lipatan); lebar: lebar benda (putaran)')
    a = p.parse_args()

    berkas = sorted(glob.glob(os.path.join(a.folder, a.pola)))
    if len(berkas) < 2:
        raise SystemExit('butuh minimal dua frame')
    tinggi = {b: ukuran_benda(b, a.ukur) for b in berkas}
    lo, hi = min(tinggi.values()), max(tinggi.values())
    if hi == lo:
        raise SystemExit('semua frame berukuran sama; tidak ada gerak untuk diratakan')
    # Untuk putaran koin, makin lebar = makin jauh dari tepi; progresnya tetap
    # dibalik supaya urutannya sama seperti frame aslinya.
    progres = {b: (v - lo) / (hi - lo) for b, v in tinggi.items()}
    urut = sorted(berkas, key=lambda k: progres[k])

    os.makedirs(a.keluar, exist_ok=True)
    # Pencampuran dilakukan pada kanvas asli (semua frame berukuran sama);
    # pemotongan dan transparansi dikerjakan buat-sprite.py setelahnya.
    gambar = {b: Image.open(b).convert('RGB') for b in urut}
    ukuran = gambar[urut[0]].size

    dobel = 0
    for i in range(a.jumlah):
        t = i / (a.jumlah - 1)
        kiri = max([b for b in urut if progres[b] <= t] or [urut[0]], key=lambda k: progres[k])
        kanan = min([b for b in urut if progres[b] >= t] or [urut[-1]], key=lambda k: progres[k])
        if progres[kanan] - progres[kiri] < 1e-6 or kiri == kanan:
            hasil = gambar[kiri]
        else:
            bobot = (t - progres[kiri]) / (progres[kanan] - progres[kiri])
            if 0.03 < bobot < 0.97:
                dobel += 1
            hasil = Image.blend(gambar[kiri], gambar[kanan], bobot)
        hasil.save(os.path.join(a.keluar, 'r%02d.png' % (i + 1)))
    print('keluar %d frame di %s (%d frame hasil campuran)' % (a.jumlah, a.keluar, dobel))


if __name__ == '__main__':
    main()
