import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'
import { startSession, useSession } from './lib/session'
import { BootScreen } from './components/BootScreen'
import { ToastProvider } from './components/Toast'
import './design-system.css'
import './app.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 } },
})

/**
 * Router baru dipasang setelah status sesi jelas. Kalau dipasang lebih dulu,
 * layar sempat memutuskan sendiri "belum ada identitas" lalu berkedip ke
 * pendaftaran meski orangnya sudah punya akun.
 */
function Boot() {
  const session = useSession()

  useEffect(() => {
    void startSession()
  }, [])

  if (session.status === 'checking') return <BootScreen />
  return <RouterProvider router={router} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Boot />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
