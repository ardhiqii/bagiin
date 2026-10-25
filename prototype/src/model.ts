export type PersonId = 'A' | 'B' | 'C'
export type Screen = 'home' | 'bill' | 'recap' | 'create'
export type VariantId = 'seimbang'

export interface DemoState {
  persona: PersonId
  nasiB: boolean
  mieB: boolean
  tehB: boolean
  dimsumB: boolean
  dimsumC: boolean
  dimsumCount: number
  selfPickedC: boolean
  invitedC: boolean
  doneB: boolean
  doneC: boolean
  paidB: number
  paidC: number
  refundB: boolean
  created: boolean
}

export const INITIAL_DEMO: DemoState = {
  persona: 'B',
  nasiB: false,
  mieB: true,
  tehB: true,
  dimsumB: true,
  dimsumC: false,
  dimsumCount: 3,
  selfPickedC: false,
  invitedC: false,
  doneB: false,
  doneC: false,
  paidB: 0,
  paidC: 0,
  refundB: false,
  created: true,
}

export const PERSON: Record<PersonId, { name: string; short: string; color: string }> = {
  A: { name: 'Aufa', short: 'A', color: 'peach' },
  B: { name: 'Kamu', short: 'K', color: 'blue' },
  C: { name: 'Citra', short: 'C', color: 'violet' },
}

export const ITEMS = [
  { id: 'nasi', name: 'Nasi goreng kampung', note: '1 porsi', price: 42000, discount: 0 },
  { id: 'mie', name: 'Mie ayam bakso', note: 'Diskon item Rp6.000', price: 36000, discount: 6000 },
  { id: 'teh', name: 'Es teh manis', note: '3 gelas · A ambil 2', price: 24000, discount: 0 },
  { id: 'dimsum', name: 'Dimsum platter', note: 'Dibagi 3 orang', price: 54000, discount: 0 },
] as const

export function idr(value: number): string {
  return 'Rp' + Math.round(value).toLocaleString('id-ID')
}

function proportional(amount: number, weights: Record<string, number>): Record<string, number> {
  const keys = Object.keys(weights).filter((key) => weights[key] > 0)
  const total = keys.reduce((sum, key) => sum + weights[key], 0)
  const output: Record<string, number> = {}
  if (!total) return output
  let distributed = 0
  keys.forEach((key) => {
    output[key] = Math.floor(amount * weights[key] / total)
    distributed += output[key]
  })
  keys.sort((a, b) => a.localeCompare(b))
  for (let i = 0; distributed < amount; i = (i + 1) % keys.length) {
    output[keys[i]] += 1
    distributed += 1
  }
  return output
}

export interface Totals {
  total: number
  subtotal: number
  voucher: number
  service: number
  shipping: number
  base: Record<PersonId | 'pending', number>
  due: Record<PersonId | 'pending', number>
  pendingParts: number
  allocationReady: boolean
  settled: boolean
}

export function calculate(state: DemoState): Totals {
  const base = { A: (state.nasiB ? 21000 : 42000) + 16000, B: state.nasiB ? 21000 : 0, C: 0, pending: 0 }
  if (state.mieB) base.B += 30000
  else base.pending += 30000
  if (state.tehB) base.B += 8000
  else base.pending += 8000
  const dimsumTaken = 1 + Number(state.dimsumB) + Number(state.dimsumC)
  const dimsumPart = Math.floor(54000 / state.dimsumCount)
  base.A += dimsumPart
  if (state.dimsumB) base.B += dimsumPart
  if (state.dimsumC) base.C += dimsumPart
  base.pending += dimsumPart * (state.dimsumCount - dimsumTaken) + (54000 % state.dimsumCount)

  const voucher = proportional(12000, base)
  const service = proportional(15000, base)
  const takers = (['A', 'B', 'C'] as const).filter((key) => base[key] > 0)
  const shipping = proportional(10000, Object.fromEntries(takers.map((key) => [key, 1])))
  const due = { A: 0, B: 0, C: 0, pending: 0 }
  ;(['A', 'B', 'C', 'pending'] as const).forEach((key) => {
    due[key] = base[key] - (voucher[key] || 0) + (service[key] || 0) + (shipping[key] || 0)
  })
  const pendingParts = (state.mieB ? 0 : 1) + (state.tehB ? 0 : 1) + (state.dimsumCount - dimsumTaken)
  const allocationReady = pendingParts === 0 && state.doneB && state.invitedC && state.doneC
  const settled = allocationReady && state.paidB >= due.B && state.paidC >= due.C
  return { total: 163000, subtotal: 150000, voucher: 12000, service: 15000, shipping: 10000, base, due, pendingParts, allocationReady, settled }
}
