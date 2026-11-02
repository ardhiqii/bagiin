export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed'

type ShareCapableNavigator = Navigator & {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>
}

/**
 * Bagikan tautan bill.
 *
 * Di Android, share sheet sistem adalah jalan terpendek ke WhatsApp — dan
 * WhatsApp-lah tempat tautan bill ini hidup. Clipboard hanya cadangan, bukan
 * tujuan. Menutup share sheet (AbortError) berarti "tidak jadi", bukan gagal:
 * jangan menyusul dengan toast error atau membuka WhatsApp Web sendiri.
 */
export async function shareLink(text: string, url: string): Promise<ShareResult> {
  const nav = navigator as ShareCapableNavigator
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title: 'Bagiin', text, url })
      return 'shared'
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return 'cancelled'
      // gagal karena alasan lain (bukan gesture, sheet ditutup paksa, dsb.)
      // -> jatuh ke clipboard, jangan tinggalkan orang tanpa jalan
    }
  }
  try {
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'failed'
  }
}
