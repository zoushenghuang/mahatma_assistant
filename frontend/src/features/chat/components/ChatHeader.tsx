import { useRef, useState } from 'react';
import type { User } from '@/api';
import {
  BookIcon,
  ChevronIcon,
  HistoryIcon,
  KeyIcon,
  LogoutIcon,
  SettingsIcon,
  StaffLogo,
} from '@/components/icons';
import { useSettings } from '@/features/settings/SettingsProvider';
import { useOnClickOutside } from '@/shared/hooks/useOnClickOutside';

/** 顶部栏：会话入口 + 当前标题 + 知识库 / Key / 用户菜单 */
export function ChatHeader({
  user,
  sessionTitle,
  needKey,
  docCount,
  onOpenSessions,
  onOpenKnowledge,
  onOpenKey,
  onOpenSettings,
  onLogout,
}: {
  user: User;
  sessionTitle?: string;
  needKey: boolean;
  docCount: number;
  onOpenSessions: () => void;
  onOpenKnowledge: () => void;
  onOpenKey: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}) {
  const { t } = useSettings();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(menuRef, () => setMenuOpen(false), menuOpen);

  const displayName = user.nickname || user.username;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-night-700/60 bg-night-900/40 px-4 backdrop-blur">
      <div className="flex items-center gap-3">
        {/* 移动端：会话列表抽屉入口 */}
        <button
          onClick={onOpenSessions}
          aria-label={t('chat.openSessions')}
          className="cursor-pointer rounded-lg border border-night-600 p-1.5 text-ink-muted transition hover:border-gold/40 hover:text-gold lg:hidden"
        >
          <HistoryIcon />
        </button>
        <StaffLogo className="h-8 w-8 lg:hidden" />
        <h1 className="font-display text-base font-bold tracking-wide text-gold-100 lg:hidden">
          {t('app.name')}
        </h1>
        {/* 桌面端：当前会话标题 + 在线状态 */}
        <div className="hidden items-center gap-2 lg:flex">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-gold" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-gold" />
          </span>
          <span className="max-w-[260px] truncate text-sm text-ink-muted">
            {sessionTitle ?? t('chat.online')}
          </span>
        </div>
      </div>

      {/* 右侧：知识库 + 我的 Key + 用户头像 */}
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenKnowledge}
          title={t('knowledge.title')}
          className="relative flex cursor-pointer items-center gap-1.5 rounded-xl border border-night-600 px-2.5 py-1.5 text-xs text-ink-muted transition hover:border-gold/40 hover:text-gold"
        >
          <BookIcon />
          <span className="hidden sm:inline">{t('knowledge.entry')}</span>
          {docCount > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 font-display text-[10px] font-bold text-accentInk">
              {docCount}
            </span>
          )}
        </button>

        <button
          onClick={onOpenKey}
          title={t('key.title')}
          className={`flex cursor-pointer items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs transition ${
            needKey
              ? 'border-cinnabar/50 text-cinnabar-400 hover:bg-cinnabar/10'
              : 'border-night-600 text-ink-muted hover:border-gold/40 hover:text-gold'
          }`}
        >
          <KeyIcon />
          <span className="hidden sm:inline">{t('chat.myKey')}</span>
          <span
            className={`h-1.5 w-1.5 rounded-full ${needKey ? 'bg-cinnabar' : 'bg-gold'}`}
            aria-hidden="true"
          />
        </button>

        {/* 头像 → 下拉菜单（设置 / 退出登录） */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            title={displayName}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className={`flex max-w-[160px] cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-1.5 transition ${
              menuOpen
                ? 'border-gold/50 bg-night-800 text-ink'
                : 'border-night-600 bg-night-800/60 text-ink-muted hover:border-gold/40 hover:text-ink'
            }`}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gold/15 font-display text-xs font-bold text-gold">
              {displayName.slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate text-xs">{displayName}</span>
            <span className="shrink-0 text-ink-faint">
              <ChevronIcon open={menuOpen} className="h-3 w-3" />
            </span>
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-40 mt-2 w-40 animate-fade-in overflow-hidden rounded-xl border border-night-600 bg-night-800 py-1 shadow-panel"
            >
              <div className="border-b border-night-700/60 px-3 pb-1.5 pt-1">
                <p className="truncate text-xs font-medium text-ink">{displayName}</p>
                <p className="truncate text-[11px] text-ink-faint">{user.email}</p>
              </div>
              <button
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenSettings();
                }}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-ink-muted transition hover:bg-night-700/60 hover:text-ink"
              >
                <SettingsIcon />
                {t('common.settings')}
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onLogout();
                }}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-ink-muted transition hover:bg-cinnabar/10 hover:text-cinnabar-400"
              >
                <LogoutIcon />
                {t('common.logout')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
