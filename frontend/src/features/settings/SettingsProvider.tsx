import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { DICTS, type Lang, type Translate } from './i18n';

/**
 * 全局设置：外观（浅色 / 深色）+ 语言（中文 / English）
 *
 * - 主题通过 <html data-theme="..."> 生效（设计令牌见 styles/index.css）；
 * - 语言通过 t(key) 取文案，词条集中在 i18n 目录；
 * - 两者都持久化在 localStorage。
 */

export type Theme = 'light' | 'dark';
export type { Lang, Translate };

const STORAGE_KEY = { theme: 'dasheng_theme', lang: 'dasheng_lang' } as const;

interface SettingsValue {
  theme: Theme;
  lang: Lang;
  setTheme: (theme: Theme) => void;
  setLang: (lang: Lang) => void;
  t: Translate;
}

const SettingsContext = createContext<SettingsValue | null>(null);

/** 从 localStorage 读取并校验取值 */
function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  } catch {
    // 隐私模式下 localStorage 可能不可用，忽略即可
  }
  return fallback;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() =>
    readStored(STORAGE_KEY.theme, ['light', 'dark'] as const, 'dark'),
  );
  const [lang, setLangState] = useState<Lang>(() =>
    readStored(STORAGE_KEY.lang, ['zh', 'en'] as const, 'zh'),
  );

  // 主题写入 <html data-theme>，CSS 变量随之切换
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem(STORAGE_KEY.theme, theme);
    } catch {
      // 忽略持久化失败
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('lang', lang === 'zh' ? 'zh-CN' : 'en');
    try {
      localStorage.setItem(STORAGE_KEY.lang, lang);
    } catch {
      // 忽略持久化失败
    }
  }, [lang]);

  const t = useCallback<Translate>(
    (key, vars) => {
      // 英文缺词时回退中文，保证界面不会出现 key 本身
      const text = DICTS[lang][key] ?? DICTS.zh[key] ?? key;
      if (!vars) return text;
      return text.replace(/\{(\w+)\}/g, (_, name: string) =>
        vars[name] === undefined ? `{${name}}` : String(vars[name]),
      );
    },
    [lang],
  );

  const value = useMemo<SettingsValue>(
    () => ({ theme, lang, setTheme: setThemeState, setLang: setLangState, t }),
    [theme, lang, t],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings 必须在 SettingsProvider 内使用');
  return ctx;
}
