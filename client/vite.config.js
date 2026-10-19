import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
  server: {
    port: 5174,
    proxy: {
      '/socket.io': { target: 'http://localhost:8790', ws: true },
      '/api': 'http://localhost:8790',
    },
  },
  build: {
    outDir: '../docs',
    emptyOutDir: true,
  },
})
