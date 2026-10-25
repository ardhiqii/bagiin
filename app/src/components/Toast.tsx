import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

type ToastApi = (message: string) => void
const ToastContext = createContext<ToastApi>(() => {})

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('')
  const [visible, setVisible] = useState(false)
  const timer = useRef<number | null>(null)

  const show = useCallback((next: string) => {
    setMessage(next)
    setVisible(true)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setVisible(false), 2600)
  }, [])

  const value = useMemo(() => show, [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={'app-toast' + (visible ? ' show' : '')} role="status" aria-live="polite">
        {message}
      </div>
    </ToastContext.Provider>
  )
}
