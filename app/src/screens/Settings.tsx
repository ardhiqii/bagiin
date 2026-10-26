import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AppShell } from '../components/AppShell'
import { useToast } from '../components/Toast'
import { Alert, Button, Field } from '../ds/primitives'
import { publishIdentity, renameIdentity, resetIdentity } from '../lib/identity'
import { accountActions, keys, useAccounts, useBillAction, type PaymentAccount } from '../lib/queries'
import type { Identity } from '../lib/types'

const EMPTY = { brand: '', number: '', holder: '' }

export function Settings({ identity }: { identity: Identity | null }) {
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const action = useBillAction(null, identity?.id ?? null)

  const [name, setName] = useState(identity?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const accounts = useAccounts(identity?.id ?? null)
  const [draft, setDraft] = useState(EMPTY)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [autoAccept, setAutoAccept] = useState<boolean>((identity?.auto_accept ?? 1) === 1)

  async function saveName() {
    if (!identity) return
    setBusy(true)
    setError('')
    try {
      await renameIdentity(identity as never, name.trim())
      toast('Nama kamu sudah diperbarui')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function run(todo: { path: string; method?: 'POST' | 'PUT' | 'DELETE'; body?: unknown }, message: string) {
    try {
      await action.mutateAsync(todo)
      await queryClient.invalidateQueries({ queryKey: ['accounts', identity?.id ?? ''] })
      await queryClient.invalidateQueries({ queryKey: keys.bills(identity?.id ?? '') })
      toast(message)
      return true
    } catch (err) {
      toast((err as Error).message)
      return false
    }
  }

  const duplicate =
    editingId === null &&
    (accounts.data ?? []).some(
      (account) =>
        account.brand.toLowerCase() === draft.brand.trim().toLowerCase() &&
        account.account_no === draft.number.trim(),
    )

  async function saveAccount() {
    if (!identity || !draft.brand.trim() || !draft.number.trim() || duplicate) return
    const body = {
      brand: draft.brand.trim(),
      account_no: draft.number.trim(),
      holder_name: draft.holder.trim() || null,
    }
    const ok =
      editingId === null
        ? await run(accountActions.add(identity.id, body), 'Rekening ditambahkan')
        : await run(accountActions.update(editingId, body), 'Rekening diperbarui')
    if (ok) {
      setDraft(EMPTY)
      setEditingId(null)
    }
  }

  function startEdit(account: PaymentAccount) {
    setEditingId(account.id)
    setDraft({ brand: account.brand, number: account.account_no, holder: account.holder_name ?? '' })
  }

  async function copy(text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast(message)
    } catch {
      toast(text)
    }
  }

  async function toggleAutoAccept(next: boolean) {
    if (!identity) return
    setAutoAccept(next)
    const ok = await run(accountActions.autoAccept(identity.id, next), next ? 'Undangan otomatis diterima' : 'Undangan harus kamu setujui dulu')
    if (!ok) setAutoAccept(!next)
  }

  return (
    <AppShell title="Pengaturan" subtitle="Identitas, rekening, dan undangan" back active="home">
      {error ? <Alert tone="danger" title="Gagal menyimpan">{error}</Alert> : null}

      <section className="app-stack">
        <strong style={{ fontSize: 14, fontWeight: 800 }}>Nama</strong>
        <Field id="settings-name" label="Nama kamu" value={name} onChange={setName} hint="Nama ini yang muncul ke teman di bill" />
        <Button block loading={busy} disabled={!identity || !name.trim() || name.trim() === identity?.name} onClick={saveName}>
          Simpan nama
        </Button>
      </section>

      <section className="app-stack">
        <div className="app-inline">
          <strong style={{ fontSize: 14, fontWeight: 800 }}>Rekening untuk ditransfer</strong>
          <span className="app-spacer" />
          <span className="app-note">{accounts.data?.length ?? 0}</span>
        </div>
        <p className="app-note">Kalau kamu yang menalangi bill, teman kamu melihat rekening ini di layar bill.</p>

        {accounts.data && accounts.data.length > 0 ? (
          <div>
            {accounts.data.map((account) => (
              <div className="account-card" key={account.id}>
                <div className="app-inline">
                  <b style={{ fontSize: 14.5 }}>{account.brand}</b>
                  {account.holder_name ? <span className="app-note">· {account.holder_name}</span> : null}
                </div>
                <div className="account-no">{account.account_no}</div>
                <div className="account-actions">
                  <button type="button" className="link-action" onClick={() => copy(account.account_no, 'Nomor rekening disalin')}>
                    Salin nomor
                  </button>
                  <button type="button" className="link-action" onClick={() => startEdit(account)}>
                    Ubah
                  </button>
                  <button
                    type="button"
                    className="link-action is-danger"
                    onClick={() => run(accountActions.remove(account.id), 'Rekening dihapus')}
                  >
                    Hapus
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="app-note">Belum ada rekening. Tambahkan satu supaya teman tahu ke mana transfer.</div>
        )}

        <div className="ds-card ds-card-surface ds-pad-md" style={{ display: 'grid', gap: 10 }}>
          <Field
            id="account-brand"
            label={editingId === null ? 'Bank atau e-wallet' : 'Ubah bank atau e-wallet'}
            value={draft.brand}
            onChange={(v) => setDraft((prev) => ({ ...prev, brand: v }))}
            hint="Contoh: BCA, Mandiri, GoPay"
          />
          <Field
            id="account-number"
            label="Nomor"
            value={draft.number}
            inputMode="numeric"
            onChange={(v) => setDraft((prev) => ({ ...prev, number: v.replace(/[^0-9]/g, '') }))}
          />
          <Field
            id="account-holder"
            label="Nama pemilik (opsional)"
            value={draft.holder}
            onChange={(v) => setDraft((prev) => ({ ...prev, holder: v }))}
          />
          {duplicate ? <div className="app-note">Rekening ini sudah ada di daftar kamu.</div> : null}
          <div className="app-inline">
            <Button
              disabled={!draft.brand.trim() || !draft.number.trim() || duplicate}
              loading={action.isPending}
              onClick={saveAccount}
            >
              {editingId === null ? 'Tambah rekening' : 'Simpan perubahan'}
            </Button>
            {editingId !== null ? (
              <Button
                variant="quiet"
                onClick={() => {
                  setEditingId(null)
                  setDraft(EMPTY)
                }}
              >
                Batal
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="app-stack">
        <strong style={{ fontSize: 14, fontWeight: 800 }}>Undangan</strong>
        <label className="app-row" style={{ cursor: 'pointer' }}>
          <span className="grow">
            <b>Terima undangan otomatis</b>
            <small>{autoAccept ? 'Langsung masuk kalau diundang' : 'Kamu harus menyetujui tiap undangan'}</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Terima undangan otomatis"
            checked={autoAccept}
            onChange={(event) => void toggleAutoAccept(event.target.checked)}
            style={{ width: 22, height: 22, accentColor: 'var(--ds-teal)' }}
          />
        </label>
      </section>

      <section className="app-stack">
        <strong style={{ fontSize: 14, fontWeight: 800 }}>Identitas</strong>
        <div className="app-row">
          <span className="grow">
            <b>{identity?.id ?? '—'}</b>
            <small>Tanpa akun. ID ini yang menyimpan siapa kamu di semua bill.</small>
          </span>
          <button type="button" className="ds-button ds-button-quiet" onClick={() => identity && copy(identity.id, 'ID identitas disalin')}>
            Salin
          </button>
        </div>
      </section>

      <section className="app-stack">
        <strong style={{ fontSize: 14, fontWeight: 800 }}>Mulai dari nol</strong>
        <p className="app-note">
          Menghapus identitas di perangkat ini. Bill yang sudah kamu buat tetap ada di server, tapi kamu tidak akan bisa membukanya lagi sebagai dirimu.
        </p>
        {confirmReset ? (
          <Alert tone="danger" title="Yakin mulai dari nol?">
            Identitas di perangkat ini dihapus. Bill yang pernah kamu buat tetap ada di server, tapi kamu tidak bisa
            membukanya lagi sebagai dirimu.
          </Alert>
        ) : null}
        {confirmReset ? (
          <div className="app-inline">
            <Button
              variant="danger"
              onClick={() => {
                resetIdentity()
                publishIdentity(null)
                toast('Identitas dihapus dari perangkat ini')
                navigate({ to: '/' })
              }}
            >
              Ya, hapus identitas
            </Button>
            <Button variant="quiet" onClick={() => setConfirmReset(false)}>
              Batal
            </Button>
          </div>
        ) : (
          <Button variant="danger" block onClick={() => setConfirmReset(true)}>
            Hapus identitas di perangkat ini
          </Button>
        )}
      </section>
    </AppShell>
  )
}
