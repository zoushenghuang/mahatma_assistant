import { AuthError } from './auth';

/**
 * 错误文案归一化
 *
 * 上游（DeepSeek / 网络）抛出的原始异常是给开发者看的
 * （如「401 Authentication Fails, Your api key is invalid」），
 * 直接经 SSE 推到界面会变成一句看不懂的「系统出错」。
 * 这里统一翻译成对用户友好的提示文案，界面只展示这里的文案。
 */

/** 未填写 Key 的引导文案（与前端「我的 Key」入口呼应） */
export const NO_API_KEY_MESSAGE =
  '你还没有配置 DeepSeek API Key 哦，点右上角「我的 Key」填入自己的 Key，就能继续对话啦～';

/** 各类异常的友好文案 */
export const FRIENDLY_MESSAGES = {
  invalidKey: 'API Key 好像不太对（无效或已过期），点右上角「我的 Key」重新填一个有效的 Key 再试试吧～',
  quota: '你的 API Key 额度不足或已用尽，充值后或换一个 Key 就能继续啦～',
  rateLimit: '这会儿问得有点频繁，稍等几秒再试一次吧～',
  network: '网络好像开小差了，检查一下网络或稍后再试试～',
  fallback: '大圣这边出了点小状况，没能接住这个问题，稍后再试一次吧～',
} as const;

/**
 * 把任意异常翻译成用户可读的文案。
 * 已知业务错误（AuthError）本身的文案就是给用户看的，原样返回。
 */
export function friendlyErrorMessage(err: unknown): string {
  // 业务校验类错误：文案已经是对用户说的，直接透传
  if (err instanceof AuthError) return err.message;

  const raw = err instanceof Error ? err.message : String(err ?? '');
  const text = raw.toLowerCase();

  // 1) API Key 无效 / 鉴权失败
  if (/401|403|unauthorized|authentication fails|invalid[_ -]?api[_ -]?key/.test(text)) {
    return FRIENDLY_MESSAGES.invalidKey;
  }
  // 2) 额度 / 余额不足
  if (/402|insufficient|exceeded your current quota|balance/.test(text)) {
    return FRIENDLY_MESSAGES.quota;
  }
  // 3) 触发限流
  if (/429|rate limit|too many requests/.test(text)) {
    return FRIENDLY_MESSAGES.rateLimit;
  }
  // 4) 网络 / 超时
  if (/timeout|timed out|etimedout|econnreset|enotfound|fetch failed|socket|network/.test(text)) {
    return FRIENDLY_MESSAGES.network;
  }
  // 5) 兜底：不把底层细节暴露给用户
  return FRIENDLY_MESSAGES.fallback;
}
