import { useState } from 'react';
import { CheckIcon, CopyIcon } from '@/components/icons';
import { useSettings } from '@/features/settings/SettingsProvider';

/** 复制按钮（代码块 / 消息共用），带「已复制」反馈 */
export function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const { t } = useSettings();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 剪贴板不可用（非 https / 无权限）时静默失败
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? t('chat.copied') : t('chat.copy')}
      className={`flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-faint transition hover:bg-night-700/60 hover:text-gold ${className}`}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      <span>{copied ? t('chat.copied') : t('chat.copy')}</span>
    </button>
  );
}
