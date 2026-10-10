import { useEffect, type ReactNode } from 'react';
import { useSettings, type Lang, type Theme } from './settings';

/**
 * 设置弹窗：外观设置（浅色 / 深色）+ 语言设置（中文 / English）
 *
 * 选项以卡片形式呈现，选中态用金色描边 + 对勾，支持 Esc 关闭。
 */

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" />
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="M12 21a9 9 0 1 1 9-9c0 1.7-1.3 3-3 3h-2a2 2 0 0 0-1.4 3.4A2 2 0 0 1 12 21z" />
      <circle cx="7.5" cy="12" r="1" />
      <circle cx="10" cy="8" r="1" />
      <circle cx="15" cy="8.5" r="1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden="true">
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

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
        <span className={`flex items-center gap-1.5 text-sm font-medium ${selected ? 'text-gold-100' : 'text-ink'}`}>
          {label}
          {selected && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gold text-accentInk">
              <CheckIcon />
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

  // Esc 关闭
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const themeOptions: { value: Theme; label: string; desc: string; icon: ReactNode }[] = [
    { value: 'light', label: t('settings.light'), desc: t('settings.lightDesc'), icon: <SunIcon /> },
    { value: 'dark', label: t('settings.dark'), desc: t('settings.darkDesc'), icon: <MoonIcon /> },
  ];

  const langOptions: { value: Lang; label: string; desc: string }[] = [
    { value: 'zh', label: t('settings.zh'), desc: t('settings.zhDesc') },
    { value: 'en', label: t('settings.en'), desc: t('settings.enDesc') },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
        className="relative z-10 max-h-[85vh] w-full max-w-md animate-fade-up overflow-y-auto rounded-2xl border border-night-600 bg-night-800 p-6 shadow-panel"
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
                icon={<span className="font-display text-xs font-bold">{opt.value === 'zh' ? '中' : 'EN'}</span>}
                label={opt.label}
                desc={opt.desc}
                onClick={() => setLang(opt.value)}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
