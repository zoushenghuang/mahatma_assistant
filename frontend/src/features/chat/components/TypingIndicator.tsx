import { StaffLogo } from '@/components/icons';
import { useSettings } from '@/features/settings/SettingsProvider';

/** 等待首个 token 时的「思考中」占位 */
export function TypingIndicator() {
  const { t } = useSettings();

  return (
    <div className="flex animate-fade-up items-start gap-3">
      <div className="mt-0.5 shrink-0 rounded-xl border border-night-600 bg-night-800 p-1.5">
        <StaffLogo className="h-6 w-6" />
      </div>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-night-600 bg-night-800/80 px-4 py-3.5">
        {[0, 1, 2].map((d) => (
          <span
            key={d}
            className="h-1.5 w-1.5 animate-bounce-dot rounded-full bg-gold"
            style={{ animationDelay: `${d * 0.15}s` }}
          />
        ))}
        <span className="ml-1 text-xs text-ink-faint">{t('chat.thinking')}</span>
      </div>
    </div>
  );
}
