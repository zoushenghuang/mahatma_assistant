import { Input } from 'antd';
import { SendIcon, StopIcon } from '@/components/icons';
import { Button } from '@/components/ui/Button';
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
        <Input
          size="large"
          value={input}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('chat.inputPlaceholder')}
          disabled={streaming}
          className="flex-1"
        />
        {streaming ? (
          <Button
            variant="danger"
            size="large"
            icon={<StopIcon />}
            aria-label={t('chat.stop')}
            onClick={onStop}
          />
        ) : (
          <Button
            variant="primary"
            htmlType="submit"
            size="large"
            icon={<SendIcon />}
            disabled={!input.trim()}
            aria-label={t('chat.send')}
          />
        )}
      </form>
      <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-ink-faint">
        {t('chat.footer')}
      </p>
    </footer>
  );
}
