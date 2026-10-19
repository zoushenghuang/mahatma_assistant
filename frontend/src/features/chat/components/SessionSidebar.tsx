import type { Session } from '@/api';
import { HistoryIcon, PlusIcon, StaffLogo, TrashIcon } from '@/components/icons';
import { useSettings } from '@/features/settings/SettingsProvider';

/** 桌面端左侧品牌栏 + 会话列表 */
export function SessionSidebar({
  sessions,
  activeSessionId,
  onSelect,
  onCreate,
  onDelete,
}: {
  sessions: Session[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useSettings();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-night-700/60 bg-night-900/60 lg:flex">
      {/* 品牌区 */}
      <div className="flex items-center gap-3 px-6 py-5">
        <StaffLogo className="h-10 w-10 drop-shadow-glow-gold-sm" />
        <div>
          <h1 className="font-display text-lg font-bold tracking-wide text-gold-100">
            {t('app.name')}
          </h1>
          <p className="text-xs text-ink-faint">{t('app.tagline')}</p>
        </div>
      </div>

      {/* 新建会话 */}
      <div className="px-4">
        <button
          onClick={onCreate}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gold-gradient px-4 py-2.5 text-sm font-medium text-accentInk transition hover:brightness-110 hover:shadow-glow-gold"
        >
          <PlusIcon />
          {t('chat.newSession')}
        </button>
      </div>

      {/* 会话列表 */}
      <div className="mt-4 flex min-h-0 flex-1 flex-col px-3">
        <p className="px-2 pb-2 text-[11px] font-medium uppercase tracking-widest text-ink-faint">
          {t('chat.history')}
        </p>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {sessions.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-ink-faint">{t('chat.noSessions')}</p>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={`group flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 transition ${
                s.id === activeSessionId
                  ? 'border-gold/40 bg-gold/10 text-gold-100'
                  : 'border-transparent text-ink-muted hover:border-night-600 hover:bg-night-800/60 hover:text-ink'
              }`}
            >
              <HistoryIcon />
              <span className="min-w-0 flex-1 truncate text-sm">{s.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(s.id);
                }}
                aria-label={t('chat.deleteSession', { title: s.title })}
                className="shrink-0 cursor-pointer rounded-md p-1 text-ink-faint opacity-0 transition hover:bg-cinnabar/20 hover:text-cinnabar group-hover:opacity-100"
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 底部说明 */}
      <div className="px-4 py-4 text-[11px] leading-relaxed text-ink-faint">{t('chat.footer')}</div>
    </aside>
  );
}
