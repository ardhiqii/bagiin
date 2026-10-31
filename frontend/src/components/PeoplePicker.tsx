import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, MagnifyingGlass } from '@phosphor-icons/react'
import type { Contact } from '../lib/queries'
import { Avatar, Button, Sheet } from '../ds/primitives'

/**
 * Pemilih orang untuk daftar peserta bill.
 *
 * Kenapa tidak lagi berupa kolom teks bebas:
 *
 * Kolom "Nama teman" dulu membuat peserta berupa **string**. Akibatnya nama
 * yang salah ketik tidak pernah diklaim siapa pun, dua orang bernama sama tidak
 * bisa dibedakan, dan menambah tiga orang berarti tiga kali buka-tutup. Di sini
 * yang dipilih adalah orang yang benar-benar pernah sebill — lengkap dengan
 * nama pembeda, @username, dan bill terakhirnya sebagai pengingat konteks.
 *
 * Orang yang belum pernah sebill tidak dicari di sini: dia masuk lewat link
 * bill seperti biasa, lalu memilih namanya sendiri. Jadi daftar ini saran yang
 * akurat, bukan gerbang yang menutup orang baru.
 */
export function PeoplePicker({
  open,
  contacts,
  isPending,
  isError,
  picked,
  onToggle,
  onClose,
}: {
  open: boolean
  contacts: Contact[] | undefined
  isPending: boolean
  isError?: boolean
  picked: Contact[]
  onToggle: (contact: Contact) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Pencarian selalu mulai kosong: sheet ini dibuka untuk "siapa lagi yang
  // ikut", bukan untuk melanjutkan pencarian sebelumnya.
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const pickedIds = useMemo(() => new Set(picked.map((contact) => contact.id)), [picked])

  const shown = useMemo(() => {
    const list = contacts ?? []
    const needle = query.trim().toLowerCase().replace(/^[@#]/, '')
    if (!needle) return list
    return list.filter((contact) => {
      const haystack = [
        contact.display_name,
        contact.name,
        contact.alias ?? '',
        contact.username ?? '',
        contact.handle,
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [contacts, query])

  return (
    <Sheet open={open} title="Siapa yang ikut?" onClose={onClose}>
      <p className="app-note">
        Pilih dari orang yang pernah sebill dengan kamu. Yang belum pernah, buka
        link bill ini nanti — dia ikut sendiri dari sana.
      </p>

      <div className="search-field">
        <MagnifyingGlass size={18} weight="bold" aria-hidden="true" />
        <input
          id="people-search"
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cari nama atau @username"
          aria-label="Cari teman"
        />
        {query ? (
          <button type="button" className="search-clear" onClick={() => setQuery('')} aria-label="Hapus pencarian">
            ×
          </button>
        ) : null}
      </div>

      {isPending ? <div className="app-note">Memuat teman…</div> : null}
      {isError ? <div className="app-note">Daftar teman gagal dimuat. Coba tutup lalu buka lagi.</div> : null}

      {!isPending && !isError && shown.length === 0 ? (
        <div className="app-note">
          {query
            ? 'Tidak ada teman yang cocok. Nama baru masuk lewat link bill.'
            : 'Belum ada teman sebill. Buat bill, bagikan link-nya, dan mereka akan muncul di sini.'}
        </div>
      ) : null}

      <div>
        {shown.map((contact) => {
          const isPicked = pickedIds.has(contact.id)
          return (
            <button
              key={contact.id}
              type="button"
              className={'ds-pick-row' + (isPicked ? ' is-picked' : '')}
              aria-pressed={isPicked}
              onClick={() => onToggle(contact)}
            >
              <Avatar label={contact.display_name.slice(0, 1).toUpperCase()} tone={contact.alias ? 'mint' : 'navy'} />
              <span className="grow">
                <b className="row-name">{contact.display_name}</b>
                <small className="row-meta">
                  {/* Nama asli ikut kalau ada nama pembeda: tanpa itu orang bisa
                      menambahkan orang yang salah tanpa sadar. */}
                  {contact.alias ? contact.name + ' · ' : ''}
                  {contact.username ? '@' + contact.username : '#' + contact.handle}
                  {contact.last_bill_title ? ' · ' + contact.last_bill_title : ''}
                </small>
              </span>
              <span className="ds-pick-mark" aria-hidden="true">
                {isPicked ? <Check size={16} weight="bold" /> : null}
              </span>
            </button>
          )
        })}
      </div>

      <div className="ds-sheet-foot">
        <Button onClick={onClose}>
          {picked.length > 0 ? 'Selesai · ' + picked.length + ' orang' : 'Selesai'}
        </Button>
      </div>
    </Sheet>
  )
}
