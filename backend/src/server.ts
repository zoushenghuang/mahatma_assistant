import http from 'node:http';
import { config } from './config';
import { runChat } from './agent';
import {
  createDocument,
  createSession,
  deleteDocument,
  deleteSession,
  finalizeDocument,
  getDisplayRows,
  getSession,
  getUserApiKey,
  insertChunks,
  listDocuments,
  listSessions,
  setUserApiKey,
  touchSession,
  truncateFromDisplayIndex,
  updateSessionTitle,
  type UserRow,
} from './db';
import { invalidateAgentCache } from './agent';
import { isApiKeyRequired } from './llm';
import { maskSecret } from './crypto';
import { chunkText, extractText } from './knowledge';
import {
  AuthError,
  getUserFromRequest,
  login,
  register,
  requestPasswordReset,
  resetPassword,
} from './auth';
import { getDisplayMessages } from './history';
import { friendlyErrorMessage } from './errors';
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
 * - POST   /api/sessions/:id/regenerate  重新生成（丢弃最后一条回答，用上一条用户消息重跑）
 * - POST   /api/sessions/:id/edit        编辑重发（body: { displayIndex, message }）
 * - GET    /api/documents                我的知识库文档列表
 * - POST   /api/documents                上传文档（body: { filename, mime, data(base64) }）
 * - DELETE /api/documents/:id            删除文档（级联删分块）
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

  // ===== 重新生成 / 编辑重发（都是「截断历史 + 重新流式」）=====

  // 重新生成：丢掉最后一条回答，用上一条用户消息重跑
  const regenMatch = url.pathname.match(/^\/api\/sessions\/([\w-]+)\/regenerate$/);
  if (req.method === 'POST' && regenMatch) {
    const sessionId = regenMatch[1];
    if (!(await getSession(sessionId, user!.id))) {
      sendJson(res, 404, { error: '会话不存在或无权限' });
      return;
    }
    const display = await getDisplayRows(sessionId);
    let lastUserIndex = -1;
    display.forEach((m, i) => {
      if (m.role === 'human') lastUserIndex = i;
    });
    if (lastUserIndex < 0) {
      sendJson(res, 400, { error: '还没有可重新生成的消息' });
      return;
    }
    // 截断该用户消息及其之后的所有消息（含回答与工具消息），再用原文重跑
    const removed = await truncateFromDisplayIndex(sessionId, lastUserIndex);
    await streamChat(req, res, user!, sessionId, removed!.content);
    return;
  }

  // 编辑重发：把某条用户消息改成新内容重跑（其后消息一并丢弃）
  const editMatch = url.pathname.match(/^\/api\/sessions\/([\w-]+)\/edit$/);
  if (req.method === 'POST' && editMatch) {
    const sessionId = editMatch[1];
    const body = await readJson(req).catch(() => ({}));
    const displayIndex = Number(body?.displayIndex);
    const message = String(body?.message ?? '').trim();

    if (!(await getSession(sessionId, user!.id))) {
      sendJson(res, 404, { error: '会话不存在或无权限' });
      return;
    }
    if (!Number.isInteger(displayIndex) || displayIndex < 0) {
      sendJson(res, 400, { error: '消息序号不合法' });
      return;
    }
    if (!message) {
      sendJson(res, 400, { error: '消息内容不能为空' });
      return;
    }
    // 只允许编辑「用户消息」，避免把助手的回答当成提问
    const display = await getDisplayRows(sessionId);
    const target = display[displayIndex];
    if (!target || target.role !== 'human') {
      sendJson(res, 400, { error: '只能编辑用户消息' });
      return;
    }
    await truncateFromDisplayIndex(sessionId, displayIndex);
    await streamChat(req, res, user!, sessionId, message);
    return;
  }

  // ===== 知识库（RAG）：文档上传 / 列表 / 删除 =====

  // 文档列表
  if (req.method === 'GET' && url.pathname === '/api/documents') {
    sendJson(res, 200, await listDocuments(user!.id));
    return;
  }

  // 上传文档：前端读文件为 base64，后端解码 → 解析文本 → 分块入库
  if (req.method === 'POST' && url.pathname === '/api/documents') {
    const body = await readJson(req, UPLOAD_MAX_BYTES);
    const doc = await handleUpload(user!, body);
    sendJson(res, 200, doc);
    return;
  }

  // 删除文档（级联删分块）
  const docMatch = url.pathname.match(/^\/api\/documents\/([\w-]+)$/);
  if (req.method === 'DELETE' && docMatch) {
    const ok = await deleteDocument(docMatch[1], user!.id);
    res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok }));
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
    res.write(`data: ${JSON.stringify({ type: 'error', message: msg, fatal: true })}\n\n`);
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

  await streamChat(req, res, user, sessionId, message.trim());
}

/**
 * 公共流式对话：建立 SSE → 跑 Agent → 收尾（标题 / 活跃时间）
 * 供「发送消息 / 重新生成 / 编辑重发」三条链路复用。
 */
async function streamChat(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  user: UserRow,
  sessionId: string,
  message: string,
) {
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
    await runChat(sessionId, message, emit, { signal: controller.signal, user });

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
      // 原始异常只写服务端日志；推给用户的是翻译后的友好文案
      console.error('[Server] 处理失败:', err?.message ?? err);
      if (!res.destroyed) emit({ type: 'error', message: friendlyErrorMessage(err), fatal: true });
    }
  } finally {
    res.end();
  }
}

/**
 * 读取 JSON 请求体
 * @param maxBytes 体积上限：普通接口 1MB；文档上传（base64 后）放宽到 20MB
 */
function readJson(req: http.IncomingMessage, maxBytes = 1e6): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return; // 已判定超限，丢弃后续数据，等待 end
      data += chunk;
      if (data.length > maxBytes) {
        tooLarge = true;
        data = '';
      }
    });
    req.on('end', () => {
      if (tooLarge) {
        reject(new Error(`文件过大，请求体不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB`));
        return;
      }
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

// ===== 知识库上传 =====

const UPLOAD_MAX_BYTES = 20 * 1024 * 1024; // 请求体上限（base64 编码后，约对应 8MB 原文件）
const FILE_MAX_BYTES = 8 * 1024 * 1024; // 单文件原始大小上限

/**
 * 处理文档上传：先落库记录，再解析 / 分块 / 回填状态。
 * 解析失败也返回 200 + status='failed'，让前端展示失败原因，而不是整请求报错。
 */
async function handleUpload(user: UserRow, body: any) {
  const filename = String(body?.filename ?? '').trim();
  const mime = String(body?.mime ?? '').trim();
  const data = String(body?.data ?? '');

  if (!filename) throw new AuthError('缺少文件名');
  if (!data) throw new AuthError('文件内容为空');

  const buffer = Buffer.from(data, 'base64');
  if (buffer.length === 0) throw new AuthError('文件内容解析失败，请重试');
  if (buffer.length > FILE_MAX_BYTES) {
    throw new AuthError(`文件过大，请上传 ${FILE_MAX_BYTES / 1024 / 1024}MB 以内的文件`);
  }

  // 先落一条记录（状态 pending），再异步解析，便于失败时保留可读的错误信息
  const doc = await createDocument({
    userId: user.id,
    filename,
    mime,
    size: buffer.length,
    status: 'pending',
  });

  try {
    const text = await extractText(filename, mime, buffer);
    const chunks = chunkText(text);
    if (chunks.length === 0) throw new Error('未能从文件中解析出文本内容（可能是空文件或扫描件）');

    await insertChunks(doc.id, user.id, chunks);
    await finalizeDocument(doc.id, { chunkCount: chunks.length, status: 'ready' });
    console.log(`[知识库] 用户 ${user.username} 上传《${filename}》，切分为 ${chunks.length} 块`);
    return { ...doc, chunkCount: chunks.length, status: 'ready', error: null };
  } catch (err: any) {
    const message = err?.message ?? '解析失败';
    console.error(`[知识库] 解析《${filename}》失败: ${message}`);
    await finalizeDocument(doc.id, { chunkCount: 0, status: 'failed', error: message });
    return { ...doc, chunkCount: 0, status: 'failed', error: message };
  }
}
