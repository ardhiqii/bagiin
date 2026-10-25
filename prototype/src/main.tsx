import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowLeft, ArrowRight, Bell, Camera, CaretRight,
  Check, CheckCircle, Clock, Copy, CreditCard, ForkKnife, House, Info,
  Link as LinkIcon, List, Minus, PencilSimple, Plus, Receipt, ShareNetwork,
  Sparkle, UserPlus, UsersThree, Wallet, X,
} from '@phosphor-icons/react'
import { calculate, idr, INITIAL_DEMO, ITEMS, PERSON, VARIANTS } from './model'
import type { DemoState, PersonId, Screen, Totals, VariantId } from './model'
import { DesignSystemShowcase } from './DesignSystemShowcase'
import './styles.css'
import './design-system.css'

type Sheet = 'share' | 'invite' | 'pay' | 'item' | 'person' | null
type ItemId = typeof ITEMS[number]['id']

type LabContext = {
  state: DemoState
  totals: Totals
  screen: Screen
  variant: VariantId
  setScreen: (screen: Screen) => void
  setSheet: (sheet: Sheet) => void
  setActiveItem: (item: ItemId) => void
  setPersonDetail: (name: string) => void
  pick: (item: ItemId) => void
  done: () => void
  edit: () => void
  pay: () => void
  invite: () => void
  assign: () => void
  join: () => void
  setCount: (n: number) => void
  notify: (message: string) => void
}

const featureGroups = [
  { title: 'Buat bill', icon: Camera, items: ['Foto / upload struk dengan OCR', 'Editor yang sama untuk OCR dan manual', 'Jumlah unit, diskon item dan voucher terpilih', 'Pajak, service, ongkir dan biaya lain', 'Foto struk dan edit setelah dibuat'] },
  { title: 'Bagi item', icon: ForkKnife, items: ['Undang via link atau kontak lama', 'Owner assign sebelum orang memilih sendiri', 'Satu item untuk satu atau banyak orang', 'Bagian tetap: “Dibagi 3 orang”', 'Selesai pilih, koreksi, keluar dari bill'] },
  { title: 'Bayar & kelola', icon: CreditCard, items: ['Metode bayar orang yang nalangin', 'Tandai lunas tanpa transfer dalam aplikasi', 'Selisih setelah nominal berubah', 'Catat pengembalian kelebihan bayar', 'Pindah pembayar dengan penerimaan', 'Owner bisa selesaikan bill manual'] },
  { title: 'Rekap & riwayat', icon: Wallet, items: ['Total utang dan uang masuk yang tersisa', 'Angka final dan sementara dipisah', 'Rincian per orang dan sumber bill', 'Riwayat bill serta perubahan pembayaran', 'Tanpa grup dan tanpa netting otomatis'] },
  { title: 'Identitas', icon: UsersThree, items: ['Guest dengan ID unik', 'Google opsional dan recovery key', 'Kontak otomatis setelah pernah se-bill', 'Nama bebas dan nickname pribadi', 'Data serta tautan lama tetap bekerja'] },
]

function useUrlVariant(): VariantId | null {
  const value = new URLSearchParams(window.location.search).get('v')
  return VARIANTS.some((variant) => variant.id === value) ? value as VariantId : null
}

function Avatar({ person, size = 'normal' }: { person: PersonId; size?: 'normal' | 'small' | 'large' }) {
  const p = PERSON[person]
  return <span className={`avatar avatar-${p.color} avatar-${size}`} title={p.name}>{p.short}</span>
}

function Amount({ value, className = '' }: { value: number; className?: string }) {
  return <span className={`money ${className}`}>{idr(value)}</span>
}

function TinyStatus({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'accent' | 'good' | 'warn' }) {
  return <span className={`tiny-status tiny-${tone}`}>{children}</span>
}

function Nav({ ctx }: { ctx: LabContext }) {
  const nav = [
    { id: 'home' as const, label: 'Beranda', icon: House },
    { id: 'bill' as const, label: 'Bill', icon: Receipt },
    { id: 'create' as const, label: 'Buat', icon: Plus },
    { id: 'recap' as const, label: 'Rekap', icon: Wallet },
  ]
  return <nav className="app-nav" aria-label="Navigasi prototype">
    {nav.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={`app-nav-item ${ctx.screen === id ? 'active' : ''}`} onClick={() => ctx.setScreen(id)} aria-current={ctx.screen === id ? 'page' : undefined}>
      <Icon size={21} weight={ctx.screen === id ? 'fill' : 'regular'} />
      <span>{label}</span>
    </button>)}
  </nav>
}

function LabApp() {
  const [variant, setVariantState] = useState<VariantId | null>(useUrlVariant)
  const [screen, setScreen] = useState<Screen>('home')
  const [state, setState] = useState<DemoState>(INITIAL_DEMO)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [activeItem, setActiveItem] = useState<ItemId>('dimsum')
  const [personDetail, setPersonDetail] = useState('Aufa')
  const [toast, setToast] = useState('')
  const totals = useMemo(() => calculate(state), [state])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3300)
    return () => window.clearTimeout(timer)
  }, [toast])

  function setVariant(next: VariantId | null) {
    setVariantState(next)
    setScreen('home')
    setSheet(null)
    const url = new URL(window.location.href)
    if (next) url.searchParams.set('v', next)
    else url.searchParams.delete('v')
    window.history.pushState({}, '', url)
  }

  useEffect(() => {
    function onPop() { setVariantState(useUrlVariant()) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function pick(item: ItemId) {
    if (state.persona === 'A') {
      setActiveItem(item)
      setSheet('item')
      return
    }
    if (state.persona === 'C') {
      if (!state.invitedC) { setState((old) => ({ ...old, invitedC: true })); setToast('Citra bergabung lewat link.'); return }
      if (item !== 'dimsum') { setActiveItem(item); setSheet('item'); return }
      setState((old) => ({ ...old, dimsumC: !old.dimsumC, selfPickedC: true, doneC: false }))
      return
    }
    setState((old) => {
      if (item === 'nasi') return { ...old, nasiB: !old.nasiB, doneB: false }
      if (item === 'mie') return { ...old, mieB: !old.mieB, doneB: false }
      if (item === 'teh') return { ...old, tehB: !old.tehB, doneB: false }
      if (item === 'dimsum') return { ...old, dimsumB: !old.dimsumB, doneB: false }
      return old
    })
  }

  function done() {
    if (state.persona === 'B') {
      if (!state.nasiB && !state.mieB && !state.tehB && !state.dimsumB) { setToast('Pilih setidaknya satu item dulu.'); return }
      setState((old) => ({ ...old, doneB: true }))
    } else if (state.persona === 'C') {
      if (!state.dimsumC) { setToast('Pilih setidaknya satu item dulu.'); return }
      setState((old) => ({ ...old, doneC: true }))
    }
    setToast('Pilihanmu tersimpan. Kamu masih bisa mengeditnya.')
  }

  function edit() {
    if (state.persona === 'B') setState((old) => ({ ...old, doneB: false }))
    if (state.persona === 'C') setState((old) => ({ ...old, doneC: false, selfPickedC: true }))
    setToast('Pilihannya bisa diubah. Tekan Selesai pilih lagi setelah beres.')
  }

  function pay() {
    if (state.persona === 'B') setState((old) => ({ ...old, paidB: totals.due.B, refundB: false }))
    if (state.persona === 'C') setState((old) => ({ ...old, paidC: totals.due.C }))
    setSheet(null)
    setToast('Tanda lunas dicatat. Ini bukan transfer otomatis.')
  }

  function invite() {
    setState((old) => ({ ...old, invitedC: true }))
    setSheet(null)
    setToast('Citra langsung masuk bill karena pernah se-bill.')
  }

  function assign() {
    if (state.selfPickedC) { setToast('Citra sudah memilih sendiri. Owner tidak bisa assign lagi.'); return }
    if (!state.invitedC) { setToast('Undang Citra dulu.'); return }
    setState((old) => ({ ...old, dimsumC: true, doneC: true }))
    setSheet(null)
    setToast('Dimsum ditentukan untuk Citra. Ia tetap harus menandai lunas sendiri.')
  }

  function join() {
    setState((old) => ({ ...old, invitedC: true }))
    setToast('Citra masuk dari link bill.')
  }

  function setCount(n: number) {
    const taken = 1 + Number(state.dimsumB) + Number(state.dimsumC)
    if (n < taken || n > 6) { setToast(`Minimal ${taken} orang yang sudah mengambil item ini.`); return }
    setState((old) => ({ ...old, dimsumCount: n }))
  }

  const ctx: LabContext = { state, totals, screen, variant: variant || 'seimbang', setScreen, setSheet, setActiveItem, setPersonDetail, pick, done, edit, pay, invite, assign, join, setCount, notify: setToast }

  if (new URLSearchParams(window.location.search).get('view') === 'system') return <DesignSystemShowcase />
  if (!variant) return <Gallery choose={setVariant} />

  const currentVariant = VARIANTS.find((entry) => entry.id === variant)!
  return <div className={`lab-workspace workspace-${variant}`}>
    <aside className="lab-sidebar">
      <button type="button" className="brand-back" onClick={() => setVariant(null)}><ArrowLeft size={17} /> Semua konsep</button>
      <div className="sidebar-title"><span className="brand-logo">b.</span><span>Bagiin<br /><small>Design Lab</small></span></div>
      <h1>{currentVariant.name}</h1>
      <p>{currentVariant.desc}</p>
      <div className="sidebar-callout"><b>Yang kuat</b><span>{currentVariant.strength}</span></div>
      <div className="sidebar-callout"><b>Tradeoff</b><span>{currentVariant.tradeoff}</span></div>
      <div className="sidebar-divider" />
      <span className="sidebar-label">Ganti konsep</span>
      {VARIANTS.map((entry, index) => <button type="button" key={entry.id} className={`sidebar-variant ${entry.id === variant ? 'selected' : ''}`} onClick={() => setVariant(entry.id)}><span>{String(index + 1).padStart(2, '0')}</span>{entry.name}<CaretRight size={16} /></button>)}
      <button type="button" className="sidebar-reset" onClick={() => { setState(INITIAL_DEMO); setScreen('home'); setToast('Skenario demo dikembalikan ke awal.') }}>Reset skenario</button>
    </aside>

    <main className="lab-main">
      <div className="lab-mobile-header">
        <button type="button" className="lab-back" onClick={() => setVariant(null)} aria-label="Kembali ke semua konsep"><ArrowLeft size={19} /></button>
        <div><b>{currentVariant.name}</b><span>{currentVariant.type}</span></div>
        <button type="button" className="lab-reset" onClick={() => { setState(INITIAL_DEMO); setScreen('home'); setToast('Skenario demo direset.') }} title="Reset skenario"><List size={19} /></button>
      </div>
      <div className="lab-controls">
        <div className="variant-scroll" aria-label="Pilih varian desain">{VARIANTS.map((entry) => <button type="button" key={entry.id} className={entry.id === variant ? 'selected' : ''} onClick={() => setVariant(entry.id)}>{entry.name}</button>)}</div>
        <div className="persona-control"><span>Bill sebagai</span>{(['A', 'B', 'C'] as const).map((person) => <button type="button" key={person} className={state.persona === person ? 'selected' : ''} onClick={() => { setState((old) => ({ ...old, persona: person })); setScreen('bill') }}>{person === 'A' ? 'Aufa · owner' : person === 'B' ? 'Kamu' : 'Citra'}</button>)}</div>
      </div>

      <div className={`phone-shell v-${variant}`}>
        <div className="phone-inner">
          {screen === 'home' && <VariantHome ctx={ctx} />}
          {screen === 'bill' && <VariantBill ctx={ctx} />}
          {screen === 'recap' && <VariantRecap ctx={ctx} />}
          {screen === 'create' && <CreateScreen ctx={ctx} />}
          <Nav ctx={ctx} />
        </div>
      </div>
      <div className="lab-hint"><Info size={16} /> Prototype interaktif dengan data contoh. Ganti peran untuk mencoba aksi di bill. Beranda dan rekap memakai sudut pandang Bima.</div>
    </main>

    {sheet && <SheetLayer ctx={ctx} sheet={sheet} activeItem={activeItem} personDetail={personDetail} close={() => setSheet(null)} />}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>
}

function Gallery({ choose }: { choose: (id: VariantId) => void }) {
  const [showFeatures, setShowFeatures] = useState(false)
  return <div className="gallery-page">
    <header className="gallery-header"><div className="gallery-brand"><span className="brand-logo">b.</span><span>Bagiin <em>Design Lab</em></span></div><button type="button" onClick={() => setShowFeatures((old) => !old)}>{showFeatures ? 'Tutup daftar fitur' : 'Lihat daftar fitur'} <ArrowRight size={17} /></button></header>
    <main className="gallery-main">
      <div className="gallery-intro"><div className="gallery-kicker">4 arah desain · mobile first</div><h1>Pilih rasa yang paling pas buat <span>patungan.</span></h1><p>Satu skenario bill yang sama, empat cara menyusun informasi dan aksi. Buka tiap konsep di HP, coba pilih item, undang teman, lalu lihat rekapnya.</p><div className="gallery-intro-actions"><button type="button" className="gallery-primary" onClick={() => choose('seimbang')}>Mulai dari konsep 01 <ArrowRight size={19} /></button><button type="button" className="gallery-secondary" onClick={() => setShowFeatures((old) => !old)}>{showFeatures ? 'Sembunyikan fitur' : 'Apa saja fiturnya?'}</button></div></div>
      {showFeatures && <section className="features-panel" id="fitur"><div className="section-heading"><h2>Peta fitur produk</h2><p>Fondasi dari PRODUCT.md. Prototype memvisualkan alur penting; belum terhubung ke backend.</p></div><div className="features-grid">{featureGroups.map((group) => { const Icon = group.icon; return <article key={group.title} className="feature-group"><Icon size={23} weight="duotone" /><h3>{group.title}</h3><ul>{group.items.map((item) => <li key={item}>{item}</li>)}</ul></article> })}</div></section>}
      <section className="chosen-direction"><div><span>ARAH TERPILIH</span><h2>Layout Seimbang.<br />Warna Saldo.</h2><p>Satu sistem untuk beranda, bill, rekap, dan editor. Halaman bill masih akan diolah lebih lanjut.</p></div><div><a href="/?view=system">Lihat design system <ArrowRight size={17} /></a><button type="button" onClick={() => choose('seimbang')}>Buka prototype utama</button></div></section>
      <section className="concept-section"><div className="section-heading"><h2>Empat konsep</h2><p>Seimbang sudah memakai palet Saldo; tiga konsep lain tetap tersedia sebagai pembanding.</p></div><div className="concept-grid">{VARIANTS.map((entry, index) => <button type="button" className={`concept-card concept-${entry.id}`} key={entry.id} onClick={() => choose(entry.id)}><span className="concept-index">{String(index + 1).padStart(2, '0')} / 04</span><MiniPreview variant={entry.id} /><span className="concept-meta"><b>{entry.name}</b><span>{entry.type}</span></span><span className="concept-description">{entry.desc}</span><span className="concept-open">Buka konsep <ArrowRight size={17} /></span></button>)}</div></section>
      <section className="gallery-note"><div><Sparkle size={24} /><h2>Apa yang perlu dinilai?</h2></div><p>Perhatikan apakah jelas siapa yang ambil item, kenapa nominal masih sementara, kapan orang bisa menandai bayar, dan apakah rekap membantu menemukan asal utang.</p></section>
    </main>
  </div>
}

function MiniPreview({ variant }: { variant: VariantId }) {
  const label = variant === 'seimbang' ? 'Makan siang' : variant === 'saldo' ? 'Tagihanmu' : variant === 'teman' ? 'Bareng teman' : 'Rincian bill'
  return <span className={`mini-preview mini-${variant}`}><span className="mini-top"><span>bagiin.</span><span>•••</span></span><span className="mini-title">{label}</span><span className="mini-number">{variant === 'saldo' ? 'Rp84.000' : variant === 'struk' ? 'Rp163.000' : 'Rp61.080'}</span><span className="mini-line long" /><span className="mini-line" /><span className="mini-line short" /><span className="mini-action">Lihat bill</span></span>
}

function QuickHeader({ ctx, title, sub }: { ctx: LabContext; title: string; sub?: string }) {
  return <header className="app-header"><div><span className="app-wordmark">bagiin<span>.</span></span><h1>{title}</h1>{sub && <p>{sub}</p>}</div><button type="button" className="header-icon" onClick={() => { ctx.setScreen('recap'); ctx.notify('Perubahan penting muncul di rekap.') }} aria-label="Lihat pemberitahuan"><Bell size={21} /></button></header>
}

function VariantHome({ ctx }: { ctx: LabContext }) {
  const { variant, totals } = ctx
  if (variant === 'seimbang') return <div className="screen screen-home home-seimbang"><QuickHeader ctx={ctx} title="Halo, Bima" sub="Patungan hari ini lebih gampang." /><div className="summary-pair"><div><span>Perlu kamu bayar</span><Amount value={totals.due.B} /><small>1 bill masih berjalan</small></div><div><span>Akan kamu terima</span><Amount value={46000} /><small>dari 1 teman</small></div></div><div className="section-row"><h2>Bill yang berjalan</h2><button type="button" onClick={() => ctx.setScreen('recap')}>Lihat semua <CaretRight size={15} /></button></div><button type="button" className="running-card" onClick={() => ctx.setScreen('bill')}><span className="running-card-icon"><ForkKnife size={22} /></span><span><b>Makan siang di Dapur Tiga</b><small>{totals.pendingParts} bagian menunggu · {ctx.state.doneB ? 'Kamu selesai pilih' : 'Pilih itemmu'}</small></span><CaretRight size={21} /></button><div className="quick-create"><div><h2>Bill baru?</h2><p>Foto struk atau ketik manual. Pembagian dilakukan setelah bill dibuat.</p></div><button type="button" onClick={() => ctx.setScreen('create')}><Camera size={19} /> Buat bill</button></div></div>
  if (variant === 'saldo') return <div className="screen screen-home home-saldo"><div className="saldo-top"><div className="saldo-brand"><span>bagiin.</span><button type="button" onClick={() => ctx.setScreen('recap')} aria-label="Buka rekap"><Bell size={20} /></button></div><span className="saldo-eyebrow">Sisa yang perlu dibayar</span><Amount value={totals.due.B + 28000} className="saldo-huge" /><span className="saldo-sub">Dari 2 bill, termasuk {totals.pendingParts ? '1 angka sementara' : '1 bill baru'}</span><button type="button" className="saldo-detail" onClick={() => ctx.setScreen('recap')}>Lihat rincian saldo <ArrowRight size={17} /></button></div><div className="saldo-white"><div className="section-row"><h2>Perlu perhatian</h2><TinyStatus tone="warn">1 sementara</TinyStatus></div><button type="button" className="saldo-bill" onClick={() => ctx.setScreen('bill')}><div className="saldo-date">12<br /><span>OKT</span></div><div><b>Dapur Tiga</b><small>Aufa nalangin · {ctx.state.doneB ? 'Menunggu Citra' : 'Selesaikan pilihanmu'}</small></div><Amount value={totals.due.B} /></button><div className="saldo-incoming"><span>Uang yang akan masuk</span><Amount value={46000} /><button type="button" onClick={() => ctx.setScreen('recap')}>Detail <ArrowRight size={16} /></button></div></div></div>
  if (variant === 'teman') return <div className="screen screen-home home-teman"><div className="teman-hero"><span className="teman-brand">bagiin<span>✳</span></span><span className="teman-hello">Hai, Bima!</span><h1>Lebih enak<br />kalau bareng.</h1><p>Urus patungan, teman yang makan tetap santai.</p><div className="teman-hero-actions"><button type="button" onClick={() => ctx.setScreen('create')}><Plus size={18} /> Bill baru</button><button type="button" onClick={() => ctx.setScreen('recap')}>Lihat rekap</button></div></div><div className="teman-section"><div className="section-row"><h2>Lagi bareng</h2><span>1 bill aktif</span></div><button type="button" className="teman-bill" onClick={() => ctx.setScreen('bill')}><div className="teman-avatars"><Avatar person="A" /><Avatar person="B" /><span className="avatar avatar-violet">{ctx.state.invitedC ? 'C' : '+'}</span></div><b>Makan siang di Dapur Tiga</b><small>{ctx.state.invitedC ? 'Citra belum bayar' : 'Satu bagian menunggu teman masuk'}</small><span className="teman-bill-bottom"><span><Amount value={totals.due.B} /> bagianmu</span><ArrowRight size={19} /></span></button><div className="teman-recap-tile"><span>Yang perlu kamu bayar</span><Amount value={totals.due.B + 28000} /><button type="button" onClick={() => ctx.setScreen('recap')}>Lihat asalnya <ArrowRight size={16} /></button></div></div></div>
  if (variant === 'struk') return <div className="screen screen-home home-struk"><header className="struk-head"><span>BAGIIN / BERANDA</span><button type="button" onClick={() => ctx.setScreen('create')} aria-label="Buat bill"><Plus size={22} /></button></header><div className="struk-intro"><span>REKAP HARI INI</span><h1>Patungan yang<br />masih jalan.</h1></div><div className="struk-ledger"><div><span>UTANG TERBUKA</span><Amount value={totals.due.B + 28000} /></div><div><span>UANG MASUK</span><Amount value={46000} /></div></div><div className="struk-datebar"><span>BILL TERBARU</span><span>12 OKTOBER 2026</span></div><button type="button" className="struk-paper-preview" onClick={() => ctx.setScreen('bill')}><div className="receipt-perf" /><div className="paper-title"><b>DAPUR TIGA</b><small>#BG-1024</small></div><div className="paper-line"><span>4 jenis item</span><span>Rp163.000</span></div><div className="paper-line"><span>Bagianmu · sementara</span><strong>{idr(totals.due.B)}</strong></div><div className="paper-footer">BUKA RINCIAN <ArrowRight size={17} /></div></button><button type="button" className="struk-text-link" onClick={() => ctx.setScreen('recap')}>Lihat semua kewajiban <ArrowRight size={18} /></button></div>
  return null
}

function ItemRow({ ctx, item, compact = false }: { ctx: LabContext; item: typeof ITEMS[number]; compact?: boolean }) {
  const selected = item.id === 'nasi' ? ctx.state.persona === 'A' || ctx.state.nasiB : item.id === 'mie' ? ctx.state.mieB && ctx.state.persona === 'B' : item.id === 'teh' ? ctx.state.persona === 'A' || (ctx.state.persona === 'B' && ctx.state.tehB) : ctx.state.persona === 'A' || (ctx.state.persona === 'B' && ctx.state.dimsumB) || (ctx.state.persona === 'C' && ctx.state.dimsumC)
  const owners = item.id === 'nasi' ? `Aufa${ctx.state.nasiB ? ', kamu' : ''}` : item.id === 'mie' ? ctx.state.mieB ? 'Kamu' : 'Belum dipilih' : item.id === 'teh' ? `Aufa 2${ctx.state.tehB ? ', kamu 1' : ', 1 belum'}` : `Aufa${ctx.state.dimsumB ? ', kamu' : ''}${ctx.state.dimsumC ? ', Citra' : ''} · ${ctx.totals.pendingParts > 0 && ctx.state.dimsumCount > 1 + Number(ctx.state.dimsumB) + Number(ctx.state.dimsumC) ? 'ada bagian kosong' : 'lengkap'}`
  return <button type="button" className={`item-row ${selected ? 'is-picked' : ''} ${compact ? 'compact' : ''}`} onClick={() => ctx.pick(item.id)}>
    <span className="item-check">{selected ? <Check size={15} weight="bold" /> : null}</span>
    <span className="item-copy"><b>{item.name}</b><small>{item.note}</small><em>{owners}</em></span>
    <span className="item-price"><Amount value={item.price - item.discount} />{item.discount > 0 && <small>−{idr(item.discount)}</small>}</span>
  </button>
}

function BillProgress({ ctx }: { ctx: LabContext }) {
  return <div className="bill-progress"><span className="progress-dot done" /><span className="progress-line" /><span className={`progress-dot ${ctx.state.doneB ? 'done' : 'current'}`} /><span className="progress-line" /><span className={`progress-dot ${ctx.totals.settled ? 'done' : ''}`} /><div className="progress-labels"><span>Bill dibuat</span><span>Semua pilih</span><span>Lunas</span></div></div>
}

function BillActions({ ctx }: { ctx: LabContext }) {
  const { state, totals } = ctx
  const person = state.persona
  const ready = person === 'B' ? state.doneB : person === 'C' ? state.doneC : true
  const due = totals.due[person]
  const paid = person === 'B' ? state.paidB : person === 'C' ? state.paidC : 0
  if (person === 'A') return <div className="bill-actions owner-actions"><button type="button" className="primary-action" onClick={() => ctx.setSheet(state.invitedC ? 'item' : 'invite')}><UserPlus size={19} /> {state.invitedC ? 'Atur item bersama' : 'Undang Citra'}</button><button type="button" className="secondary-action" onClick={() => ctx.setSheet('share')}><ShareNetwork size={18} /> Bagikan</button></div>
  if (person === 'C' && !state.invitedC) return <div className="bill-actions"><button type="button" className="primary-action" onClick={ctx.join}>Bergabung lewat link <ArrowRight size={18} /></button></div>
  if (!ready) return <div className="bill-actions"><div className="bill-action-summary"><span>Perkiraan bagianmu</span><Amount value={due} /></div><button type="button" className="primary-action" onClick={ctx.done}>Selesai pilih <ArrowRight size={18} /></button></div>
  if (paid < due) return <div className="bill-actions"><div className="bill-action-summary"><span>{paid ? 'Masih kurang' : totals.allocationReady ? 'Tagihanmu' : 'Tagihan sementara'}</span><Amount value={due - paid} /></div><button type="button" className="primary-action" onClick={() => ctx.setSheet('pay')}>{paid ? 'Tandai tambahan' : 'Tandai lunas'} <ArrowRight size={18} /></button><button type="button" className="text-action" onClick={ctx.edit}>Edit pilihan</button></div>
  return <div className="bill-actions"><div className="bill-action-summary"><span>{paid > due ? 'Kelebihan yang tercatat' : 'Status pembayaran'}</span><Amount value={paid > due ? paid - due : paid} /></div><button type="button" className="primary-action paid-action" onClick={() => ctx.notify(paid > due ? 'Kelebihan bayar dapat dicatat sebagai pengembalian.' : 'Pembayaranmu sudah ditandai lunas.')}><CheckCircle size={18} /> {paid > due ? 'Lunas · Ada kelebihan' : 'Sudah ditandai lunas'}</button><button type="button" className="text-action" onClick={ctx.edit}>Edit pilihan</button></div>
}

function BillIntro({ ctx }: { ctx: LabContext }) {
  return <div className="bill-intro"><button type="button" className="back-in-app" onClick={() => ctx.setScreen('home')}><ArrowLeft size={18} /> Beranda</button><div className="bill-title-row"><div><span>12 Oktober 2026 · Dapur Tiga</span><h1>Makan siang bareng</h1></div><button type="button" className="round-icon" onClick={() => ctx.setSheet('share')} aria-label="Bagikan bill"><ShareNetwork size={19} /></button></div><div className="bill-total"><span>Total struk</span><Amount value={ctx.totals.total} /></div><div className="participant-strip"><Avatar person="A" size="small" /><Avatar person="B" size="small" />{ctx.state.invitedC ? <Avatar person="C" size="small" /> : <span className="avatar avatar-small avatar-empty">+</span>}<span>{ctx.state.invitedC ? '3 orang di bill' : '2 orang · 1 bagian menunggu'}</span></div></div>
}

function VariantBill({ ctx }: { ctx: LabContext }) {
  const { variant, totals } = ctx
  if (variant === 'seimbang') return <div className="screen screen-bill bill-seimbang"><BillIntro ctx={ctx} /><div className="bill-body"><div className="section-row"><h2>Siapa ambil apa?</h2><TinyStatus tone={totals.allocationReady ? 'good' : 'warn'}>{totals.allocationReady ? 'Sudah lengkap' : 'Sementara'}</TinyStatus></div><p className="section-sub">Ketuk item untuk memilih. Item bersama terbagi rata.</p><div className="item-list">{ITEMS.map((item) => <ItemRow key={item.id} ctx={ctx} item={item} />)}</div><button type="button" className="cost-detail" onClick={() => ctx.setSheet('item')}><span>Voucher, service & ongkir</span><span>Periksa rincian <CaretRight size={16} /></span></button><BillProgress ctx={ctx} /></div><BillActions ctx={ctx} /></div>
  if (variant === 'saldo') return <div className="screen screen-bill bill-saldo"><div className="saldo-bill-top"><button type="button" className="back-in-app" onClick={() => ctx.setScreen('home')}><ArrowLeft size={18} /> Kembali</button><span className="bill-kicker">DAPUR TIGA · 12 OKT</span><h1>Bagianmu</h1><Amount value={totals.due[ctx.state.persona]} className="saldo-bill-amount" /><span className="saldo-estimate">{totals.allocationReady ? 'Pembagian lengkap' : `Masih sementara · ${totals.pendingParts} bagian belum terisi`}</span><div className="saldo-bill-stats"><div><span>Total struk</span><b>{idr(totals.total)}</b></div><div><span>Ditanggung Aufa</span><b>{idr(totals.due.A)}</b></div></div></div><div className="saldo-bill-body"><div className="section-row"><h2>Rincian item</h2><button type="button" onClick={() => ctx.setSheet('share')}><ShareNetwork size={18} /></button></div><div className="item-list">{ITEMS.map((item) => <ItemRow key={item.id} ctx={ctx} item={item} compact />)}</div><div className="saldo-people"><span>Yang ada di bill</span><span><Avatar person="A" size="small" /><Avatar person="B" size="small" />{ctx.state.invitedC && <Avatar person="C" size="small" />}</span></div></div><BillActions ctx={ctx} /></div>
  if (variant === 'teman') return <div className="screen screen-bill bill-teman"><div className="teman-bill-head"><button type="button" onClick={() => ctx.setScreen('home')}><ArrowLeft size={19} /></button><span>Bill bareng</span><button type="button" onClick={() => ctx.setSheet('share')}><ShareNetwork size={19} /></button></div><h1>Dapur Tiga</h1><p>Makan siang · 12 Oktober 2026</p><div className="teman-party"><div><Avatar person="A" /><b>Aufa</b><small>Nalangin</small></div><div><Avatar person="B" /><b>Kamu</b><small>{ctx.state.doneB ? 'Selesai pilih' : 'Memilih item'}</small></div><button type="button" onClick={() => ctx.state.invitedC ? (ctx.setPersonDetail('Citra'), ctx.setSheet('person')) : ctx.setSheet('invite')}><span className="avatar avatar-violet">{ctx.state.invitedC ? 'C' : '+'}</span><b>{ctx.state.invitedC ? 'Citra' : 'Undang'}</b><small>{ctx.state.invitedC ? ctx.state.doneC ? 'Ditentukan A' : 'Belum pilih' : 'Kontak'}</small></button></div><div className="teman-own"><span>Bagianmu sekarang</span><Amount value={totals.due[ctx.state.persona]} /><small>{totals.allocationReady ? 'Pembagian lengkap' : `${totals.pendingParts} bagian masih menunggu`}</small></div><div className="teman-item-area"><div className="section-row"><h2>Item di meja</h2><TinyStatus tone="accent">4 item</TinyStatus></div><div className="item-list">{ITEMS.map((item) => <ItemRow key={item.id} ctx={ctx} item={item} />)}</div></div><BillActions ctx={ctx} /></div>
  if (variant === 'struk') return <div className="screen screen-bill bill-struk"><div className="struk-bill-head"><button type="button" onClick={() => ctx.setScreen('home')}><ArrowLeft size={18} /> Beranda</button><button type="button" onClick={() => ctx.setSheet('share')}><ShareNetwork size={18} /> Bagikan</button></div><div className="struk-bill-paper"><div className="receipt-perf" /><div className="struk-bill-logo">BAGIIN <span>/</span> BILL</div><div className="receipt-center"><h1>DAPUR TIGA</h1><p>Makan siang bareng<br />12/10/2026 · #BG-1024</p></div><div className="receipt-rule">✦ ✦ ✦</div><div className="receipt-table-head"><span>ITEM / PEMILIK</span><span>JUMLAH</span></div><div className="item-list">{ITEMS.map((item) => <ItemRow key={item.id} ctx={ctx} item={item} compact />)}</div><div className="receipt-calcs"><div><span>Subtotal</span><Amount value={150000} /></div><div><span>Voucher</span><span>−{idr(12000)}</span></div><div><span>Service</span><Amount value={15000} /></div><div><span>Ongkir</span><Amount value={10000} /></div></div><div className="receipt-grand"><span>TOTAL</span><Amount value={totals.total} /></div><div className="receipt-own"><span>BAGIANMU · {totals.allocationReady ? 'FINAL' : 'SEMENTARA'}</span><Amount value={totals.due[ctx.state.persona]} /></div><div className="receipt-bottom-mark">BAGI BARENG, BERES BARENG.</div></div><BillActions ctx={ctx} /></div>
  return null
}

function VariantRecap({ ctx }: { ctx: LabContext }) {
  const { totals, variant } = ctx
  const debt = Math.max(0, totals.due.B - ctx.state.paidB) + 28000
  const provisional = !totals.allocationReady
  return <div className={`screen screen-recap recap-${variant}`}><div className="recap-head"><button type="button" onClick={() => ctx.setScreen('home')}><ArrowLeft size={18} /> Beranda</button><span>{variant === 'struk' ? 'BUKU PATUNGAN' : 'Rekap patungan'}</span></div><h1>{variant === 'teman' ? 'Uang di antara kita.' : 'Yang masih berjalan.'}</h1><p className="recap-description">Sisa dari bill aktif. Ketuk orang untuk melihat asal angkanya.</p><div className="recap-dual"><div><span>Perlu kamu bayar</span><Amount value={debt} /><small>Ke 2 orang</small></div><div><span>Akan kamu terima</span><Amount value={46000} /><small>Dari 1 orang</small></div></div><div className="recap-segment"><span>Sudah pasti</span><b>{idr(28000)}</b><small>Bill yang pembagiannya lengkap</small></div>{provisional && <div className="recap-provisional"><div><Clock size={20} /><b>Perkiraan tambahan</b></div><Amount value={Math.max(0, totals.due.B - ctx.state.paidB)} /><p>Bill Dapur Tiga masih punya {totals.pendingParts} bagian yang menunggu. Nominal bisa berubah.</p><button type="button" onClick={() => ctx.setScreen('bill')}>Lihat bill <ArrowRight size={16} /></button></div>}<div className="section-row recap-list-title"><h2>Per orang</h2><span>Tanpa saling potong</span></div><button type="button" className="recap-person" onClick={() => { ctx.setPersonDetail('Aufa'); ctx.setSheet('person') }}><Avatar person="A" /><span><b>Aufa</b><small>Dapur Tiga · Makan siang</small></span><Amount value={Math.max(0, totals.due.B - ctx.state.paidB)} /><CaretRight size={17} /></button><button type="button" className="recap-person" onClick={() => { ctx.setPersonDetail('Nadia'); ctx.setSheet('person') }}><span className="avatar avatar-rose">N</span><span><b>Nadia</b><small>Kopi Jumat · Sudah pasti</small></span><Amount value={28000} /><CaretRight size={17} /></button><button type="button" className="recap-person incoming" onClick={() => { ctx.setPersonDetail('Raka'); ctx.setSheet('person') }}><span className="avatar avatar-green">R</span><span><b>Raka</b><small>Belanja snack · Uang masuk</small></span><Amount value={46000} /><CaretRight size={17} /></button></div>
}

function CreateScreen({ ctx }: { ctx: LabContext }) {
  const [source, setSource] = useState<'ocr' | 'manual'>('ocr')
  const [rows, setRows] = useState([{ name: 'Nasi goreng kampung', price: 42000 }, { name: 'Mie ayam bakso', price: 36000 }, { name: 'Es teh manis ×3', price: 24000 }, { name: 'Dimsum platter', price: 54000 }])
  const [discount, setDiscount] = useState(6000)
  return <div className={`screen screen-create create-${ctx.variant}`}><div className="create-head"><button type="button" onClick={() => ctx.setScreen('home')}><ArrowLeft size={18} /></button><span>Bill baru</span><span>1 / 2</span></div><h1>Isi struknya dulu.</h1><p>Pemilihan orang dan item dilakukan setelah bill dibuat.</p><div className="source-switch"><button type="button" className={source === 'ocr' ? 'selected' : ''} onClick={() => { setSource('ocr'); ctx.notify('Contoh hasil OCR dimuat ke editor.') }}><Camera size={18} /> Dari foto</button><button type="button" className={source === 'manual' ? 'selected' : ''} onClick={() => { setSource('manual'); ctx.notify('Mode manual memakai editor yang sama.') }}><PencilSimple size={18} /> Ketik manual</button></div><div className="create-source-note">{source === 'ocr' ? <><Sparkle size={18} /> Contoh hasil OCR sudah terisi. Cek dan ubah bila ada yang meleset.</> : <><PencilSimple size={18} /> Ketik nama dan harga item langsung di bawah.</>}</div><div className="editor-title"><span>ITEM BILL</span><button type="button" onClick={() => setRows((old) => [...old, { name: '', price: 0 }])}><Plus size={17} /> Tambah</button></div><div className="editor-rows">{rows.map((row, i) => <div className="editor-row" key={i}><input aria-label={`Nama item ${i + 1}`} value={row.name} placeholder="Nama item" onChange={(event) => setRows((old) => old.map((item, n) => n === i ? { ...item, name: event.target.value } : item))} /><div><span>Rp</span><input aria-label={`Harga item ${i + 1}`} type="number" min="0" value={row.price || ''} placeholder="0" onChange={(event) => setRows((old) => old.map((item, n) => n === i ? { ...item, price: Number(event.target.value) } : item))} /></div><button type="button" aria-label={`Hapus item ${i + 1}`} onClick={() => setRows((old) => old.filter((_, n) => n !== i))}><X size={17} /></button></div>)}</div><div className="editor-cost"><span>Diskon item / voucher</span><div><span>− Rp</span><input aria-label="Diskon contoh" type="number" min="0" value={discount || ''} onChange={(event) => setDiscount(Number(event.target.value))} /></div></div><div className="editor-total"><span>Total editor contoh</span><Amount value={rows.reduce((sum, row) => sum + row.price, 0) - discount} /></div><div className="create-bottom"><button type="button" className="primary-action" onClick={() => { ctx.setScreen('bill'); ctx.notify('Membuka bill contoh. Editor ini simulasi lokal; data bill contoh tetap sama.') }}>Lihat bill contoh <ArrowRight size={18} /></button><small>Prototype: perubahan editor hanya contoh tampilan, tidak disimpan ke bill.</small></div></div>
}

function SheetLayer({ ctx, sheet, activeItem, personDetail, close }: { ctx: LabContext; sheet: Sheet; activeItem: ItemId; personDetail: string; close: () => void }) {
  const item = ITEMS.find((entry) => entry.id === activeItem) || ITEMS[3]
  const currentDue = ctx.totals.due[ctx.state.persona]
  const paid = ctx.state.persona === 'B' ? ctx.state.paidB : ctx.state.paidC
  async function copyLink() {
    const url = new URL(window.location.href)
    url.searchParams.set('v', ctx.variant)
    try { await navigator.clipboard.writeText(url.toString()); ctx.notify('Link prototype tersalin.'); close() }
    catch { ctx.notify('Salin alamat halaman dari browser.'); }
  }
  return <div className="sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}><section className={`sheet v-${ctx.variant}`} role="dialog" aria-modal="true" aria-label={sheet === 'item' ? 'Rincian item' : sheet === 'pay' ? 'Pembayaran' : 'Pilihan bill'}><div className="sheet-handle" /><button type="button" className="sheet-close" onClick={close} aria-label="Tutup"><X size={20} /></button>
    {sheet === 'share' && <><div className="sheet-icon"><LinkIcon size={24} /></div><h2>Undang lewat link</h2><p>Orang baru bisa bergabung lalu memilih itemnya sendiri. Kontak lama bisa diundang langsung dari bill.</p><div className="share-link">bagiin.app/b/dapur-tiga <button type="button" onClick={copyLink} aria-label="Salin link"><Copy size={19} /></button></div><button type="button" className="primary-action" onClick={copyLink}>Salin link bill <Copy size={18} /></button></>}
    {sheet === 'invite' && <><div className="sheet-icon"><UserPlus size={24} /></div><h2>Undang teman</h2><p>Citra pernah se-bill denganmu. Undangan ini langsung menambahkannya ke bill.</p><div className="invite-person"><Avatar person="C" /><span><b>Citra Putri</b><small>Pernah se-bill 3 kali</small></span><CheckCircle size={20} /></div><button type="button" className="primary-action" onClick={ctx.invite}>Undang Citra <ArrowRight size={18} /></button><button type="button" className="sheet-secondary" onClick={() => ctx.setSheet('share')}>Pakai link untuk orang baru</button></>}
    {sheet === 'pay' && <><div className="sheet-icon"><CreditCard size={24} /></div><h2>{paid ? 'Tandai tambahan' : 'Tandai sudah bayar'}</h2><p>Ini mencatat status pembayaranmu. Uangnya dikirim di luar Bagiin.</p><div className="pay-amount"><span>{paid ? 'Kekurangan saat ini' : 'Nominal yang ditandai'}</span><Amount value={currentDue - paid} /></div><div className="pay-method"><span>BCA</span><div><b>Aufa Fauqi</b><small>1234 5678 9012</small></div><button type="button" onClick={() => ctx.notify('Nomor rekening contoh: 1234 5678 9012')}><Copy size={18} /></button></div><button type="button" className="primary-action" onClick={ctx.pay}>Tandai lunas <Check size={18} /></button></>}
    {sheet === 'item' && <><div className="sheet-icon"><ForkKnife size={24} /></div><h2>{item.name}</h2><p>{item.note}. Pilihan pada bill ini langsung memperbarui perkiraan tiap orang.</p>{item.id === 'dimsum' ? <><div className="sheet-people"><div><Avatar person="A" size="small" /> Aufa <CheckCircle size={18} /></div><div><Avatar person="B" size="small" /> Kamu {ctx.state.dimsumB && <CheckCircle size={18} />}</div><div><Avatar person="C" size="small" /> Citra {ctx.state.dimsumC ? <CheckCircle size={18} /> : <span>Belum ambil</span>}</div></div><div className="share-count"><span>Rencana dibagi</span><div><button type="button" onClick={() => ctx.state.persona === 'A' ? ctx.setCount(ctx.state.dimsumCount - 1) : ctx.notify('Hanya owner yang dapat mengubah jumlah pemakan.')}><Minus size={17} /></button><b>{ctx.state.dimsumCount} orang</b><button type="button" onClick={() => ctx.state.persona === 'A' ? ctx.setCount(ctx.state.dimsumCount + 1) : ctx.notify('Hanya owner yang dapat mengubah jumlah pemakan.')}><Plus size={17} /></button></div></div>{ctx.state.persona === 'A' && <button type="button" className="primary-action" onClick={() => ctx.state.invitedC ? ctx.assign() : ctx.setSheet('invite')}>{ctx.state.invitedC ? 'Tetapkan bagian Citra' : 'Undang Citra dulu'} <ArrowRight size={18} /></button>}</> : <div className="sheet-line"><span>Harga setelah diskon</span><Amount value={item.price - item.discount} /></div>}<button type="button" className="sheet-secondary" onClick={close}>Kembali ke bill</button></>}
    {sheet === 'person' && <><div className="sheet-icon"><Wallet size={24} /></div><h2>{personDetail}</h2><p>Rincian ini menunjukkan asal sisa kewajiban, tanpa memotong utang dua arah secara otomatis.</p><div className="person-breakdown"><span>{personDetail === 'Aufa' ? 'Makan siang di Dapur Tiga' : personDetail === 'Nadia' ? 'Kopi Jumat' : 'Belanja snack'}</span><Amount value={personDetail === 'Aufa' ? Math.max(0, ctx.totals.due.B - ctx.state.paidB) : personDetail === 'Nadia' ? 28000 : 46000} /></div><button type="button" className="primary-action" onClick={() => { close(); ctx.setScreen('bill') }}>Buka bill sumber <ArrowRight size={18} /></button></>}
  </section></div>
}

createRoot(document.getElementById('root')!).render(<LabApp />)
