import { useState } from 'react'
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

type DraftItem = { key: string; name: string; qty: string; price: string; slots: string }

const newItem = (): DraftItem => ({ key: Math.random().toString(36).slice(2), name: '', qty: '1', price: '', slots: '' })

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
  const [ocrBusy, setOcrBusy] = useState(false)
  const [ocrNote, setOcrNote] = useState('')
  const [photoPath, setPhotoPath] = useState<string | null>(null)
  const [roster, setRoster] = useState<string[]>([])
  const [rosterName, setRosterName] = useState('')

  async function readPhoto(file: File) {
    setOcrBusy(true)
    setOcrNote('Membaca struk…')
    setError('')
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
      }>('/api/ocr', { method: 'POST', body: form })
      if (draft.title && draft.title.trim()) setTitle(draft.title)
      if (draft.merchant) setMerchant(draft.merchant)
      if (draft.tax) setTax(formatRd(draft.tax))
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
            slots: '',
          })),
        )
      }
      setOcrNote('Struk terbaca. Periksa angkanya sebelum simpan.')
      toast('Struk terbaca. Cek lagi angkanya ya.')
    } catch (err) {
      setOcrNote('')
      setError((err as Error).message)
    } finally {
      setOcrBusy(false)
    }
  }

  const parsed = items.map((i) => ({
    slots: i.slots,
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
              // satu item bisa dibagi rata jadi N slot (mis. pizza 4 potong)
              mode: Number(i.slots) > 1 ? 'slot' : 'free',
              slot_count: Number(i.slots) > 1 ? Number(i.slots) : null,
            })),
          photo_path: photoPath,
          photos: photoPath ? [photoPath] : [],
          paid_by_name: payerName.trim() || null,
          tax_included: 0,
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
      <div className={'ds-create-hero' + (ocrBusy ? ' is-scanning' : '')}>
        <img src={ocrBusy ? scanArt : createHeroArt} alt="" width={120} height={120} />
        <div>
          <b>{ocrBusy ? 'Membaca struk…' : 'Ketik manual atau tempel hasil fotonya'}</b>
          <p className="app-note">
            {ocrBusy
              ? 'Angkanya sedang diambil dari foto. Biasanya beberapa detik.'
              : 'Semua angka rupiah. Pajak dibagi proporsional ke porsi masing-masing.'}
          </p>
        </div>
      </div>

      <label className="ds-button ds-button-secondary" style={{ textAlign: 'center', cursor: 'pointer' }}>
        {ocrBusy ? 'Membaca struk…' : 'Foto struk (opsional)'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          disabled={ocrBusy}
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void readPhoto(file)
            event.target.value = ''
          }}
        />
      </label>
      {ocrNote ? <div className="app-note">{ocrNote}</div> : null}
      {photoPath ? (
        <div className="receipt-preview">
          <img src={'/uploads/' + photoPath.split('/').pop()} alt="Foto struk yang dibaca" />
          <span className="app-note">Foto ini ikut tersimpan di bill.</span>
        </div>
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
              <div className="item-slot">
                <label htmlFor={'item-slots-' + index}>Dibagi rata jadi</label>
                <input
                  id={'item-slots-' + index}
                  aria-label={'Jumlah slot baris ' + (index + 1)}
                  inputMode="numeric"
                  placeholder="mis. 4"
                  value={item.slots}
                  onChange={(event) =>
                    setItems((prev) =>
                      prev.map((it) => (it.key === item.key ? { ...it, slots: event.target.value.replace(/[^0-9]/g, '') } : it)),
                    )
                  }
                />
                <span>slot — kosongkan kalau tidak dibagi</span>
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
          <Field id="bill-tax" label="Pajak" value={tax} inputMode="numeric" onChange={(v) => setTax(formatRp(parseRupiah(v)).replace('Rp', ''))} />
          <Field id="bill-service" label="Service" value={service} inputMode="numeric" onChange={(v) => setService(formatRp(parseRupiah(v)).replace('Rp', ''))} />
        </div>
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
          <span style={{ fontSize: 13, fontWeight: 700 }}>Pajak + service</span>
          <span className="app-spacer" />
          <span>{formatRp(taxIdr + serviceIdr)}</span>
        </div>
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
