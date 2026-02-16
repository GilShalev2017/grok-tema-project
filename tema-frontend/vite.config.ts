import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  css: {
    postcss: './postcss.config.js',
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      // All requests starting with /api/ will be forwarded to backend
      '/api': {
        target: 'http://localhost:3000',      // your Express server
        changeOrigin: true,                   // changes origin header to match target
        secure: false,                        // for http → http
        rewrite: (path) => path.replace(/^\/api/, '/api'), // keep /api prefix (optional)
      },
    },
  },  
})
