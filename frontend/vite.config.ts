import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API = process.env.VITE_API_PROXY ?? 'http://127.0.0.1:8090'

export default defineConfig({
  plugins: [react()],
  // /uploads juga diproksi: tanpa ini thumbnail struk 404 di dev dan
  // kelihatan seperti foto rusak padahal backend menyajikannya normal.
  server: {
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/uploads': { target: API, changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/uploads': { target: API, changeOrigin: true },
    },
  },
})
