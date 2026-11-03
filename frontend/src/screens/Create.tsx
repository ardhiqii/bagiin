import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { formatDigits, formatRp, parseRupiah } from '../lib/money'
import { AppShell } from '../components/AppShell'
import { useToast } from '../components/Toast'
import { ActionGroup, ActionRow, Alert, Button, DateField, Field, SectionHead, Sheet } from '../ds/primitives'
import { Camera, Images, Plus, X } from '@phosphor-icons/react'
import { IconPaste } from '../ds/icons'
import createHeroArt from '../assets/create-hero.webp'
import scanArt from '../assets/scan.webp'
import scanLine from '../assets/scan-line.webp'
import { invalidateMoneyViews } from '../lib/mutations'
import { useContacts, type Contact } from '../lib/queries'
import { PeoplePicker } from '../components/PeoplePicker'

/**
 * Backend menolak judul, nama tempat, dan nama item di atas 120 karakter.
 * Angka yang sama dipakai di sini supaya orang tidak mengetik 400 karakter lalu
 * menunggu perjalanan ke server hanya untuk diberi tahu.
 */
const MAX_TEXT = 120

type DraftItem = { key: string; name: string; qty: string; price: string }

/**
 * Tanggal hari ini menurut jam perangkat, bukan UTC.
 *
 * `new Date().toISOString()` memotong ke UTC: di WIB (UTC+7) pukul 06.00 tanggal
 * 1 masih tercatat 31 di UTC, jadi tanggal bawaannya bisa meleset sehari.
 */
function todayISO(): string {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

const newItem = (): DraftItem => ({ key: Math.random().toString(36).slice(2), name: '', qty: '1', price: '' })

/** Angka -> teks ribuan tanpa prefix, untuk isi input. */
/**
 * Papan klip hanya bisa dibaca lewat izin pengguna (Chrome Android, Safari iOS
 * 13.1+). Kalau tidak ada, tombolnya tidak ditampilkan — lebih baik tidak
 * menjanjikan jalan yang tidak ada daripada tombol yang selalu gagal.
 */
const bisaTempelGambar = typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.read)

/** Mouse atau trackpad: di situlah Ctrl+V masuk akal untuk disebut. */
const perangkatPointer = typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches

export function Create({ identityId }: { identityId: string | null }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()

  const [title, setTitle] = useState('')
  const [merchant, setMerchant] = useState('')
  /**
   * Tanggal bill. Bawaannya hari ini, tapi bisa diubah: bill sering dibuat
   * belakangan untuk transaksi yang tanggalnya lain (makan tanggal 31, dicatat
   * tanggal 2), dan tanpa pilihan ini tanggalnya ikut tanggal pencatatan.
   */
  const [billDate, setBillDate] = useState(todayISO)
  const [items, setItems] = useState<DraftItem[]>([newItem()])
  const [tax, setTax] = useState('')
  const [service, setService] = useState('')
  const [discount, setDiscount] = useState('')
  const [payerName, setPayerName] = useState('')
  const [busy, setBusy] = useState(false)
  // Kunci sinkron, bukan state: dua ketukan dalam satu putaran render sama-sama
  // membaca busy=false, dan itu cukup untuk membuat DUA bill (terbukti di tes
  // ketukan ganda). Kunci ini menutup celah sebelum render berikutnya sempat
  // mematikan tombolnya.
  const submitLock = useRef(false)
  const [error, setError] = useState('')
  /** Semua foto bill ini: ada yang dibaca AI, ada yang cuma bukti. */
  const [photos, setPhotos] = useState<{ path: string; source: 'ocr' | 'attach' }[]>([])
  /**
   * 'ocr' = foto dibaca AI dan angkanya masuk form, 'attach' = foto cuma bukti
   * dan angkanya diketik sendiri. Dua jalur ini yang bikin orang tetap bisa
   * lanjut waktu AI sedang mati atau kuotanya habis.
   */
  const [photoBusy, setPhotoBusy] = useState<'ocr' | 'attach' | null>(null)
  const [ocrError, setOcrError] = useState('')
  const [ocrSeconds, setOcrSeconds] = useState(0)
  const [lastFiles, setLastFiles] = useState<File[]>([])
  const [taxIncluded, setTaxIncluded] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const kameraRef = useRef<HTMLInputElement>(null)
  /** Sheet pemilih sumber foto: kamera, galeri, atau papan klip. */
  const [sumberTerbuka, setSumberTerbuka] = useState(false)
  const intentRef = useRef<'ocr' | 'attach'>('ocr')
  const abortRef = useRef<AbortController | null>(null)
  // Peserta dipilih dari orang yang pernah sebill, bukan diketik. Yang belum
  // pernah sebill masuk lewat link bill: dia memilih namanya sendiri di sana.
  const [picked, setPicked] = useState<Contact[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  /** Indeks foto yang sedang dilihat penuh; null = tidak ada. */
  const [viewer, setViewer] = useState<number | null>(null)
  /**
   * Gambar yang baru ditempel, menunggu diputuskan mau dibacakan AI atau cuma
   * dilampirkan. Tempelan tidak punya tombol asal seperti "Scan pakai AI", jadi
   * niatnya harus ditanyakan — dan menampilkan thumbnail-nya sekalian membuat
   * orang bisa memastikan yang tertempel memang struk yang benar.
   */
  const [pending, setPending] = useState<{ file: File; url: string }[]>([])
  /** URL pratinjau yang masih hidup; dilepas saat layar ditutup. */
  const pendingUrls = useRef<string[]>([])
  const contacts = useContacts(identityId, Boolean(identityId))

  useEffect(() => {
    if (photoBusy !== 'ocr') return
    const timer = setInterval(() => setOcrSeconds((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [photoBusy])

  /* Ctrl+V di mana saja di layar ini menempelkan screenshot struk. Teks biasa
     dibiarkan menempel di kolomnya sendiri — hanya gambar yang kita ambil. */
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (photoBusy) return
      const berkas = gambarDariPapanKlip(e.clipboardData)
      if (!berkas.length) return
      e.preventDefault()
      terimaFoto(berkas)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [photoBusy])

  // URL pratinjau harus dilepas, kalau tidak blob tempelan menahan memori sesi.
  // Hanya saat layar ditinggalkan: kalau efek ini bergantung pada `pending`, ia
  // akan melepas URL yang baru saja ditambahkan.
  useEffect(() => () => {
    for (const url of pendingUrls.current) URL.revokeObjectURL(url)
  }, [])

  function pilihSumber(sumber: 'kamera' | 'galeri' | 'papan klip') {
    setSumberTerbuka(false)
    if (sumber === 'kamera') kameraRef.current?.click()
    else if (sumber === 'galeri') fileRef.current?.click()
    else void tempelDariPapanKlip()
  }

  /**
   * Gambar dari papan klip. Struk yang paling sering dibagi orang Indonesia
   * bukan berkas — ia screenshot pesanan ojol yang masih nempel di papan klip,
   * atau struk yang difoto lalu disalin. Tanpa jalur pending, orang harus
   * menyimpan screenshot ke galeri dulu baru bisa memilihnya.
   */
  function gambarDariPapanKlip(data: DataTransfer | null): File[] {
    if (!data) return []
    const hasil: File[] = []
    for (const butir of Array.from(data.items ?? [])) {
      if (butir.kind !== 'file' || !butir.type.startsWith('image/')) continue
      const berkas = butir.getAsFile()
      if (berkas) hasil.push(berkas)
    }
    // Sebagian aplikasi hanya mengisi `files` tanpa `items`.
    if (!hasil.length) {
      for (const berkas of Array.from(data.files ?? [])) {
        if (berkas.type.startsWith('image/')) hasil.push(berkas)
      }
    }
    return hasil.slice(0, 3)
  }

  /**
   * Tempelan masuk ke daftar, tidak menimpa. Menimpa diam-diam adalah yang
   * paling menyebalkan saat orang menempel berkali-kali: screenshot kedua
   * datang, yang pertama hilang tanpa pernah dipakai.
   */
  function terimaFoto(files: File[]) {
    if (!files.length) return
    setOcrError('')
    setPending((lama) => {
      const sisa = 10 - lama.length
      if (sisa <= 0) {
        toast('Sudah 10 foto. Buang satu dulu kalau mau menempel yang lain.')
        return lama
      }
      const masuk = files.slice(0, sisa)
      if (masuk.length < files.length) {
        toast('Cuma ' + masuk.length + ' foto yang muat — batas satu bill 10 foto.')
      }
      const baru = masuk.map((file) => {
        const url = URL.createObjectURL(file)
        pendingUrls.current.push(url)
        return { file, url }
      })
      return [...lama, ...baru]
    })
  }

  /** Foto yang diketuk di strip naik jadi tampilan besar. */
  function jadikanUtama(indeks: number) {
    setPending((lama) => {
      if (indeks <= 0 || indeks >= lama.length) return lama
      const urut = [...lama]
      const [pilih] = urut.splice(indeks, 1)
      return [pilih, ...urut]
    })
  }

  function buangPending(indeks: number) {
    setPending((lama) => {
      const buang = lama[indeks]
      if (buang) {
        URL.revokeObjectURL(buang.url)
        pendingUrls.current = pendingUrls.current.filter((url) => url !== buang.url)
      }
      return lama.filter((_, i) => i !== indeks)
    })
  }

  function bersihkanPending() {
    for (const item of pending) URL.revokeObjectURL(item.url)
    pendingUrls.current = []
    setPending([])
  }

  /** Tempelan yang sudah diputuskan: jalurnya sama dengan dua tombol di atas. */
  function pakaiPending(intent: 'ocr' | 'attach') {
    if (!pending.length) return
    const files = pending.map((item) => item.file)
    for (const item of pending) URL.revokeObjectURL(item.url)
    pendingUrls.current = []
    setPending([])
    intentRef.current = intent
    onFilesPicked(files)
  }

  async function tempelDariPapanKlip() {
    if (photoBusy) return
    setOcrError('')
    try {
      const butir = await navigator.clipboard.read()
      for (const isi of butir) {
        const jenis = isi.types.find((t) => t.startsWith('image/'))
        if (!jenis) continue
        const blob = await isi.getType(jenis)
        const ext = jenis.split('/')[1] || 'png'
        terimaFoto([new File([blob], `pending-${Date.now()}.${ext}`, { type: jenis })])
        return
      }
      toast('Papan klip tidak berisi gambar. Salin dulu screenshot struknya.')
    } catch {
      toast('Browser ini melarang membaca papan klip. Pakai "Scan pakai AI" ya.')
    }
  }

  function onFilesPicked(files: File[]) {
    if (!files.length) return
    setLastFiles(files)
    setError('')
    setOcrError('')
    setOcrSeconds(0)
    if (intentRef.current === 'attach') void attachPhotos(files)
    else void readPhotos(files)
  }

  /** Unggah foto tanpa AI: bukti struk, angkanya diketik sendiri. */
  async function attachPhotos(files: File[]) {
    if (!files.length) return
    setPhotoBusy('attach')
    try {
      const saved: { path: string; source: 'attach' }[] = []
      for (const file of files) {
        const form = new FormData()
        form.append('file', file)
        const res = await api<{ photo_path: string }>('/api/photos', { method: 'POST', body: form })
        saved.push({ path: res.photo_path, source: 'attach' })
      }
      setPhotos((prev) => [...prev, ...saved].slice(0, 10))
      setOcrError('')
      toast(
        saved.length > 1
          ? saved.length + ' foto dilampirkan sebagai bukti.'
          : 'Foto dilampirkan sebagai bukti. Angkanya isi sendiri ya.',
      )
    } catch (err) {
      setOcrError((err as Error).message)
    } finally {
      setPhotoBusy(null)
    }
  }

  function cancelRead() {
    abortRef.current?.abort()
    abortRef.current = null
    setPhotoBusy(null)
    setOcrError('')
  }

  async function readPhotos(files: File[]) {
    // Tiga foto terbukti aman: struk 11 item dipotong tiga bagian dengan
    // overlap tetap terbaca 11 item dan total yang sama, tanpa duplikat.
    // Sisanya tetap disimpan sebagai bukti supaya tidak ada foto yang hilang.
    const forAi = files.slice(0, 3)
    // Dulu `slice(2)`: dengan tiga foto, foto ketiga ikut dibaca AI DAN ikut
    // dilampirkan, jadi muncul dua kali di bill.
    const extras = files.slice(forAi.length)
    setPhotoBusy('ocr')
    setOcrError('')
    setOcrSeconds(0)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const form = new FormData()
      for (const file of forAi) form.append('file', file)
      const draft = await api<{
        title?: string
        merchant?: string
        items?: { name?: string; price?: number; quantity?: number }[]
        photos?: string[]
        photo_path?: string
        tax?: number
        service?: number
        /** backend menamainya order_discount; discount cuma alias lama */
        order_discount?: number
        discount?: number
        /** harga item sudah termasuk pajak: jangan tambah kolom pajak lagi */
        tax_included?: boolean
      }>('/api/ocr', { method: 'POST', body: form, signal: controller.signal })
      if (draft.title && draft.title.trim()) setTitle(draft.title)
      if (draft.merchant) setMerchant(draft.merchant)
      const included = Boolean(draft.tax_included)
      setTaxIncluded(included)
      setTax(included ? '' : draft.tax ? formatDigits(draft.tax) : '')
      if (draft.service) setService(formatDigits(draft.service))
      const discountFromReceipt = draft.order_discount ?? draft.discount
      if (discountFromReceipt) setDiscount(formatDigits(discountFromReceipt))
      const readPaths = (draft.photos?.length
        ? draft.photos
        : draft.photo_path
          ? [draft.photo_path]
          : []
      ).map((path) => ({ path, source: 'ocr' as const }))
      setPhotos((prev) => [...prev, ...readPaths].slice(0, 10))
      if (draft.items?.length) {
        setItems(
          draft.items.map((it) => ({
            key: Math.random().toString(36).slice(2),
            name: it.name ?? '',
            qty: String(it.quantity ?? 1),
            price: formatDigits(it.price ?? 0),
          })),
        )
      }
      toast(
        forAi.length > 1
          ? forAi.length + ' foto digabung jadi satu bill. Cek lagi angkanya ya.'
          : 'Struk terbaca. Cek lagi angkanya ya.',
      )
      if (extras.length) await attachPhotos(extras)
    } catch (err) {
      if (controller.signal.aborted || (err as Error).name === 'AbortError') return
      setOcrError((err as Error).message)
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setPhotoBusy(null)
    }
  }

  const parsed = items.map((i) => ({
    name: i.name.trim(),
    qty: Math.max(1, Number.parseInt(i.qty || '1', 10) || 1),
    price: parseRupiah(i.price),
  }))
  const subtotal = parsed.reduce((sum, i) => sum + i.price * i.qty, 0)
  const taxIdr = parseRupiah(tax)
  const serviceIdr = parseRupiah(service)
  const discountIdr = parseRupiah(discount)
  const grossTotal = subtotal + taxIdr + serviceIdr
  /* Diskon yang lebih besar dari tagihan tidak boleh menghasilkan total minus:
     layar sempat menampilkan "Rp-70.000" untuk diskon 90.000 pada bill 20.000,
     dan itu angka yang tidak bisa dibayar siapa pun. Totalnya ditahan di Rp0
     dan kolom diskonnya yang diberi tahu. */
  // Aturan server: diskon pesanan tidak boleh melebihi subtotal (main.py).
  // Layar memakai batas yang sama supaya tombol tidak menyala untuk isian yang
  // pasti ditolak.
  const discountTooBig = discountIdr > subtotal
  const total = Math.max(0, grossTotal - discountIdr)

  const hasNamedItem = parsed.some((i) => i.name && i.price > 0)
  const canSubmit = Boolean(identityId) && hasNamedItem && total > 0 && !busy
  /* Tombol mati tanpa penjelasan bikin orang menebak. Kalau memang belum bisa
     disimpan, sebut apa yang kurang — di tempat yang sama dengan tombolnya. */
  // Identitas belum siap = tombol mati TANPA alasan. Itu yang terjadi kalau
  // layar dibuka terlalu cepat: tombolnya tidak bisa ditekan dan tidak ada satu
  // kata pun yang menjelaskan kenapa. Alasannya sekarang disebut, sekalian
  // memberi tahu bahwa ini soal waktu, bukan isian yang salah.
  const blockedReason = !identityId
    ? 'Menyiapkan… sebentar.'
    : !hasNamedItem
      ? 'Isi nama item & harga dulu.'
      : discountTooBig
        ? 'Diskonnya lebih besar dari total bill.'
      : total <= 0
        ? 'Total masih Rp0.'
        : ''

  async function submit() {
    if (submitLock.current || !canSubmit) return
    submitLock.current = true
    setError('')
    setBusy(true)
    try {
      const created = await api<{ id: string }>('/api/bills', {
        method: 'POST',
        body: {
          title: title.trim() || merchant.trim() || 'Bill',
          merchant: merchant.trim() || null,
          // jam 12 siang, bukan tengah malam: tengah malam UTC bisa jatuh ke
          // tanggal sebelumnya di zona waktu barat, dan jam 12 aman di semua zona.
          transacted_at: billDate ? billDate + ' 12:00:00' : null,
          tax_mode: 'proportional',
          subtotal,
          order_discount: discountIdr,
          cashback: 0,
          tax: taxIdr,
          service: serviceIdr,
          total,
          items: parsed
            .filter((i) => i.name && i.price > 0)
            .map((i) => ({
              name: i.name,
              price: i.price,
              discount: 0,
              quantity: i.qty || 1,
              // semua baris satu perlakuan: ketuk = ambil satu porsi. Pembagian
              // rata ke lebih banyak orang terjadi sendiri di kalkulator.
              mode: 'free',
              slot_count: null,
            })),
          photo_path: photos[0]?.path ?? null,
          photos: photos.map((p) => p.path),
          paid_by_name: payerName.trim() || null,
          tax_included: taxIncluded ? 1 : 0,
          // Nama jadi placeholder, identity_id-nya ikut supaya orang yang
          // dipilih benar-benar terhubung dan diundang oleh server. Dulu yang
          // dikirim cuma nama: tidak ada undangan sama sekali, jadi orang yang
          // sudah dipilih tidak pernah tahu dirinya masuk bill ini.
          participants: picked.map((contact) => ({
            name: contact.display_name,
            identity_id: contact.id,
          })),
        },
      })
      // bill baru mengubah beranda DAN rekap: yang lain belum tahu bill ini ada
      invalidateMoneyViews(qc, { identityId })
      toast('Bill sudah jadi. Bagikan linknya ke teman kamu.')
      navigate({ to: '/b/$billId', params: { billId: created.id } })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      submitLock.current = false
      setBusy(false)
    }
  }

  return (
    <AppShell
      title="Bill baru"
      subtitle="Isi item, pajak, lalu simpan"
      back
      active="create"
      footer={
        <div className="create-dock">
          <div className="tot">
            <small>Total bill</small>
            <b>{formatRp(total)}</b>
            {/* Slot ini SELALU ada, walau kosong. Sebelumnya alasan hanya
                dirender saat tombol mati, jadi dock menyusut 40 px dan tombolnya
                melompat tepat saat orang mau menekan — ketukan mendarat di
                tempat lama. Diukur: tombol bergeser 20 px (y 691 -> 711). */}
            <small className="dock-reason" role="status" aria-live="polite">
              {blockedReason || '\u00a0'}
            </small>
          </div>
          <Button loading={busy} disabled={!canSubmit} onClick={submit}>
            Buat bill
          </Button>
        </div>
      }
    >
      {/* Tanpa atribut capture: di HP, pemilih bawaan menawarkan kamera atau
          galeri, jadi beberapa foto sekaligus bisa dipilih. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(event) => {
          terimaFoto(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />
      {/* Kamera punya input sendiri: `capture` memaksa kamera belakang dan
          mematikan pilihan galeri, jadi keduanya tidak bisa satu elemen. */}
      <input
        ref={kameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(event) => {
          terimaFoto(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />

      {photos.length > 0 ? (
        <section className="photo-block">
          <SectionHead meta={<>{photos.length} dari 10</>}>Foto struk</SectionHead>
          <div className="photo-grid">
            {photos.map((photo) => (
              <div className="photo-tile" key={photo.path}>
                {/* Ketuk = lihat penuh, supaya hasil bacaan AI bisa diperiksa
                    ulang sebelum bill disimpan. Tombol hapus tetap terpisah:
                    satu ketukan tidak boleh punya dua arti. */}
                <button
                  type="button"
                  className="photo-open"
                  aria-label={'Lihat foto ' + (photos.indexOf(photo) + 1)}
                  onClick={() => setViewer(photos.indexOf(photo))}
                >
                  <img
                    src={'/uploads/' + photo.path.split('/').pop()}
                    alt={photo.source === 'ocr' ? 'Foto struk yang dibaca' : 'Foto struk bukti'}
                  />
                </button>
                <span className={'photo-tag' + (photo.source === 'ocr' ? ' is-ai' : '')}>
                  {photo.source === 'ocr' ? 'AI' : 'bukti'}
                </span>
                <button
                  type="button"
                  className="photo-kill"
                  aria-label="Hapus foto"
                  onClick={() => setPhotos((prev) => prev.filter((item) => item.path !== photo.path))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <Button variant="secondary" block onClick={() => setSumberTerbuka(true)}>
            Tambah foto
          </Button>
        </section>
      ) : photoBusy ? (
        <div className={'ds-create-hero' + (photoBusy === 'ocr' ? ' is-scanning' : '')} role="status">
          {/* Ilustrasi diam; hanya garis hijaunya yang menyapu atas-bawah. */}
          <span className="ds-scan-art">
            <img src={scanArt} alt="" width={120} height={120} />
            {photoBusy === 'ocr' ? <img className="ds-scan-beam" src={scanLine} alt="" aria-hidden="true" /> : null}
          </span>
          <div>
            <b>
              {photoBusy === 'ocr'
                ? 'Membaca struk… ' + (ocrSeconds > 0 ? ocrSeconds + ' detik' : '')
                : 'Mengunggah foto…'}
            </b>
            <p className="app-note">
              {photoBusy === 'ocr'
                ? 'Bisa 10-60 detik kalau layanan AI ramai. Kamu tetap bisa mengisi manual sambil menunggu.'
                : 'Sebentar, fotonya sedang disimpan.'}
            </p>
            {photoBusy === 'ocr' ? (
              <Button variant="quiet" onClick={cancelRead}>
                Batal baca
              </Button>
            ) : null}
          </div>
        </div>
      ) : ocrError ? null : pending.length > 0 ? (
        /* Sejak foto masuk, foto itulah subjeknya — ilustrasi struk sudah tidak
           relevan, jadi tempatnya digantikan hasil pending, bukan ditemani kotak
           thumbnail kecil. Niatnya ditanya di sini, bukan di baris tombol. */
        <section className="photo-review">
          <div className="photo-review-frame">
            <img src={pending[0].url} alt="Foto yang baru ditempel" />
            <button
              type="button"
              className="photo-review-kill"
              aria-label="Buang foto ke-1"
              onClick={() => buangPending(0)}
            >
              ×
            </button>
          </div>
          {pending.length > 1 ? (
            /* Semua foto tampil di strip, termasuk yang sedang besar: kalau yang
               besar tidak ikut dihitung, judul "3 foto" di bawahnya bertabrakan
               dengan dua thumbnail yang terlihat. */
            <div className="photo-review-strip">
              {pending.map((item, i) => (
                <div className={'photo-review-item' + (i === 0 ? ' is-active' : '')} key={item.url}>
                  <button
                    type="button"
                    className="photo-review-pick"
                    aria-label={i === 0 ? 'Sedang ditampilkan' : `Tampilkan foto ke-${i + 1}`}
                    onClick={() => jadikanUtama(i)}
                  >
                    <img src={item.url} alt="" />
                  </button>
                  <button
                    type="button"
                    className="photo-review-kill"
                    aria-label={`Buang foto ke-${i + 1}`}
                    onClick={() => buangPending(i)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="app-inline">
            <b>{pending.length > 1 ? pending.length + ' foto siap dipakai' : 'Screenshot siap dipakai'}</b>
            <span className="app-spacer" />
            <button type="button" className="link-quiet" onClick={bersihkanPending}>
              Buang semua
            </button>
          </div>
          <p className="app-note">
            Mau dibacakan AI supaya item dan totalnya terisi sendiri, atau cuma dilampirkan sebagai bukti?
          </p>
          <div className="photo-actions">
            <Button onClick={() => pakaiPending('ocr')}>Baca pakai AI</Button>
            <Button variant="secondary" onClick={() => pakaiPending('attach')}>
              Lampirkan saja
            </Button>
          </div>
          <div className="photo-review-foot">
            {bisaTempelGambar ? (
              <button type="button" className="link-quiet" onClick={() => void tempelDariPapanKlip()}>
                Tempel lagi
              </button>
            ) : null}
            <span className="app-spacer" />
            <span className="photo-review-count">{pending.length} dari 10</span>
          </div>
        </section>
      ) : (
        <div className="ds-create-hero is-choice">
          <img src={createHeroArt} alt="" width={64} height={64} />
          <div className="grow">
            {/* Tanpa tautan "Isi manual saja": formulirnya ada persis di bawah
                kartu ini, jadi tautan itu cuma berebut perhatian dengan tombol
                utama tanpa menambah jalan yang belum ada. */}
            <b>Foto struk (opsional)</b>
            <p className="app-note">AI bisa baca struk atau screenshot.</p>
            {/* Satu tombol, karena pertanyaannya cuma satu: "fotonya dari mana?".
                Niatnya (dibacakan AI atau tidak) ditanya setelah fotonya ada —
                di layar yang sama, saat orang sudah melihat fotonya. */}
            <div className="photo-cta-wrap">
              <Button onClick={() => setSumberTerbuka(true)}>
                <span className="photo-cta">
                  <Plus /> Tambah foto
                </span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {ocrError ? (
        <Alert tone="danger" title={photoBusy === 'attach' ? 'Foto gagal diunggah' : 'Struk gagal dibaca'}>
          {ocrError}
          <span style={{ display: 'block', marginTop: 10 }}>
            <Button
              onClick={() => {
                document.getElementById('item-name-0')?.scrollIntoView({ block: 'center' })
                document.getElementById('item-name-0')?.focus()
              }}
            >
              Isi manual sekarang
            </Button>
          </span>
          <span style={{ display: 'block', marginTop: 8 }}>
            <Button
              variant="quiet"
              disabled={!lastFiles.length || Boolean(photoBusy)}
              onClick={() => lastFiles.length && readPhotos(lastFiles)}
            >
              Coba baca lagi
            </Button>
            <Button
              variant="quiet"
              disabled={!lastFiles.length || Boolean(photoBusy)}
              onClick={() => lastFiles.length && attachPhotos(lastFiles)}
            >
              Pakai foto struk tadi sebagai bukti
            </Button>
            <Button variant="quiet" onClick={() => setSumberTerbuka(true)}>
              Foto lain
            </Button>
          </span>
        </Alert>
      ) : null}

      {error ? <Alert tone="danger" title="Bill gagal dibuat">{error}</Alert> : null}

      <Field
        id="bill-title"
        label="Nama bill"
        value={title}
        maxLength={MAX_TEXT}
        onChange={setTitle}
        hint={
          title.length >= MAX_TEXT - 20
            ? 'Sisa ' + (MAX_TEXT - title.length) + ' karakter'
            : 'Contoh: Makan malam di Warteg'
        }
      />
      <Field
        id="bill-merchant"
        label="Merchant (opsional)"
        value={merchant}
        maxLength={MAX_TEXT}
        onChange={setMerchant}
      />
      <DateField
        id="bill-date"
        label="Tanggal bill"
        value={billDate}
        onChange={setBillDate}
        hint="Bawaannya hari ini, ditulis tanggal/bulan/tahun. Ubah kalau bill-nya untuk tanggal lain."
      />

      <section className="app-stack">
        <div className="app-inline">
          <SectionHead>Item</SectionHead>
          <span className="app-spacer" />
          <button type="button" className="ds-button ds-button-quiet" onClick={() => setItems((prev) => [...prev, newItem()])}>
            + Tambah item
          </button>
        </div>

        {items.map((item, index) => (
          <div key={item.key} className="ds-group" style={{ border: '1px solid var(--ds-border)', background: 'var(--ds-surface)', borderRadius: 18, overflow: 'hidden' }}>
            <div className="item-row">
              <Field
                id={'item-name-' + index}
                label={'Item ' + (index + 1)}
                value={item.name}
                maxLength={MAX_TEXT}
                hint={
                  item.name.length >= MAX_TEXT - 20
                    ? 'Sisa ' + (MAX_TEXT - item.name.length) + ' karakter'
                    : undefined
                }
                onChange={(v) => setItems((prev) => prev.map((it) => (it.key === item.key ? { ...it, name: v } : it)))}
              />
              <div className="item-meta">
                <Field
                  id={'item-qty-' + index}
                  label="Qty"
                  value={item.qty}
                  inputMode="numeric"
                  onChange={(v) => setItems((prev) => prev.map((it) => (it.key === item.key ? { ...it, qty: v.replace(/[^0-9]/g, '') } : it)))}
                  // Kotak boleh kosong sebentar saat mengetik, tapi tidak boleh
                  // ditinggal 0 atau kosong: item tanpa porsi bukan item, dan
                  // layar Ubah bill sudah memaksa minimal 1 — dua layar tidak
                  // boleh berbeda aturan untuk kolom yang sama.
                  onBlur={() => setItems((prev) => prev.map((it) => (
                    it.key === item.key && (Number(it.qty) || 0) < 1 ? { ...it, qty: '1' } : it
                  )))}
                />
                <Field
                  id={'item-price-' + index}
                  label="Harga satuan"
                  value={item.price}
                  inputMode="numeric"
                  onChange={(v) => setItems((prev) => prev.map((it) => (it.key === item.key ? { ...it, price: formatDigits(parseRupiah(v)) } : it)))}
                />
                <button
                  type="button"
                  className="kill"
                  aria-label={'Hapus ' + (item.name.trim() || 'baris ' + (index + 1))}
                  disabled={items.length === 1}
                  style={items.length === 1 ? { opacity: .35, cursor: 'not-allowed' } : undefined}
                  onClick={() => setItems((prev) => prev.filter((it) => it.key !== item.key))}
                >
                  <X size={15} weight="bold" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="app-stack">
        <SectionHead>Siapa saja yang ikut (opsional)</SectionHead>
        <p className="app-note">
          Pilih dari orang yang pernah sebill dengan kamu. Teman baru tinggal buka link bill ini nanti, dia memilih namanya sendiri.
        </p>
        {picked.length > 0 ? (
          <div className="chip-row">
            {picked.map((contact) => (
              <span className="chip" key={contact.id}>
                {contact.display_name}
                <button
                  type="button"
                  aria-label={'Hapus ' + contact.display_name}
                  onClick={() => setPicked((prev) => prev.filter((item) => item.id !== contact.id))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <button type="button" className="add-person" onClick={() => setPickerOpen(true)}>
          <Plus size={18} weight="bold" aria-hidden="true" />
          {picked.length > 0 ? 'Tambah orang lagi' : 'Pilih orang'}
          {picked.length > 0 ? (
            <span className="add-count">{picked.length} orang dipilih</span>
          ) : null}
        </button>
      </section>

      <PeoplePicker
        open={pickerOpen}
        contacts={contacts.data}
        isPending={contacts.isPending}
        isError={contacts.isError}
        picked={picked}
        onToggle={(contact) =>
          setPicked((prev) =>
            prev.some((item) => item.id === contact.id)
              ? prev.filter((item) => item.id !== contact.id)
              : [...prev, contact],
          )
        }
        onClose={() => setPickerOpen(false)}
      />

      {/* Sumber foto dipilih di daftar aksi, bukan sebagai tiga tombol di kartu:
          di sini tempel punya label yang jelas tanpa harus jadi baris teks
          tambahan di bawah tombol. */}
      <Sheet open={sumberTerbuka} title="Tambah foto struk" onClose={() => setSumberTerbuka(false)}>
        <ActionGroup>
          <ActionRow
            icon={<Camera size={20} />}
            label="Kamera"
            note="Foto struk sekarang"
            onClick={() => pilihSumber('kamera')}
          />
          <ActionRow
            icon={<Images size={20} />}
            label="Galeri"
            note="Pilih foto atau screenshot"
            onClick={() => pilihSumber('galeri')}
          />
          {bisaTempelGambar ? (
            <ActionRow
              icon={<IconPaste />}
              label="Tempel screenshot"
              note="Dari papan klip"
              onClick={() => pilihSumber('papan klip')}
            />
          ) : null}
        </ActionGroup>
        {perangkatPointer ? (
          <p className="app-note">Di komputer, Ctrl+V juga langsung menempelkan screenshot.</p>
        ) : null}
      </Sheet>

      <Sheet open={viewer !== null} title="Foto struk" onClose={() => setViewer(null)}>
        {viewer !== null && photos[viewer] ? (
          <div className="photo-viewer">
            <img
              src={'/uploads/' + photos[viewer].path.split('/').pop()}
              alt={
                photos[viewer].source === 'ocr'
                  ? 'Foto struk yang dibaca AI ' + (viewer + 1)
                  : 'Foto struk bukti ' + (viewer + 1)
              }
            />
            {photos.length > 1 ? (
              <div className="photo-viewer-nav">
                <Button variant="secondary" disabled={viewer === 0} onClick={() => setViewer((v) => Math.max(0, (v ?? 0) - 1))}>
                  Sebelumnya
                </Button>
                <span className="app-note">
                  {viewer + 1} dari {photos.length}
                </span>
                <Button
                  variant="secondary"
                  disabled={viewer >= photos.length - 1}
                  onClick={() => setViewer((v) => Math.min(photos.length - 1, (v ?? 0) + 1))}
                >
                  Berikutnya
                </Button>
              </div>
            ) : (
              <p className="app-note">
                Cocokkan angkanya dengan isian di bawah. Kalau ada yang salah, tinggal ubah di form.
              </p>
            )}
          </div>
        ) : null}
      </Sheet>

      <section className="app-stack">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field
            id="bill-tax"
            label={taxIncluded ? 'Pajak (di dalam harga)' : 'Pajak'}
            value={taxIncluded ? '' : tax}
            inputMode="numeric"
            disabled={taxIncluded}
            onChange={(v) => setTax(formatDigits(parseRupiah(v)))}
          />
          <Field id="bill-service" label="Service" value={service} inputMode="numeric" onChange={(v) => setService(formatDigits(parseRupiah(v)))} />
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={taxIncluded}
            onChange={(event) => {
              setTaxIncluded(event.target.checked)
              if (event.target.checked) setTax('')
            }}
          />
          <span>
            Harga item sudah termasuk pajak
            <small>Pilih ini kalau struk menulis “termasuk pajak”. Pajak tidak ditambahkan lagi.</small>
          </span>
        </label>
        <Field
          id="bill-discount"
          label="Diskon pesanan"
          value={discount}
          inputMode="numeric"
          onChange={(v) => setDiscount(formatDigits(parseRupiah(v)))}
          hint={
            discountTooBig
              ? 'Diskon lebih besar dari total bill. Kecilkan angkanya.'
              : 'Diskon yang berlaku untuk seluruh bill'
          }
        />
        {discountTooBig ? (
          <div className="app-note" style={{ color: 'var(--ds-danger)', marginTop: -4 }}>
            Diskon {formatRp(discountIdr)} melebihi subtotal {formatRp(subtotal)}. Kecilkan
            angkanya dulu.
          </div>
        ) : null}
        <Field id="bill-payer" label="Yang bayar duluan (opsional)" value={payerName} onChange={setPayerName} hint="Kosongkan kalau kamu sendiri yang bayar" />
      </section>

      <div className="ds-card ds-card-mint ds-pad-md">
        <div className="app-inline">
          <span style={{ fontSize: 'var(--ds-text-md)', fontWeight: 700 }}>Subtotal</span>
          <span className="app-spacer" />
          <span>{formatRp(subtotal)}</span>
        </div>
        <div className="app-inline" style={{ marginTop: 6 }}>
          <span style={{ fontSize: 'var(--ds-text-md)', fontWeight: 700 }}>{taxIncluded ? 'Service' : 'Pajak + service'}</span>
          <span className="app-spacer" />
          <span>{formatRp((taxIncluded ? 0 : taxIdr) + serviceIdr)}</span>
        </div>
        {taxIncluded ? (
          <p className="app-note" style={{ marginTop: 6 }}>Pajak sudah nempel di harga item, jadi tidak dihitung lagi.</p>
        ) : null}
        {discountIdr > 0 ? (
          <div className="app-inline" style={{ marginTop: 6 }}>
            <span style={{ fontSize: 'var(--ds-text-md)', fontWeight: 700 }}>Diskon</span>
            <span className="app-spacer" />
            <span>−{formatRp(discountIdr)}</span>
          </div>
        ) : null}
      </div>

    </AppShell>
  )
}
