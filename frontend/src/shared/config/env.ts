/**
 * 运行时配置
 *
 * 开发环境走 Vite 的 /api 代理；生产环境可通过 VITE_API_BASE 指向 API 网关。
 */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/+$/, '');
