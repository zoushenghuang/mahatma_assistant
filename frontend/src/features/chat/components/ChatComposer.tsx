import { SendIcon, StopIcon } from '@/components/icons';
import { useSettings } from '@/features/settings/SettingsProvider';

/** 底部输入区：输入框 + 发送 / 停止 */
export function ChatComposer({
  input,
  streaming,
  onChange,
  onSend,
  onStop,
}: {
  input: string;
  streaming: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
}) {
  const { t } = useSettings();

  return (
    <footer className="shrink-0 border-t border-night-700/60 bg-night-900/40 px-4 pb-4 pt-3 backdrop-blur">
      <form
        className="mx-auto flex max-w-3xl items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        <div className="flex flex-1 items-center gap-2 rounded-2xl border border-night-600 bg-night-800/80 px-4 py-3 transition focus-within:border-gold/60 focus-within:shadow-glow-gold-sm">
          <input
            value={input}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t('chat.inputPlaceholder')}
            disabled={streaming}
            className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint disabled:cursor-not-allowed"
          />
        </div>
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label={t('chat.stop')}
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-2xl border border-cinnabar/50 bg-cinnabar/10 text-cinnabar transition hover:bg-cinnabar/20"
          >
            <StopIcon />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            aria-label={t('chat.send')}
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-2xl bg-gold-gradient text-accentInk transition hover:brightness-110 hover:shadow-glow-gold disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            <SendIcon />
          </button>
        )}
      </form>
      <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-ink-faint">
        {t('chat.footer')}
      </p>
    </footer>
  );
}
