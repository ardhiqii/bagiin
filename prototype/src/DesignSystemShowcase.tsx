import { useState } from 'react'
import { ArrowLeft, ArrowRight, Check, CheckCircle, Copy, Info, WarningCircle } from '@phosphor-icons/react'
import {
  Alert, Avatar, BalanceCard, BottomNav, Button, EmptyState, Field, Group, ItemRow, Money, Sheet, StatusBadge,
} from './ds/primitives'
import type { ItemState } from './ds/primitives'
import emptyBillArt from './assets/empty-bill.png'
import splitReceiptArt from './assets/split-receipt.png'
import {
  BRAND_TOKENS, COMPONENT_INVENTORY, ELEVATIONS, RADII, RULES, SHADCN_MAP, SPACING, STATUS_GRAMMAR, STATUS_TOKENS, TYPE_SCALE,
} from './ds/spec'

function Section({ id, index, title, lead, children }: { id: string; index: string; title: string; lead: string; children: React.ReactNode }) {
  return <section className="ds-section" id={id}>
    <div className="ds-heading"><span>{index}</span><h2>{title}</h2><p>{lead}</p></div>
    {children}
  </section>
}

function Specimen({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return <article className="ds-specimen">
    <span className="ds-specimen-label">{label}</span>
    <div className="ds-specimen-body">{children}</div>
    {note && <p className="ds-specimen-note">{note}</p>}
  </article>
}

export function DesignSystemShowcase() {
  const [itemState, setItemState] = useState<ItemState>('shared')
  const [plainPicked, setPlainPicked] = useState(true)
  const [amount, setAmount] = useState('54.000')
  const [name, setName] = useState('')
  const [sheetOpen, setSheetOpen] = useState(false)

  const cycle = (state: ItemState): ItemState => state === 'idle' ? 'picked' : state === 'picked' ? 'shared' : 'idle'

  return <div className="ds-page">
    <header className="ds-topbar">
      <a href="/" aria-label="Kembali ke design lab"><ArrowLeft size={18} /> Design Lab</a>
      <span>Design system · v0.2 · hybrid</span>
    </header>

    <main className="ds-main">
      <section className="ds-hero">
        <div className="ds-eyebrow">Bagiin / arah terpilih</div>
        <h1>Struktur Seimbang.<br /><span>Warna Saldo.</span></h1>
        <p>Susunan informasi mengikuti Seimbang: ringkasan di atas, item sebagai isi utama, satu aksi dekat konteksnya. Warnanya dari Saldo. Kedalaman dibangun dari <b>lapisan, bukan garis</b> — satu prinsip yang sama dengan material di iOS: konten duduk di permukaannya sendiri, sementara navigasi dan sheet melayang di atasnya.</p>
        <div className="ds-hero-actions">
          <a href="/?v=seimbang">Lihat prototype utama <ArrowRight size={17} /></a>
          <a href="#komponen">Langsung ke komponen</a>
          <a href="#aset">Lihat aset ilustrasi</a>
        </div>
      </section>

      <Section id="fondasi" index="01 / Fondasi" title="Warna punya peran." lead="Navy mengarahkan, teal mengajak bertindak, warna status hanya muncul saat maknanya memang berbeda. Semua pasangan teks–latar di bawah lolos kontras minimal 4,5:1.">
        <div className="ds-swatches">
          {BRAND_TOKENS.map((token) => <div className="ds-swatch" key={token.token}>
            <span className="ds-swatch-color" style={{ background: `var(${token.token})` }} aria-hidden="true" />
            <div><b>{token.name}</b><code>{token.value}</code><small>{token.role}</small></div>
          </div>)}
        </div>
        <h3 className="ds-subheading">Token status</h3>
        <div className="ds-token-list">
          {STATUS_TOKENS.map((status) => <div className="ds-token-row" key={status.name}>
            <span className={`ds-token-chip ds-tone-${status.tone}`}>{status.name}</span>
            <code>{status.ink} di {status.bg}</code>
            <span className="ds-token-ratio">{status.ratio}</span>
            <small>{status.use}</small>
          </div>)}
        </div>
      </Section>

      <Section id="tipografi" index="02 / Tipografi & angka" title="Angka gampang dipindai." lead="Manrope untuk judul, DM Sans untuk isi. Semua nominal memakai tabular numbers dan pemisah ribuan Indonesia — jangan disingkat jadi “62rb” untuk angka yang harus dibayar.">
        <div className="ds-type-grid">
          {TYPE_SCALE.map((type) => <div className="ds-type-cell" key={type.name}>
            <span>{type.name}</span>
            <strong className={type.className}>{type.sample}</strong>
            <code>{type.spec}</code>
          </div>)}
        </div>
      </Section>

      <Section id="ruang" index="03 / Ruang, radius, elevasi" title="Delapan angka, tiga lapisan." lead="Skala jarak kelipatan 4 px dengan sisi layar 20 px. Radius hanya empat ukuran. Bayangan dipakai kalau memang ada lapisan yang menutup konten; kartu biasa pakai garis.">
        <div className="ds-grid-3">
          <Specimen label="Skala jarak" note="Sisi layar mobile 20 px; jarak antar-kartu 12 px; dalam kartu 16 px.">
            <div className="ds-spacing-scale">
              {SPACING.map((step) => <div key={step}><span>{step}</span><i style={{ width: `${step * 2}px` }} /></div>)}
            </div>
          </Specimen>
          <Specimen label="Radius" note="Radius berbeda hanya kalau komponennya memang beda peran.">
            <div className="ds-radius-scale">
              {RADII.map((radius) => <div key={radius.token}><i style={{ borderRadius: `var(${radius.token})` }} /><span><b>{radius.value}</b><small>{radius.use}</small></span></div>)}
            </div>
          </Specimen>
          <Specimen label="Lapisan" note="Tidak ada garis keliling di lapisan konten. Pemisah hanya hairline di dalam grup.">
            <div className="ds-elevation-scale">
              {ELEVATIONS.map((elevation) => <div key={elevation.name} className={elevation.name === 'Sheet' ? 'is-sheet' : elevation.name === 'Fokus' ? 'is-focus' : ''}>
                <b>{elevation.name}</b><small>{elevation.use}</small>
              </div>)}
            </div>
          </Specimen>
        </div>
        <div className="ds-material">
          <div>
            <span>Lapisan konten</span>
            <b>Isi, kartu, daftar item</b>
            <p>Permukaan solid di atas latar fog. Pemisah hanya hairline di dalam grup, bukan garis keliling tiap baris. Ini yang membuat daftar terasa satu benda, bukan tumpukan kotak.</p>
          </div>
          <div>
            <span>Lapisan fungsi</span>
            <b>Navigasi, aksi utama, sheet</b>
            <p>Melayang di atas konten dengan blur dan bayangan lembut, jadi isi halaman masih terlihat lewat di bawahnya. Kontrol tidak pernah menutupi konten tanpa alasan.</p>
          </div>
        </div>
      </Section>

      <Section id="komponen" index="04 / Komponen" title="Satu bentuk, satu fungsi." lead="Kontrol yang sama dipakai di beranda, bill, rekap, dan editor. Semua contoh di bawah bisa dicoba;">
        <div className="ds-grid-2">
          <Specimen label="Button" note="Satu aksi utama per area. Label menyebut hasil, bukan proses. Loading mengunci tombol.">
            <div className="ds-stack">
              <Button onClick={() => setSheetOpen(true)}>Selesai pilih <ArrowRight size={17} /></Button>
              <Button variant="secondary" onClick={() => setSheetOpen(true)}>Bagikan bill</Button>
              <Button variant="quiet" onClick={() => setSheetOpen(true)}>Edit pilihan</Button>
              <Button variant="danger" onClick={() => setSheetOpen(true)}>Batalkan tanda lunas</Button>
              <Button disabled>Tandai lunas</Button>
              <Button loading>Tandai lunas</Button>
            </div>
          </Specimen>

          <Specimen label="Status badge" note="Ikon + teks + latar. Warna tidak pernah jadi satu-satunya penanda.">
            <div className="ds-wrap">
              <StatusBadge tone="pending">Sementara · Citra belum pilih</StatusBadge>
              <StatusBadge tone="info">Pembagian lengkap</StatusBadge>
              <StatusBadge tone="success">Lunas</StatusBadge>
              <StatusBadge tone="danger">Kurang bayar Rp5.000</StatusBadge>
            </div>
            <div className="ds-divider" />
            <div className="ds-stack-sm">
              <Alert tone="danger" title="Nominal naik setelah kamu tandai lunas">Tagihanmu sekarang Rp67.120, sebelumnya Rp62.120. Kurang Rp5.000.</Alert>
              <Alert tone="pending" title="1 bagian menunggu">Dimsum platter baru terisi 2 dari 3 orang. Nominal bisa turun.</Alert>
            </div>
          </Specimen>

          <Specimen label="ItemRow" note="Seluruh baris bisa diketuk; kotak centang hanya penanda. Klik untuk mencoba ketiga state.">
            <Group label="Item bill">
              <ItemRow name="Nasi goreng kampung" note="1 porsi" price={42000} state={plainPicked ? 'picked' : 'idle'} onToggle={() => setPlainPicked((old) => !old)} />
              <ItemRow name="Dimsum platter" note="Dibagi 3 orang" price={54000} state={itemState} onToggle={() => setItemState((old) => cycle(old))} />
              <ItemRow name="Mie ayam bakso" note="Diskon item" price={36000} discount={6000} state="idle" onToggle={() => undefined} />
            </Group>
          </Specimen>

          <Specimen label="Input nominal" note="Input menampilkan angka bertitik. Jangan parseInt nilainya; pakai parser rupiah.">
            <div className="ds-stack">
              <Field id="ds-amount" label="Harga item" value={amount} onChange={setAmount} inputMode="numeric" hint="Tanpa “Rp”, titik ribuan otomatis." />
              <Field id="ds-name" label="Nama item" value={name} onChange={setName} error={name.length === 0 ? 'Nama item tidak boleh kosong.' : undefined} />
            </div>
          </Specimen>

          <Specimen label="Saldo & rincian" note="Kartu navy hanya untuk kewajiban utama. Rincian tetap di permukaan putih.">
            <BalanceCard label="Perlu kamu bayar" value={62120} note="Dari 1 bill · angka masih sementara" />
            <div className="ds-detail-row"><span>Aufa · Dapur Tiga</span><Money value={62120} /></div>
            <div className="ds-detail-row"><span>Nadia · Kopi Jumat</span><Money value={28000} /></div>
          </Specimen>

          <Specimen label="Navigasi & avatar" note="Navigasi di luar area scroll. Avatar memakai inisial; jangan mengandalkan warna saja.">
            <BottomNav active="bill" />
            <div className="ds-avatars">
              <Avatar label="A" tone="navy" />
              <Avatar label="K" tone="teal" />
              <Avatar label="C" tone="mint" />
              <Avatar label="+" tone="muted" filled={false} />
              <small>Hadir, kamu, teman, belum bergabung</small>
            </div>
          </Specimen>

          <Specimen label="Empty state" note="Kosong bukan kesalahan; sebutkan langkah berikutnya.">
            <EmptyState art={<img className="ds-art" src={emptyBillArt} alt="" width={216} height={216} />} title="Belum ada bill" action={<Button onClick={() => setSheetOpen(true)}>Buat bill</Button>}>Foto struk atau ketik manual. Pembagian dilakukan setelah bill dibuat.</EmptyState>
          </Specimen>

          <Specimen label="Bottom sheet" note="Untuk konfirmasi, rincian, dan tujuan bayar. Nominal selalu terlihat sebelum aksi.">
            <Button variant="secondary" onClick={() => setSheetOpen(true)}>Buka contoh sheet</Button>
          </Specimen>
        </div>
      </Section>

      <Section id="status" index="05 / Tata bahasa status" title="Jangan campur tiga status." lead="Pembagian, pembayaran peserta, dan keadaan bill adalah tiga dimensi berbeda. Menggabungkannya jadi satu kata “Selesai” adalah cara tercepat membuat orang salah paham.">
        <div className="ds-grammar">
          {STATUS_GRAMMAR.map((group) => <article className="ds-grammar-col" key={group.dimension}>
            <h3>{group.dimension}</h3>
            <div className="ds-stack-sm">
              {group.steps.map((step) => <div className="ds-grammar-step" key={step.label}>
                <StatusBadge tone={step.tone}>{step.label}</StatusBadge>
                <small>{step.detail}</small>
              </div>)}
            </div>
            <p>{group.rule}</p>
          </article>)}
        </div>
      </Section>

      <Section id="aset" index="06 / Aset ilustrasi" title="Digambar, bukan ditempel." lead="Dua ilustrasi dibuat dengan model gambar memakai brief yang mengunci palet dan ukuran tampil, lalu background datarnya dibuang dan paletnya dikuantisasi. Yang di bawah ini file asli yang dipakai aplikasi, bukan mockup.">
        <div className="ds-assets">
          <figure className="ds-asset">
            <div className="ds-asset-plate"><img src={emptyBillArt} alt="Ilustrasi struk kosong" width={216} height={216} /></div>
            <figcaption>
              <b>Struk kosong</b>
              <span>empty-bill.png · 512 px · 7,5 KB</span>
              <p>Empty state “Belum ada bill”. Tampil 216 px di dalam kartu putih, tanpa kotak background karena transparan.</p>
            </figcaption>
          </figure>
          <figure className="ds-asset">
            <div className="ds-asset-plate"><img src={splitReceiptArt} alt="Ilustrasi struk terbagi tiga" width={150} height={150} /></div>
            <figcaption>
              <b>Struk terbagi</b>
              <span>split-receipt.png · 512 px · 8,9 KB</span>
              <p>Sampul layar “Buat bill”. Tampil 68 px di samping judul; ukuran besar di atas hanya untuk memperlihatkan detail.</p>
            </figcaption>
          </figure>
        </div>
        <div className="ds-asset-rules">
          <div><b>Palet</b><span>Enam hex saja: navy, teal, mint, off-white, putih, satu amber. Tidak ada warna di luar token.</span></div>
          <div><b>Bentuk</b><span>Flat, sudut keras, tanpa outline, gradasi, bayangan, atau tekstur. Aman di layar 1x maupun 3x.</span></div>
          <div><b>Larangan</b><span>Tidak ada teks, angka, logo, atau orang di dalam gambar. Semua makna tetap dibawa oleh teks di UI.</span></div>
        </div>
      </Section>

      <Section id="pola" index="07 / Pola layar" title="Komposisi halaman bill." lead="Susunan yang dipakai halaman bill: kepala navy berisi merchant dan total, lalu item sebagai isi utama, rincian biaya, progres, dan aksi di dekat konteksnya. Struktur rinci per kasus masih diuji; komposisinya sudah tetap.">
        <div className="ds-phone-demo">
          <div className="ds-phone">
            <div className="ds-phone-head">
              <span className="ds-phone-back"><ArrowLeft size={17} /> Beranda</span>
              <div className="ds-phone-title"><small>12 Oktober 2026 · Dapur Tiga</small><h4>Makan siang bareng</h4></div>
              <div className="ds-phone-total"><span>Total struk</span><strong><em>Rp</em>163.000</strong></div>
              <div className="ds-phone-people"><Avatar label="A" tone="mint" /><Avatar label="K" tone="teal" /><Avatar label="+" tone="muted" filled={false} /><span>2 orang · 1 bagian menunggu</span></div>
            </div>
            <div className="ds-phone-body">
              <div className="ds-phone-row"><h5>Siapa ambil apa?</h5><StatusBadge tone="pending">Sementara</StatusBadge></div>
              <p className="ds-phone-sub">Ketuk item untuk memilih. Item bersama terbagi rata.</p>
              <Group>
                <ItemRow name="Nasi goreng kampung" note="1 porsi" price={42000} state="picked" />
                <ItemRow name="Mie ayam bakso" note="Diskon item" price={36000} discount={6000} state="picked" />
                <ItemRow name="Es teh manis" note="3 gelas · Aufa ambil 2" price={24000} state="idle" />
                <ItemRow name="Dimsum platter" note="Platter isi 6" price={54000} state="shared" />
              </Group>
              <div className="ds-phone-cost"><span>Voucher, service &amp; ongkir</span><b>Periksa rincian</b></div>
              <div className="ds-phone-progress">
                <span className="is-done" /><i /><span className="is-done" /><i /><span />
                <div className="ds-phone-labels"><em>Bill dibuat</em><em>Semua pilih</em><em>Lunas</em></div>
              </div>
            </div>
            <div className="ds-phone-action">
              <div><span>Perkiraan bagianmu</span><strong><em>Rp</em>62.120</strong></div>
              <Button>Selesai pilih <ArrowRight size={17} /></Button>
            </div>
            <BottomNav active="bill" />
          </div>
          <ul className="ds-phone-notes">
            <li><b>Kepala navy</b> menjawab “ini bill apa dan totalnya berapa” sebelum orang scroll.</li>
            <li><b>Item jadi isi utama</b> karena di situlah satu-satunya keputusan peserta.</li>
            <li><b>Aksi dekat konteks:</b> tombol berubah mengikuti tahap — selesai pilih, lalu tandai lunas.</li>
            <li><b>Status sementara terlihat</b> di dua tempat: badge bagian dan angka aksi.</li>
            <li><b>Yang belum diputuskan:</b> kontrol “siapa ikut makan” (sheet per item vs stepper jumlah pemakan) dan tampilan unit barang.</li>
          </ul>
        </div>
      </Section>

      <Section id="aturan" index="08 / Aturan mahal" title="Empat kesalahan yang pernah menagih." lead="Bukan preferensi visual. Ini empat hal yang kalau dilanggar, orang mentransfer nominal yang salah atau tidak bisa memakai aplikasinya.">
        <div className="ds-rules">
          {RULES.map((rule) => <article className="ds-rule" key={rule.title}>
            <h3>{rule.title}</h3>
            <div className="ds-rule-pair">
              <div className="is-wrong"><span><WarningCircle size={16} weight="bold" /> Jangan</span><p>{rule.wrong}</p></div>
              <div className="is-right"><span><Check size={16} weight="bold" /> Lakukan</span><p>{rule.right}</p></div>
            </div>
            <small>{rule.why}</small>
          </article>)}
        </div>
      </Section>

      <Section id="shadcn" index="09 / Inventaris & pemetaan" title="Siap dipindah ke shadcn." lead="Saat migrasi produksi, token di bawah pindah ke theme aplikasi; komponennya memakai shadcn/ui dengan struktur dan copy Bagiin, bukan default library.">
        <div className="ds-grid-2">
          <Specimen label="Komponen & varian" note="Daftar ini yang harus ada sebelum React dianggap siap menggantikan vanilla.">
            <div className="ds-table">
              {COMPONENT_INVENTORY.map((row) => <div className="ds-table-row" key={row.component}>
                <b>{row.component}</b><code>{row.shadcn}</code><small>{row.variants}</small>
              </div>)}
            </div>
          </Specimen>
          <Specimen label="Token → variabel shadcn" note="Jangan membuat hex baru di komponen; semua lewat token.">
            <div className="ds-table">
              {SHADCN_MAP.map((row) => <div className="ds-table-row is-token" key={row.token}>
                <code>{row.token}</code><span>{row.note}</span>
              </div>)}
            </div>
          </Specimen>
        </div>
        <div className="ds-a11y">
          <Info size={18} weight="duotone" />
          <div>
            <b>Aksesibilitas yang sudah dipegang</b>
            <p>Target sentuh minimal 44×44 px, cincin fokus 3 px terlihat di semua kontrol, tabrakan status selalu disertai teks, nominal memakai tabular numbers, dan tidak ada status yang bergantung pada warna saja.</p>
          </div>
        </div>
      </Section>
    </main>

    <Sheet open={sheetOpen} title="Periksa sebelum bayar" onClose={() => setSheetOpen(false)}>
      <p className="ds-sheet-copy">Sheet menjelaskan akibat aksi. Nominal, tujuan bayar, dan status terlihat sebelum konfirmasi.</p>
      <div className="ds-sheet-row"><span>Tagihan sementara</span><Money value={62120} /></div>
      <div className="ds-sheet-row"><span>Tujuan bayar</span><b>BCA · Aufa Fauqi</b></div>
      <Button block onClick={() => setSheetOpen(false)}><CheckCircle size={18} /> Mengerti</Button>
      <p className="ds-sheet-foot"><Copy size={14} /> Bayar di Bagiin berarti mencatat status, bukan memindahkan uang.</p>
    </Sheet>
  </div>
}
