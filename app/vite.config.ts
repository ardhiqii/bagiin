import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API = process.env.VITE_API_PROXY ?? 'http://127.0.0.1:8090'

export default defineConfig({
  plugins: [react()],
  server: { allowedHosts: ['.trycloudflare.com'], proxy: { '/api': { target: API, changeOrigin: true } } },
  preview: { proxy: { '/api': { target: API, changeOrigin: true } } },
})
