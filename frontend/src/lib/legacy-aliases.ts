import { endpoints } from './api'

/**
 * Migrasi nama pembeda dari versi 0.9.
 *
 * 0.9 menyimpan nama kontak di perangkat saja:
 *   localStorage['bagiin_recap_aliases'] = { "<identity-id>": "Amel kantor" }
 * 1.0 menyimpannya di server (tabel contact_alias) supaya ikut ke perangkat lain.
 *
 * Tanpa langkah ini, orang yang sudah menamai kontaknya di 0.9 akan melihat nama
 * asli lagi setelah pindah ke 1.0 — pekerjaan mereka hilang tanpa penjelasan.
 *
 * Aturan mainnya:
 *  - jalan sekali per perangkat (penanda di localStorage)
 *  - tidak pernah menahan layar: kalau gagal, aplikasi tetap jalan
 *  - satu kontak gagal tidak menghentikan kontak lain (404 = orangnya sudah
 *    tidak ada di bill mana pun, 409 = nama itu sudah dipakai kontak lain)
 */
const OLD_KEY = 'bagiin_recap_aliases'
const DONE_KEY = 'bagiin_aliases_migrated_v1'
const MAX_ALIAS = 40

function readOld(): Record<string, string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(OLD_KEY) || 'null')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Record<string, string> = {}
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      const alias = typeof value === 'string' ? value.trim().slice(0, MAX_ALIAS) : ''
      if (alias) out[id] = alias
    }
    return out
  } catch {
    return {}
  }
}

/** Mengembalikan jumlah nama yang berhasil dipindahkan ke server. */
export async function migrateRecapAliases(ownerId: string): Promise<number> {
  if (!ownerId) return 0
  try {
    if (localStorage.getItem(DONE_KEY) === '1') return 0
  } catch {
    return 0
  }

  const old = readOld()
  const entries = Object.entries(old).filter(([contactId]) => contactId && contactId !== ownerId)
  if (entries.length === 0) {
    try {
      localStorage.setItem(DONE_KEY, '1')
    } catch {
      /* localStorage penuh/diblokir: migrasi dianggap selesai untuk sesi ini */
    }
    return 0
  }

  let moved = 0
  for (const [contactId, alias] of entries) {
    try {
      await endpoints.setAlias(ownerId, contactId, alias)
      moved += 1
    } catch {
      /* dilewati dengan sengaja — lihat komentar di atas */
    }
  }

  try {
    localStorage.setItem(DONE_KEY, '1')
  } catch {
    /* idem */
  }
  return moved
}
