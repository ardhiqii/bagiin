#!/usr/bin/env python3
"""Ubah beberapa frame kunci jadi sprite animasi yang mulus (24–30 fps).

Kenapa tidak minta model menggambar 24 frame: model gambar tidak menjaga benda
yang sama di 24 frame berturut-turut. Yang terbukti stabil adalah beberapa frame
kunci (6–8). Jadi: frame kunci dari model, lalu **interpolasi gerak** (ffmpeg
`minterpolate`, mode mci/aobmc) mengisi antaranya, seperti alat retiming video.

Pemakaian:
    python3 scripts/buat-sprite.py --folder /tmp/fold-8 --jumlah 24 \
        --sel 160x214 --angker bawah --keluar out.webp

Catatan penting:
- **Satu faktor skala untuk semua frame**, dihitung dari frame pertama. Kalau tiap
  frame diskalakan sendiri-sendiri, bendanya terlihat menyusut/berubah ukuran.
- `--angker bawah` menempelkan kaki benda ke garis yang sama (struk terlipat);
  `--angker tengah` memusatkan benda (stempel).
- Latar putih dibuang jadi transparan, dengan tepi dihaluskan 0,6 px.
"""
import argparse
import glob
import os
import shutil
import subprocess
import tempfile

from PIL import Image, ImageFilter

KUNCI_FPS = 8.0


def baca_kunci(folder, pola):
    berkas = sorted(glob.glob(os.path.join(folder, pola)))
    if not berkas:
        raise SystemExit('tidak ada frame di %s/%s' % (folder, pola))
    return berkas


def interpolasi(berkas, jumlah, kerja):
    """Frame kunci -> video -> interpolasi gerak -> frame PNG sebanyak `jumlah`."""
    fps_kunci = KUNCI_FPS
    durasi = len(berkas) / fps_kunci
    # minterpolate membuang frame yang menurutnya kembar, jadi minta dua kali
    # lebih banyak dari yang dibutuhkan lalu ambil merata.
    fps_target = max(4.0, (jumlah / durasi) * 2)

    # Nama berurutan supaya ffmpeg membacanya dalam urutan yang benar.
    for i, path in enumerate(berkas):
        shutil.copy(path, os.path.join(kerja, 'k%04d.png' % (i + 1)))

    pola = os.path.join(kerja, 'k%04d.png')
    kunci = os.path.join(kerja, 'kunci.mp4')
    mulus = os.path.join(kerja, 'mulus.mp4')
    subprocess.run(
        ['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(fps_kunci), '-i', pola,
         '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '10', kunci], check=True)
    subprocess.run(
        ['ffmpeg', '-y', '-loglevel', 'error', '-i', kunci,
         '-vf', 'minterpolate=fps=%.4f:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1' % fps_target,
         '-c:v', 'libx264', '-crf', '10', '-pix_fmt', 'yuv420p', mulus], check=True)

    keluaran = os.path.join(kerja, 'm%04d.png')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', mulus, '-vsync', '0', keluaran], check=True)
    hasil = sorted(glob.glob(os.path.join(kerja, 'm*.png')))
    if len(hasil) < jumlah:
        raise SystemExit('interpolasi menghasilkan %d frame, kurang dari %d' % (len(hasil), jumlah))
    # Ambil merata sebanyak `jumlah` frame, supaya sprite-nya persis N sel.
    if len(hasil) > jumlah:
        langkah = len(hasil) / jumlah
        hasil = [hasil[min(len(hasil) - 1, int(i * langkah))] for i in range(jumlah)]
    return hasil


def transparan(path, halus=0):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    px = im.load()
    bg = px[2, 2]
    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > 40:
                xs.append(x)
                ys.append(y)
    if not xs:
        raise SystemExit('frame kosong: %s' % path)
    im = im.crop((min(xs), min(ys), max(xs) + 1, max(ys) + 1))
    lebar, tinggi = im.size
    src = im.load()
    alpha = Image.new('L', im.size, 0)
    ap = alpha.load()
    for y in range(tinggi):
        for x in range(lebar):
            r, g, b = src[x, y]
            jarak = abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2])
            ap[x, y] = 255 if jarak > 60 else (0 if jarak < 24 else int(255 * (jarak - 24) / 36))
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.6))
    out = im.convert('RGBA')
    out.putalpha(alpha)
    # Butir kertas halus adalah biaya terbesar WebP: 24 frame dengan grain utuh
    # 260 KB, sedangkan grain yang dihaluskan 3 px jadi 128 KB pada ukuran tampil
    # yang sama. Di 112 px butirnya tidak terlihat; yang terlihat cuma beratnya.
    if halus > 0:
        out = out.filter(ImageFilter.MedianFilter(2 * halus + 1))
    return out


def rakit(gambar, sel_w, sel_h, angker, keluar, kualitas):
    skala = (sel_h * 0.96) / gambar[0].height   # satu skala, dari frame pertama
    sheet = Image.new('RGBA', (sel_w * len(gambar), sel_h), (0, 0, 0, 0))
    for i, im in enumerate(gambar):
        lebar = max(1, round(im.width * skala))
        tinggi = max(1, round(im.height * skala))
        kecil = im.resize((lebar, tinggi), Image.LANCZOS)
        x = i * sel_w + sel_w // 2 - lebar // 2
        y = sel_h - tinggi if angker == 'bawah' else (sel_h - tinggi) // 2
        sheet.alpha_composite(kecil, (x, max(0, y)))
    sheet.save(keluar, 'WEBP', quality=kualitas, method=6)
    print('%s  %dx%d  %d B  (%d sel)' % (keluar, sheet.width, sheet.height, os.path.getsize(keluar), len(gambar)))


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--folder', required=True)
    p.add_argument('--pola', default='*.png')
    p.add_argument('--jumlah', type=int, default=24)
    p.add_argument('--sel', default='160x214', help='lebar x tinggi satu sel, px')
    p.add_argument('--angker', choices=['bawah', 'tengah'], default='bawah')
    p.add_argument('--keluar', required=True)
    p.add_argument('--kualitas', type=int, default=82)
    p.add_argument('--halus', type=int, default=1, help='median filter radius; 0 = grain utuh')
    a = p.parse_args()

    sel_w, sel_h = (int(v) for v in a.sel.lower().split('x'))
    berkas = baca_kunci(a.folder, a.pola)
    with tempfile.TemporaryDirectory() as kerja:
        frame = interpolasi(berkas, a.jumlah, kerja)
        gambar = [transparan(f, a.halus) for f in frame]
    rakit(gambar, sel_w, sel_h, a.angker, a.keluar, a.kualitas)


if __name__ == '__main__':
    main()
