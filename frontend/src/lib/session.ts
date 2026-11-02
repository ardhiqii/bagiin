import { useSyncExternalStore } from 'react'
import { endpoints, isSessionError, setSessionErrorHandler } from './api'
import { loadStored, publishIdentity, storeIdentity, type Stored } from './identity'
import type { Identity } from './types'
import { migrateRecapAliases } from './legacy-aliases'

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
 * Batas tunggu validasi sesi. Server yang lambat, atau jaringan yang menggantung,
 * tidak boleh membuat orang menatap kerangka layar selamanya: sesudah batas ini
 * layar dibuka dengan identitas tersimpan, dan hasil pemeriksaan yang datang
 * belakangan tetap dipakai — termasuk memutus sesi kalau ternyata identitasnya
 * sudah tidak ada.
 */
const SESSION_CHECK_TIMEOUT_MS = 8000
const SESSION_TIMEOUT = Symbol('sesi-timeout')

/**
 * Validasi identitas tersimpan ke server sebelum layar mana pun dibuka.
 * Jaringan bermasalah TIDAK mengeluarkan orang dari akunnya — hanya server yang
 * menjawab "identitas ini tidak ada / sesi tidak valid" yang boleh memutus sesi.
 */
/**
 * Gabungkan jawaban `/me` dengan identitas yang tersimpan di perangkat.
 *
 * Sebelum ini hanya `name` dan `role` yang diperbarui. Akibatnya setelan yang
 * diubah di server tidak pernah sampai ke layar: orang mematikan "terima
 * undangan otomatis", database menyimpan 0, dan setelah muat ulang sakelarnya
 * kembali menyala karena yang dibaca nilai lama di perangkat.
 */
function mergeIdentity(stored: Stored, me: Partial<Identity> & { auto_accept?: number | boolean }): Stored {
  const auto = me.auto_accept
  return {
    ...stored,
    name: me.name ?? stored.name,
    role: me.role ?? stored.role,
    auto_accept: auto === undefined || auto === null ? stored.auto_accept : auto ? 1 : 0,
    username: me.username === undefined ? stored.username : me.username,
    handle: me.handle === undefined ? stored.handle : me.handle,
  }
}

export async function startSession() {
  const stored = loadStored()
  if (!stored?.id) {
    setSession({ status: 'anonymous' })
    return
  }
  publishIdentity(stored)

  const probe = endpoints.me(stored.id)
  let me: Awaited<ReturnType<typeof endpoints.me>> | typeof SESSION_TIMEOUT
  try {
    me = await Promise.race([
      probe,
      new Promise<typeof SESSION_TIMEOUT>((resolve) =>
        setTimeout(() => resolve(SESSION_TIMEOUT), SESSION_CHECK_TIMEOUT_MS),
      ),
    ])
  } catch (error) {
    if (isSessionError(error)) {
      expireSession()
      return
    }
    // Offline atau server sedang bermasalah: pertahankan sesi, biar layar yang
    // menampilkan pesan koneksi sendiri.
    setSession({ status: 'authed' })
    return
  }

  if (me === SESSION_TIMEOUT) {
    // Server belum menjawab dalam batas tunggu: buka layar dengan identitas yang
    // tersimpan, jangan tahan orang di kerangka. Tiap layar punya keadaan
    // memuatnya sendiri, dan hasil pemeriksaan yang telat tetap dihormati.
    setSession({ status: 'authed' })
    void probe
      .then((late) => publishIdentity(mergeIdentity(stored, late)))
      .catch((error) => {
        if (isSessionError(error)) expireSession()
      })
    return
  }

  const merged = mergeIdentity(stored, me)
  publishIdentity(merged)
  setSession({ status: 'authed' })
  // Nama kontak dari 0.9 dipindahkan ke server sekali per perangkat. Tidak
  // ditunggu: layar tidak boleh tertahan oleh pekerjaan latar seperti ini.
  void migrateRecapAliases(merged.id)
  if (!stored.secret) {
    // localStorage dibersihkan sebagian: ambil ulang secret kalau perangkat ini
    // memang masih pemilik sesi. Jangan ditunggu — endpoint ini pun bisa lambat,
    // dan gagal di sini bukan alasan menendang orang dari akunnya.
    void endpoints
      .bind(stored.id)
      .then((bound) => {
        if (bound?.secret) publishIdentity({ ...merged, secret: bound.secret })
      })
      .catch(() => {
        /* sudah terikat di perangkat lain */
      })
  }
}

setSessionErrorHandler(() => {
  // Error sesi dari request mana pun (termasuk saat layar sedang terbuka).
  if (state.status === 'authed') expireSession()
})
