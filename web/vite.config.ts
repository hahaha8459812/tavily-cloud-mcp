import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 部署路径：由后端在 /admin 下托管
  base: '/admin/',
  server: {
    // 开发时代理 /api 到后端 MCP 服务（本地后端默认 8080）
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
})
