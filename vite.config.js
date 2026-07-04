import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:4100',
      '/socket.io': {
        target: 'http://127.0.0.1:4100',
        ws: true,
      },
    },
  },
})
