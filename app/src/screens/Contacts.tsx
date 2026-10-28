import { useMemo, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { useToast } from '../components/Toast'
import { Alert, Avatar, Button, EmptyState, Field, Sheet } from '../ds/primitives'
import { endpoints } from '../lib/api'
import { useContacts, type Contact } from '../lib/queries'
import { useQueryClient } from '@tanstack/react-query'
import peopleArt from '../assets/person.webp'

/**
 * Kontak: siapa saja yang pernah bareng bill, dan apa nama yang SAYA beri.
 *
 * Kenapa layar sendiri, bukan cuma sheet undangan: nama pembeda berguna di luar
 * momen mengundang (melihat rekap, menagih, mengingat siapa). Kalau hanya ada di
 * sheet undangan, orang harus mulai bikin bill dulu untuk bisa merapikan nama.
 *
 * Aturan yang dijaga: nama asli selalu terlihat di baris kedua. Alias tanpa nama
 * asli membuat orang bisa salah menamai orang lain dan tidak pernah sadar.
 */
export function Contacts({ identityId }: { identityId: string }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const contacts = useContacts(identityId, true)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Contact | null>(null)
  const [alias, setAlias] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const rows = useMemo(() => {
    const list = contacts.data ?? []
    const needle = query.trim().toLowerCase()
    if (!needle) return list
    return list.filter((contact) =>
      [contact.display_name, contact.name, contact.username ?? '', contact.handle]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    )
  }, [contacts.data, query])

  /* Dua orang dengan nama tampil sama dan belum diberi nama pembeda = undangan
     yang bisa salah orang. Dihitung sekali di sini supaya baris bisa menandai
     dirinya sendiri. */
  const duplicates = useMemo(() => {
    const counts = new Map<string, number>()
    for (const contact of contacts.data ?? []) {
      const key = contact.name.trim().toLowerCase()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return new Set(
      [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name),
    )
  }, [contacts.data])

  function openEditor(contact: Contact) {
    setEditing(contact)
    setAlias(contact.alias ?? '')
    setError('')
  }

  async function save() {
    if (!editing) return
    setBusy(true)
    setError('')
    try {
      await endpoints.setAlias(identityId, editing.id, alias.trim())
      await queryClient.invalidateQueries({ queryKey: ['contacts', identityId] })
      toast('Nama pembeda disimpan')
      setEditing(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function clear() {
    if (!editing) return
    setBusy(true)
    setError('')
    try {
      await endpoints.clearAlias(identityId, editing.id)
      await queryClient.invalidateQueries({ queryKey: ['contacts', identityId] })
      toast('Nama pembeda dihapus')
      setEditing(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const total = contacts.data?.length ?? 0

  return (
    <AppShell
      title="Kontak"
      subtitle={total ? `${total} orang pernah bareng bill sama kamu` : 'Orang yang pernah bareng bill sama kamu'}
      back
      active="home"
    >
      {total > 3 ? (
        <Field
          id="contact-search"
          label="Cari"
          value={query}
          onChange={setQuery}
          hint="Nama, nama pembeda, atau kode seperti SW9C"
        />
      ) : null}

      {duplicates.size > 0 && !query ? (
        <Alert tone="pending" title="Ada nama yang sama">
          Beri nama pembeda supaya kamu tidak salah orang waktu mengundang. Nama
          pembeda hanya kamu yang lihat.
        </Alert>
      ) : null}

      {contacts.isPending ? <div className="app-note">Memuat kontak…</div> : null}
      {contacts.isError ? (
        <Alert tone="danger" title="Kontak gagal dimuat">
          {(contacts.error as Error).message}
        </Alert>
      ) : null}

      {contacts.data && total === 0 ? (
        <EmptyState
          title="Belum ada kontak"
          art={<img className="ds-empty-art" src={peopleArt} alt="" width={120} height={120} />}
        >
          Kontak muncul sendiri setelah kamu bareng bill dengan seseorang — tidak
          perlu menambahkan manual.
        </EmptyState>
      ) : null}

      {rows.length > 0 ? (
        <div className="ds-card ds-card-surface ds-pad-sm">
          {rows.map((contact) => {
            const twin = duplicates.has(contact.name.trim().toLowerCase()) && !contact.alias
            return (
              <button
                type="button"
                className="app-row is-tappable"
                key={contact.id}
                onClick={() => openEditor(contact)}
              >
                <Avatar label={contact.display_name.slice(0, 1).toUpperCase()} tone="mint" />
                <span className="grow">
                  <b className="row-name">
                    {contact.display_name}
                    {twin ? <span className="contact-twin">nama sama</span> : null}
                  </b>
                  <small className="row-meta">
                    {contact.alias ? contact.name + ' · ' : ''}
                    {contact.username ? '@' + contact.username : '#' + contact.handle}
                    {contact.shared_count
                      ? ` · ${contact.shared_count} bill${contact.last_bill_title ? ' · terakhir ' + contact.last_bill_title : ''}`
                      : ''}
                  </small>
                </span>
                <span className="row-chevron" aria-hidden="true">›</span>
              </button>
            )
          })}
        </div>
      ) : null}

      {contacts.data && total > 0 && rows.length === 0 ? (
        <div className="app-note">Tidak ada kontak yang cocok dengan “{query}”.</div>
      ) : null}

      <Sheet
        open={Boolean(editing)}
        title="Nama pembeda"
        onClose={() => setEditing(null)}
      >
        {editing ? (
          <>
            <div className="alias-target">
              <Avatar label={editing.name.slice(0, 1).toUpperCase()} tone="navy" />
              <span>
                <b>{editing.name}</b>
                <small>
                  {editing.username ? '@' + editing.username : '#' + editing.handle}
                </small>
              </span>
            </div>
            <Field
              id="contact-alias"
              label="Kamu mengenalnya sebagai"
              value={alias}
              onChange={(next) => {
                setAlias(next)
                setError('')
              }}
              hint="Contoh: Amel Kampus. Hanya kamu yang melihat nama ini."
              error={error || undefined}
              maxLength={40}
            />
            <Button
              block
              loading={busy}
              disabled={!alias.trim() || alias.trim() === (editing.alias ?? '')}
              onClick={() => void save()}
            >
              Simpan nama
            </Button>
            {editing.alias ? (
              <Button variant="quiet" block disabled={busy} onClick={() => void clear()}>
                Hapus nama pembeda
              </Button>
            ) : null}
            <span className="app-note">
              Nama pembeda tidak pernah dikirim ke orangnya. Di bill dan rekap, dia
              tetap melihat namanya sendiri.
            </span>
          </>
        ) : null}
      </Sheet>
    </AppShell>
  )
}
