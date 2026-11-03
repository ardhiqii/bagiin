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
  defaultOptions: {
    queries: {
      // Data uang boleh berumur pendek, tapi tidak perlu ditahan selamanya:
      // 15 detik cukup untuk berpindah layar tanpa permintaan ulang, dan
      // mutasi tetap menyapu tampilan uang lewat `invalidateMoneyViews`.
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      // 4xx bukan gangguan sementara. Mengulanginya cuma menambah permintaan
      // yang pasti gagal — 403 sesi basi dan 404 bill terhapus paling sering.
      retry: (count, error) => {
        const status = (error as { status?: number }).status
        if (status && status >= 400 && status < 500) return false
        return count < 1
      },
    },
  },
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
