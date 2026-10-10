/**
 * 语义化颜色全部指向 CSS 变量（见 src/index.css）：
 * 这样同一套 class（bg-night-800 / text-ink …）能随 data-theme 自动切换浅色 / 深色，
 * 不需要在每个组件里写两套类名。/ <alpha-value> 保留 Tailwind 的透明度修饰符能力。
 */
const token = (name) => `rgb(var(${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // 大圣助手设计系统（ui-ux-pro-max 风格推理：AI 原生 UI × 中国神话主题）
      colors: {
        // 底色 / 面板 / 描边（深色=墨蓝黑，浅色=云雾白）
        night: {
          DEFAULT: token('--c-night'),
          900: token('--c-night-900'),
          800: token('--c-night-800'),
          700: token('--c-night-700'),
          600: token('--c-night-600'),
        },
        // 金箍棒金 · 主色 / CTA
        gold: {
          DEFAULT: token('--c-gold'),
          100: token('--c-gold-100'),
          300: '#FFD97A',
          400: '#F7C64F',
          500: '#E8A817',
          600: '#C98A0D',
        },
        // 朱砂红 · 火眼金睛点缀
        cinnabar: {
          DEFAULT: '#E5484D',
          400: '#F0645F',
          600: '#C93A3F',
        },
        // 正文文字
        ink: {
          DEFAULT: token('--c-ink'),
          muted: token('--c-ink-muted'),
          faint: token('--c-ink-faint'),
        },
        // 金色渐变按钮 / 用户气泡上的文字：浅色深色都用深色，保证对比度
        accentInk: token('--c-accent-ink'),
      },
      fontFamily: {
        // 正文：思源黑体；数字/英文点缀：Space Grotesk
        sans: ['"Noto Sans SC"', 'system-ui', '-apple-system', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
        display: ['"Space Grotesk"', '"Noto Sans SC"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'glow-gold': '0 0 24px rgba(240, 180, 41, 0.25)',
        'glow-gold-sm': '0 0 12px rgba(240, 180, 41, 0.35)',
        'glow-red': '0 0 20px rgba(229, 72, 77, 0.25)',
        panel: 'var(--shadow-panel)',
      },
      backgroundImage: {
        'gold-gradient': 'linear-gradient(135deg, #FFD97A 0%, #F0B429 45%, #C98A0D 100%)',
        'bubble-user': 'linear-gradient(135deg, #F7C64F 0%, #E8A817 100%)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'bounce-dot': {
          '0%, 80%, 100%': { transform: 'translateY(0)', opacity: '0.5' },
          '40%': { transform: 'translateY(-6px)', opacity: '1' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.6' },
          '100%': { transform: 'scale(1.25)', opacity: '0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.35s ease-out both',
        'fade-in': 'fade-in 0.25s ease-out both',
        'bounce-dot': 'bounce-dot 1.2s ease-in-out infinite',
        'pulse-ring': 'pulse-ring 1.8s ease-out infinite',
      },
    },
  },
  plugins: [],
};
