import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { config } from './config';
import { decryptSecret, encryptSecret, generateToken, hashPassword, sha256 } from './crypto';

/** 演示账号默认密码（仅用于迁移/初始化，不在生产使用） */
export const DEMO_PASSWORD = 'demo1234';

/**
 * 数据层（MySQL + mysql2）
 *
 * 两张表：
 * - sessions —— 会话元数据（id / 标题 / 时间）
 * - messages —— 会话内消息（LangChain 消息序列化后的通用存储，
 *               既是「前端展示」的数据源，也是「上下文记忆」的数据源）
 *
 * 注意：MySQL 是异步 IO，因此这里所有导出函数均为 async，
 *       调用方（server.ts / history.ts）需要 await。
 */

// 连接池（惰性建连：真正执行查询时才会连 MySQL，因此库不存在时也不会立刻报错）
export const pool: Pool = mysql.createPool({
  host: config.mysql.host,
  port: config.mysql.port,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
  waitForConnections: true,
  connectionLimit: config.mysql.connectionLimit,
  charset: 'utf8mb4',
  // 保证 BIGINT（时间戳）以 number 返回，而不是字符串
  supportBigNumbers: false,
  bigNumberStrings: false,
});

const DDL_SESSIONS = `
  CREATE TABLE IF NOT EXISTS sessions (
    id         VARCHAR(36)  NOT NULL,
    user_id    VARCHAR(36)  NOT NULL,
    title      VARCHAR(255) NOT NULL DEFAULT '新对话',
    created_at BIGINT       NOT NULL,
    updated_at BIGINT       NOT NULL,
    PRIMARY KEY (id),
    KEY idx_sessions_updated (updated_at),
    KEY idx_sessions_user (user_id, updated_at),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id)
      REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

// 用户表：账号 + 密码登录（不使用手机号），邮箱用于找回密码
const DDL_USERS = `
  CREATE TABLE IF NOT EXISTS users (
    id            VARCHAR(36)  NOT NULL,
    username      VARCHAR(50)  NOT NULL,
    email         VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    api_key       TEXT         NULL,                -- 用户自己的 DeepSeek Key（AES-256-GCM 加密）
    nickname      VARCHAR(50)  NOT NULL DEFAULT '',
    status        TINYINT      NOT NULL DEFAULT 1,
    created_at    BIGINT       NOT NULL,
    updated_at    BIGINT       NOT NULL,
    last_login_at BIGINT       NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_users_username (username),
    UNIQUE KEY uk_users_email (email)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

// 密码重置令牌表（库里只存 token 的哈希，明文仅返回给用户一次）
const DDL_RESETS = `
  CREATE TABLE IF NOT EXISTS password_resets (
    id         BIGINT       NOT NULL AUTO_INCREMENT,
    user_id    VARCHAR(36)  NOT NULL,
    token_hash VARCHAR(128) NOT NULL,
    expires_at BIGINT       NOT NULL,
    used_at    BIGINT       NULL,
    created_at BIGINT       NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_resets_token (token_hash),
    KEY idx_resets_user (user_id),
    CONSTRAINT fk_resets_user FOREIGN KEY (user_id)
      REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

const DDL_MESSAGES = `
  CREATE TABLE IF NOT EXISTS messages (
    id           BIGINT       NOT NULL AUTO_INCREMENT,
    session_id   VARCHAR(36)  NOT NULL,
    role         VARCHAR(16)  NOT NULL,
    content      LONGTEXT,
    \`name\`       VARCHAR(255) NULL,
    tool_calls   LONGTEXT,
    tool_call_id VARCHAR(255) NULL,
    created_at   BIGINT       NOT NULL,
    PRIMARY KEY (id),
    KEY idx_messages_session (session_id, id),
    CONSTRAINT fk_messages_session FOREIGN KEY (session_id)
      REFERENCES sessions (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

// 知识库文档表：用户上传的原始文件元数据（RAG 的「文档」层）
const DDL_DOCUMENTS = `
  CREATE TABLE IF NOT EXISTS documents (
    id          VARCHAR(36)  NOT NULL,
    user_id     VARCHAR(36)  NOT NULL,
    filename    VARCHAR(255) NOT NULL,
    mime        VARCHAR(128) NOT NULL DEFAULT '',
    size        BIGINT       NOT NULL DEFAULT 0,
    chunk_count INT          NOT NULL DEFAULT 0,
    status      VARCHAR(16)  NOT NULL DEFAULT 'ready',
    error       TEXT         NULL,
    created_at  BIGINT       NOT NULL,
    PRIMARY KEY (id),
    KEY idx_documents_user (user_id, created_at),
    CONSTRAINT fk_documents_user FOREIGN KEY (user_id)
      REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

// 文档分块表：把文档切成小片，作为检索的最小单元（RAG 的「切片」层）
const DDL_DOC_CHUNKS = `
  CREATE TABLE IF NOT EXISTS doc_chunks (
    id          BIGINT       NOT NULL AUTO_INCREMENT,
    document_id VARCHAR(36)  NOT NULL,
    user_id     VARCHAR(36)  NOT NULL,
    chunk_index INT          NOT NULL,
    content     TEXT         NOT NULL,
    created_at  BIGINT       NOT NULL,
    PRIMARY KEY (id),
    KEY idx_chunks_document (document_id, chunk_index),
    KEY idx_chunks_user (user_id),
    CONSTRAINT fk_chunks_document FOREIGN KEY (document_id)
      REFERENCES documents (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

/**
 * 初始化数据库：库不存在则创建 → 建表
 * 必须在启动 HTTP 服务前 await 调用（见 index.ts）
 */
export async function initDb(): Promise<void> {
  // 先用不带 database 的临时连接创建库（utf8mb4 支持 emoji 等 4 字节字符）
  const conn = await mysql.createConnection({
    host: config.mysql.host,
    port: config.mysql.port,
    user: config.mysql.user,
    password: config.mysql.password,
    charset: 'utf8mb4',
  });
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.mysql.database}\`
       DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
    );
  } finally {
    await conn.end();
  }

  await pool.query(DDL_USERS);
  await pool.query(DDL_RESETS);
  await pool.query(DDL_SESSIONS);
  await pool.query(DDL_MESSAGES);
  await pool.query(DDL_DOCUMENTS);
  await pool.query(DDL_DOC_CHUNKS);

  // 老库升级：sessions 早期版本没有 user_id，补列 + 回填到演示账号
  await migrateSessionsOwner();
  // 用户自填 API Key 的列
  if (!(await hasColumn('users', 'api_key'))) {
    await pool.query(`ALTER TABLE users ADD COLUMN api_key TEXT NULL AFTER password_hash`);
  }

  console.log(
    `[DB] MySQL 已就绪: ${config.mysql.user}@${config.mysql.host}:${config.mysql.port}/${config.mysql.database}`,
  );
}

/** 查询某表是否存在指定列 */
async function hasColumn(table: string, column: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [config.mysql.database, table, column],
  );
  return rows.length > 0;
}

/**
 * 迁移：给旧的 sessions 表补 user_id
 * - 新增列 + 索引 + 外键
 * - 已有会话全部挂到演示账号（demo）名下，避免登录后看不到历史
 */
async function migrateSessionsOwner(): Promise<void> {
  if (await hasColumn('sessions', 'user_id')) return;

  console.log('[DB] 检测到 sessions 缺少 user_id，开始迁移...');
  await pool.query(`ALTER TABLE sessions ADD COLUMN user_id VARCHAR(36) NULL AFTER id`);

  // 演示账号（不存在则创建），用于承接迁移前的历史会话
  const demoId = (await ensureDemoUser()).id;

  await pool.query('UPDATE sessions SET user_id = ? WHERE user_id IS NULL', [demoId]);
  try {
    await pool.query(`ALTER TABLE sessions MODIFY user_id VARCHAR(36) NOT NULL`);
    await pool.query(`ALTER TABLE sessions ADD KEY idx_sessions_user (user_id, updated_at)`);
    await pool.query(
      `ALTER TABLE sessions ADD CONSTRAINT fk_sessions_user FOREIGN KEY (user_id)
       REFERENCES users (id) ON DELETE CASCADE`,
    );
  } catch {
    // 键/约束可能已存在，忽略即可
  }
  console.log('[DB] sessions.user_id 迁移完成');
}

/** 优雅关闭连接池（进程退出时调用） */
export async function closeDb(): Promise<void> {
  await pool.end();
}

// ============ 类型 ============

export interface SessionRow {
  id: string;
  userId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

/** 用户行（对外不暴露 password_hash） */
export interface UserRow {
  id: string;
  username: string;
  email: string;
  nickname: string;
  status: number;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
}

/** 含密码哈希的用户行（仅内部校验用） */
export interface UserAuthRow extends UserRow {
  passwordHash: string;
}

/** 消息行：兼容 LangChain 各类型消息的通用存储 */
export interface MessageRow {
  id: number;
  sessionId: string;
  role: 'system' | 'human' | 'ai' | 'tool';
  content: string | null;
  name?: string | null;
  toolCalls?: string | null; // assistant 消息的 tool_calls（JSON 字符串）
  toolCallId?: string | null; // tool 消息对应的工具调用 id
  createdAt: number;
}

type SessionDbRow = RowDataPacket & {
  id: string;
  user_id: string;
  title: string;
  created_at: number;
  updated_at: number;
};

type UserDbRow = RowDataPacket & {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  nickname: string;
  status: number;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
};

type ResetDbRow = RowDataPacket & {
  id: number;
  user_id: string;
  expires_at: number;
  used_at: number | null;
};

function toUserRow(r: UserDbRow): UserRow {
  return {
    id: r.id,
    username: r.username,
    email: r.email,
    nickname: r.nickname,
    status: Number(r.status),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    lastLoginAt: r.last_login_at === null ? null : Number(r.last_login_at),
  };
}

function toUserAuthRow(r: UserDbRow): UserAuthRow {
  return { ...toUserRow(r), passwordHash: r.password_hash };
}

type MessageDbRow = RowDataPacket & {
  id: number;
  session_id: string;
  role: MessageRow['role'];
  content: string | null;
  name: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
  created_at: number;
};

// ============ 会话 CRUD ============

/** 新建会话（归属指定用户） */
export async function createSession(userId: string, title = '新对话'): Promise<SessionRow> {
  const now = Date.now();
  const id = randomUUID();
  await pool.query(
    `INSERT INTO sessions (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [id, userId, title, now, now],
  );
  return { id, userId, title, createdAt: now, updatedAt: now };
}

/** 某用户的会话列表（按最近活跃排序，数据按用户隔离） */
export async function listSessions(userId: string): Promise<SessionRow[]> {
  const [rows] = await pool.query<SessionDbRow[]>(
    `SELECT id, user_id, title, created_at, updated_at FROM sessions
     WHERE user_id = ? ORDER BY updated_at DESC`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    title: r.title,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }));
}

/** 按 id 查会话（传 userId 时校验归属） */
export async function getSession(id: string, userId?: string): Promise<SessionRow | undefined> {
  const [rows] = await pool.query<SessionDbRow[]>(
    `SELECT id, user_id, title, created_at, updated_at FROM sessions
     WHERE id = ? ${userId ? 'AND user_id = ?' : ''}`,
    userId ? [id, userId] : [id],
  );
  const r = rows[0];
  if (!r) return undefined;
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

/** 删除会话（校验归属；外键 ON DELETE CASCADE 会自动级联删除其消息） */
export async function deleteSession(id: string, userId: string): Promise<boolean> {
  const existed = (await getSession(id, userId)) !== undefined;
  if (!existed) return false;
  await pool.query(`DELETE FROM sessions WHERE id = ? AND user_id = ?`, [id, userId]);
  await pool.query(`DELETE FROM messages WHERE session_id = ?`, [id]);
  return true;
}

/** 仅删除某会话的消息（会话本身保留），供记忆历史 clear() 使用 */
export async function deleteMessagesBySession(sessionId: string): Promise<void> {
  await pool.query(`DELETE FROM messages WHERE session_id = ?`, [sessionId]);
}

/** 更新标题（一般用首条用户消息） */
export async function updateSessionTitle(id: string, title: string): Promise<void> {
  await pool.query(`UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?`, [
    title,
    Date.now(),
    id,
  ]);
}

/** 刷新活跃时间（每次对话后调用，让会话列表排序正确） */
export async function touchSession(id: string): Promise<void> {
  await pool.query(`UPDATE sessions SET updated_at = ? WHERE id = ?`, [Date.now(), id]);
}

// ============ 用户 CRUD ============

/** 新建用户；账号或邮箱已存在时抛出 code = 'DUPLICATE' */
export async function createUser(input: {
  username: string;
  email: string;
  passwordHash: string;
  nickname?: string;
}): Promise<UserRow> {
  const now = Date.now();
  const id = randomUUID();
  try {
    await pool.query(
      `INSERT INTO users (id, username, email, password_hash, nickname, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, input.username, input.email, input.passwordHash, input.nickname ?? input.username, now, now],
    );
  } catch (err: any) {
    // MySQL 唯一键冲突：1062
    if (err?.errno === 1062) {
      const e = new Error(
        String(err?.sqlMessage ?? '').includes('username') ? '账号已被注册' : '邮箱已被注册',
      );
      (e as any).code = 'DUPLICATE';
      throw e;
    }
    throw err;
  }
  return {
    id,
    username: input.username,
    email: input.email,
    nickname: input.nickname ?? input.username,
    status: 1,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
  };
}

/** 按账号查（含密码哈希，用于登录校验） */
export async function findUserByUsername(username: string): Promise<UserAuthRow | undefined> {
  const [rows] = await pool.query<UserDbRow[]>('SELECT * FROM users WHERE username = ?', [username]);
  return rows[0] ? toUserAuthRow(rows[0]) : undefined;
}

/** 按邮箱查（含密码哈希） */
export async function findUserByEmail(email: string): Promise<UserAuthRow | undefined> {
  const [rows] = await pool.query<UserDbRow[]>('SELECT * FROM users WHERE email = ?', [email]);
  return rows[0] ? toUserAuthRow(rows[0]) : undefined;
}

/** 按 id 查（不含密码哈希） */
export async function findUserById(id: string): Promise<UserRow | undefined> {
  const [rows] = await pool.query<UserDbRow[]>('SELECT * FROM users WHERE id = ?', [id]);
  return rows[0] ? toUserRow(rows[0]) : undefined;
}

/** 更新密码 */
export async function updateUserPassword(userId: string, passwordHash: string): Promise<void> {
  await pool.query('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [
    passwordHash,
    Date.now(),
    userId,
  ]);
}

/**
 * 读取用户的 DeepSeek API Key（解密后的明文，仅用于创建模型，不得外传）
 * 未设置 / 解密失败时返回 null
 */
export async function getUserApiKey(userId: string): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT api_key FROM users WHERE id = ?',
    [userId],
  );
  const raw = String(rows[0]?.api_key ?? '');
  if (!raw) return null;
  return decryptSecret(raw);
}

/** 保存用户的 API Key（存加密后的密文；传 null 清空） */
export async function setUserApiKey(userId: string, apiKey: string | null): Promise<void> {
  await pool.query('UPDATE users SET api_key = ?, updated_at = ? WHERE id = ?', [
    apiKey ? encryptSecret(apiKey) : null,
    Date.now(),
    userId,
  ]);
}

/** 记录登录时间 */
export async function touchUserLogin(userId: string): Promise<void> {
  await pool.query('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?', [
    Date.now(),
    Date.now(),
    userId,
  ]);
}

/** 确保演示账号存在（用于旧数据迁移与初始化），返回其用户行 */
export async function ensureDemoUser(): Promise<UserAuthRow> {
  const exist = await findUserByUsername('demo');
  if (exist) return exist;
  const now = Date.now();
  const id = randomUUID();
  const passwordHash = hashPassword(DEMO_PASSWORD);
  await pool.query(
    `INSERT INTO users (id, username, email, password_hash, nickname, status, created_at, updated_at)
     VALUES (?, 'demo', 'demo@example.com', ?, '演示账号', 1, ?, ?)`,
    [id, passwordHash, now, now],
  );
  return {
    id,
    username: 'demo',
    email: 'demo@example.com',
    nickname: '演示账号',
    status: 1,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    passwordHash,
  };
}

// ============ 密码重置令牌 ============

/** 创建重置令牌（库里只存哈希），返回明文令牌 */
export async function createPasswordReset(userId: string, ttlMs = 30 * 60 * 1000): Promise<string> {
  const token = generateToken();
  const tokenHash = sha256(token);
  const now = Date.now();
  // 同一用户只保留最新一枚有效令牌
  await pool.query('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL', [userId]);
  await pool.query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)`,
    [userId, tokenHash, now + ttlMs, now],
  );
  return token;
}

/** 校验令牌：存在 / 未使用 / 未过期，返回归属用户 id */
export async function findValidReset(token: string): Promise<string | undefined> {
  const [rows] = await pool.query<ResetDbRow[]>(
    'SELECT * FROM password_resets WHERE token_hash = ? LIMIT 1',
    [sha256(token)],
  );
  const r = rows[0];
  if (!r || r.used_at !== null || Number(r.expires_at) < Date.now()) return undefined;
  return r.user_id;
}

/** 令牌使用后作废 */
export async function markResetUsed(token: string): Promise<void> {
  await pool.query('UPDATE password_resets SET used_at = ? WHERE token_hash = ?', [
    Date.now(),
    sha256(token),
  ]);
}

// ============ 消息读写（供 MysqlChatHistory 使用） ============

export async function insertMessage(row: Omit<MessageRow, 'id' | 'createdAt'>): Promise<void> {
  await pool.query(
    `INSERT INTO messages (session_id, role, content, \`name\`, tool_calls, tool_call_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      row.sessionId,
      row.role,
      row.content,
      row.name ?? null,
      row.toolCalls ?? null,
      row.toolCallId ?? null,
      Date.now(),
    ],
  );
}

/** 按会话读取全部消息（按写入顺序） */
export async function getMessagesBySession(sessionId: string): Promise<MessageRow[]> {
  const [rows] = await pool.query<MessageDbRow[]>(
    `SELECT id, session_id, role, content, \`name\`, tool_calls, tool_call_id, created_at
     FROM messages WHERE session_id = ? ORDER BY id ASC`,
    [sessionId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    sessionId: r.session_id,
    role: r.role,
    content: r.content,
    name: r.name ?? null,
    toolCalls: r.tool_calls ?? null,
    toolCallId: r.tool_call_id ?? null,
    createdAt: Number(r.created_at),
  }));
}

// ============ 知识库（RAG）：文档 CRUD ============

/** 文档行（对外） */
export interface DocumentRow {
  id: string;
  userId: string;
  filename: string;
  mime: string;
  size: number;
  chunkCount: number;
  status: string; // ready | failed
  error: string | null;
  createdAt: number;
}

/** 分块行（检索单元） */
export interface ChunkRow {
  id: number;
  documentId: string;
  userId: string;
  chunkIndex: number;
  content: string;
  createdAt: number;
}

/** 带来源文件名的分块（检索结果用） */
export interface ChunkWithSource extends ChunkRow {
  filename: string;
}

type DocumentDbRow = RowDataPacket & {
  id: string;
  user_id: string;
  filename: string;
  mime: string;
  size: number;
  chunk_count: number;
  status: string;
  error: string | null;
  created_at: number;
};

type ChunkDbRow = RowDataPacket & {
  id: number;
  document_id: string;
  user_id: string;
  chunk_index: number;
  content: string;
  created_at: number;
};

function toDocumentRow(r: DocumentDbRow): DocumentRow {
  return {
    id: r.id,
    userId: r.user_id,
    filename: r.filename,
    mime: r.mime,
    size: Number(r.size),
    chunkCount: Number(r.chunk_count),
    status: r.status,
    error: r.error ?? null,
    createdAt: Number(r.created_at),
  };
}

/** 新建文档记录（先落库，解析/分块随后异步补齐） */
export async function createDocument(input: {
  userId: string;
  filename: string;
  mime: string;
  size: number;
  status?: string;
  error?: string | null;
}): Promise<DocumentRow> {
  const id = randomUUID();
  const now = Date.now();
  const status = input.status ?? 'ready';
  await pool.query(
    `INSERT INTO documents (id, user_id, filename, mime, size, chunk_count, status, error, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [id, input.userId, input.filename, input.mime, input.size, status, input.error ?? null, now],
  );
  return {
    id,
    userId: input.userId,
    filename: input.filename,
    mime: input.mime,
    size: input.size,
    chunkCount: 0,
    status,
    error: input.error ?? null,
    createdAt: now,
  };
}

/** 批量写入分块（事务，避免只写一半） */
export async function insertChunks(
  documentId: string,
  userId: string,
  contents: string[],
): Promise<void> {
  if (contents.length === 0) return;
  const now = Date.now();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (let i = 0; i < contents.length; i++) {
      await conn.query(
        `INSERT INTO doc_chunks (document_id, user_id, chunk_index, content, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [documentId, userId, i, contents[i], now],
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** 回填文档的解析结果（成功：chunkCount；失败：status=failed + error） */
export async function finalizeDocument(
  id: string,
  result: { chunkCount: number; status: string; error?: string | null },
): Promise<void> {
  await pool.query(`UPDATE documents SET chunk_count = ?, status = ?, error = ? WHERE id = ?`, [
    result.chunkCount,
    result.status,
    result.error ?? null,
    id,
  ]);
}

/** 某用户的知识库文档列表（最新在前） */
export async function listDocuments(userId: string): Promise<DocumentRow[]> {
  const [rows] = await pool.query<DocumentDbRow[]>(
    `SELECT id, user_id, filename, mime, size, chunk_count, status, error, created_at
     FROM documents WHERE user_id = ? ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(toDocumentRow);
}

/** 按 id 查文档（传 userId 时校验归属） */
export async function getDocument(id: string, userId?: string): Promise<DocumentRow | undefined> {
  const [rows] = await pool.query<DocumentDbRow[]>(
    `SELECT id, user_id, filename, mime, size, chunk_count, status, error, created_at
     FROM documents WHERE id = ? ${userId ? 'AND user_id = ?' : ''}`,
    userId ? [id, userId] : [id],
  );
  return rows[0] ? toDocumentRow(rows[0]) : undefined;
}

/** 删除文档（校验归属；外键级联删除其分块） */
export async function deleteDocument(id: string, userId: string): Promise<boolean> {
  if (!(await getDocument(id, userId))) return false;
  await pool.query(`DELETE FROM documents WHERE id = ? AND user_id = ?`, [id, userId]);
  return true;
}

/**
 * 取某用户的全部知识库分块（含来源文件名），供内存检索打分。
 * Demo 场景下数据量可控，直接一次性读回落库；limit 作为安全上限。
 */
export async function getChunksByUser(userId: string, limit = 3000): Promise<ChunkWithSource[]> {
  const [rows] = await pool.query<(ChunkDbRow & { filename: string })[]>(
    `SELECT c.id, c.document_id, c.user_id, c.chunk_index, c.content, c.created_at, d.filename
     FROM doc_chunks c
     JOIN documents d ON d.id = c.document_id
     WHERE c.user_id = ? AND d.status = 'ready'
     ORDER BY c.id ASC
     LIMIT ?`,
    [userId, limit],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    documentId: r.document_id,
    userId: r.user_id,
    chunkIndex: Number(r.chunk_index),
    content: r.content,
    createdAt: Number(r.created_at),
    filename: r.filename,
  }));
}
