import { useState } from 'react';
import { api, setToken, type User } from './api';

/**
 * 登录 / 注册 / 忘记密码（暗黑中国神话主题，与聊天页同一套设计令牌）
 *
 * 流程：
 * login → 注册 / 忘记密码
 * register → 注册成功直接登录
 * forgot（账号 + 邮箱）→ 拿到重置令牌 → reset（新密码）→ 回登录
 */

type Mode = 'login' | 'register' | 'forgot' | 'reset';

/** 金箍棒徽章 */
function StaffLogo({ className = 'h-12 w-12' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <circle cx="20" cy="20" r="19" fill="#12151E" stroke="#F0B429" strokeWidth="1.5" />
      <rect x="18" y="6" width="4" height="28" rx="2" fill="#F0B429" />
      <rect x="14.5" y="9" width="11" height="4" rx="2" fill="#E5484D" />
      <rect x="14.5" y="27" width="11" height="4" rx="2" fill="#E5484D" />
      <path d="M20 3.5c1.5 2 1.5 3 0 4.5-1.5-1.5-1.5-2.5 0-4.5z" fill="#FFD97A" />
      <path d="M20 32c1.5 2 1.5 3 0 4.5-1.5-1.5-1.5-2.5 0-4.5z" fill="#FFD97A" />
    </svg>
  );
}

/** 眼睛 · 显示/隐藏密码 */
function EyeIcon({ off }: { off?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

const TITLES: Record<Mode, { title: string; sub: string }> = {
  login: { title: '登录大圣助手', sub: '金箍棒在手，法宝随时调用' },
  register: { title: '注册新账号', sub: '一个账号，开启七十二变' },
  forgot: { title: '找回密码', sub: '验证账号与预留邮箱' },
  reset: { title: '设置新密码', sub: '验证通过，请输入新密码' },
};

export default function AuthPage({ onAuthed }: { onAuthed: (user: User) => void }) {
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

    if (mode === 'register' && password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    if (mode === 'reset' && password !== confirm) {
      setError('两次输入的密码不一致');
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
        setNotice('验证通过！演示环境未接入邮件服务，重置令牌已生成并自动填入下一步。');
        return;
      }
      // reset
      const res = await api.resetPassword({ token: resetToken, password });
      switchMode('login');
      setNotice(`密码已重置，请用账号 ${res.username} 重新登录`);
    } catch (err: any) {
      setError(err?.message ?? '操作失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const meta = TITLES[mode];

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
            <Field label="账号" hint="3-20 位字母、数字或下划线">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                placeholder="请输入账号"
                className={inputCls}
                required
              />
            </Field>
          )}

          {/* 邮箱（找回密码时用于验证身份） */}
          {(mode === 'register' || mode === 'forgot') && (
            <Field label="邮箱" hint="用于找回密码">
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
            <Field label="昵称" hint="选填，默认与账号相同">
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="怎么称呼你？"
                className={inputCls}
              />
            </Field>
          )}

          {/* 密码 */}
          {mode !== 'forgot' && (
            <Field label={mode === 'reset' ? '新密码' : '密码'} hint="至少 8 位">
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  placeholder="请输入密码"
                  className={`${inputCls} pr-10`}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  aria-label={showPwd ? '隐藏密码' : '显示密码'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-1.5 text-ink-faint transition hover:text-gold"
                >
                  <EyeIcon off={showPwd} />
                </button>
              </div>
            </Field>
          )}

          {/* 确认密码 */}
          {(mode === 'register' || mode === 'reset') && (
            <Field label="确认密码">
              <input
                type={showPwd ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="再输入一次密码"
                className={inputCls}
                required
              />
            </Field>
          )}

          {/* 重置令牌（演示环境展示，便于直接复制） */}
          {mode === 'reset' && (
            <Field label="重置令牌" hint="演示环境直接返回；接入邮件后由链接携带">
              <input
                value={resetToken}
                onChange={(e) => setResetToken(e.target.value)}
                placeholder="重置令牌"
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
            className="w-full cursor-pointer rounded-xl bg-gold-gradient px-4 py-3 text-sm font-semibold text-night transition hover:brightness-110 hover:shadow-glow-gold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading
              ? '处理中…'
              : mode === 'login'
                ? '登录'
                : mode === 'register'
                  ? '注册并登录'
                  : mode === 'forgot'
                    ? '验证身份'
                    : '重置密码'}
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
                  没有账号？立即注册
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('forgot')}
                  className="cursor-pointer transition hover:text-gold"
                >
                  忘记密码？
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="cursor-pointer transition hover:text-gold"
              >
                返回登录
              </button>
            )}
          </div>
        </form>

        {/* 演示账号提示 */}
        {mode === 'login' && (
          <p className="mt-4 text-center text-[11px] leading-relaxed text-ink-faint">
            演示账号：<span className="text-ink-muted">demo / demo1234</span> ·
            <span className="text-ink-muted"> wukong / wukong1234</span>
          </p>
        )}
      </div>
    </div>
  );
}

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
