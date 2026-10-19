import type { TokenUsage } from '@/api';
import { BoltIcon } from '@/components/icons';
import { useSettings } from '@/features/settings/SettingsProvider';

/** 本轮 token 用量（与法宝调用卡片相邻展示） */
export function TokenUsageBadge({ usage }: { usage: TokenUsage | null }) {
  const { t } = useSettings();
  if (!usage) return null;

  return (
    <div className="flex animate-fade-in justify-end">
      <span
        title={t('chat.usageDetail', {
          input: usage.inputTokens.toLocaleString(),
          output: usage.outputTokens.toLocaleString(),
        })}
        className="inline-flex cursor-help items-center gap-1.5 rounded-lg border border-night-700/60 bg-night-900/60 px-2.5 py-1 font-mono text-[11px] text-ink-faint"
      >
        <BoltIcon />
        {t('chat.usage', { total: usage.totalTokens.toLocaleString() })}
      </span>
    </div>
  );
}
