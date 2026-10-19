import * as auth from './auth';
import * as chat from './chat';
import * as documents from './documents';
import * as sessions from './sessions';
import * as user from './user';

export * from './types';
export { clearToken, getToken, setToken, setUnauthorizedHandler } from './client';

/**
 * 聚合的业务 API。
 * 用法：`api.listSessions()` / `api.chatSSE(...)`，与拆分前保持一致。
 */
export const api = {
  ...auth,
  ...user,
  ...sessions,
  ...documents,
  ...chat,
};
