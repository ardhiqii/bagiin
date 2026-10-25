import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AppShell } from '../components/AppShell'
import { useToast } from '../components/Toast'
import { billActions, keys, useBill, useBillAction } from '../lib/queries'
import { formatRp, parseRupiah } from '../lib/money'
import { Alert, Button, Field } from '../ds/primitives'
import manualArt from '../assets/manual.webp'
import type { BillItem } from '../lib/types'

const formatRd = (value: number): string => formatRp(value).replace('Rp', '')

type Draft = { id?: number; key: string; name: string; qty: string; price: string; slots: string }

const draftFrom = (item: BillItem): Draft => ({
  id: item.id,
  key: String(item.id),
  name: item.name,
  qty: String(item.quantity),
  price: formatRd(item.price_idr),
  slots: item.mode === 'slot' && item.slot_count ? String(item.slot_count) : '',
})

export function EditBill({ billId, identityId }: { billId: string; identityId: string | null }) {
  const bill = useBill(billId)
  const action = useBillAction(billId, identityId)
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const data = bill.data
  const [title, setTitle] = useState<string | null>(null)
  const [merchant, setMerchant] = useState<string | null>(null)
  const [tax, setTax] = useState<string | null>(null)
  const [service, setService] = useState<string | null>(null)
  const [discount, setDiscount] = useState<string | null>(null)
  const [items, setItems] = useState<Draft[] | null>(null)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Nilai awal diambil sekali dari server, sesudah itu state lokal yang menang.
  const titleValue = title ?? data?.bill.title ?? ''
  const merchantValue = merchant ?? data?.bill.merchant ?? ''
  const taxValue = tax ?? (data ? formatRd(data.bill.tax_idr) : '')
  const serviceValue = service ?? (data ? formatRd(data.bill.service_idr) : '')
  const discountValue = discount ?? (data ? formatRd(data.bill.order_discount_idr) : '')
  const drafts = items ?? (data ? data.items.map(draftFrom) : [])

  const parsed = drafts.map((draft) => ({
    id: draft.id,
    name: draft.name.trim(),
    qty: Math.max(1, Number.parseInt(draft.qty || '1', 10) || 1),
    price: parseRupiah(draft.price),
    slots: Number(draft.slots),
  }))
  const subtotal = parsed.reduce((sum, item) => sum + item.price * item.qty, 0)
  const taxIdr = parseRupiah(taxValue)
  const serviceIdr = parseRupiah(serviceValue)
  const discountIdr = parseRupiah(discountValue)
  const total = subtotal + taxIdr + serviceIdr - discountIdr
  const valid = parsed.length > 0 && parsed.every((item) => item.name && item.price > 0) && total > 0

  async function save() {
    if (!data || !valid) return
    setError('')
    try {
      await action.mutateAsync({
        path: '/api/bills/' + billId,
        method: 'PUT',
        body: {
          title: titleValue.trim() || data.bill.title,
          merchant: merchantValue.trim(),
          tax: taxIdr,
          service: serviceIdr,
          order_discount: discountIdr,
          cashback: data.bill.cashback_idr,
          subtotal,
          total,
          tax_mode: data.bill.tax_mode,
          tax_included: Boolean(data.bill.tax_included),
          // daftar item harus lengkap: id yang tidak dikirim akan dihapus
          items: parsed.map((item) => ({
            ...(item.id ? { id: item.id } : {}),
            name: item.name,
            price: item.price,
            discount: 0,
            quantity: item.qty,
            mode: item.slots > 1 ? 'slot' : 'free',
            slot_count: item.slots > 1 ? item.slots : null,
          })),
        },
      })
      await queryClient.invalidateQueries({ queryKey: keys.bill(billId) })
      toast('Perubahan bill disimpan')
      navigate({ to: '/b/$billId', params: { billId } })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <AppShell title="Ubah bill" subtitle="Perbaiki judul, item, atau pajak" back active="bill" dock>
      {bill.isPending ? <div className="app-note">Memuat bill…</div> : null}
      {bill.isError ? <Alert tone="danger" title="Bill tidak bisa dibuka">{(bill.error as Error).message}</Alert> : null}

      {data && !data.can_manage ? (
        <Alert tone="pending" title="Hanya yang menalangi bisa mengubah">
          Minta {data.paid_by_name} mengubah bill ini.
        </Alert>
      ) : null}

      {data && data.can_manage ? (
        <>
          {error ? <Alert tone="danger" title="Perubahan gagal disimpan">{error}</Alert> : null}

          <div className="ds-create-hero">
            <img src={manualArt} alt="" width={120} height={120} />
            <div>
              <b>Perbaiki tanpa bikin ulang</b>
              <p className="app-note">Ubah judul, harga, atau pajak. Pilihan yang sudah diambil orang lain tetap menempel.</p>
            </div>
          </div>

          <section className="app-stack">
            <Field id="edit-title" label="Nama bill" value={titleValue} onChange={setTitle} />
            <Field id="edit-merchant" label="Merchant (opsional)" value={merchantValue} onChange={setMerchant} />
          </section>

          <section className="app-stack">
            <div className="app-inline">
              <strong style={{ fontSize: 14, fontWeight: 800 }}>Item</strong>
              <span className="app-spacer" />
              <button
                type="button"
                className="link-action"
                onClick={() =>
                  setItems((prev) => [
                    ...(prev ?? drafts),
                    { key: 'new-' + Math.random().toString(36).slice(2), name: '', qty: '1', price: '', slots: '' },
                  ])
                }
              >
                + Tambah item
              </button>
            </div>

            {drafts.map((draft, index) => (
              <div className="ds-group" key={draft.key} style={{ border: '1px solid var(--ds-border)', background: 'var(--ds-surface)', borderRadius: 18, overflow: 'hidden' }}>
                <div className="item-row">
                  <Field
                    id={'edit-item-name-' + index}
                    label={'Item ' + (index + 1)}
                    value={draft.name}
                    onChange={(value) =>
                      setItems((prev) => (prev ?? drafts).map((it) => (it.key === draft.key ? { ...it, name: value } : it)))
                    }
                  />
                  <div className="item-meta">
                    <Field
                      id={'edit-item-qty-' + index}
                      label="Qty"
                      value={draft.qty}
                      inputMode="numeric"
                      onChange={(value) =>
                        setItems((prev) =>
                          (prev ?? drafts).map((it) => (it.key === draft.key ? { ...it, qty: value.replace(/[^0-9]/g, '') } : it)),
                        )
                      }
                    />
                    <Field
                      id={'edit-item-price-' + index}
                      label="Harga satuan"
                      value={draft.price}
                      inputMode="numeric"
                      onChange={(value) =>
                        setItems((prev) =>
                          (prev ?? drafts).map((it) => (it.key === draft.key ? { ...it, price: formatRd(parseRupiah(value)) } : it)),
                        )
                      }
                    />
                    <button
                      type="button"
                      className="kill"
                      aria-label={'Hapus baris ' + (index + 1)}
                      disabled={drafts.length === 1}
                      onClick={() => setItems((prev) => (prev ?? drafts).filter((it) => it.key !== draft.key))}
                    >
                      ×
                    </button>
                  </div>
                  <div className="item-slot">
                    <label htmlFor={'edit-item-slots-' + index}>Dibagi rata jadi</label>
                    <input
                      id={'edit-item-slots-' + index}
                      aria-label={'Jumlah slot baris ' + (index + 1)}
                      inputMode="numeric"
                      value={draft.slots}
                      onChange={(event) =>
                        setItems((prev) =>
                          (prev ?? drafts).map((it) =>
                            it.key === draft.key ? { ...it, slots: event.target.value.replace(/[^0-9]/g, '') } : it,
                          ),
                        )
                      }
                    />
                    <span>slot</span>
                  </div>
                </div>
              </div>
            ))}
          </section>

          <section className="app-stack">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field id="edit-tax" label="Pajak" value={taxValue} inputMode="numeric" onChange={(v) => setTax(formatRd(parseRupiah(v)))} />
              <Field id="edit-service" label="Service" value={serviceValue} inputMode="numeric" onChange={(v) => setService(formatRd(parseRupiah(v)))} />
            </div>
            <Field
              id="edit-discount"
              label="Diskon pesanan"
              value={discountValue}
              inputMode="numeric"
              onChange={(v) => setDiscount(formatRd(parseRupiah(v)))}
              hint="Diskon yang berlaku untuk seluruh bill"
            />
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

          <section className="app-stack">
            <strong style={{ fontSize: 14, fontWeight: 800 }}>Hapus bill</strong>
            <p className="app-note">
              Bill beserta semua item, pilihan, dan status lunasnya dihapus permanen. Tautan yang sudah kamu bagikan tidak akan bisa dibuka lagi.
            </p>
            {confirmDelete ? (
              <Alert tone="danger" title="Yakin menghapus bill ini?">
                Tidak ada cara mengembalikannya. Kalau cuma ingin menghentikan perubahan, tutup bill saja.
              </Alert>
            ) : null}
            {confirmDelete ? (
              <div className="app-inline">
                <Button
                  variant="danger"
                  loading={action.isPending}
                  onClick={async () => {
                    try {
                      await action.mutateAsync(billActions.removeBill(billId))
                      await queryClient.invalidateQueries({ queryKey: keys.bills(identityId ?? '') })
                      toast('Bill dihapus')
                      navigate({ to: '/' })
                    } catch (err) {
                      setError((err as Error).message)
                    }
                  }}
                >
                  Ya, hapus permanen
                </Button>
                <Button variant="quiet" onClick={() => setConfirmDelete(false)}>
                  Batal
                </Button>
              </div>
            ) : (
              <Button variant="danger" block onClick={() => setConfirmDelete(true)}>
                Hapus bill ini
              </Button>
            )}
          </section>

          <div className="create-dock">
            <div className="tot">
              <small>Total baru</small>
              <b>{formatRp(total)}</b>
            </div>
            <Button loading={action.isPending} disabled={!valid} onClick={save}>
              Simpan perubahan
            </Button>
          </div>
        </>
      ) : null}
    </AppShell>
  )
}
