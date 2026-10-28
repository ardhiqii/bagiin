/**
 * Google Identity Services (GIS).
 *
 * Kenapa memakai GIS dan bukan redirect OAuth: alur redirect butuh halaman
 * perantara, cookie state, dan kembali ke aplikasi lewat URL — tiga tempat yang
 * bisa gagal di HP. GIS mengembalikan **ID token** langsung ke halaman, dan
 * token itu diverifikasi ulang di server (tanda tangan, aud, iss, email
 * terverifikasi). Kunci Google tidak pernah menyentuh aplikasi ini.
 *
 * Client ID diambil dari server (`/api/auth/config`), bukan dari build VITE:
 * satu nilai, satu tempat; mengganti client ID tidak perlu build ulang frontend.
 */
import { api } from './api'

type CredentialResponse = { credential?: string; select_by?: string }

type GoogleAccounts = {
  id: {
    initialize: (config: {
      client_id: string
      callback: (response: CredentialResponse) => void
      auto_select?: boolean
      cancel_on_tap_outside?: boolean
      use_fedcm_for_prompt?: boolean
    }) => void
    renderButton: (
      parent: HTMLElement,
      options: {
        type?: 'standard' | 'icon'
        theme?: 'outline' | 'filled_blue' | 'filled_black'
        size?: 'large' | 'medium' | 'small'
        text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'
        shape?: 'rectangular' | 'pill' | 'circle' | 'square'
        logo_alignment?: 'left' | 'center'
        width?: number | string
        locale?: string
      },
    ) => void
    disableAutoSelect: () => void
  }
}

declare global {
  interface Window {
    google?: { accounts: GoogleAccounts }
  }
}

export type GoogleConfig = { client_id: string | null; stub: boolean }

let scriptPromise: Promise<void> | null = null

function loadScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-gis="1"]')
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Google gagal dimuat')))
      return
    }
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.dataset.gis = '1'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Google gagal dimuat'))
    document.head.appendChild(script)
  })
  return scriptPromise
}

export async function googleConfig(): Promise<GoogleConfig> {
  const config = await api<{ google_client_id: string | null; google_stub: boolean }>('/api/auth/config')
  return { client_id: config.google_client_id, stub: config.google_stub }
}

/**
 * Pasang tombol resmi Google ke dalam `parent` dan kirim ID token ke `onToken`.
 * Tombol resmi dipakai apa adanya (bukan tombol buatan sendiri): pedoman merek
 * Google melarang tombol kustom, dan tombol resmi sudah membawa jaminan
 * "ini benar Google" yang tidak bisa ditiru aplikasi lain.
 */
export async function mountGoogleButton(
  parent: HTMLElement,
  clientId: string,
  onToken: (token: string) => void,
  onError?: (message: string) => void,
): Promise<() => void> {
  await loadScript()
  const accounts = window.google?.accounts
  if (!accounts?.id) {
    onError?.('Google belum siap di perangkat ini')
    return () => {}
  }
  accounts.id.initialize({
    client_id: clientId,
    callback: (response) => {
      if (response?.credential) onToken(response.credential)
      else onError?.('Google tidak mengirim identitas, coba lagi')
    },
    cancel_on_tap_outside: true,
  })
  parent.innerHTML = ''
  const width = Math.min(400, Math.max(240, parent.clientWidth || 320))
  accounts.id.renderButton(parent, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'continue_with',
    shape: 'pill',
    logo_alignment: 'center',
    width,
    locale: 'id',
  })
  return () => {
    try {
      accounts.id.disableAutoSelect()
    } catch {
      /* tidak semua versi GIS punya; tidak penting untuk keluar */
    }
  }
}
