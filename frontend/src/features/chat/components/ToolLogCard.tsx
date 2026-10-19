import { ChevronIcon, GearIcon } from '@/components/icons';
import { useSettings } from '@/features/settings/SettingsProvider';
import { truncate } from '@/shared/lib/format';
import type { ToolLogItem } from '../types';

/** 法宝调用日志（可折叠卡片） */
export function ToolLogCard({
  items,
  open,
  onToggle,
}: {
  items: ToolLogItem[];
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useSettings();
  if (items.length === 0) return null;

  return (
    <div className="animate-fade-in overflow-hidden rounded-2xl border border-night-600 bg-night-900/70">
      <button
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left transition hover:bg-night-800/60"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-gold">
          <GearIcon />
          {t('chat.tools')}
          <span className="rounded-md bg-gold/10 px-1.5 py-0.5 font-display text-xs text-gold">
            {items.length}
          </span>
        </span>
        <span className="text-ink-faint">
          <ChevronIcon open={open} />
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-night-700/60 px-4 py-3">
          {items.map((item, i) => (
            <div
              key={i}
              className="rounded-xl border border-night-700/60 bg-night-800/60 px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    item.error ? 'bg-cinnabar' : 'bg-gold'
                  }`}
                />
                <span className="font-mono text-xs font-medium text-ink">
                  {item.error ? t('chat.toolFailed', { name: item.name }) : item.name}
                </span>
              </div>
              {(item.result || item.error) && (
                <p className="mt-1.5 break-all font-mono text-xs leading-relaxed text-ink-faint">
                  {item.error ?? (item.result && truncate(item.result))}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
