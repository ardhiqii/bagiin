import { endpoints, setApiIdentity } from './api'
import type { Identity } from './types'

const KEY = 'bagiin_identity'
const NAME_KEY = 'bagiin_name'

type Stored = Identity & { secret?: string | null }

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
  setApiIdentity(identity)
}

export function storedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
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

  const clean = (name ?? '').trim() || 'Teman'
  const created = await endpoints.createIdentity(clean)
  const stored: Stored = { ...created }
  storeIdentity(stored)
  return stored
}

export async function renameIdentity(identity: Stored, name: string): Promise<Stored> {
  const updated = await endpoints.rename(identity.id, name)
  const merged: Stored = { ...identity, ...updated, secret: updated.secret ?? identity.secret }
  storeIdentity(merged)
  return merged
}

export function resetIdentity() {
  storeIdentity(null)
}
