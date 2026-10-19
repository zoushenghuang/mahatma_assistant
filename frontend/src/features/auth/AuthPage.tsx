import { useState } from 'react';
import { api, setToken, type User } from '@/api';
import { EyeIcon, StaffLogo } from '@/components/icons';
import { useSettings } from '@/features/settings/SettingsProvider';

/**
 * 登录 / 注册 / 忘记密码（暗黑中国神话主题，与聊天页同一套设计令牌）
 *
 * 流程：
 * login → 注册 / 忘记密码
 * register → 注册成功直接登录
 * forgot（账号 + 邮箱）→ 拿到重置令牌 → reset（新密码）→ 回登录
 */

type Mode = 'login' | 'register' | 'forgot' | 'reset';

const inputCls =
  'w-full rounded-xl border border-night-600 bg-night-900/70 px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-gold/60 focus:shadow-glow-gold-sm';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-2">
        <span className="text-xs font-medium text-ink-muted">{label}</span>
        {hint && <span className="text-[11px] text-ink-faint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export default function AuthPage({ onAuthed }: { onAuthed: (user: User) => void }) {
  const { t } = useSettings();
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
    setNotice('');
    setPassword('');
    setConfirm('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');

    if ((mode === 'register' || mode === 'reset') && password !== confirm) {
      setError(t('auth.passwordMismatch'));
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        const res = await api.login({ username, password });
        setToken(res.token);
        onAuthed(res.user);
        return;
      }
      if (mode === 'register') {
        const res = await api.register({ username, password, email, nickname });
        setToken(res.token);
        onAuthed(res.user);
        return;
      }
      if (mode === 'forgot') {
        const res = await api.forgotPassword({ username, email });
        setResetToken(res.resetToken);
        switchMode('reset');
        setNotice(t('auth.forgotNotice'));
        return;
      }
      // reset
      const res = await api.resetPassword({ token: resetToken, password });
      switchMode('login');
      setNotice(t('auth.resetNotice', { username: res.username }));
    } catch (err) {
      setError((err as Error)?.message ?? t('auth.failed'));
    } finally {
      setLoading(false);
    }
  };

  const meta = {
    login: { title: t('auth.loginTitle'), sub: t('auth.loginSub') },
    register: { title: t('auth.registerTitle'), sub: t('auth.registerSub') },
    forgot: { title: t('auth.forgotTitle'), sub: t('auth.forgotSub') },
    reset: { title: t('auth.resetTitle'), sub: t('auth.resetSub') },
  }[mode];

  return (
    <div className="flex min-h-screen items-center justify-center bg-night px-4 py-10">
      {/* 背景光晕 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-32 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-gold/10 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-cinnabar/5 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md animate-fade-up">
        {/* 品牌 */}
        <div className="mb-8 flex flex-col items-center">
          <div className="relative flex h-20 w-20 items-center justify-center">
            <span className="absolute inset-0 animate-pulse-ring rounded-3xl border border-gold/40" />
            <StaffLogo className="h-20 w-20 drop-shadow-glow-gold-sm" />
          </div>
          <h1 className="mt-5 font-display text-2xl font-bold tracking-wide text-gold-100">
            {meta.title}
          </h1>
          <p className="mt-1.5 text-sm text-ink-muted">{meta.sub}</p>
        </div>

        <form
          onSubmit={submit}
          className="space-y-4 rounded-2xl border border-night-600 bg-night-800/70 p-6 shadow-panel backdrop-blur"
        >
          {/* 账号 */}
          {mode !== 'reset' && (
            <Field label={t('auth.username')} hint={t('auth.usernameHint')}>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                placeholder={t('auth.usernamePlaceholder')}
                className={inputCls}
                required
              />
            </Field>
          )}

          {/* 邮箱（找回密码时用于验证身份） */}
          {(mode === 'register' || mode === 'forgot') && (
            <Field label={t('auth.email')} hint={t('auth.emailHint')}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={inputCls}
                required
              />
            </Field>
          )}

          {/* 昵称（仅注册） */}
          {mode === 'register' && (
            <Field label={t('auth.nickname')} hint={t('auth.nicknameHint')}>
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={t('auth.nicknamePlaceholder')}
                className={inputCls}
              />
            </Field>
          )}

          {/* 密码 */}
          {mode !== 'forgot' && (
            <Field
              label={mode === 'reset' ? t('auth.newPassword') : t('auth.password')}
              hint={t('auth.passwordHint')}
            >
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  placeholder={t('auth.passwordPlaceholder')}
                  className={`${inputCls} pr-10`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  aria-label={showPwd ? t('auth.hidePassword') : t('auth.showPassword')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-1.5 text-ink-faint transition hover:text-gold"
                >
                  <EyeIcon off={showPwd} />
                </button>
              </div>
            </Field>
          )}

          {/* 确认密码 */}
          {(mode === 'register' || mode === 'reset') && (
            <Field label={t('auth.confirmPassword')}>
              <input
                type={showPwd ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={t('auth.confirmPlaceholder')}
                className={inputCls}
                required
              />
            </Field>
          )}

          {/* 重置令牌（演示环境展示，便于直接复制） */}
          {mode === 'reset' && (
            <Field label={t('auth.resetToken')} hint={t('auth.resetTokenHint')}>
              <input
                value={resetToken}
                onChange={(e) => setResetToken(e.target.value)}
                placeholder={t('auth.resetTokenPlaceholder')}
                className={`${inputCls} font-mono text-xs`}
                required
              />
            </Field>
          )}

          {/* 提示 */}
          {error && (
            <p className="rounded-xl border border-cinnabar/40 bg-cinnabar/10 px-3 py-2 text-sm text-cinnabar-400">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-xl border border-gold/40 bg-gold/10 px-3 py-2 text-sm leading-relaxed text-gold-100">
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full cursor-pointer rounded-xl bg-gold-gradient px-4 py-3 text-sm font-semibold text-accentInk transition hover:brightness-110 hover:shadow-glow-gold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading
              ? t('auth.processing')
              : mode === 'login'
                ? t('auth.login')
                : mode === 'register'
                  ? t('auth.registerAndLogin')
                  : mode === 'forgot'
                    ? t('auth.verify')
                    : t('auth.submitReset')}
          </button>

          {/* 模式切换 */}
          <div className="flex items-center justify-between text-xs text-ink-muted">
            {mode === 'login' ? (
              <>
                <button
                  type="button"
                  onClick={() => switchMode('register')}
                  className="cursor-pointer transition hover:text-gold"
                >
                  {t('auth.toRegister')}
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className="cursor-pointer transition hover:text-gold"
                >
                  {t('auth.toForgot')}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="cursor-pointer transition hover:text-gold"
              >
                {t('auth.backToLogin')}
              </button>
            )}
          </div>
        </form>

        {/* 演示账号提示 */}
        {mode === 'login' && (
          <p className="mt-4 text-center text-[11px] leading-relaxed text-ink-faint">
            {t('auth.demoAccounts')}
            <span className="text-ink-muted">demo / demo1234</span> ·
            <span className="text-ink-muted"> wukong / wukong1234</span>
          </p>
        )}
      </div>
    </div>
  );
}
