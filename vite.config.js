import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Large media in public/ can be locked by FFmpeg during render (EBUSY on watch)
    watch: {
      ignored: [
        '**/public/**/*.mp3',
        '**/public/**/*.png',
        '**/public/**/*.jpg',
        '**/public/**/*.jpeg',
        '**/output/**',
        '**/.tmp/**',
        '**/cache/**',
      ],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/output': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
})
