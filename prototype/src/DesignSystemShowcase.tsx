import { useState } from 'react'
import {
  ArrowLeft, ArrowRight, Check, CheckCircle, Clock,
  House, Info, Plus, Receipt, WarningCircle, Wallet, X,
} from '@phosphor-icons/react'

const swatches = [
  { name: 'Navy 900', token: '--ds-navy', value: '#142F3A', role: 'Teks utama, kartu saldo, header bill' },
  { name: 'Teal 700', token: '--ds-teal', value: '#087665', role: 'Aksi utama, item terpilih, fokus' },
  { name: 'Fog 50', token: '--ds-bg', value: '#F5F8F8', role: 'Latar layar' },
  { name: 'White', token: '--ds-surface', value: '#FFFFFF', role: 'Kartu, sheet, navigasi' },
  { name: 'Mint 100', token: '--ds-mint', value: '#E2F5EF', role: 'Aksi sekunder, sorotan halus' },
  { name: 'Slate 600', token: '--ds-muted', value: '#536D78', role: 'Teks pendukung' },
]

const semantic = [
  { label: 'Sementara', detail: 'Ada bagian yang menunggu', className: 'ds-status-pending', icon: Clock },
  { label: 'Pembagian lengkap', detail: 'Nominal sudah final', className: 'ds-status-info', icon: CheckCircle },
  { label: 'Lunas', detail: 'Pembayaran ditandai', className: 'ds-status-success', icon: Check },
  { label: 'Kurang bayar', detail: 'Ada selisih setelah revisi', className: 'ds-status-danger', icon: WarningCircle },
]

export function DesignSystemShowcase() {
  const [picked, setPicked] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)

  return <div className="ds-page">
    <header className="ds-topbar">
      <a href="/" aria-label="Kembali ke design lab"><ArrowLeft size={18} /> Design Lab</a>
      <span>Design system / v0.1</span>
    </header>
    <main className="ds-main">
      <section className="ds-hero">
        <div className="ds-eyebrow">Bagiin / Arah terpilih</div>
        <h1>Jelas angkanya.<br /><span>Ringan patungannya.</span></h1>
        <p>Struktur halaman Seimbang, warna Saldo. Komponen di bawah menjadi bahasa visual bersama untuk beranda, bill, rekap, dan editor.</p>
        <div className="ds-hero-actions"><a href="/?v=seimbang">Lihat prototype utama <ArrowRight size={17} /></a><a href="#fondasi">Lihat token</a></div>
      </section>

      <section className="ds-section" id="fondasi">
        <div className="ds-section-heading"><span>01 / Fondasi</span><h2>Warna punya peran.</h2><p>Navy untuk orientasi dan angka utama. Teal untuk hal yang bisa dilakukan. Warna status hanya dipakai saat maknanya memang berbeda.</p></div>
        <div className="ds-swatches">{swatches.map((swatch) => <div className="ds-swatch" key={swatch.token}><div className="ds-swatch-color" style={{ background: `var(${swatch.token})` }} /><div><b>{swatch.name}</b><code>{swatch.value}</code><small>{swatch.role}</small></div></div>)}</div>
      </section>

      <section className="ds-section ds-type-section">
        <div className="ds-section-heading"><span>02 / Tipografi</span><h2>Angka gampang dipindai.</h2><p>Manrope untuk judul. DM Sans untuk isi. Nominal memakai tabular numbers agar angka tidak bergeser saat berubah.</p></div>
        <div className="ds-type-grid"><div><span>Display / 32 · 700</span><strong className="ds-type-display">Rp163.000</strong></div><div><span>Heading / 24 · 700</span><strong className="ds-type-heading">Makan siang bareng</strong></div><div><span>Body / 14 · 400</span><p>Bagianmu dihitung dari item yang dipilih, diskon, service, dan ongkir.</p></div><div><span>Label / 12 · 700</span><b className="ds-type-label">1 BAGIAN MENUNGGU</b></div></div>
      </section>

      <section className="ds-section">
        <div className="ds-section-heading"><span>03 / Komponen</span><h2>Satu bentuk, satu fungsi.</h2><p>Kontrol utama konsisten di semua layar; status tetap menjelaskan sebabnya lewat teks.</p></div>
        <div className="ds-component-grid">
          <article className="ds-specimen"><span className="ds-specimen-label">Saldo & rincian</span><div className="ds-balance-card"><span>Perlu kamu bayar</span><strong>Rp62.120</strong><small>Dari 1 bill, angka masih sementara</small></div><div className="ds-mini-detail"><span>Aufa · Dapur Tiga</span><b>Rp62.120</b></div></article>
          <article className="ds-specimen"><span className="ds-specimen-label">Aksi & input</span><div className="ds-button-stack"><button type="button" className="ds-button ds-button-primary" onClick={() => setSheetOpen(true)}>Tandai lunas <ArrowRight size={17} /></button><button type="button" className="ds-button ds-button-secondary" onClick={() => setSheetOpen(true)}>Lihat rincian</button><button type="button" className="ds-button ds-button-quiet" onClick={() => setPicked((old) => !old)}>Edit pilihan</button></div><label className="ds-input-label" htmlFor="ds-item-name">Nama item</label><input id="ds-item-name" defaultValue="Dimsum platter" /></article>
          <article className="ds-specimen"><span className="ds-specimen-label">Item yang bisa dipilih</span><button type="button" className={`ds-item ${picked ? 'is-picked' : ''}`} onClick={() => setPicked((old) => !old)} aria-pressed={picked}><span className="ds-item-check">{picked && <Check size={15} weight="bold" />}</span><span><b>Dimsum platter</b><small>Dibagi 3 orang · 1 bagian menunggu</small></span><strong>Rp54.000</strong></button><div className="ds-item-note"><Info size={16} /> Ketuk seluruh baris. Warna dan tanda centang menunjukkan pilihan.</div></article>
          <article className="ds-specimen"><span className="ds-specimen-label">Navigasi bawah</span><div className="ds-nav-example"><div className="active"><House size={20} weight="fill" />Beranda</div><div><Receipt size={20} />Bill</div><div><Plus size={20} />Buat</div><div><Wallet size={20} />Rekap</div></div><p className="ds-specimen-foot">Navigasi berada di luar area scroll. Konten dan tombol akhir tidak tertutup.</p></article>
        </div>
      </section>

      <section className="ds-section">
        <div className="ds-section-heading"><span>04 / Status bisnis</span><h2>Jangan campur status.</h2><p>Pembagian, pembayaran, dan keadaan bill adalah tiga hal berbeda. Labelnya harus terbaca tanpa mengandalkan warna.</p></div>
        <div className="ds-status-grid">{semantic.map(({ label, detail, className, icon: Icon }) => <div className={`ds-status-card ${className}`} key={label}><Icon size={20} /><div><b>{label}</b><small>{detail}</small></div></div>)}</div>
      </section>

      <section className="ds-section ds-mobile-principles"><div className="ds-section-heading"><span>05 / Mobile</span><h2>Nyaman dipakai satu tangan.</h2></div><div className="ds-principle-grid"><div><b>20 px</b><span>Jarak sisi layar</span></div><div><b>44 px</b><span>Tinggi minimum target sentuh</span></div><div><b>4 px</b><span>Dasar skala jarak</span></div><div><b>1 aksi</b><span>Prioritas utama per area</span></div></div></section>
    </main>
    {sheetOpen && <div className="ds-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setSheetOpen(false) }}><section className="ds-sheet" role="dialog" aria-modal="true" aria-label="Contoh bottom sheet"><span className="ds-sheet-handle" /><button type="button" className="ds-sheet-close" onClick={() => setSheetOpen(false)} aria-label="Tutup"><X size={20} /></button><span className="ds-sheet-icon"><CheckCircle size={24} /></span><h2>Periksa sebelum bayar</h2><p>Sheet menjelaskan akibat aksi. Nominal, tujuan bayar, dan status selalu terlihat sebelum konfirmasi.</p><div><span>Tagihan sementara</span><b>Rp62.120</b></div><button type="button" className="ds-button ds-button-primary" onClick={() => setSheetOpen(false)}>Mengerti <Check size={17} /></button></section></div>}
  </div>
}
