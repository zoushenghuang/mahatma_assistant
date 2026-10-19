import { en } from './en';
import { zh, type TKey } from './zh';

export type Lang = 'zh' | 'en';

/** 文案 key（以中文词典为唯一事实来源） */
export type { TKey };

/** 翻译函数 */
export type Translate = (key: TKey, vars?: Record<string, string | number>) => string;

export const DICTS: Record<Lang, Record<TKey, string>> = { zh, en };
