import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { formatRp, parseRupiah } from '../lib/money'
import { AppShell } from '../components/AppShell'
import { useToast } from '../components/Toast'
import { Alert, Button, Field, SectionHead } from '../ds/primitives'
import { X } from '@phosphor-icons/react'
import createHeroArt from '../assets/create-hero.webp'
import scanArt from '../assets/scan.webp'
import { invalidateMoneyViews } from '../lib/mutations'

/**
 * Backend menolak judul, nama tempat, dan nama item di atas 120 karakter.
 * Angka yang sama dipakai di sini supaya orang tidak mengetik 400 karakter lalu
 * menunggu perjalanan ke server hanya untuk diberi tahu.
 */
const MAX_TEXT = 120

type DraftItem = { key: string; name: string; qty: string; price: string }

const newItem = (): DraftItem => ({ key: Math.random().toString(36).slice(2), name: '', qty: '1', price: '' })

/** Angka -> teks ribuan tanpa prefix, untuk isi input. */
const formatRd = (value: number): string => formatRp(value).replace('Rp', '')

export function Create({ identityId }: { identityId: string | null }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()

  const [title, setTitle] = useState('')
  const [merchant, setMerchant] = useState('')
  const [items, setItems] = useState<DraftItem[]>([newItem()])
  const [tax, setTax] = useState('')
  const [service, setService] = useState('')
  const [discount, setDiscount] = useState('')
  const [payerName, setPayerName] = useState('')
  const [busy, setBusy] = useState(false)
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
  const intentRef = useRef<'ocr' | 'attach'>('ocr')
  const abortRef = useRef<AbortController | null>(null)
  const [roster, setRoster] = useState<string[]>([])
  const [rosterName, setRosterName] = useState('')

  useEffect(() => {
    if (photoBusy !== 'ocr') return
    const timer = setInterval(() => setOcrSeconds((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [photoBusy])

  function pickPhoto(intent: 'ocr' | 'attach') {
    intentRef.current = intent
    fileRef.current?.click()
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
    const extras = files.slice(2)
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
      setTax(included ? '' : draft.tax ? formatRd(draft.tax) : '')
      if (draft.service) setService(formatRd(draft.service))
      const discountFromReceipt = draft.order_discount ?? draft.discount
      if (discountFromReceipt) setDiscount(formatRd(discountFromReceipt))
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
            price: formatRd(it.price ?? 0),
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
    qty: Math.max(0, Number.parseInt(i.qty || '1', 10) || 0),
    price: parseRupiah(i.price),
  }))
  const subtotal = parsed.reduce((sum, i) => sum + i.price * i.qty, 0)
  const taxIdr = parseRupiah(tax)
  const serviceIdr = parseRupiah(service)
  const discountIdr = parseRupiah(discount)
  const total = subtotal + taxIdr + serviceIdr - discountIdr

  const hasNamedItem = parsed.some((i) => i.name && i.price > 0)
  const canSubmit = Boolean(identityId) && hasNamedItem && total > 0 && !busy
  /* Tombol mati tanpa penjelasan bikin orang menebak. Kalau memang belum bisa
     disimpan, sebut apa yang kurang — di tempat yang sama dengan tombolnya. */
  const blockedReason = !identityId
    ? ''
    : !hasNamedItem
      ? 'Isi nama item & harga dulu.'
      : total <= 0
        ? 'Total masih Rp0.'
        : ''

  async function submit() {
    if (!canSubmit) return
    setError('')
    setBusy(true)
    try {
      const created = await api<{ id: string }>('/api/bills', {
        method: 'POST',
        body: {
          title: title.trim() || merchant.trim() || 'Bill',
          merchant: merchant.trim() || null,
          transacted_at: null,
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
          // nama yang diketik di sini jadi placeholder: begitu orangnya join,
          // backend mencocokkan namanya dan klaim otomatis
          participants: roster,
        },
      })
      // bill baru mengubah beranda DAN rekap: yang lain belum tahu bill ini ada
      invalidateMoneyViews(qc, { identityId })
      toast('Bill sudah jadi. Bagikan linknya ke teman kamu.')
      navigate({ to: '/b/$billId', params: { billId: created.id } })
    } catch (err) {
      setError((err as Error).message)
    } finally {
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
          onFilesPicked(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />

      {photos.length > 0 ? (
        <section className="photo-block">
          <SectionHead meta={<>{photos.length} dari 10</>}>Foto struk</SectionHead>
          <div className="photo-grid">
            {photos.map((photo) => (
              <div className="photo-tile" key={photo.path}>
                <img
                  src={'/uploads/' + photo.path.split('/').pop()}
                  alt={photo.source === 'ocr' ? 'Foto struk yang dibaca' : 'Foto struk bukti'}
                />
                <span className={'photo-tag' + (photo.source === 'ocr' ? ' is-ai' : '')}>
                  {photo.source === 'ocr' ? 'AI' : 'bukti'}
                </span>
                <button
                  type="button"
                  aria-label="Hapus foto"
                  onClick={() => setPhotos((prev) => prev.filter((item) => item.path !== photo.path))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="photo-actions">
            <Button variant="secondary" onClick={() => pickPhoto('ocr')}>
              Scan foto lagi (AI)
            </Button>
            <Button variant="secondary" onClick={() => pickPhoto('attach')}>
              Tambah bukti
            </Button>
          </div>
        </section>
      ) : photoBusy ? (
        <div className={'ds-create-hero' + (photoBusy === 'ocr' ? ' is-scanning' : '')} role="status">
          <img src={scanArt} alt="" width={92} height={92} />
          <div>
            <b>
              {photoBusy === 'ocr'
                ? 'Membaca struk… ' + (ocrSeconds > 0 ? ocrSeconds + ' detik' : '')
                : 'Mengunggah foto…'}
            </b>
            <p className="app-note">
              {photoBusy === 'ocr'
                ? 'Bisa 10–60 detik kalau layanan AI ramai. Kamu tetap bisa mengisi manual sambil menunggu.'
                : 'Sebentar, fotonya sedang disimpan.'}
            </p>
            {photoBusy === 'ocr' ? (
              <Button variant="quiet" onClick={cancelRead}>
                Batal baca
              </Button>
            ) : null}
          </div>
        </div>
      ) : ocrError ? null : (
        <div className="ds-create-hero is-choice">
          <img src={createHeroArt} alt="" width={64} height={64} />
          <div className="grow">
            <div className="app-inline">
              <b>Foto struk (opsional)</b>
              <span className="app-spacer" />
              <button
                type="button"
                className="link-quiet"
                onClick={() => {
                  document.getElementById('item-name-0')?.scrollIntoView({ block: 'center' })
                  document.getElementById('item-name-0')?.focus()
                }}
              >
                Isi manual saja
              </button>
            </div>
            <p className="app-note">
              AI bisa membaca struk atau screenshot pesanan (Gojek, ShopeeFood, Grab). Sampai 3 foto sekaligus.
            </p>
            <div className="photo-actions">
              <Button onClick={() => pickPhoto('ocr')}>Scan pakai AI</Button>
              <Button variant="secondary" onClick={() => pickPhoto('attach')}>
                Lampirkan saja
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
            <Button variant="quiet" onClick={() => pickPhoto('ocr')}>
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
                />
                <Field
                  id={'item-price-' + index}
                  label="Harga satuan"
                  value={item.price}
                  inputMode="numeric"
                  onChange={(v) => setItems((prev) => prev.map((it) => (it.key === item.key ? { ...it, price: formatRd(parseRupiah(v)) } : it)))}
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
          Tulis nama teman kamu sekarang. Begitu mereka buka link dan memakai nama yang sama, bagiannya langsung nyambung.
        </p>
        {roster.length > 0 ? (
          <div className="chip-row">
            {roster.map((person) => (
              <span className="chip" key={person}>
                {person}
                <button type="button" aria-label={'Hapus nama ' + person} onClick={() => setRoster((prev) => prev.filter((p) => p !== person))}>
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="app-inline">
          <div className="grow">
            <Field
              id="roster-name"
              label="Nama teman"
              value={rosterName}
              onChange={setRosterName}
              hint="Contoh: Bima"
            />
          </div>
          <Button
            variant="quiet"
            disabled={!rosterName.trim() || roster.some((p) => p.toLowerCase() === rosterName.trim().toLowerCase())}
            onClick={() => {
              setRoster((prev) => [...prev, rosterName.trim()])
              setRosterName('')
            }}
          >
            Tambah
          </Button>
        </div>
      </section>

      <section className="app-stack">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field
            id="bill-tax"
            label={taxIncluded ? 'Pajak (di dalam harga)' : 'Pajak'}
            value={taxIncluded ? '' : tax}
            inputMode="numeric"
            disabled={taxIncluded}
            onChange={(v) => setTax(formatRp(parseRupiah(v)).replace('Rp', ''))}
          />
          <Field id="bill-service" label="Service" value={service} inputMode="numeric" onChange={(v) => setService(formatRp(parseRupiah(v)).replace('Rp', ''))} />
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
          onChange={(v) => setDiscount(formatRp(parseRupiah(v)).replace('Rp', ''))}
          hint="Diskon yang berlaku untuk seluruh bill"
        />
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
