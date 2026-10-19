import { post, requestJson } from './client';
import type { DisplayMessage, Session } from './types';

/** 会话列表（按最近活跃排序） */
export function listSessions(): Promise<Session[]> {
  return requestJson<Session[]>('/sessions');
}

/** 新建会话 */
export function createSession(): Promise<Session> {
  return post<Session>('/sessions', {});
}

/** 删除会话（级联删除消息） */
export function deleteSession(id: string): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(`/sessions/${id}`, { method: 'DELETE' });
}

/** 加载会话历史（切换会话时展示） */
export function getMessages(id: string): Promise<DisplayMessage[]> {
  return requestJson<DisplayMessage[]>(`/sessions/${id}/messages`);
}
