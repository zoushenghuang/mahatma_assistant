import { theme as antdTheme, type ThemeConfig } from 'antd';
import type { Theme } from '@/features/settings/SettingsProvider';

/**
 * Ant Design 主题：把 antd 的 token 对齐项目现有的墨蓝 / 金色设计语言。
 * 深色用 darkAlgorithm，浅色用 defaultAlgorithm。
 */

const fontFamily =
  '"Noto Sans SC", system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

const dark: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  cssVar: true,
  token: {
    colorPrimary: '#F0B429',
    colorInfo: '#F0B429',
    colorSuccess: '#9ECE6A',
    colorWarning: '#FF9E64',
    colorError: '#E5484D',
    colorBgBase: '#0A0C12',
    colorBgContainer: '#12151E',
    colorBgElevated: '#161A25',
    colorBorder: '#232A3B',
    colorBorderSecondary: '#1A1F2C',
    colorText: '#ECE9E2',
    colorTextSecondary: '#8B90A0',
    colorTextTertiary: '#5A6072',
    colorLink: '#F0B429',
    borderRadius: 12,
    borderRadiusLG: 16,
    controlHeight: 36,
    fontFamily,
    fontSize: 14,
  },
  components: {
    Button: { primaryShadow: 'none' },
    Input: { activeShadow: '0 0 0 2px rgba(240, 180, 41, 0.15)' },
    Tabs: {
      itemSelectedColor: '#F0B429',
      inkBarColor: '#F0B429',
      titleFontSize: 12,
      horizontalItemGutter: 20,
    },
    Dropdown: { paddingBlock: 6 },
    Tooltip: { colorBgSpotlight: '#1A1F2C' },
    Modal: { contentBg: '#12151E', headerBg: 'transparent' },
    Tag: { defaultBg: '#1A1F2C', defaultColor: '#8B90A0' },
  },
};

const light: ThemeConfig = {
  algorithm: antdTheme.defaultAlgorithm,
  cssVar: true,
  token: {
    colorPrimary: '#B07C0C',
    colorInfo: '#B07C0C',
    colorSuccess: '#2F7D31',
    colorWarning: '#B35C00',
    colorError: '#C93A3F',
    colorBgBase: '#F5F6FA',
    colorBgContainer: '#FFFFFF',
    colorBgElevated: '#FFFFFF',
    colorBorder: '#D6DAE6',
    colorBorderSecondary: '#ECEEF4',
    colorText: '#1C2130',
    colorTextSecondary: '#5C6479',
    colorTextTertiary: '#868DA0',
    colorLink: '#B07C0C',
    borderRadius: 12,
    borderRadiusLG: 16,
    controlHeight: 36,
    fontFamily,
    fontSize: 14,
  },
  components: {
    Button: { primaryShadow: 'none' },
    Input: { activeShadow: '0 0 0 2px rgba(176, 124, 12, 0.15)' },
    Tabs: {
      itemSelectedColor: '#B07C0C',
      inkBarColor: '#B07C0C',
      titleFontSize: 12,
      horizontalItemGutter: 20,
    },
    Dropdown: { paddingBlock: 6 },
    Tooltip: { colorBgSpotlight: '#1C2130' },
    Modal: { contentBg: '#FFFFFF', headerBg: 'transparent' },
    Tag: { defaultBg: '#ECEEF4', defaultColor: '#5C6479' },
  },
};

export function buildAntdTheme(theme: Theme): ThemeConfig {
  return theme === 'light' ? light : dark;
}
