import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { Home } from './screens/Home'
import { Bills } from './screens/Bills'
import { Create } from './screens/Create'
import { BillDetail } from './screens/BillDetail'
import { Recap } from './screens/Recap'
import { Settings } from './screens/Settings'
import { renameIdentity, useIdentity } from './lib/identity'

const rootRoute = createRootRoute()

function useMe() {
  return useIdentity()
}

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: function HomeRoute() {
    const me = useMe()
    return (
      <Home
        identityId={me?.id ?? null}
        name={me?.name ?? ''}
        onRenamed={async (next) => {
          if (!me) return
          await renameIdentity(me, next)
        }}
      />
    )
  },
})

const billsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/bills',
  component: function BillsRoute() {
    const me = useMe()
    return <Bills identityId={me?.id ?? null} />
  },
})

const createBillRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/create',
  component: function CreateRoute() {
    const me = useMe()
    return <Create identityId={me?.id ?? null} />
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

const recapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recap',
  component: function RecapRoute() {
    const me = useMe()
    return <Recap identityId={me?.id ?? null} />
  },
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: function SettingsRoute() {
    const me = useMe()
    return <Settings identity={me} onIdentity={() => {}} />
  },
})

const routeTree = rootRoute.addChildren([homeRoute, billsRoute, createBillRoute, billRoute, recapRoute, settingsRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
