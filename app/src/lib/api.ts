import type { Identity } from './types'

const BASE = import.meta.env.VITE_API_BASE ?? ''

let identityRef: Identity | null = null
export function setApiIdentity(identity: Identity | null) {
  identityRef = identity
}

/**
 * Error yang berarti "identitas di perangkat ini tidak berlaku lagi", bukan
 * "kamu tidak boleh melakukan ini". Backend memakai 403 untuk dua hal yang
 * sangat berbeda — sesi basi dan aksi yang bukan hakmu — jadi pemisahannya
 * harus lewat pesan, bukan hanya status.
 */
export function isSessionError(error: unknown): boolean {
  const err = error as { status?: number; message?: string } | null
  if (!err || typeof err.status !== 'number') return false
  const message = err.message ?? ''
  if (err.status === 404 && /identitas tidak ditemukan/i.test(message)) return true
  if (err.status === 403 && /(sesi tidak valid|identitas tidak cocok)/i.test(message)) return true
  return false
}

let sessionErrorHandler: (() => void) | null = null
/** Dipasang sekali oleh lib/session.ts; dipanggil saat server menolak identitas. */
export function setSessionErrorHandler(handler: (() => void) | null) {
  sessionErrorHandler = handler
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

/** Pesan error selalu bahasa Indonesia yang bisa dibaca user. */
function messageFrom(status: number, body: unknown): string {
  if (status === 429) return 'Terlalu banyak permintaan, tunggu sebentar ya'
  if (body && typeof body === 'object') {
    const detail = (body as { detail?: unknown }).detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail) && detail.length) {
      const first = detail[0] as { msg?: string; loc?: unknown[] }
      if (first?.msg) return first.msg
    }
  }
  if (status === 404) return 'Data tidak ditemukan'
  if (status >= 500) return 'Server sedang bermasalah, coba lagi sebentar'
  return `Terjadi kendala (${status})`
}

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  headers?: Record<string, string>
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  if (identityRef) {
    headers['X-Identity-Id'] = identityRef.id
    if (identityRef.secret) headers['X-Identity-Secret'] = identityRef.secret
  }
  let body: BodyInit | undefined
  if (opts.body !== undefined && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.body)
  } else if (opts.body instanceof FormData) {
    body = opts.body
  }

  let res: Response
  try {
    res = await fetch(BASE + path, {
      method: opts.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      signal: opts.signal,
    })
  } catch (error) {
    // Permintaan yang dibatalkan user bukan kegagalan jaringan: teruskan apa
    // adanya supaya pemanggil bisa membedakan "dibatalkan" dari "gagal".
    if ((error as Error)?.name === 'AbortError') throw error
    throw new ApiError('Koneksi bermasalah. Periksa internet kamu, lalu coba lagi.', 0)
  }

  if (!res.ok) {
    let parsed: unknown = null
    try {
      parsed = await res.json()
    } catch {
      /* body bukan JSON */
    }
    const error = new ApiError(messageFrom(res.status, parsed), res.status)
    // Sesi basi harus memutus sesi di mana pun error-nya muncul, bukan cuma di
    // layar beranda. Tanpa ini, orang bisa duduk di layar kosong berisi pesan
    // "Identitas tidak ditemukan" tanpa pernah ditawari daftar ulang.
    if (isSessionError(error)) sessionErrorHandler?.()
    throw error
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

export const endpoints = {
  createIdentity: (name: string) => api<Identity>('/api/identities', { method: 'POST', body: { name } }),
  /* Endpoint restore menerima KODE pemulihan, bukan id+secret. Versi lama di
     sini salah bentuk dan tidak pernah dipakai layar mana pun. */
  restoreByCode: (code: string) =>
    api<Identity & { secret?: string | null; token?: string }>('/api/identities/restore', {
      method: 'POST',
      body: { code },
    }),
  newRecoveryCode: (id: string) =>
    api<{ code: string }>(`/api/identities/${id}/code/generate`, { method: 'POST', body: {} }),
  bind: (id: string) => api<{ secret: string }>(`/api/identities/${id}/bind`, { method: 'POST', body: {} }),
  me: (id: string) => api<Identity & { stats?: unknown }>(`/api/identities/${id}/me`),
  rename: (id: string, name: string) =>
    api<Identity>(`/api/identities/${id}/name`, { method: 'POST', body: { name } }),

  /* ---------- akun ----------
     Semua jalur masuk mengembalikan `token` (sesi perangkat yang bisa dicabut)
     dan, untuk akun baru, `recovery_code` yang wajib ditampilkan sekali. */
  authState: () => api<AuthState>('/api/auth/state'),
  register: (input: { username: string; password: string; name: string }) =>
    api<AuthSession>('/api/auth/register', { method: 'POST', body: input }),
  login: (input: { username: string; password: string }) =>
    api<AuthSession>('/api/auth/login', { method: 'POST', body: input }),
  googleLogin: (idToken: string) =>
    api<AuthSession>('/api/auth/google', { method: 'POST', body: { id_token: idToken, mode: 'login' } }),
  googleLink: (idToken: string) =>
    api<{ linked: boolean; email?: string | null }>('/api/auth/google', {
      method: 'POST',
      body: { id_token: idToken, mode: 'link' },
    }),
  googleUnlink: () => api<{ linked: boolean }>('/api/auth/google/unlink', { method: 'POST', body: {} }),
  setPassword: (input: { current_password?: string; new_password: string }) =>
    api<{ ok: boolean }>('/api/auth/password', { method: 'POST', body: input }),
  setUsername: (username: string) =>
    api<{ username: string }>('/api/auth/username', { method: 'POST', body: { username } }),
  /* kode pemulihan untuk identitas yang sedang login (beda dari endpoint lama
     yang butuh id di URL) */
  regenerateRecoveryCode: () => api<{ code: string }>('/api/auth/recovery', { method: 'POST', body: {} }),
  logout: () => api<{ ok: boolean }>('/api/auth/logout', { method: 'POST', body: {} }),
  revokeDevice: (deviceId: string) =>
    api<{ ok: boolean }>(`/api/auth/devices/${deviceId}`, { method: 'DELETE' }),

  /* ---------- kontak ---------- */
  setAlias: (identityId: string, contactId: string, alias: string) =>
    api<{ alias: string; display_name: string }>(
      `/api/identities/${identityId}/contacts/${contactId}/alias`,
      { method: 'PUT', body: { alias } },
    ),
  clearAlias: (identityId: string, contactId: string) =>
    api<{ alias: null; display_name: string | null }>(
      `/api/identities/${identityId}/contacts/${contactId}/alias`,
      { method: 'DELETE' },
    ),
}

export type AuthSession = { identity: Identity; token: string; recovery_code?: string }

export type AuthDevice = {
  id: string
  label: string
  last_seen_at: string | null
  current: boolean
}

export type AuthState = {
  username: string | null
  handle: string
  has_password: boolean
  has_recovery_code: boolean
  google: { linked: boolean; email: string | null }
  google_configured: boolean
  devices: AuthDevice[]
}
