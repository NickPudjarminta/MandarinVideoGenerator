import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const APP_PATHS = new Set(['/hsk', '/grammar', '/scheduler'])

function spaAppRoutes() {
  return {
    name: 'spa-app-routes',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url?.split('?')[0] || ''
        if (APP_PATHS.has(url) || APP_PATHS.has(url.replace(/\/$/, ''))) {
          req.url = '/index.html'
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), spaAppRoutes()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'packages/shared'),
      '@hsk': path.resolve(__dirname, 'apps/hsk-generator/src'),
      '@grammar': path.resolve(__dirname, 'apps/grammar-generator/src'),
      '@scheduler': path.resolve(__dirname, 'apps/youtube-scheduler/src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        hsk: path.resolve(__dirname, 'apps/hsk-generator/index.html'),
        grammar: path.resolve(__dirname, 'apps/grammar-generator/index.html'),
        scheduler: path.resolve(__dirname, 'apps/youtube-scheduler/index.html'),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
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
