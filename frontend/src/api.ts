// 后端 API 封装（用户鉴权 + 会话管理 + SSE 流式对话）

export interface Session {
  id: string;
  userId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface DisplayMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  nickname: string;
  status: number;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
}

export interface AuthResult {
  token: string;
  user: User;
}

/** 我的 API Key 状态（后端只回脱敏值） */
export interface ApiKeyStatus {
  hasKey: boolean;
  masked: string | null;
  required: boolean;
}

/** 知识库文档（RAG 数据源） */
export interface KnowledgeDoc {
  id: string;
  userId: string;
  filename: string;
  mime: string;
  size: number;
  chunkCount: number;
  status: 'pending' | 'ready' | 'failed';
  error: string | null;
  createdAt: number;
}

// 后端通过 SSE 推送的事件
export type SseEvent =
  | { type: 'content'; text: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string; result: string }
  | { type: 'done' }
  // message 已是面向用户的友好文案；fatal 为 false 时仅工具失败（对话继续）
  | { type: 'error'; message: string; fatal?: boolean };

const BASE = '/api';
const TOKEN_KEY = 'dasheng_token';

// ============ 登录态（token 存 localStorage）============

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

function authHeaders(base?: HeadersInit): Record<string, string> {
  const headers: Record<string, string> = { ...(base as Record<string, string> | undefined) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** 统一取错误文案（后端 { error } 优先） */
async function readError(resp: Response): Promise<string> {
  try {
    const data = await resp.json();
    if (data?.error) return data.error;
  } catch {
    // 忽略非 JSON 响应
  }
  return `HTTP ${resp.status}`;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, { ...init, headers: authHeaders(init?.headers) });
  if (resp.status === 401) {
    clearToken();
    unauthorizedHandler?.();
    throw new Error('登录已失效，请重新登录');
  }
  if (!resp.ok) throw new Error(await readError(resp));
  return resp.json();
}

function post<T>(url: string, body: unknown): Promise<T> {
  return json<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

export const api = {
  // ===== 用户模块 =====

  /** 注册（注册成功即登录） */
  register: (input: { username: string; password: string; email: string; nickname?: string }) =>
    post<AuthResult>(`${BASE}/auth/register`, input),

  /** 登录（账号 + 密码） */
  login: (input: { username: string; password: string }) =>
    post<AuthResult>(`${BASE}/auth/login`, input),

  /** 当前登录用户 */
  me: () => json<{ user: User }>(`${BASE}/auth/me`).then((r) => r.user),

  /** 忘记密码：账号 + 预留邮箱 → 重置令牌（演示环境直接返回） */
  forgotPassword: (input: { username: string; email: string }) =>
    post<{ resetToken: string; email: string }>(`${BASE}/auth/forgot-password`, input),

  /** 用重置令牌设置新密码 */
  resetPassword: (input: { token: string; password: string }) =>
    post<{ username: string }>(`${BASE}/auth/reset-password`, input),

  // ===== 我的 API Key（每个用户用自己的 Key，服务端不代持）=====

  getApiKey: () => json<ApiKeyStatus>(`${BASE}/user/api-key`),

  saveApiKey: (apiKey: string) =>
    json<ApiKeyStatus>(`${BASE}/user/api-key`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    }),

  deleteApiKey: () => json<ApiKeyStatus>(`${BASE}/user/api-key`, { method: 'DELETE' }),

  // ===== 会话管理（均需登录，数据按用户隔离）=====

  /** 会话列表（按最近活跃排序） */
  listSessions: () => json<Session[]>(`${BASE}/sessions`),

  /** 新建会话 */
  createSession: () => post<Session>(`${BASE}/sessions`, {}),

  /** 删除会话（级联删除消息） */
  deleteSession: (id: string) => json<{ ok: boolean }>(`${BASE}/sessions/${id}`, { method: 'DELETE' }),

  /** 加载会话历史（切换会话时展示） */
  getMessages: (id: string) => json<DisplayMessage[]>(`${BASE}/sessions/${id}/messages`),

  // ===== 知识库（RAG）：上传 / 列表 / 删除（数据按用户隔离）=====

  /** 我的知识库文档列表 */
  listDocuments: () => json<KnowledgeDoc[]>(`${BASE}/documents`),

  /** 上传文档（前端把文件读成 base64 后随 JSON 提交） */
  uploadDocument: (input: { filename: string; mime: string; data: string }) =>
    post<KnowledgeDoc>(`${BASE}/documents`, input),

  /** 删除文档（级联删除其分块） */
  deleteDocument: (id: string) =>
    json<{ ok: boolean }>(`${BASE}/documents/${id}`, { method: 'DELETE' }),

  /**
   * 流式对话（POST + SSE）：
   * 用 fetch + ReadableStream 逐行解析 "data: {json}" 事件，
   * 替代 EventSource（EventSource 只支持 GET）
   */
  async chatSSE(
    sessionId: string,
    message: string,
    onEvent: (e: SseEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const resp = await fetch(`${BASE}/chat`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ sessionId, message }),
      signal,
    });
    if (resp.status === 401) {
      clearToken();
      unauthorizedHandler?.();
      throw new Error('登录已失效，请重新登录');
    }
    if (!resp.ok || !resp.body) {
      throw new Error(await readError(resp));
    }

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
            const data = JSON.parse(line.slice(6)) as SseEvent;
            onEvent(data);
          } catch {
            // 忽略无法解析的行
          }
        }
      }
    }
  },
};
