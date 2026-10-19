import { StaffLogo } from '@/components/icons';
import { useSettings } from '@/features/settings/SettingsProvider';

/** 空会话欢迎页：品牌 + 示例问题（点击直接发送） */
export function WelcomePanel({ onPick }: { onPick: (text: string) => void }) {
  const { t } = useSettings();

  const examples = [
    { label: t('chat.exampleWeatherLabel'), text: t('chat.exampleWeatherText') },
    { label: t('knowledge.entry'), text: t('knowledge.exampleText') },
    { label: t('chat.exampleEchoLabel'), text: t('chat.exampleEchoText') },
  ];

  return (
    <div className="animate-fade-up pt-16 text-center">
      <div className="relative mx-auto flex h-20 w-20 items-center justify-center">
        <span className="absolute inset-0 animate-pulse-ring rounded-3xl border border-gold/40" />
        <StaffLogo className="h-20 w-20 drop-shadow-glow-gold-sm" />
      </div>
      <h2 className="mt-6 font-display text-2xl font-bold text-gold-100">{t('chat.heroTitle')}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">
        {t('chat.heroSub')}
      </p>
      <div className="mx-auto mt-8 grid max-w-lg gap-3 sm:grid-cols-2">
        {examples.map((ex) => (
          <button
            key={ex.text}
            onClick={() => onPick(ex.text)}
            className="group cursor-pointer rounded-2xl border border-night-600 bg-night-800/60 p-4 text-left transition hover:border-gold/50 hover:bg-night-700/50 hover:shadow-glow-gold-sm"
          >
            <span className="text-xs font-medium text-gold">{ex.label}</span>
            <span className="mt-1.5 block text-sm leading-relaxed text-ink transition group-hover:text-gold-100">
              {ex.text}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
