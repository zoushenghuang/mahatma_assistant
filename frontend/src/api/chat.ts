import { streamSse } from './client';
import type { GeoLocation, SseEvent } from './types';

type EventHandler = (e: SseEvent) => void;

/** 流式对话（POST + SSE） */
export function chatSSE(
  sessionId: string,
  message: string,
  location: GeoLocation | null,
  onEvent: EventHandler,
  signal: AbortSignal,
): Promise<void> {
  return streamSse('/chat', { sessionId, message, location }, onEvent, signal);
}

/** 重新生成：后端丢弃最后一条回答及其后的记录，用上一条用户消息重跑 */
export function regenerateSSE(
  sessionId: string,
  location: GeoLocation | null,
  onEvent: EventHandler,
  signal: AbortSignal,
): Promise<void> {
  return streamSse(`/sessions/${sessionId}/regenerate`, { location }, onEvent, signal);
}

/** 编辑重发：把第 displayIndex 条用户消息改成新内容，并丢弃其后所有消息重跑 */
export function editMessageSSE(
  sessionId: string,
  displayIndex: number,
  message: string,
  location: GeoLocation | null,
  onEvent: EventHandler,
  signal: AbortSignal,
): Promise<void> {
  return streamSse(
    `/sessions/${sessionId}/edit`,
    { displayIndex, message, location },
    onEvent,
    signal,
  );
}
