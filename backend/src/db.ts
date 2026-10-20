import mysql, { type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';
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
    text_content LONGTEXT    NULL,                -- 解析后的全文（供在线预览 / 全文搜索）
    text_length  INT         NOT NULL DEFAULT 0,  -- 全文字符数（列表展示用，避免读 LONGTEXT）
    storage_key  VARCHAR(255) NULL,               -- 原始文件在 uploads 目录下的文件名
    embedding_model  VARCHAR(64) NULL,            -- 向量模型（null = 未建立向量索引）
    embedding_dim    INT         NOT NULL DEFAULT 0,
    embedded_chunks  INT         NOT NULL DEFAULT 0, -- 已向量化的切片数
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
    embedding   MEDIUMBLOB   NULL,               -- Float32 小端向量
    embedding_model VARCHAR(64) NULL,
    embedding_dim   INT         NOT NULL DEFAULT 0,
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
  // 知识库预览：早期只存切片，补上全文 / 原文件字段（老文档仍可按切片回退预览）
  await migrateDocumentsPreview();
  // 向量知识库：补上 embedding 相关字段（老数据需在界面上重建索引）
  await migrateDocumentsVector();

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

/**
 * 迁移：documents 增加全文预览相关列
 * - text_content：解析后的纯文本（在线预览 / 全文搜索）
 * - text_length：字符数（列表展示，避免每次读 LONGTEXT）
 * - storage_key：原始文件在 uploads 目录下的文件名
 */
async function migrateDocumentsPreview(): Promise<void> {
  if (!(await hasColumn('documents', 'text_content'))) {
    await pool.query(`ALTER TABLE documents ADD COLUMN text_content LONGTEXT NULL AFTER error`);
  }
  if (!(await hasColumn('documents', 'text_length'))) {
    await pool.query(`ALTER TABLE documents ADD COLUMN text_length INT NOT NULL DEFAULT 0 AFTER text_content`);
  }
  if (!(await hasColumn('documents', 'storage_key'))) {
    await pool.query(`ALTER TABLE documents ADD COLUMN storage_key VARCHAR(255) NULL AFTER text_length`);
  }
}

/**
 * 迁移：向量知识库字段
 * - doc_chunks.embedding：Float32 小端向量（MEDIUMBLOB）
 * - documents.embedding_*：文档级索引状态（用于列表展示与重建）
 */
async function migrateDocumentsVector(): Promise<void> {
  if (!(await hasColumn('doc_chunks', 'embedding'))) {
    await pool.query(`ALTER TABLE doc_chunks ADD COLUMN embedding MEDIUMBLOB NULL AFTER content`);
  }
  if (!(await hasColumn('doc_chunks', 'embedding_model'))) {
    await pool.query(
      `ALTER TABLE doc_chunks ADD COLUMN embedding_model VARCHAR(64) NULL AFTER embedding`,
    );
  }
  if (!(await hasColumn('doc_chunks', 'embedding_dim'))) {
    await pool.query(
      `ALTER TABLE doc_chunks ADD COLUMN embedding_dim INT NOT NULL DEFAULT 0 AFTER embedding_model`,
    );
  }
  if (!(await hasColumn('documents', 'embedding_model'))) {
    await pool.query(
      `ALTER TABLE documents ADD COLUMN embedding_model VARCHAR(64) NULL AFTER storage_key`,
    );
  }
  if (!(await hasColumn('documents', 'embedding_dim'))) {
    await pool.query(
      `ALTER TABLE documents ADD COLUMN embedding_dim INT NOT NULL DEFAULT 0 AFTER embedding_model`,
    );
  }
  if (!(await hasColumn('documents', 'embedded_chunks'))) {
    await pool.query(
      `ALTER TABLE documents ADD COLUMN embedded_chunks INT NOT NULL DEFAULT 0 AFTER embedding_dim`,
    );
  }
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

// ============ 消息截断（供「重新生成 / 编辑重发」使用）============

/** 展示用消息：只含 user/assistant 的纯文本，与前端消息列表一一对应，并带原始行 id */
export interface DisplayRow {
  id: number;
  role: 'human' | 'ai';
  content: string;
}

/** 取展示用消息（带 id），顺序与前端一致 */
export async function getDisplayRows(sessionId: string): Promise<DisplayRow[]> {
  const rows = await getMessagesBySession(sessionId);
  return rows
    .filter((m) => (m.role === 'human' || m.role === 'ai') && m.content)
    .map((m) => ({ id: m.id, role: m.role as 'human' | 'ai', content: m.content as string }));
}

/**
 * 从第 displayIndex 条展示消息开始截断（含自身）：删除它及其之后的全部消息
 * （连带 tool 消息），用于重新生成 / 编辑重发。
 *
 * 依赖 messages.id 自增有序，因此 `id >= 目标行 id` 即「该条及之后」。
 * @returns 被删除的那条展示消息（调用方据此拿到原文重发），越界时返回 undefined
 */
export async function truncateFromDisplayIndex(
  sessionId: string,
  displayIndex: number,
): Promise<DisplayRow | undefined> {
  const display = await getDisplayRows(sessionId);
  const target = display[displayIndex];
  if (!target) return undefined;
  await pool.query(`DELETE FROM messages WHERE session_id = ? AND id >= ?`, [sessionId, target.id]);
  return target;
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
  textLength: number;
  /** 原始文件在 uploads 目录下的文件名（null = 早期文档，未保留原文件） */
  storageKey: string | null;
  /** 向量模型（null = 尚未建立向量索引，只能关键词检索） */
  embeddingModel: string | null;
  embeddingDim: number;
  /** 已向量化的切片数 */
  embeddedChunks: number;
  createdAt: number;
}

/** 分块行（检索单元） */
export interface ChunkRow {
  id: number;
  documentId: string;
  userId: string;
  chunkIndex: number;
  content: string;
  /** Float32 小端向量（未向量化时为 null） */
  embedding: Buffer | null;
  embeddingModel: string | null;
  embeddingDim: number;
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
  text_length: number;
  storage_key: string | null;
  embedding_model: string | null;
  embedding_dim: number;
  embedded_chunks: number;
  created_at: number;
};

type ChunkDbRow = RowDataPacket & {
  id: number;
  document_id: string;
  user_id: string;
  chunk_index: number;
  content: string;
  embedding: Buffer | null;
  embedding_model: string | null;
  embedding_dim: number;
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
    textLength: Number(r.text_length ?? 0),
    storageKey: r.storage_key ?? null,
    embeddingModel: r.embedding_model ?? null,
    embeddingDim: Number(r.embedding_dim ?? 0),
    embeddedChunks: Number(r.embedded_chunks ?? 0),
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
    textLength: 0,
    storageKey: null,
    embeddingModel: null,
    embeddingDim: 0,
    embeddedChunks: 0,
    createdAt: now,
  };
}

/** 一条待写入的切片（可带向量） */
export interface ChunkInsert {
  content: string;
  embedding?: Buffer | null;
}

/** 向量元信息（模型 + 维度） */
export interface EmbeddingMeta {
  model: string | null;
  dim: number;
}

/** 写入切片并带上向量（调用方负责事务） */
async function writeChunks(
  conn: PoolConnection,
  documentId: string,
  userId: string,
  items: ChunkInsert[],
  meta: EmbeddingMeta | undefined,
  now: number,
): Promise<void> {
  const model = meta?.model ?? null;
  const dim = meta?.dim ?? 0;
  for (let i = 0; i < items.length; i++) {
    await conn.query(
      `INSERT INTO doc_chunks
         (document_id, user_id, chunk_index, content, embedding, embedding_model, embedding_dim, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [documentId, userId, i, items[i].content, items[i].embedding ?? null, model, dim, now],
    );
  }
}

/** 批量写入分块（事务，避免只写一半） */
export async function insertChunks(
  documentId: string,
  userId: string,
  items: ChunkInsert[],
  meta?: EmbeddingMeta,
): Promise<void> {
  if (items.length === 0) return;
  const now = Date.now();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await writeChunks(conn, documentId, userId, items, meta, now);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * 重建某文档的切片（删除旧切片 → 写入新切片 + 新向量），事务保证原子性。
 * 用于切换 embedding 模型后重建索引。
 */
export async function replaceChunks(
  documentId: string,
  userId: string,
  items: ChunkInsert[],
  meta?: EmbeddingMeta,
): Promise<void> {
  const now = Date.now();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM doc_chunks WHERE document_id = ? AND user_id = ?`, [
      documentId,
      userId,
    ]);
    await writeChunks(conn, documentId, userId, items, meta, now);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** 回填文档的解析/索引结果（失败时写 status=failed + error） */
export async function finalizeDocument(
  id: string,
  result: {
    chunkCount: number;
    status: string;
    error?: string | null;
    embeddingModel?: string | null;
    embeddingDim?: number;
    embeddedChunks?: number;
  },
): Promise<void> {
  await pool.query(
    `UPDATE documents
       SET chunk_count = ?, status = ?, error = ?,
           embedding_model = ?, embedding_dim = ?, embedded_chunks = ?
     WHERE id = ?`,
    [
      result.chunkCount,
      result.status,
      result.error ?? null,
      result.embeddingModel ?? null,
      result.embeddingDim ?? 0,
      result.embeddedChunks ?? 0,
      id,
    ],
  );
}

/** 某用户的知识库文档列表（最新在前；不返回 LONGTEXT 全文） */
export async function listDocuments(userId: string): Promise<DocumentRow[]> {
  const [rows] = await pool.query<DocumentDbRow[]>(
    `SELECT id, user_id, filename, mime, size, chunk_count, status, error,
            text_length, storage_key, embedding_model, embedding_dim, embedded_chunks, created_at
     FROM documents WHERE user_id = ? ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(toDocumentRow);
}

/** 按 id 查文档（传 userId 时校验归属；不返回 LONGTEXT 全文） */
export async function getDocument(id: string, userId?: string): Promise<DocumentRow | undefined> {
  const [rows] = await pool.query<DocumentDbRow[]>(
    `SELECT id, user_id, filename, mime, size, chunk_count, status, error,
            text_length, storage_key, embedding_model, embedding_dim, embedded_chunks, created_at
     FROM documents WHERE id = ? ${userId ? 'AND user_id = ?' : ''}`,
    userId ? [id, userId] : [id],
  );
  return rows[0] ? toDocumentRow(rows[0]) : undefined;
}

/**
 * 保存解析后的全文与原始文件标识。
 * @param storageKey 传 undefined 表示不动原文件字段（用于老文档回填全文）
 */
export async function saveDocumentContent(
  id: string,
  text: string,
  storageKey?: string | null,
): Promise<void> {
  if (storageKey === undefined) {
    await pool.query(`UPDATE documents SET text_content = ?, text_length = ? WHERE id = ?`, [
      text,
      text.length,
      id,
    ]);
    return;
  }
  await pool.query(
    `UPDATE documents SET text_content = ?, text_length = ?, storage_key = ? WHERE id = ?`,
    [text, text.length, storageKey, id],
  );
}

/** 读取文档全文（按用户校验归属） */
export async function getDocumentText(id: string, userId: string): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT text_content FROM documents WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  if (!rows[0]) return null;
  const text = rows[0].text_content;
  return typeof text === 'string' ? text : text === null ? null : String(text);
}

/** 某文档的全部切片（按顺序；按用户校验归属） */
export async function getChunksByDocument(
  documentId: string,
  userId: string,
): Promise<{ index: number; content: string }[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT chunk_index, content FROM doc_chunks
     WHERE document_id = ? AND user_id = ? ORDER BY chunk_index ASC`,
    [documentId, userId],
  );
  return rows.map((r) => ({ index: Number(r.chunk_index), content: String(r.content ?? '') }));
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
    `SELECT c.id, c.document_id, c.user_id, c.chunk_index, c.content,
            c.embedding, c.embedding_model, c.embedding_dim, c.created_at, d.filename
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
    embedding: r.embedding ?? null,
    embeddingModel: r.embedding_model ?? null,
    embeddingDim: Number(r.embedding_dim ?? 0),
    createdAt: Number(r.created_at),
    filename: r.filename,
  }));
}
