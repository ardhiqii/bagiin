import { useSyncExternalStore } from 'react'
import { endpoints, setApiIdentity } from './api'
import type { Identity } from './types'

/**
 * Satu sumber identitas untuk seluruh UI. Router context tidak dipakai untuk
 * ini: context router tidak menjamin re-render setelah `router.update`, dan
 * nama yang baru diganti harus langsung terlihat di header.
 */
type Listener = () => void
const listeners = new Set<Listener>()
let current: (Identity & { secret?: string | null }) | null = null

function emit() {
  for (const listener of listeners) listener()
}

export function getIdentity(): (Identity & { secret?: string | null }) | null {
  return current
}

export function subscribeIdentity(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function publishIdentity(next: (Identity & { secret?: string | null }) | null) {
  current = next
  setApiIdentity(next)
  emit()
}

export function useIdentity() {
  return useSyncExternalStore(subscribeIdentity, getIdentity, () => null)
}

const KEY = 'bagiin_identity'
const NAME_KEY = 'bagiin_name'

export type Stored = Identity & { secret?: string | null }

export function loadStored(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Stored
    if (!parsed?.id) return null
    return parsed
  } catch {
    return null
  }
}

export function storeIdentity(identity: Stored | null) {
  try {
    if (!identity) {
      localStorage.removeItem(KEY)
    } else {
      localStorage.setItem(KEY, JSON.stringify(identity))
      localStorage.setItem(NAME_KEY, identity.name)
    }
  } catch {
    /* localStorage bisa diblokir; app tetap jalan tanpa persistensi */
  }
  publishIdentity(identity)
}

export function storedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

/**
 * Masuk di perangkat lain dengan kode pemulihan. Backend mencocokkan hash kode
 * lalu mengembalikan identitas beserta secret-nya, jadi HP baru langsung punya
 * sesi yang sama. Kode lama tetap berlaku sampai dibuat ulang.
 */
/**
 * Terapkan sesi hasil login akun (username/password atau Google).
 *
 * Token perangkat disimpan di kolom `secret` yang sama dengan yang dipakai app
 * sejak awal: header `X-Identity-Secret` menerima keduanya di server, dan
 * dengan begitu tidak ada dua jalur auth yang harus dirawat di sisi klien.
 */
function storeSession(session: { identity: Identity; token: string }): Stored {
  const stored: Stored = {
    id: session.identity.id,
    name: session.identity.name,
    role: session.identity.role,
    auto_accept: session.identity.auto_accept,
    username: session.identity.username ?? null,
    handle: session.identity.handle ?? null,
    secret: session.token,
  } as Stored
  storeIdentity(stored)
  return stored
}

export async function loginWithPassword(username: string, password: string): Promise<Stored> {
  const clean = username.trim()
  if (!clean) throw new Error('Username belum diisi')
  if (!password) throw new Error('Password belum diisi')
  return storeSession(await endpoints.login({ username: clean, password }))
}

export async function registerAccount(input: {
  username: string
  password: string
  name: string
}): Promise<{ stored: Stored; code: string }> {
  if (!input.name.trim()) throw new Error('Nama belum diisi')
  const session = await endpoints.register({
    username: input.username.trim(),
    password: input.password,
    name: input.name.trim(),
  })
  return { stored: storeSession(session), code: session.recovery_code ?? '' }
}

export async function loginWithGoogle(idToken: string): Promise<{ stored: Stored; code?: string }> {
  const session = await endpoints.googleLogin(idToken)
  return { stored: storeSession(session), code: session.recovery_code }
}

/** Keluar: cabut sesi perangkat ini di server, lalu lupakan di perangkat. */
export async function logoutDevice(): Promise<void> {
  try {
    await endpoints.logout()
  } catch {
    /* jaringan bermasalah bukan alasan menahan orang di dalam akun */
  }
  resetIdentity()
}

export async function restoreFromCode(code: string): Promise<Stored> {
  const clean = code.trim().toUpperCase()
  if (!clean) throw new Error('Kode belum diisi')
  const ident = await endpoints.restoreByCode(clean)
  if (!ident?.id) throw new Error('Kode tidak dikenal')
  // hash kode tidak pernah disimpan di perangkat
  const stored: Stored = {
    id: ident.id,
    name: ident.name,
    role: ident.role,
    auto_accept: ident.auto_accept,
    // `token` = sesi perangkat yang bisa dicabut; `secret` cuma dikirim server
    // untuk klien lama. Klien ini selalu memilih token kalau ada.
    secret: ident.token ?? ident.secret ?? null,
  } as Stored
  storeIdentity(stored)
  return stored
}

/**
 * Identitas guest: dibuat sekali, disimpan di localStorage, dan dipulihkan
 * lewat /restore kalau secret hilang (mis. localStorage dibersihkan sebagian).
 */
export async function ensureIdentity(name?: string): Promise<Stored> {
  const existing = loadStored()
  if (existing?.id) {
    if (!existing.secret) {
      try {
        const bound = await endpoints.bind(existing.id)
        if (bound?.secret) {
          const merged = { ...existing, secret: bound.secret }
          storeIdentity(merged)
          return merged
        }
      } catch {
        /* sudah terikat di device lain — permintaan berikutnya akan bilang */
      }
    }
    setApiIdentity(existing)
    return existing
  }

  const clean = (name ?? '').trim()
  if (!clean) throw new Error('Nama belum diisi')
  const created = await endpoints.createIdentity(clean)
  const stored: Stored = { ...created }
  storeIdentity(stored)
  return stored
}

/** Dipanggil dari layar kenalan: buat identitas dengan nama yang benar-benar diisi. */
export async function startIdentity(name: string): Promise<Stored> {
  const clean = name.trim()
  if (!clean) throw new Error('Nama belum diisi')
  // identitas lama dari versi yang auto-memberi nama "Teman" cukup diganti
  // namanya supaya bill lama tetap menempel di orang yang sama
  const existing = loadStored()
  if (existing?.id) return renameIdentity(existing, clean)
  const created = await endpoints.createIdentity(clean)
  const stored: Stored = { ...created }
  storeIdentity(stored)
  return stored
}

export async function renameIdentity(identity: Stored, name: string): Promise<Stored> {
  // backend menjawab {ok: true} saja — nama baru disimpan di sisi klien
  await endpoints.rename(identity.id, name)
  const merged: Stored = { ...identity, name }
  storeIdentity(merged)
  return merged
}

export function resetIdentity() {
  storeIdentity(null)
}
