import { API_BASE } from '@/shared/config/env';
import type { SseEvent } from './types';

/**
 * HTTP 客户端基础设施
 *
 * - Token 存取与统一 401 处理
 * - JSON 请求 / 二进制请求 / SSE 流式解析
 * 业务 API 见同目录下的 auth / sessions / documents / chat 模块。
 */

const TOKEN_KEY = 'dasheng_token';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** 注册「登录失效」回调：App 收到后回到登录页 */
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void): void {
  unauthorizedHandler = fn;
}

/** 拼接完整 API 地址 */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

function authHeaders(base?: HeadersInit): Record<string, string> {
  const headers: Record<string, string> = { ...(base as Record<string, string> | undefined) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** 登录失效统一处理 */
function onUnauthorized(): never {
  clearToken();
  unauthorizedHandler?.();
  throw new Error('登录已失效，请重新登录');
}

/** 统一取错误文案（后端 { error } 优先） */
export async function readError(resp: Response): Promise<string> {
  try {
    const data = await resp.json();
    if (data?.error) return data.error;
  } catch {
    // 忽略非 JSON 响应
  }
  return `HTTP ${resp.status}`;
}

/** 带鉴权的 JSON 请求 */
export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(apiUrl(path), {
    ...init,
    headers: authHeaders(init?.headers),
  });
  if (resp.status === 401) onUnauthorized();
  if (!resp.ok) throw new Error(await readError(resp));
  return resp.json() as Promise<T>;
}

/** POST JSON */
export function post<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

/**
 * 带鉴权的二进制请求（原文件 / 全文下载）。
 * 浏览器无法给 <iframe> 直接加 Authorization 头，因此统一走 fetch → Blob / 文本。
 */
export async function authedFetch(path: string): Promise<Response> {
  const resp = await fetch(apiUrl(path), { headers: authHeaders() });
  if (resp.status === 401) onUnauthorized();
  if (!resp.ok) throw new Error(await readError(resp));
  return resp;
}

/**
 * 通用 SSE 流式请求：
 * 用 fetch + ReadableStream 逐行解析 "data: {json}" 事件，
 * 替代 EventSource（EventSource 只支持 GET）。
 */
export async function streamSse(
  path: string,
  body: unknown,
  onEvent: (e: SseEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const resp = await fetch(apiUrl(path), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body ?? {}),
    signal,
  });
  if (resp.status === 401) onUnauthorized();
  if (!resp.ok || !resp.body) throw new Error(await readError(resp));

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE 事件以空行分隔，每行 "data: {json}"
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const part of parts) {
      for (const line of part.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          onEvent(JSON.parse(line.slice(6)) as SseEvent);
        } catch {
          // 忽略无法解析的行
        }
      }
    }
  }
}
