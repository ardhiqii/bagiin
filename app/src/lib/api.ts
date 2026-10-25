import type { Identity } from './types'

const BASE = import.meta.env.VITE_API_BASE ?? ''

let identityRef: Identity | null = null
export function setApiIdentity(identity: Identity | null) {
  identityRef = identity
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
  } catch {
    throw new ApiError('Koneksi bermasalah. Periksa internet kamu, lalu coba lagi.', 0)
  }

  if (!res.ok) {
    let parsed: unknown = null
    try {
      parsed = await res.json()
    } catch {
      /* body bukan JSON */
    }
    throw new ApiError(messageFrom(res.status, parsed), res.status)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

export const endpoints = {
  createIdentity: (name: string) => api<Identity>('/api/identities', { method: 'POST', body: { name } }),
  restoreIdentity: (id: string, secret: string) =>
    api<Identity>('/api/identities/restore', { method: 'POST', body: { id, secret } }),
  bind: (id: string) => api<{ secret: string }>(`/api/identities/${id}/bind`, { method: 'POST', body: {} }),
  me: (id: string) => api<Identity & { stats?: unknown }>(`/api/identities/${id}/me`),
  rename: (id: string, name: string) =>
    api<Identity>(`/api/identities/${id}/name`, { method: 'POST', body: { name } }),
}
