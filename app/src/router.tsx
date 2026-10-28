import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { Home } from './screens/Home'
import { Create } from './screens/Create'
import { BillDetail } from './screens/BillDetail'
import { EditBill } from './screens/EditBill'
import { Recap } from './screens/Recap'
import { Settings } from './screens/Settings'
import { useIdentity } from './lib/identity'
import { useSession } from './lib/session'
import { RequireIdentity } from './components/RequireIdentity'
import { Welcome } from './screens/Welcome'
import { Restore } from './screens/Restore'
import { NotFound } from './screens/NotFound'

/* Alamat tak dikenal tetap harus terlihat seperti aplikasi ini, bukan halaman
   "Not Found" polos tanpa navigasi. */
const rootRoute = createRootRoute({ notFoundComponent: NotFound })

function useMe() {
  return useIdentity()
}

/* Beranda: tanpa identitas, layar ini sendiri yang jadi pintu pendaftaran. */
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: function HomeRoute() {
    const me = useMe()
    const session = useSession()
    if (!me) return <Welcome expired={session.status === 'expired'} />
    return <Home identityId={me.id} name={me.name} />
  },
})

/* Daftar bill sekarang jadi satu dengan beranda. Alamat lama tetap hidup supaya
   link yang sudah tersebar tidak jadi 404. */
const billsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/bills',
  beforeLoad: () => {
    throw redirect({ to: '/' })
  },
})

const createBillRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/create',
  component: function CreateRoute() {
    return (
      <RequireIdentity>
        {(me) => <Create identityId={me.id} />}
      </RequireIdentity>
    )
  },
})

/* Layar bill sengaja tidak dijaga: penerima link belum tentu punya identitas. */
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
    return (
      <RequireIdentity>
        {(me) => <EditBill billId={billId} identityId={me.id} />}
      </RequireIdentity>
    )
  },
})

const recapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recap',
  component: function RecapRoute() {
    return (
      <RequireIdentity>
        {(me) => <Recap identityId={me.id} />}
      </RequireIdentity>
    )
  },
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: function SettingsRoute() {
    return (
      <RequireIdentity>
        {(me) => <Settings identity={me} />}
      </RequireIdentity>
    )
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
