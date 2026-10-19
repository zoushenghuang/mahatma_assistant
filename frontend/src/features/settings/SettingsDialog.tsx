import type { ReactNode } from 'react';
import {
  CheckIcon,
  CloseIcon,
  GlobeIcon,
  MoonIcon,
  PaletteIcon,
  SunIcon,
} from '@/components/icons';
import { Modal } from '@/components/ui/Modal';
import { useSettings, type Theme } from './SettingsProvider';
import type { Lang } from './i18n';

/**
 * 设置弹窗：外观设置（浅色 / 深色）+ 语言设置（中文 / English）
 *
 * 选项以卡片形式呈现，选中态用金色描边 + 对勾。
 */

/** 可选项卡片 */
function OptionCard({
  selected,
  icon,
  label,
  desc,
  onClick,
}: {
  selected: boolean;
  icon?: ReactNode;
  label: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition ${
        selected
          ? 'border-gold/60 bg-gold/10 shadow-glow-gold-sm'
          : 'border-night-600 bg-night-900/50 hover:border-gold/40 hover:bg-night-800/60'
      }`}
    >
      <span
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition ${
          selected ? 'border-gold/50 bg-gold/15 text-gold' : 'border-night-600 text-ink-muted'
        }`}
      >
        {icon ?? <GlobeIcon />}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`flex items-center gap-1.5 text-sm font-medium ${
            selected ? 'text-gold-100' : 'text-ink'
          }`}
        >
          {label}
          {selected && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gold text-accentInk">
              <CheckIcon className="h-3 w-3" />
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ink-faint">{desc}</span>
      </span>
    </button>
  );
}

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { theme, lang, setTheme, setLang, t } = useSettings();

  const themeOptions: { value: Theme; label: string; desc: string; icon: ReactNode }[] = [
    {
      value: 'light',
      label: t('settings.light'),
      desc: t('settings.lightDesc'),
      icon: <SunIcon />,
    },
    { value: 'dark', label: t('settings.dark'), desc: t('settings.darkDesc'), icon: <MoonIcon /> },
  ];

  const langOptions: { value: Lang; label: string; desc: string }[] = [
    { value: 'zh', label: t('settings.zh'), desc: t('settings.zhDesc') },
    { value: 'en', label: t('settings.en'), desc: t('settings.enDesc') },
  ];

  return (
    <Modal
      onClose={onClose}
      layer="top"
      ariaLabel={t('settings.title')}
      panelClassName="w-full max-w-md max-h-[85vh] animate-fade-up overflow-y-auto rounded-2xl border border-night-600 bg-night-800 p-6 shadow-panel"
    >
      {/* 标题 */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-base font-bold text-gold-100">{t('settings.title')}</h2>
          <p className="mt-0.5 text-[11px] text-ink-faint">{t('settings.sub')}</p>
        </div>
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          className="cursor-pointer rounded-lg p-1.5 text-ink-muted transition hover:text-ink"
        >
          <CloseIcon />
        </button>
      </div>

      {/* 外观设置 */}
      <section className="mb-5">
        <div className="mb-2.5 flex items-baseline gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
            <PaletteIcon />
            {t('settings.appearance')}
          </span>
          <span className="text-[11px] text-ink-faint">{t('settings.appearanceHint')}</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {themeOptions.map((opt) => (
            <OptionCard
              key={opt.value}
              selected={theme === opt.value}
              icon={opt.icon}
              label={opt.label}
              desc={opt.desc}
              onClick={() => setTheme(opt.value)}
            />
          ))}
        </div>
      </section>

      {/* 语言设置 */}
      <section>
        <div className="mb-2.5 flex items-baseline gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
            <GlobeIcon />
            {t('settings.language')}
          </span>
          <span className="text-[11px] text-ink-faint">{t('settings.languageHint')}</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {langOptions.map((opt) => (
            <OptionCard
              key={opt.value}
              selected={lang === opt.value}
              icon={
                <span className="font-display text-xs font-bold">
                  {opt.value === 'zh' ? '中' : 'EN'}
                </span>
              }
              label={opt.label}
              desc={opt.desc}
              onClick={() => setLang(opt.value)}
            />
          ))}
        </div>
      </section>
    </Modal>
  );
}
