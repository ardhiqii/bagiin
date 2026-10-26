import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { Home } from './screens/Home'
import { Bills } from './screens/Bills'
import { Create } from './screens/Create'
import { BillDetail } from './screens/BillDetail'
import { EditBill } from './screens/EditBill'
import { Recap } from './screens/Recap'
import { Settings } from './screens/Settings'
import { useIdentity } from './lib/identity'
import { Welcome } from './screens/Welcome'
import { Restore } from './screens/Restore'

const rootRoute = createRootRoute()

function useMe() {
  return useIdentity()
}

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: function HomeRoute() {
    const me = useMe()
    if (!me) return <Welcome />
    return (
      <Home identityId={me.id} name={me.name} />
    )
  },
})

const billsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/bills',
  component: function BillsRoute() {
    const me = useMe()
    if (!me) return <Welcome context="Isi nama dulu supaya daftar bill kamu bisa dibuka." />
    return <Bills identityId={me.id} />
  },
})

const createBillRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/create',
  component: function CreateRoute() {
    const me = useMe()
    if (!me) return <Welcome context="Buat bill butuh nama dulu, biar teman tahu siapa yang menalangi." />
    return <Create identityId={me.id} />
  },
})

const billRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/b/$billId',
  component: function BillRoute() {
    const { billId } = billRoute.useParams()
    const me = useMe()
    return <BillDetail billId={billId} identityId={me?.id ?? null} />
  },
})

const editBillRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/b/$billId/edit',
  component: function EditBillRoute() {
    const { billId } = editBillRoute.useParams()
    const me = useMe()
    return <EditBill billId={billId} identityId={me?.id ?? null} />
  },
})

const recapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recap',
  component: function RecapRoute() {
    const me = useMe()
    if (!me) return <Welcome context="Isi nama dulu supaya rekap kamu bisa dihitung." />
    return <Recap identityId={me.id} />
  },
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: function SettingsRoute() {
    const me = useMe()
    if (!me) return <Welcome context="Isi nama dulu untuk membuka pengaturan." />
    return <Settings identity={me} />
  },
})

/* Halaman masuk harus bisa dibuka tanpa identitas — ini satu-satunya pintu
   untuk memakai akun lama di perangkat baru. */
const restoreRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/masuk',
  component: Restore,
})

const routeTree = rootRoute.addChildren([homeRoute, billsRoute, createBillRoute, billRoute, editBillRoute, recapRoute, settingsRoute, restoreRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
