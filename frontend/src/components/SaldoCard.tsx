import { useState } from 'react'
import { BalanceCard, Button, Sheet, idr } from '../ds/primitives'
import type { Recap } from '../lib/types'

/**
 * Kartu saldo — satu komponen untuk Beranda dan Rekap.
 *
 * Dua layar ini dulu menyusun kartunya sendiri-sendiri dan hasilnya berbeda:
 * Beranda menampilkan NET (Rp208.000) sementara Rekap menampilkan satu arah saja
 * (Rp22.000) dengan catatan "kamu juga terima Rp230.000". Uangnya sama, angkanya
 * beda, dan orangnya wajar bingung apakah dia menerima Rp208.000 atau membayar
 * Rp22.000. Sekarang kartunya satu, jadi tidak mungkin menyimpang lagi.
 *
 * Angka besar = NET dari bill yang pembagiannya SUDAH PASTI. Dua komponennya
 * ditulis di bawahnya dengan tanda + / −, karena net tidak sama dengan salah
 * satu komponennya. Uang yang masih bisa berubah tidak pernah dijumlahkan ke
 * angka itu: dia punya baris sendiri dengan "±".
 */
export function SaldoCard({
  recap,
  onOpenUnclear,
}: {
  recap: Pick<Recap, 'final' | 'provisional'>
  /** Dipanggil dari pop-up rincian: pindah ke daftar bill yang belum pasti. */
  onOpenUnclear?: () => void
}) {
  const [detailOpen, setDetailOpen] = useState(false)
  const { final, provisional } = recap

  const net = Math.round(final.net_idr)
  const terima = Math.round(final.receivable_idr)
  const bayar = Math.round(final.payable_idr)
  const duaArah = terima > 0 && bayar > 0
  const belumPasti = Math.round((provisional?.receivable_idr ?? 0) - (provisional?.payable_idr ?? 0))
  const billBelumPasti = provisional?.bill_count ?? 0

  const tagih = final.counterparties.filter((row) => row.net_idr > 0)
  const utang = final.counterparties.filter((row) => row.net_idr < 0)
  const billsOf = (rows: typeof tagih) =>
    new Set(rows.flatMap((row) => row.bills.map((edge) => edge.bill_id))).size

  const label = net > 0 ? 'Harus kamu terima' : net < 0 ? 'Harus kamu bayar' : 'Saldonya nol'

  return (
    <>
      <BalanceCard
        label={label}
        value={Math.abs(net)}
        tone={net > 0 ? 'pos' : net < 0 ? 'neg' : undefined}
        rows={
          duaArah
            ? [
                { label: 'Terima', value: terima, tone: 'pos' as const },
                { label: 'Bayar', value: -bayar, tone: 'neg' as const },
              ]
            : undefined
        }
        // Saat dua arah, keterangan "sudah pasti" jadi caption di atas rincian
        // (lihat BalanceCard), jadi catatan ini tidak diulang di sini.
        // Kalau ada bill belum dibagi TAPI perkiraannya nol (mis. sisa yang
        // jatuh ke pembayar tidak mengubah arah), jumlah billnya tetap harus
        // disebut — kalau tidak, layar terlihat seperti tidak ada yang
        // menggantung padahal ada.
        note={
          duaArah
            ? undefined
            : billBelumPasti > 0 && belumPasti === 0
              ? billBelumPasti + ' bill belum dibagi · angkanya belum bisa dipastikan'
              : net === 0
                ? 'tidak ada sisa bill yang pembagiannya sudah jelas'
                : 'dari bill yang pembagiannya sudah pasti'
        }
        estimate={belumPasti !== 0 ? { value: belumPasti, label: 'Belum dipastikan' } : undefined}
        onOpenDetail={() => setDetailOpen(true)}
      />

      <Sheet open={detailOpen} title="Rincian saldo" onClose={() => setDetailOpen(false)}>
        <div className="saldo-detail">
          <div className="saldo-detail-group">
            <span className="saldo-detail-cap">sudah pasti</span>
            <div className="saldo-detail-row">
              <span>Kamu terima</span>
              <b className="ds-amount--pos">+{idr(terima)}</b>
            </div>
            <div className="saldo-detail-row">
              <span>Kamu bayar</span>
              <b className="ds-amount--neg">−{idr(bayar)}</b>
            </div>
            <div className="saldo-detail-row is-total">
              <span>Ringkasan selisih</span>
              <b>{net < 0 ? '−' : ''}{idr(Math.abs(net))}</b>
            </div>
            <p className="saldo-detail-hint">
              {duaArah
                ? 'Uangnya tidak benar-benar bertemu: yang kamu tagih dan yang kamu bayar adalah orang yang berbeda. Selisih di atas cuma ringkasan, bukan satu transfer.'
                : 'Semua bill yang pembagiannya sudah pasti mengarah ke arah yang sama.'}
            </p>
          </div>

          {billBelumPasti > 0 ? (
            <div className="saldo-detail-group">
              <span className="saldo-detail-cap">belum pasti</span>
              <div className="saldo-detail-row">
                <span>
                  {billBelumPasti} bill belum dibagi
                </span>
                <b className="saldo-detail-est">
                  {belumPasti !== 0 ? '± ' + idr(Math.abs(belumPasti)) : 'belum bisa dihitung'}
                </b>
              </div>
              <p className="saldo-detail-hint">
                Angka ini belum masuk hitungan di atas dan tidak akan pernah
                dijumlahkan ke sana. Ada item yang belum dipilih atau belum ada
                yang mengaku, jadi bagiannya masih bisa pindah ke kamu.
              </p>
              {onOpenUnclear && billBelumPasti > 0 ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDetailOpen(false)
                    onOpenUnclear()
                  }}
                >
                  Lihat {billBelumPasti} bill itu
                </Button>
              ) : null}
            </div>
          ) : null}

          <p className="saldo-detail-foot">
            {billsOf(tagih) > 0 || billsOf(utang) > 0
              ? 'Dari ' + billsOf(tagih) + ' bill yang menagih dan ' + billsOf(utang) + ' bill yang harus kamu bayar.'
              : ''}
          </p>
        </div>
      </Sheet>
    </>
  )
}
