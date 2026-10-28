import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CaretRight, WarningCircle } from '@phosphor-icons/react'
import { useAccounts, useRecap } from '../lib/queries'
import { invalidateMoneyViews } from '../lib/mutations'
import { api } from '../lib/api'
import { formatRp } from '../lib/money'
import { AppShell } from '../components/AppShell'
import { useToast } from '../components/Toast'
import { Alert, Avatar, BalanceCard, Button, EmptyState, Group, Sheet } from '../ds/primitives'
import type { RecapBill, RecapCounterparty, RecapEdge } from '../lib/types'
import personArt from '../assets/person.webp'
import paidArt from '../assets/paid.webp'

/**
 * Alasan bill belum final, ditulis sebagai kalimat. Kode alasan dari backend
 * ("uncovered_slots") tidak berguna bagi orang yang membaca rekap; yang dia
 * butuh tahu: item apa yang belum ada pengakunya.
 */
function blockers(bill: RecapBill) {
  const parts: string[] = []
  for (const item of bill.uncovered_items) {
    parts.push(item.name + ' ' + formatRp(item.amount_idr) + ' belum ada yang ngaku')
  }
  // item yang tidak dipilih siapa pun: uangnya sudah masuk bagian pembayar,
  // tapi harus disebut supaya kelihatan
  for (const item of bill.owner_absorbed_items) {
    parts.push(item.name + ' ' + formatRp(item.amount_idr) + ' belum ada yang ngaku')
  }
  const named = new Set([...bill.uncovered_items, ...bill.owner_absorbed_items].map((i) => i.name))
  for (const name of bill.unassigned_items) {
    if (!named.has(name)) parts.push(name + ' belum ada yang pilih')
  }
  if (parts.length === 0) {
    if (bill.reason_codes.includes('pending_selection')) parts.push('ada yang belum pilih item')
    else if (bill.reason_codes.includes('open_bill')) parts.push('belum ada yang pilih item')
    else if (bill.reason_codes.includes('payer_unresolved')) parts.push('pembayar belum pasti')
    else parts.push('belum bisa dihitung pasti')
  }
  return parts.join(' · ')
}

/** "belum kamu transfer" vs "belum dia transfer" — dari arah sisanya. */
function edgeLabel(edge: RecapEdge) {
  if (edge.status === 'closed') return 'bill ditutup, sisa belum dibayar'
  return edge.direction === 'pay' ? 'belum kamu transfer' : 'belum dia transfer'
}

function initial(name: string) {
  const trimmed = name.trim()
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : '?'
}

function PersonRow({ row, onOpen }: { row: RecapCounterparty; onOpen: () => void }) {
  const pays = row.net_idr < 0
  const twoWay = row.payable_idr > 0 && row.receivable_idr > 0
  // meta menyebut apa yang harus dilakukan, bukan status sistem. Kalau uangnya
  // dua arah, menyebut satu arah saja akan menyesatkan — jadi dikatakan apa
  // adanya dan rinciannya ada di baris kedua.
  const meta = twoWay
    ? row.bills.length + ' bill'
    : pays
      ? row.bills.length + ' bill · belum kamu transfer'
      : row.bills.length + ' bill · belum dia transfer'
  return (
    <button type="button" className="recap-person" onClick={onOpen}>
      <Avatar label={initial(row.display_name ?? row.name)} tone={pays ? 'navy' : 'mint'} />
      <span className="recap-person-copy">
        {/* nama pembeda milik penampil; pesan yang dikirim ke dia tetap
            memakai nama aslinya (lihat copyReminder) */}
        <b>{row.display_name ?? row.name}</b>
        <small>{meta}</small>
        {/* dua arah sekaligus: jangan sembunyikan yang satunya di balik net */}
        {twoWay ? (
          <>
            {/* dua baris pendek, bukan satu baris dengan pemisah: kalimat
                gabungan mematah setelah "dia" dan terbaca sebagai salah ketik */}
            <small className="recap-recip">kamu bayar {formatRp(row.payable_idr)}</small>
            <small className="recap-recip">dia bayar {formatRp(row.receivable_idr)}</small>
          </>
        ) : null}
      </span>
      <span className="recap-person-amt">
        <b>{formatRp(row.amount_idr)}</b>
        <small>{pays ? 'kamu bayar' : 'kamu tagih'}</small>
      </span>
      <CaretRight size={16} className="recap-chevron" aria-hidden="true" />
    </button>
  )
}

function PersonSheet({
  row,
  onClose,
  identityId,
}: {
  row: RecapCounterparty | null
  onClose: () => void
  identityId: string | null
}) {
  const twoWay = !!row && row.payable_idr > 0 && row.receivable_idr > 0
  const accounts = useAccounts(identityId)
  const toast = useToast()

  /**
   * Pesan pengingat disusun dari angka yang SAMA dengan yang tampil di kartu,
   * bukan dihitung ulang: kalau orang menagih lewat WhatsApp dengan nominal
   * berbeda dari yang ada di aplikasi, dua angka itu yang jadi pertengkaran.
   * Hanya untuk piutang — menagih orang yang justru kita utangi itu janggal.
   */
  async function copyReminder() {
    if (!row) return
    const lines = row.bills.map((edge) => '- ' + edge.title + ': ' + formatRp(edge.amount_idr))
    const account = accounts.data?.[0]
    const transfer = account ? '\n\nTransfer ke ' + account.brand + ' ' + account.account_no +
      (account.holder_name ? ' a.n. ' + account.holder_name : '') : ''
    const text =
      'Hai ' + row.name + ', ini tagihan kita yang belum lunas:\n' +
      lines.join('\n') +
      '\nTotal: ' + formatRp(row.amount_idr) +
      transfer +
      '\n\nKalau sudah, tandai lunas di aplikasi Bagiin ya. Makasih!'
    try {
      await navigator.clipboard.writeText(text)
      toast('Pesan pengingat disalin')
    } catch {
      toast('Tidak bisa menyalin. Salin manual: ' + text)
    }
  }
  return (
    <Sheet open={row !== null} title={(row?.display_name ?? row?.name) || 'Orang'} art={personArt} onClose={onClose}>
      {row ? (
        <div className="app-stack">
          <div className="recap-sheet-total">
            <span className="recap-sheet-label">{row.net_idr < 0 ? 'Kamu bayar' : 'Kamu tagih'}</span>
            <strong className="recap-sheet-value">{formatRp(row.amount_idr)}</strong>
            <small>{row.bills.length} bill belum lunas</small>
          </div>

          {twoWay ? (
            <div className="app-list">
              <div className="app-row">
                <span className="grow">
                  <b>Kamu bayar</b>
                  <small>bagianmu yang belum kamu transfer</small>
                </span>
                <span className="amt">{formatRp(row.payable_idr)}</span>
              </div>
              <div className="app-row">
                <span className="grow">
                  <b>Dia bayar</b>
                  <small>bagian dia yang belum dia transfer</small>
                </span>
                <span className="amt">{formatRp(row.receivable_idr)}</span>
              </div>
              <div className="app-row">
                <span className="grow">
                  <b>Bersih</b>
                  <small>selisih kalau dua-duanya dihitung</small>
                </span>
                <span className="amt">{formatRp(Math.abs(row.net_idr))}</span>
              </div>
            </div>
          ) : null}

          <div className="app-list">
            {row.bills.map((edge) => (
              <Link
                key={edge.bill_id}
                to="/b/$billId"
                params={{ billId: edge.bill_id }}
                className="app-row recap-bill-row"
                onClick={onClose}
              >
                <span className="grow">
                  <b>{edge.title}</b>
                  <small>{edgeLabel(edge)}</small>
                </span>
                <span className="amt">{formatRp(edge.amount_idr)}</span>
                <CaretRight size={15} className="recap-chevron" aria-hidden="true" />
              </Link>
            ))}
          </div>

          {/* Aksi ini berlaku untuk SEMUA baris di atasnya, jadi tempatnya di
              bawah daftar — bukan menyela antara angka total dan rinciannya. */}
          {row.receivable_idr > 0 ? (
            <Button variant="quiet" block onClick={() => void copyReminder()}>
              Salin pesan pengingat
            </Button>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  )
}

/**
 * Rekap menjawab dua pertanyaan yang tidak boleh dicampur:
 *   1. berapa utang/piutang yang pembagiannya SUDAH JELAS — angkanya tidak
 *      berubah lagi, boleh langsung ditransfer;
 *   2. bill mana yang pembagiannya BELUM JELAS, dan apa yang membuatnya belum
 *      jelas.
 * Angka dari keduanya tidak pernah dijumlahkan; kalau dicampur, orang
 * mentransfer nominal yang salah.
 *
 * Yang sudah lunas tidak muncul sama sekali: backend hanya mengirim sisa
 * (`_recap_edges_for_viewer`), jadi rekap berisi pekerjaan, bukan arsip.
 */
export function Recap({ identityId }: { identityId: string | null }) {
  const recap = useRecap(identityId)
  const qc = useQueryClient()
  const data = recap.data

  const [openPerson, setOpenPerson] = useState<RecapCounterparty | null>(null)
  const [closing, setClosing] = useState<RecapBill | null>(null)

  const settle = useMutation({
    mutationFn: (billId: string) =>
      api<unknown>('/api/bills/' + billId + '/settle', { method: 'POST', body: {} }),
    onSuccess: (_data, billId) => {
      // tutup bill mengubah rekap, daftar, dan layar bill itu sendiri
      invalidateMoneyViews(qc, { billId, identityId })
      setClosing(null)
    },
  })

  const people = useMemo(
    () =>
      [...(data?.final.counterparties ?? [])].sort(
        (a, b) => Math.abs(b.net_idr) - Math.abs(a.net_idr),
      ),
    [data],
  )
  // urut: kewajiban dulu, baru hak. Nominal terbesar di atas.
  const pays = people.filter((row) => row.net_idr < 0)
  const receives = people.filter((row) => row.net_idr > 0)
  const unclear = data?.provisional.bills ?? []

  const outstandingBills = useMemo(() => {
    const ids = new Set<string>()
    for (const row of people) for (const edge of row.bills) ids.add(edge.bill_id)
    return ids.size
  }, [people])

  const payable = data?.final.payable_idr ?? 0
  const receivable = data?.final.receivable_idr ?? 0
  // Angka kasar, sama seperti di beranda: dari bill yang pembagiannya belum
  // selesai. Tidak pernah dijumlahkan ke angka pasti.
  const estimate = data
    ? (data.provisional.receivable_idr ?? 0) - (data.provisional.payable_idr ?? 0)
    : 0
  const heroPays = payable > 0
  const heroValue = heroPays ? payable : receivable
  const otherDirection = heroPays ? receivable : payable

  // Catatan di bawah angka besar menjawab "angka ini angka apa", bukan
  // menambah penghitung. Versi lama menulis "1 bill belum lunas" — angka kedua
  // di layar yang sama, persis yang bikin orang ragu mana yang harus dipercaya.
  // Arah sebaliknya tetap disebut karena itu uang, bukan hitungan: orang perlu
  // tahu ada piutang yang belum masuk angka ini.
  const note =
    outstandingBills === 0
      ? 'tidak ada sisa tagihan yang pembagiannya sudah jelas'
      : 'dari bill yang pembagiannya sudah pasti' +
        (otherDirection > 0
          ? ' · kamu juga ' + (heroPays ? 'terima' : 'bayar') + ' ' + formatRp(otherDirection)
          : '')

  const nothingToDo = people.length === 0 && unclear.length === 0

  function jumpToUnclear() {
    const target = document.getElementById('rekap-belum-jelas')
    if (!target) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <AppShell
      title="Rekap"
      subtitle={
        // angka sudah ada di kartu dan di banner; subtitle menyebut cakupannya
        // supaya tidak ada tiga kalimat yang mengatakan hal yang sama.
        // Sebelum data datang jangan menebak "tidak ada yang perlu diurus".
        !data ? undefined : nothingToDo ? 'tidak ada yang perlu diurus' : 'yang belum beres aja'
      }
      active="recap"
    >
      {recap.isError ? (
        <Alert tone="danger" title="Gagal memuat rekap">
          {(recap.error as Error).message}
        </Alert>
      ) : null}
      {recap.isPending ? <div className="app-note">Memuat…</div> : null}

      {data ? (
        <>
          {people.length > 0 ? (
            <BalanceCard
              label={heroPays ? 'Harus kamu bayar' : 'Harus kamu terima'}
              value={heroPays ? -heroValue : heroValue}
              tone={heroPays ? 'neg' : 'pos'}
              note={note}
              estimate={estimate !== 0 ? { value: estimate } : undefined}
            />
          ) : null}

          {unclear.length > 0 ? (
            <button type="button" className="app-banner is-pending" onClick={jumpToUnclear}>
              <WarningCircle size={19} weight="bold" aria-hidden="true" />
              <span className="app-banner-text">
                {/* Jumlahnya cuma disebut di judul seksi di bawah; di sini
                    kalimat aksinya saja. Dua kali "6 bill" di satu layar
                    membuat orang mengira ada dua himpunan berbeda. */}
                <b>Ada bill yang pembagiannya belum jelas</b>
                <small>Angkanya masih bisa berubah — buka untuk memberi tahu siapa ambil apa</small>
              </span>
              <CaretRight size={16} aria-hidden="true" />
            </button>
          ) : null}

          {unclear.length > 0 ? (
            <div id="rekap-belum-jelas">
              <Group label={'Pembagian belum jelas · ' + unclear.length + ' bill'}>
                {unclear.map((bill) => (
                  <div className="recap-open" key={bill.bill_id}>
                    <Link
                      className="recap-open-main"
                      to="/b/$billId"
                      params={{ billId: bill.bill_id }}
                    >
                      <b>{bill.title}</b>
                      <small>{blockers(bill)}</small>
                      <span className="recap-payer">
                        sisa ditanggung {bill.paid_by_name ?? 'pembayar'}
                      </span>
                    </Link>
                    {bill.can_manage ? (
                      <Button variant="quiet" compact onClick={() => setClosing(bill)}>
                        Tandai lunas
                      </Button>
                    ) : (
                      // bukan pembayarnya: yang bisa menutup hanya dia, tapi
                      // barisnya tetap bisa dibuka — chevron menggantikan tombol
                      // supaya ruang kanan tidak kosong tanpa alasan
                      <CaretRight size={16} className="recap-chevron" aria-hidden="true" />
                    )}
                  </div>
                ))}
              </Group>
            </div>
          ) : null}

          {pays.length > 0 ? (
            <Group label="Kamu bayar">
              {pays.map((row) => (
                <PersonRow key={row.identity_id} row={row} onOpen={() => setOpenPerson(row)} />
              ))}
            </Group>
          ) : null}

          {receives.length > 0 ? (
            <Group label="Kamu tagih">
              {receives.map((row) => (
                <PersonRow key={row.identity_id} row={row} onOpen={() => setOpenPerson(row)} />
              ))}
            </Group>
          ) : null}

          {nothingToDo ? (
            <EmptyState
              title="Semua bill beres"
              art={<img className="recap-empty-art" src={paidArt} alt="" width={150} height={150} />}
            >
              Tidak ada utang, piutang, atau bill yang menunggu dipilih.
            </EmptyState>
          ) : null}

          <PersonSheet
            row={openPerson}
            onClose={() => setOpenPerson(null)}
            identityId={identityId}
          />

          {/* Tombol ini menandai bill LUNAS (settle), bukan menutup status bill.
              Dulu labelnya "Tutup", sama dengan tombol di layar bill yang artinya
              lain: menutup status tidak membebaskan siapa pun dari utang, sedangkan
              yang ini menganggap semuanya sudah dibayar. Dua kata yang sama untuk
              dua akibat uang yang berbeda adalah cara tercepat bikin orang salah
              paham, jadi labelnya sekarang menyebut akibatnya. */}
          <Sheet open={closing !== null} title="Tandai bill ini lunas?" onClose={() => setClosing(null)}>
            {closing ? (
              <div className="app-stack">
                <div className="app-note" style={{ margin: 0 }}>
                  {closing.title} masih punya {blockers(closing)}. Kalau ditandai lunas, sisa itu
                  dianggap ditanggung {closing.paid_by_name ?? 'pembayar'} dan tidak ditagih lagi
                  ke siapa pun.
                </div>
                <Button onClick={() => settle.mutate(closing.bill_id)} disabled={settle.isPending}>
                  {settle.isPending
                    ? 'Menandai…'
                    : 'Tandai lunas, sisa ditanggung ' + (closing.paid_by_name ?? 'pembayar')}
                </Button>
                <Button variant="quiet" onClick={() => setClosing(null)}>
                  Tunggu dulu
                </Button>
              </div>
            ) : null}
          </Sheet>
        </>
      ) : null}
    </AppShell>
  )
}
