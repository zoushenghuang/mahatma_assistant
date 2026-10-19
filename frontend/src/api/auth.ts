import { post, requestJson } from './client';
import type { AuthResult, User } from './types';

/** 注册（注册成功即登录） */
export function register(input: {
  username: string;
  password: string;
  email: string;
  nickname?: string;
}): Promise<AuthResult> {
  return post<AuthResult>('/auth/register', input);
}

/** 登录（账号 + 密码） */
export function login(input: { username: string; password: string }): Promise<AuthResult> {
  return post<AuthResult>('/auth/login', input);
}

/** 当前登录用户 */
export function me(): Promise<User> {
  return requestJson<{ user: User }>('/auth/me').then((r) => r.user);
}

/** 忘记密码：账号 + 预留邮箱 → 重置令牌（演示环境直接返回） */
export function forgotPassword(input: { username: string; email: string }): Promise<{
  resetToken: string;
  email: string;
}> {
  return post('/auth/forgot-password', input);
}

/** 用重置令牌设置新密码 */
export function resetPassword(input: { token: string; password: string }): Promise<{
  username: string;
}> {
  return post('/auth/reset-password', input);
}
