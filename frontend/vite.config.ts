import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发服务器配置：端口 5173，/api 请求代理到后端 3001。
// 关键点：EventSource 通过同源代理访问后端，天然无跨域问题
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
