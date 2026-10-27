import type { QueryClient } from '@tanstack/react-query'
import { keys } from './queries'

/**
 * Satu tempat yang memutuskan "data apa yang basi setelah sebuah perubahan".
 *
 * Masalah yang file ini selesaikan: setiap layar dulu menyegarkan apa yang
 * kebetulan layar itu tampilkan. Buat bill menyegarkan daftar bill tapi tidak
 * rekap; tambah foto menyegarkan bill tapi tidak daftar (thumbnail di beranda
 * jadi tidak muncul); join bill menyegarkan bill saja, padahal beranda dan rekap
 * ikut berubah. Hasilnya: tiga layar yang menampilkan uang yang sama bisa
 * bercerita beda sampai ada yang reload.
 *
 * Aturannya sekarang satu: setiap perubahan yang menyentuh uang menyegarkan
 * bill itu, daftar bill, dan rekap milik identitas tersebut — sekaligus, dalam
 * satu fungsi. Kalau nanti ada layar baru yang membaca uang, ia ikut segar
 * tanpa perlu ada yang ingat menambahkannya.
 */
export type MoneyTarget = { identityId?: string | null; billId?: string | null }

export function invalidateMoneyViews(qc: QueryClient, target: MoneyTarget = {}) {
  const { identityId, billId } = target
  if (billId) void qc.invalidateQueries({ queryKey: keys.bill(billId) })
  if (identityId) {
    void qc.invalidateQueries({ queryKey: keys.bills(identityId) })
    void qc.invalidateQueries({ queryKey: keys.recap(identityId) })
  }
}

/** Perubahan rekening pembayar ikut mengubah isi bill (tujuan transfer). */
export function invalidateAccountViews(qc: QueryClient, identityId?: string | null) {
  if (!identityId) return
  void qc.invalidateQueries({ queryKey: ['accounts', identityId] })
  void qc.invalidateQueries({ queryKey: keys.bills(identityId) })
  void qc.invalidateQueries({ queryKey: keys.recap(identityId) })
  // bill menyimpan salinan rekening pembayar di payload-nya
  void qc.invalidateQueries({ queryKey: ['bill'] })
}

