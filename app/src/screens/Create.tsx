import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { formatRp, parseRupiah } from '../lib/money'
import { AppShell } from '../components/AppShell'
import { useToast } from '../components/Toast'
import { Alert, Button, Field } from '../ds/primitives'
import { X } from '@phosphor-icons/react'
import createHeroArt from '../assets/create-hero.webp'
import scanArt from '../assets/scan.webp'
import { keys } from '../lib/queries'

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
  const [photoPath, setPhotoPath] = useState<string | null>(null)
  /**
   * 'ocr' = foto dibaca AI dan angkanya masuk form, 'attach' = foto cuma bukti
   * dan angkanya diketik sendiri. Dua jalur ini yang bikin orang tetap bisa
   * lanjut waktu AI sedang mati atau kuotanya habis.
   */
  const [photoMode, setPhotoMode] = useState<'ocr' | 'attach' | null>(null)
  const [photoBusy, setPhotoBusy] = useState<'ocr' | 'attach' | null>(null)
  const [ocrError, setOcrError] = useState('')
  const [ocrSeconds, setOcrSeconds] = useState(0)
  const [lastPhoto, setLastPhoto] = useState<File | null>(null)
  const [taxIncluded, setTaxIncluded] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const intentRef = useRef<'ocr' | 'attach'>('ocr')
  const abortRef = useRef<AbortController | null>(null)
  const [roster, setRoster] = useState<string[]>([])
  const [rosterName, setRosterName] = useState('')

  useEffect(() => {
    if (!photoBusy) return
    const timer = setInterval(() => setOcrSeconds((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [photoBusy])

  function pickPhoto(intent: 'ocr' | 'attach') {
    intentRef.current = intent
    fileRef.current?.click()
  }

  function onFilePicked(file: File) {
    setLastPhoto(file)
    setError('')
    setOcrError('')
    setOcrSeconds(0)
    if (intentRef.current === 'attach') void attachPhoto(file)
    else void readPhoto(file)
  }

  /** Unggah foto tanpa AI: bukti struk, angkanya diketik sendiri. */
  async function attachPhoto(file: File) {
    setPhotoBusy('attach')
    try {
      const form = new FormData()
      form.append('file', file)
      const saved = await api<{ photo_path: string }>('/api/photos', { method: 'POST', body: form })
      setPhotoPath(saved.photo_path)
      setPhotoMode('attach')
      setOcrError('')
      toast('Foto dilampirkan. Angkanya isi sendiri ya.')
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

  async function readPhoto(file: File) {
    setPhotoBusy('ocr')
    setPhotoMode(null)
    setOcrError('')
    setOcrSeconds(0)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const form = new FormData()
      form.append('file', file)
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
      // Struk yang harga itemnya sudah termasuk pajak: OCR sudah mengosongkan
      // tax, dan bill harus ditandai tax_included supaya pajak tidak dihitung
      // dua kali saat orang mengetik ulang angkanya.
      const included = Boolean(draft.tax_included)
      setTaxIncluded(included)
      setTax(included ? '' : draft.tax ? formatRd(draft.tax) : '')
      if (draft.service) setService(formatRd(draft.service))
      // diskon voucher ikut kebaca struk: dulu kuncinya 'discount' sehingga
      // diskon pesanan hilang dan total jadi lebih besar dari struk
      const discountFromReceipt = draft.order_discount ?? draft.discount
      if (discountFromReceipt) setDiscount(formatRd(discountFromReceipt))
      if (draft.photos?.[0]) setPhotoPath(draft.photos[0])
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
      setPhotoMode('ocr')
      toast('Struk terbaca. Cek lagi angkanya ya.')
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

  const canSubmit = identityId && parsed.some((i) => i.name && i.price > 0) && total > 0 && !busy

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
          photo_path: photoPath,
          photos: photoPath ? [photoPath] : [],
          paid_by_name: payerName.trim() || null,
          tax_included: taxIncluded ? 1 : 0,
          // nama yang diketik di sini jadi placeholder: begitu orangnya join,
          // backend mencocokkan namanya dan klaim otomatis
          participants: roster,
        },
      })
      await qc.invalidateQueries({ queryKey: keys.bills(identityId ?? '') })
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
          </div>
          <Button loading={busy} disabled={!canSubmit} onClick={submit}>
            Buat bill
          </Button>
        </div>
      }
    >
      {/* Satu input file untuk dua niat: dibaca AI, atau cuma dilampirkan.
          Di HP input ini langsung membuka kamera, jadi tidak perlu tempel. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onFilePicked(file)
          event.target.value = ''
        }}
      />

      {photoPath ? (
        <div className="receipt-preview">
          <img src={'/uploads/' + photoPath.split('/').pop()} alt="Foto struk yang dibaca" />
          <div className="grow">
            <b>{photoMode === 'ocr' ? 'Foto dibaca AI' : 'Foto dilampirkan'}</b>
            <p className="app-note">
              {photoMode === 'ocr'
                ? 'Angka di bawah berasal dari foto ini. Periksa lagi sebelum simpan.'
                : 'Foto ini bukti saja. Angkanya kamu isi sendiri.'}
            </p>
            <div className="app-inline">
              <Button variant="quiet" onClick={() => pickPhoto(photoMode === 'ocr' ? 'ocr' : 'attach')}>
                Ganti foto
              </Button>
              <Button
                variant="quiet"
                onClick={() => {
                  setPhotoPath(null)
                  setPhotoMode(null)
                  setLastPhoto(null)
                }}
              >
                Lepas foto
              </Button>
            </div>
          </div>
        </div>
      ) : photoBusy ? (
        <div className={'ds-create-hero' + (photoBusy === 'ocr' ? ' is-scanning' : '')} role="status">
          <img src={scanArt} alt="" width={110} height={110} />
          <div>
            <b>
              {photoBusy === 'ocr'
                ? `Membaca struk… ${ocrSeconds > 0 ? ocrSeconds + ' detik' : ''}`
                : 'Mengunggah foto…'}
            </b>
            <p className="app-note">
              {photoBusy === 'ocr'
                ? 'Bisa 10–60 detik, kadang lebih kalau layanan AI ramai. Kamu tetap bisa mengisi manual sambil menunggu.'
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
          <img src={createHeroArt} alt="" width={76} height={76} />
          <div>
            <b>Isi otomatis dari foto struk?</b>
            <p className="app-note">AI baca struk dan isi item serta harganya. Atau lampirkan fotonya saja sebagai bukti.</p>
            <div className="photo-actions">
              <Button onClick={() => pickPhoto('ocr')}>Scan struk, isi otomatis</Button>
              <Button variant="secondary" onClick={() => pickPhoto('attach')}>
                Lampirkan foto sebagai bukti
              </Button>
            </div>
            <button
              type="button"
              className="ds-button ds-button-quiet"
              style={{ marginTop: 6 }}
              onClick={() => document.getElementById('item-name-0')?.focus()}
            >
              Isi manual saja
            </button>
          </div>
        </div>
      )}

      {ocrError ? (
        <Alert tone="danger" title={photoBusy ? 'Struk gagal diunggah' : 'Struk gagal dibaca'}>
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
              disabled={!lastPhoto || Boolean(photoBusy)}
              onClick={() => lastPhoto && readPhoto(lastPhoto)}
            >
              Coba baca lagi
            </Button>
            <Button
              variant="quiet"
              disabled={!lastPhoto || Boolean(photoBusy)}
              onClick={() => lastPhoto && attachPhoto(lastPhoto)}
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

      <Field id="bill-title" label="Nama bill" value={title} onChange={setTitle} hint="Contoh: Makan malam di Warteg" />
      <Field id="bill-merchant" label="Merchant (opsional)" value={merchant} onChange={setMerchant} />

      <section className="app-stack">
        <div className="app-inline">
          <strong style={{ fontSize: 14, fontWeight: 800 }}>Item</strong>
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
        <strong style={{ fontSize: 14, fontWeight: 800 }}>Siapa saja yang ikut (opsional)</strong>
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
          <span style={{ fontSize: 13, fontWeight: 700 }}>Subtotal</span>
          <span className="app-spacer" />
          <span>{formatRp(subtotal)}</span>
        </div>
        <div className="app-inline" style={{ marginTop: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{taxIncluded ? 'Service' : 'Pajak + service'}</span>
          <span className="app-spacer" />
          <span>{formatRp((taxIncluded ? 0 : taxIdr) + serviceIdr)}</span>
        </div>
        {taxIncluded ? (
          <p className="app-note" style={{ marginTop: 6 }}>Pajak sudah nempel di harga item, jadi tidak dihitung lagi.</p>
        ) : null}
        {discountIdr > 0 ? (
          <div className="app-inline" style={{ marginTop: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Diskon</span>
            <span className="app-spacer" />
            <span>−{formatRp(discountIdr)}</span>
          </div>
        ) : null}
      </div>

    </AppShell>
  )
}
