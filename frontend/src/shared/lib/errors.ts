import type { Translate } from '@/features/settings/i18n';

/**
 * 连接层异常的友好文案
 * 后端返回的文案（如「登录已失效，请重新登录」）已是给用户看的，优先透传；
 * 浏览器原生报错（Failed to fetch 等）则翻译成人话。
 */
export function friendlyClientError(err: unknown, t: Translate): string {
  const raw = String((err as Error)?.message ?? err ?? '').trim();
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(raw)) {
    return t('chat.networkError');
  }
  return raw || t('chat.unknownError');
}
