import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AppShell } from '../components/AppShell'
import { useToast } from '../components/Toast'
import { billActions, useBill, useBillAction } from '../lib/queries'
import { invalidateMoneyViews } from '../lib/mutations'
import { formatRp, parseRupiah } from '../lib/money'
import { Alert, Button, Field, SectionHead } from '../ds/primitives'
import manualArt from '../assets/manual.webp'
import type { BillItem } from '../lib/types'

const formatRd = (value: number): string => formatRp(value).replace('Rp', '')

type Draft = {
  id?: number
  key: string
  name: string
  qty: string
  price: string
  /** bill lama bisa masih bermode slot; nilainya dibawa apa adanya, tak ditampilkan */
  mode: 'free' | 'slot'
  slotCount: number | null
}

const draftFrom = (item: BillItem): Draft => ({
  id: item.id,
  key: String(item.id),
  name: item.name,
  qty: String(item.quantity),
  price: formatRd(item.price_idr),
  mode: item.mode === 'slot' ? 'slot' : 'free',
  slotCount: item.mode === 'slot' ? (item.slot_count ?? null) : null,
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
  const [roster, setRoster] = useState<string[] | null>(null)
  const [rosterName, setRosterName] = useState('')

  // Nilai awal diambil sekali dari server, sesudah itu state lokal yang menang.
  const titleValue = title ?? data?.bill.title ?? ''
  const merchantValue = merchant ?? data?.bill.merchant ?? ''
  const taxValue = tax ?? (data ? formatRd(data.bill.tax_idr) : '')
  const serviceValue = service ?? (data ? formatRd(data.bill.service_idr) : '')
  const discountValue = discount ?? (data ? formatRd(data.bill.order_discount_idr) : '')
  const drafts = items ?? (data ? data.items.map(draftFrom) : [])
  const rosterDraft = roster ?? (data ? data.participants.map((participant) => participant.name) : [])
  // nama yang sudah diklaim orangnya dikunci: mengeluarkan orang pakai tombol
  // "Keluarkan" di layar bill, bukan dengan menghapus namanya di sini
  const claimed = new Set((data?.participants ?? []).filter((p) => p.identity_id).map((p) => p.name))

  const parsed = drafts.map((draft) => ({
    id: draft.id,
    name: draft.name.trim(),
    qty: Math.max(1, Number.parseInt(draft.qty || '1', 10) || 1),
    price: parseRupiah(draft.price),
    mode: draft.id ? draft.mode : ('free' as const),
    slotCount: draft.id ? draft.slotCount : null,
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
          participants: rosterDraft,
          tax_mode: data.bill.tax_mode,
          tax_included: Boolean(data.bill.tax_included),
          // daftar item harus lengkap: id yang tidak dikirim akan dihapus
          items: parsed.map((item) => ({
            ...(item.id ? { id: item.id } : {}),
            name: item.name,
            price: item.price,
            discount: 0,
            quantity: item.qty,
            // bill lama yang bermode slot dikirim balik dengan mode aslinya:
            // mengubahnya jadi bebas akan mengubah pembagian yang sudah jalan
            mode: item.mode,
            slot_count: item.mode === 'slot' ? item.slotCount : null,
          })),
        },
      })
      // harga/item berubah -> beranda dan rekap ikut berubah
      invalidateMoneyViews(queryClient, { billId, identityId })
      toast('Perubahan bill disimpan')
      navigate({ to: '/b/$billId', params: { billId } })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <AppShell
      title="Ubah bill"
      subtitle="Perbaiki judul, item, atau pajak"
      back
      active="home"
      footer={
        // tamu yang membuka /edit tidak boleh melihat tombol simpan sama sekali;
        // bill lunas/tertutup juga tidak: server menolak menyimpannya
        data?.can_manage && !data.settled && data.bill.status === 'open' ? (
          <div className="create-dock">
            <div className="tot">
              <small>Total baru</small>
              <b>{formatRp(total)}</b>
            </div>
            <Button loading={action.isPending} disabled={!valid} onClick={save}>
              Simpan perubahan
            </Button>
          </div>
        ) : null
      }
    >
      {bill.isPending ? <div className="app-note">Memuat bill…</div> : null}
      {bill.isError ? <Alert tone="danger" title="Bill tidak bisa dibuka">{(bill.error as Error).message}</Alert> : null}

      {data && !data.can_manage ? (
        <Alert tone="pending" title="Hanya yang menalangi bisa mengubah">
          Minta {data.paid_by_name} mengubah bill ini.
        </Alert>
      ) : null}

      {/* Bill lunas atau tertutup tidak bisa disunting: server menolak dengan
          403/409. Formulir yang tetap terbuka lalu gagal saat disimpan bikin
          orang mengetik ulang tanpa hasil, jadi keadaannya dijelaskan di sini. */}
      {data && data.can_manage && (data.settled || data.bill.status !== 'open') ? (
        <Alert tone="pending" title={data.settled ? 'Bill sudah lunas' : 'Bill sudah ditutup'}>
          {data.settled
            ? 'Buka tanda lunas di layar bill dulu kalau memang mau mengubah item atau nominalnya.'
            : 'Buka lagi bill-nya di layar bill kalau memang mau mengubah isinya.'}
        </Alert>
      ) : null}

      {data && data.can_manage && !data.settled && data.bill.status === 'open' ? (
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
              <SectionHead>Item</SectionHead>
              <span className="app-spacer" />
              <button
                type="button"
                className="link-action"
                onClick={() =>
                  setItems((prev) => [
                    ...(prev ?? drafts),
                    { key: 'new-' + Math.random().toString(36).slice(2), name: '', qty: '1', price: '', mode: 'free', slotCount: null },
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
                </div>
              </div>
            ))}
          </section>

          <section className="app-stack">
            <SectionHead>Siapa saja yang ikut</SectionHead>
            <p className="app-note">
              Nama yang belum diklaim bisa diganti atau dihapus di sini. Nama yang sudah bergabung dikunci — kalau mau
              mengeluarkan orangnya, pakai tombol Keluarkan di layar bill.
            </p>
            {rosterDraft.length > 0 ? (
              <div className="chip-row">
                {rosterDraft.map((person) => (
                  <span className="chip" key={person}>
                    {person}
                    {claimed.has(person) ? (
                      <span style={{ fontSize: 'var(--ds-text-xs)', fontWeight: 'var(--ds-weight-medium)', opacity: 0.7 }}>· bergabung</span>
                    ) : (
                      <button
                        type="button"
                        aria-label={'Hapus nama ' + person}
                        onClick={() => setRoster(rosterDraft.filter((name) => name !== person))}
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
            ) : (
              <div className="app-note">Belum ada nama yang disiapkan.</div>
            )}
            <div className="app-inline">
              <div className="grow">
                <Field id="edit-roster-name" label="Tambah nama" value={rosterName} onChange={setRosterName} />
              </div>
              <Button
                variant="quiet"
                disabled={
                  !rosterName.trim() ||
                  rosterDraft.some((name) => name.toLowerCase() === rosterName.trim().toLowerCase())
                }
                onClick={() => {
                  setRoster([...rosterDraft, rosterName.trim()])
                  setRosterName('')
                }}
              >
                Tambah
              </Button>
            </div>
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
              <span style={{ fontSize: 'var(--ds-text-md)', fontWeight: 700 }}>Subtotal</span>
              <span className="app-spacer" />
              <span>{formatRp(subtotal)}</span>
            </div>
            <div className="app-inline" style={{ marginTop: 6 }}>
              <span style={{ fontSize: 'var(--ds-text-md)', fontWeight: 700 }}>Pajak + service</span>
              <span className="app-spacer" />
              <span>{formatRp(taxIdr + serviceIdr)}</span>
            </div>
            {discountIdr > 0 ? (
              <div className="app-inline" style={{ marginTop: 6 }}>
                <span style={{ fontSize: 'var(--ds-text-md)', fontWeight: 700 }}>Diskon</span>
                <span className="app-spacer" />
                <span>−{formatRp(discountIdr)}</span>
              </div>
            ) : null}
          </div>

          <section className="app-stack">
            <SectionHead>Hapus bill</SectionHead>
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
                      invalidateMoneyViews(queryClient, { identityId })
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

        </>
      ) : null}
    </AppShell>
  )
}
