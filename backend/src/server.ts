import http from 'node:http';
import { config } from './config';
import { runChat } from './agent';
import {
  createSession,
  deleteSession,
  getSession,
  getUserApiKey,
  listSessions,
  setUserApiKey,
  touchSession,
  updateSessionTitle,
  type UserRow,
} from './db';
import { invalidateAgentCache } from './agent';
import { isApiKeyRequired } from './llm';
import { maskSecret } from './crypto';
import {
  AuthError,
  getUserFromRequest,
  login,
  register,
  requestPasswordReset,
  resetPassword,
} from './auth';
import { getDisplayMessages } from './history';
import type { AgentEvent } from './types';

/**
 * HTTP 服务（Node 原生 http，不引入框架）
 *
 * 公开接口（无需登录）：
 * - GET    /api/health                   健康检查
 * - POST   /api/auth/register            注册（账号 + 邮箱 + 密码）
 * - POST   /api/auth/login               登录（账号 + 密码）
 * - POST   /api/auth/forgot-password     忘记密码（账号 + 邮箱 → 重置令牌）
 * - POST   /api/auth/reset-password      重置密码（令牌 + 新密码）
 *
 * 需登录接口（Authorization: Bearer <token>，数据按用户隔离）：
 * - GET    /api/auth/me                  当前登录用户
 * - GET    /api/user/api-key             我的 Key 状态（是否必填 + 脱敏展示）
 * - PUT    /api/user/api-key             保存我的 Key（加密落库）
 * - DELETE /api/user/api-key             删除我的 Key
 * - GET    /api/sessions                 我的会话列表
 * - POST   /api/sessions                 新建会话
 * - DELETE /api/sessions/:id             删除会话（级联删消息）
 * - GET    /api/sessions/:id/messages    会话消息（前端切换会话时加载）
 * - POST   /api/chat                     对话 SSE（body: { sessionId, message }）
 */

export function startServer() {
  const server = http.createServer((req, res) => {
    // 统一兜底：MySQL 是异步 IO，查询失败不能变成未捕获的 Promise rejection
    handleRequest(req, res).catch((err: any) => {
      // 业务校验错误（账号已存在 / 密码错误等）用对应状态码返回，不算服务端异常
      if (err instanceof AuthError) {
        console.warn(`[Server] 鉴权失败: ${err.message}`);
        if (!res.writableEnded) sendJson(res, err.status, { error: err.message });
        return;
      }
      console.error('[Server] 请求处理失败:', err?.message ?? err);
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: err?.message ?? '服务器内部错误' }));
      }
    });
  });

  server.listen(config.port, () => {
    console.log(`[Server] 后端已启动: http://localhost:${config.port}`);
  });
}

/** 我的 Key 状态：只回脱敏值，明文永不下发 */
async function apiKeyStatus(user: UserRow): Promise<{
  hasKey: boolean;
  masked: string | null;
  required: boolean;
}> {
  const key = await getUserApiKey(user.id);
  return { hasKey: Boolean(key), masked: key ? maskSecret(key) : null, required: isApiKeyRequired() };
}

/** 统一 JSON 响应 */
function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  // 客户端断开后 res 可能触发 error，吞掉避免进程崩溃
  res.on('error', () => {});

  // CORS（前端 dev server 跨端口访问 + POST JSON 预检）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ===== 用户模块（公开接口）=====

  if (req.method === 'POST' && url.pathname === '/api/auth/register') {
    const body = await readJson(req).catch(() => ({}));
    const result = await register(body);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await readJson(req).catch(() => ({}));
    const result = await login(body);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/forgot-password') {
    const body = await readJson(req).catch(() => ({}));
    const result = await requestPasswordReset(body);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/reset-password') {
    const body = await readJson(req).catch(() => ({}));
    const result = await resetPassword(body);
    sendJson(res, 200, result);
    return;
  }

  // ===== 以下接口均需登录 =====

  const user = await getUserFromRequest(req);
  if (!user && url.pathname.startsWith('/api/') && url.pathname !== '/api/health') {
    sendJson(res, 401, { error: '请先登录' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    sendJson(res, 200, { user });
    return;
  }

  // ===== 我的 API Key =====

  if (url.pathname === '/api/user/api-key') {
    if (req.method === 'GET') {
      sendJson(res, 200, await apiKeyStatus(user!));
      return;
    }
    if (req.method === 'PUT') {
      const body = await readJson(req).catch(() => ({}));
      const apiKey = String(body?.apiKey ?? '').trim();
      if (!apiKey) throw new AuthError('API Key 不能为空');
      if (apiKey.length > 200) throw new AuthError('API Key 长度异常，请检查是否复制正确');
      await setUserApiKey(user!.id, apiKey);
      invalidateAgentCache(user!.id); // 换 Key 后立刻生效
      sendJson(res, 200, await apiKeyStatus(user!));
      return;
    }
    if (req.method === 'DELETE') {
      await setUserApiKey(user!.id, null);
      invalidateAgentCache(user!.id);
      sendJson(res, 200, await apiKeyStatus(user!));
      return;
    }
  }

  // ===== 会话管理（数据按 user_id 隔离）=====

  // 会话列表
  if (req.method === 'GET' && url.pathname === '/api/sessions') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(await listSessions(user!.id)));
    return;
  }

  // 新建会话
  if (req.method === 'POST' && url.pathname === '/api/sessions') {
    const body = await readJson(req).catch(() => ({}));
    const session = await createSession(user!.id, body?.title);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(session));
    return;
  }

  // 删除会话
  const delMatch = url.pathname.match(/^\/api\/sessions\/([\w-]+)$/);
  if (req.method === 'DELETE' && delMatch) {
    const ok = await deleteSession(delMatch[1], user!.id);
    res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok }));
    return;
  }

  // 会话消息（切换会话时加载历史）
  const msgMatch = url.pathname.match(/^\/api\/sessions\/([\w-]+)\/messages$/);
  if (req.method === 'GET' && msgMatch) {
    const session = await getSession(msgMatch[1], user!.id);
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '会话不存在' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(await getDisplayMessages(msgMatch[1])));
    return;
  }

  // ===== 对话 SSE =====
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    await handleChat(req, res, user!);
    return;
  }

  // 健康检查
  if (req.method === 'GET' && url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
}

async function handleChat(req: http.IncomingMessage, res: http.ServerResponse, user: UserRow) {
  const body = await readJson(req).catch(() => ({}));
  const sessionId: string = body?.sessionId ?? '';
  const message: string = body?.message ?? '';

  const fail = (msg: string) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
    res.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
    res.end();
  };

  if (!sessionId || !message.trim()) {
    fail('缺少 sessionId 或 message');
    return;
  }
  // 校验会话归属：越权访问别人的会话直接拒绝
  if (!(await getSession(sessionId, user.id))) {
    fail('会话不存在或无权限');
    return;
  }

  // SSE 响应头（关键节点：SSE —— 告诉浏览器这是事件流，不要缓冲）
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  // 客户端断开时中止上游请求，避免资源浪费
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  const emit = (data: AgentEvent) => {
    if (res.destroyed) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // 对话前消息数（0 = 新会话：首条消息用于生成会话标题）
    const beforeCount = (await getDisplayMessages(sessionId)).length;

    // 关键节点：LangChain —— 进入带记忆的 Agent 流式对话
    await runChat(sessionId, message.trim(), emit, { signal: controller.signal, user });

    // 新会话的首条消息 → 用消息内容生成标题（列表页可读性）
    if (beforeCount === 0) {
      await updateSessionTitle(sessionId, makeTitle(message));
    }
    await touchSession(sessionId);

    if (!res.destroyed) emit({ type: 'done' });
  } catch (err: any) {
    if (controller.signal.aborted) {
      console.log('[Server] 客户端已断开，中止请求');
    } else {
      console.error('[Server] 处理失败:', err?.message ?? err);
      if (!res.destroyed) emit({ type: 'error', message: err?.message ?? String(err) });
    }
  } finally {
    res.end();
  }
}

/** 读取 JSON 请求体 */
function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy(); // 1MB 上限
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** 生成会话标题：取首条消息前 20 字 */
function makeTitle(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 20 ? `${t.slice(0, 20)}…` : t || '新对话';
}
