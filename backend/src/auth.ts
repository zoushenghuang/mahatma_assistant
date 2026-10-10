import type { IncomingMessage } from 'node:http';
import {
  createPasswordReset,
  createUser,
  findUserById,
  findUserByUsername,
  findValidReset,
  markResetUsed,
  touchUserLogin,
  updateUserPassword,
  type UserRow,
} from './db';
import { hashPassword, signToken, verifyPassword, verifyToken } from './crypto';

/**
 * 鉴权层：登录态解析 + 注册 / 登录 / 找回密码的业务逻辑
 *
 * - 登录后签发 JWT（HS256，默认 7 天），前端带 Authorization: Bearer <token>
 * - 所有业务接口必须携带有效 token，且会话数据按 user_id 隔离
 */

// ============ 登录态 ============

/** 从请求头解析当前用户，失败返回 null */
export async function getUserFromRequest(req: IncomingMessage): Promise<UserRow | null> {
  const raw = req.headers.authorization ?? '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7).trim() : '';
  if (!token) return null;

  const payload = verifyToken(token);
  if (!payload) return null;

  const user = await findUserById(payload.uid);
  if (!user || user.status !== 1) return null; // 用户被禁用/已删除
  return user;
}

// ============ 入参校验 ============

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AuthError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

function assert(cond: unknown, message: string, status = 400): asserts cond {
  if (!cond) throw new AuthError(message, status);
}

export function validateUsername(username: unknown): string {
  const v = String(username ?? '').trim();
  assert(v, '请输入账号');
  assert(USERNAME_RE.test(v), '账号需为 3-20 位字母、数字或下划线');
  return v;
}

export function validatePassword(password: unknown): string {
  const v = String(password ?? '');
  assert(v.length >= 8, '密码至少 8 位');
  assert(v.length <= 64, '密码最长 64 位');
  return v;
}

export function validateEmail(email: unknown): string {
  const v = String(email ?? '').trim();
  assert(v, '请输入邮箱（用于找回密码）');
  assert(EMAIL_RE.test(v), '邮箱格式不正确');
  return v;
}

// ============ 业务 ============

export interface AuthResult {
  token: string;
  user: UserRow;
}

/** 注册：校验入参 → 落库 → 直接签发 token（注册即登录） */
export async function register(input: {
  username: unknown;
  password: unknown;
  email: unknown;
  nickname?: unknown;
}): Promise<AuthResult> {
  const username = validateUsername(input.username);
  const password = validatePassword(input.password);
  const email = validateEmail(input.email);
  const nickname = String(input.nickname ?? '').trim() || username;

  const user = await createUser({ username, email, passwordHash: hashPassword(password), nickname });
  await touchUserLogin(user.id);
  return { token: signToken(user), user };
}

/** 登录：账号 + 密码 */
export async function login(input: { username: unknown; password: unknown }): Promise<AuthResult> {
  const username = String(input.username ?? '').trim();
  const password = String(input.password ?? '');
  assert(username, '请输入账号');
  assert(password, '请输入密码');

  const record = await findUserByUsername(username);
  // 账号不存在与密码错误返回同一提示，避免账号枚举
  assert(record && verifyPassword(password, record.passwordHash), '账号或密码错误', 401);
  assert(record!.status === 1, '账号已被禁用，请联系管理员', 403);

  await touchUserLogin(record!.id);
  const user = (await findUserById(record!.id))!;
  return { token: signToken(user), user };
}

/**
 * 忘记密码：校验账号 + 邮箱匹配 → 生成一次性重置令牌
 *
 * 演示环境没有邮件服务，令牌直接在响应里返回（真实项目应发邮件，只回 { ok: true }）
 */
export async function requestPasswordReset(input: {
  username: unknown;
  email: unknown;
}): Promise<{ resetToken: string; email: string }> {
  const username = String(input.username ?? '').trim();
  const email = validateEmail(input.email);
  assert(username, '请输入账号');

  const user = await findUserByUsername(username);
  assert(user, '账号不存在', 404);
  assert(user!.email.toLowerCase() === email.toLowerCase(), '账号与预留邮箱不匹配', 403);

  const resetToken = await createPasswordReset(user!.id);
  console.log(`[Auth] 用户 ${username} 申请重置密码，令牌: ${resetToken}（30 分钟内有效）`);
  return { resetToken, email: user!.email };
}

/** 用重置令牌设置新密码 */
export async function resetPassword(input: {
  token: unknown;
  password: unknown;
}): Promise<{ username: string }> {
  const token = String(input.token ?? '').trim();
  const password = validatePassword(input.password);
  assert(token, '缺少重置令牌');

  const userId = await findValidReset(token);
  assert(userId, '重置令牌无效或已过期', 400);

  await updateUserPassword(userId!, hashPassword(password));
  await markResetUsed(token);

  const user = await findUserById(userId!);
  return { username: user?.username ?? '' };
}
