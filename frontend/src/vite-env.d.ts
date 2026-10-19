/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 后端 API 前缀；默认 /api（开发环境由 Vite 代理） */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
