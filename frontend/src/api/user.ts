import { requestJson } from './client';
import type { ApiKeyStatus } from './types';

/** 我的 API Key 状态（后端只回脱敏值） */
export function getApiKey(): Promise<ApiKeyStatus> {
  return requestJson<ApiKeyStatus>('/user/api-key');
}

/** 保存我的 API Key（服务端加密落库） */
export function saveApiKey(apiKey: string): Promise<ApiKeyStatus> {
  return requestJson<ApiKeyStatus>('/user/api-key', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });
}

/** 删除我的 API Key */
export function deleteApiKey(): Promise<ApiKeyStatus> {
  return requestJson<ApiKeyStatus>('/user/api-key', { method: 'DELETE' });
}
