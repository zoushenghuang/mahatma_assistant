import { App as AntdApp, ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import type { ReactNode } from 'react';
import { useSettings } from '@/features/settings/SettingsProvider';
import { buildAntdTheme } from '@/shared/config/antdTheme';

/**
 * Ant Design 全局配置：
 * - 主题随应用浅色 / 深色切换
 * - locale 跟随界面语言
 * - cssVar 模式减少主题切换时的样式重算
 */
export function AntdProvider({ children }: { children: ReactNode }) {
  const { theme, lang } = useSettings();

  return (
    <ConfigProvider
      theme={buildAntdTheme(theme)}
      locale={lang === 'zh' ? zhCN : enUS}
      componentSize="middle"
    >
      <AntdApp className="h-full">{children}</AntdApp>
    </ConfigProvider>
  );
}
