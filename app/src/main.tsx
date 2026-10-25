import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'
import { ensureIdentity, loadStored, publishIdentity } from './lib/identity'
import { ToastProvider } from './components/Toast'
import './design-system.css'
import './app.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 } },
})

function Boot() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const stored = loadStored()
      if (stored) publishIdentity(stored)
      try {
        const identity = await ensureIdentity(stored?.name)
        if (alive) publishIdentity(identity)
      } catch {
        /* gagal membuat identitas — layar tetap tampil dan aksi akan memberi tahu */
      } finally {
        if (alive) setReady(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  if (!ready) {
    return (
      <div className="app-shell">
        <div className="app-frame">
          <main className="app-body">Menyiapkan Bagiin…</main>
        </div>
      </div>
    )
  }
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
