import { useSyncExternalStore } from 'react'
import { endpoints, isSessionError, setSessionErrorHandler } from './api'
import { loadStored, publishIdentity, storeIdentity, type Stored } from './identity'

/**
 * Status sesi, terpisah dari "siapa yang login".
 *
 * Alasan dipisah: dulu UI hanya bertanya "ada identitas di localStorage?".
 * Jawaban itu tidak pernah tahu apakah server masih mengenal identitas tersebut,
 * jadi perangkat yang localStorage-nya menyimpan id dari database lama tetap
 * dianggap login — dan berakhir di beranda kosong bertuliskan "Identitas tidak
 * ditemukan" dengan fitur yang kelihatan terbuka.
 *
 *   checking   → sedang menanyakan server, tampilkan splash
 *   authed     → server mengenal identitas ini, semua layar boleh dibuka
 *   anonymous  → memang belum punya identitas, arahkan ke pendaftaran
 *   expired    → punya identitas tapi server sudah tidak mengenalnya, arahkan
 *                ke pendaftaran sambil menjelaskan kenapa
 */
export type SessionStatus = 'checking' | 'authed' | 'anonymous' | 'expired'

export type Session = { status: SessionStatus; reason?: string }

let state: Session = { status: 'checking' }
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function getSession(): Session {
  return state
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSession(): Session {
  return useSyncExternalStore(subscribeSession, getSession, getSession)
}

function setSession(next: Session) {
  state = next
  emit()
}

const EXPIRED_REASON =
  'Identitas yang tersimpan di perangkat ini sudah tidak ada di server. Isi nama lagi untuk mulai, atau masuk pakai kode pemulihan.'

/* Halaman yang tadi dibuka sebelum ditendang ke pendaftaran. Disimpan di
   sessionStorage, bukan localStorage: ini niat sekali jalan, bukan data akun. */
const INTENT_KEY = 'bagiin_after_login'

export function rememberIntent(path: string) {
  try {
    if (path && path !== '/') sessionStorage.setItem(INTENT_KEY, path)
  } catch {
    /* sessionStorage bisa diblokir; tanpa ini cuma kehilangan satu navigasi */
  }
}

export function takeIntent(): string | null {
  try {
    const value = sessionStorage.getItem(INTENT_KEY)
    if (value) sessionStorage.removeItem(INTENT_KEY)
    return value && value.startsWith('/') ? value : null
  } catch {
    return null
  }
}

/** Dipanggil setelah pendaftaran atau pemulihan kode berhasil. */
export function markAuthed() {
  setSession({ status: 'authed' })
}

/**
 * Putus sesi di sisi klien: hapus identitas tersimpan, lalu tandai expired
 * supaya semua layar ber-guard langsung pindah ke pendaftaran.
 */
export function expireSession(reason: string = EXPIRED_REASON) {
  storeIdentity(null)
  setSession({ status: 'expired', reason })
}

/** Keluar dari akun atas kemauan sendiri (Pengaturan → Keluar). */
export function signOut() {
  storeIdentity(null)
  setSession({ status: 'anonymous' })
}

/**
 * Validasi identitas tersimpan ke server sebelum layar mana pun dibuka.
 * Jaringan bermasalah TIDAK mengeluarkan orang dari akunnya — hanya server yang
 * menjawab "identitas ini tidak ada / sesi tidak valid" yang boleh memutus sesi.
 */
export async function startSession(): Promise<void> {
  const stored = loadStored()
  if (!stored?.id) {
    setSession({ status: 'anonymous' })
    return
  }
  publishIdentity(stored)
  try {
    const me = await endpoints.me(stored.id)
    const merged: Stored = {
      ...stored,
      name: me.name ?? stored.name,
      role: me.role ?? stored.role,
    }
    publishIdentity(merged)
    setSession({ status: 'authed' })
    if (!stored.secret) {
      // localStorage dibersihkan sebagian: ambil ulang secret kalau perangkat
      // ini memang masih pemilik sesi. Gagal di sini bukan alasan menendang.
      try {
        const bound = await endpoints.bind(stored.id)
        if (bound?.secret) publishIdentity({ ...merged, secret: bound.secret })
      } catch {
        /* sudah terikat di perangkat lain */
      }
    }
  } catch (error) {
    if (isSessionError(error)) {
      expireSession()
      return
    }
    // Offline atau server sedang bermasalah: pertahankan sesi, biar layar yang
    // menampilkan pesan koneksi sendiri.
    setSession({ status: 'authed' })
  }
}

setSessionErrorHandler(() => {
  // Error sesi dari request mana pun (termasuk saat layar sedang terbuka).
  if (state.status === 'authed') expireSession()
})
