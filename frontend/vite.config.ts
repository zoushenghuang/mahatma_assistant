import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发服务器配置：端口 5173，/api 请求代理到后端 3001。
// 关键点：SSE 通过同源代理访问后端，天然无跨域问题。
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    // antd 体积较大，单独成 chunk，避免每次业务代码变更都让用户重新下载
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          antd: ['antd'],
          markdown: ['react-markdown', 'remark-gfm', 'rehype-highlight', 'highlight.js'],
        },
      },
    },
  },
});
