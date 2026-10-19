import { useCallback, useEffect, useState } from 'react';
import { api, clearToken, getToken, setUnauthorizedHandler, type User } from '@/api';
import AuthPage from '@/features/auth/AuthPage';
import ChatPage from '@/features/chat/ChatPage';
import { useSettings } from '@/features/settings/SettingsProvider';

/**
 * 应用入口：未登录 → 登录/注册页；已登录 → 聊天主界面
 * 刷新时先用本地 token 换一次 /api/auth/me，失效则回到登录页。
 */
export default function App() {
  const { t } = useSettings();
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // 登录失效统一回到登录页
    setUnauthorizedHandler(() => setUser(null));

    if (!getToken()) {
      setChecking(false);
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  // 校验登录态时的加载占位
  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center bg-night">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-night-600 border-t-gold" />
          <p className="text-sm text-ink-faint">{t('app.checking')}</p>
        </div>
      </div>
    );
  }

  if (!user) return <AuthPage onAuthed={setUser} />;
  return <ChatPage user={user} onLogout={logout} />;
}
