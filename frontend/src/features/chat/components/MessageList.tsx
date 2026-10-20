import { Input } from 'antd';
import { EditIcon, RefreshIcon, StaffLogo } from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { useSettings } from '@/features/settings/SettingsProvider';
import Markdown from './Markdown';
import type { ChatMsg } from '../types';

/** 消息流：用户气泡（含就地编辑）+ 助手气泡（Markdown） */
export function MessageList({
  messages,
  streaming,
  editingIndex,
  editText,
  onEditTextChange,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onRegenerate,
}: {
  messages: ChatMsg[];
  streaming: boolean;
  editingIndex: number | null;
  editText: string;
  onEditTextChange: (value: string) => void;
  onStartEdit: (index: number) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (index: number) => void;
  onRegenerate: () => void;
}) {
  const { t } = useSettings();

  return (
    <>
      {messages.map((m, i) =>
        m.role === 'user' ? (
          editingIndex === i ? (
            /* 编辑态：就地修改，保存后丢弃后续对话并重发 */
            <div key={i} className="flex animate-fade-up justify-end">
              <div className="w-full max-w-[85%] rounded-2xl border border-gold/40 bg-night-800 p-2.5 shadow-glow-gold-sm">
                <Input.TextArea
                  value={editText}
                  onChange={(e) => onEditTextChange(e.target.value)}
                  autoSize={{ minRows: 2, maxRows: 10 }}
                  autoFocus
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-ink-faint">{t('chat.editHint')}</span>
                  <div className="flex gap-2">
                    <Button size="small" onClick={onCancelEdit}>
                      {t('chat.cancel')}
                    </Button>
                    <Button
                      variant="primary"
                      size="small"
                      onClick={() => onSubmitEdit(i)}
                      disabled={!editText.trim()}
                    >
                      {t('chat.saveAndResend')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div key={i} className="group flex animate-fade-up flex-col items-end gap-1">
              <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-bubble-user px-4 py-2.5 text-sm leading-relaxed text-accentInk shadow-glow-gold-sm">
                {m.content}
              </div>
              {!streaming && (
                <div className="flex items-center gap-1 pr-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => onStartEdit(i)}
                    className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-faint transition hover:bg-night-700/60 hover:text-gold"
                  >
                    <EditIcon />
                    {t('chat.edit')}
                  </button>
                  <CopyButton text={m.content} />
                  {i === messages.length - 1 && (
                    <button
                      type="button"
                      onClick={onRegenerate}
                      className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-faint transition hover:bg-night-700/60 hover:text-gold"
                    >
                      <RefreshIcon />
                      {t('chat.regenerate')}
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        ) : (
          <div key={i} className="group flex animate-fade-up items-start gap-3">
            <div className="mt-0.5 shrink-0 rounded-xl border border-night-600 bg-night-800 p-1.5">
              <StaffLogo className="h-6 w-6" />
            </div>
            <div className="flex min-w-0 max-w-[85%] flex-col items-start gap-1">
              <div
                className={`w-full min-w-0 rounded-2xl rounded-tl-sm border px-4 py-2.5 ${
                  m.failed
                    ? 'border-cinnabar/40 bg-cinnabar/10 text-sm leading-relaxed text-cinnabar-400'
                    : 'border-night-600 bg-night-800/80 text-ink'
                }`}
              >
                {m.failed ? (
                  <>
                    <span className="mb-1 block text-xs font-medium opacity-80">
                      {t('chat.tip')}
                    </span>
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  </>
                ) : (
                  <Markdown content={m.content} />
                )}
              </div>
              {!streaming && !m.failed && (
                <div className="flex items-center gap-1 pl-1 opacity-0 transition group-hover:opacity-100">
                  <CopyButton text={m.content} />
                  {i === messages.length - 1 && (
                    <button
                      type="button"
                      onClick={onRegenerate}
                      className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-faint transition hover:bg-night-700/60 hover:text-gold"
                    >
                      <RefreshIcon />
                      {t('chat.regenerate')}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ),
      )}
    </>
  );
}
