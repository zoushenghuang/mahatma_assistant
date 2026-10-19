import type { Session } from '@/api';
import { CloseIcon, PlusIcon, TrashIcon } from '@/components/icons';
import { useSettings } from '@/features/settings/SettingsProvider';

/** 移动端会话抽屉 */
export function SessionDrawer({
  open,
  sessions,
  activeSessionId,
  onClose,
  onSelect,
  onCreate,
  onDelete,
}: {
  open: boolean;
  sessions: Session[];
  activeSessionId: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useSettings();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex lg:hidden">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 flex h-full w-72 flex-col border-r border-night-700 bg-night-900 p-4 shadow-panel">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-base font-bold text-gold-100">{t('chat.history')}</h2>
          <button
            onClick={onClose}
            aria-label={t('chat.closeSessions')}
            className="cursor-pointer rounded-lg p-1.5 text-ink-muted transition hover:text-ink"
          >
            <CloseIcon />
          </button>
        </div>
        <button
          onClick={onCreate}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gold-gradient px-4 py-2.5 text-sm font-medium text-accentInk"
        >
          <PlusIcon />
          {t('chat.newSession')}
        </button>
        <div className="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {sessions.length === 0 && (
            <p className="py-4 text-center text-xs text-ink-faint">{t('chat.noSessions')}</p>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition ${
                s.id === activeSessionId
                  ? 'border-gold/40 bg-gold/10 text-gold-100'
                  : 'border-transparent text-ink-muted hover:bg-night-800/60'
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{s.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(s.id);
                }}
                aria-label={t('chat.deleteSession', { title: s.title })}
                className="shrink-0 cursor-pointer rounded-md p-1 text-ink-faint transition hover:bg-cinnabar/20 hover:text-cinnabar"
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
