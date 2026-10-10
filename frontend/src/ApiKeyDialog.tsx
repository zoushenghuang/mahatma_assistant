import { useEffect, useState } from 'react';
import { api, type ApiKeyStatus } from './api';

/**
 * 「我的 Key」设置弹窗
 *
 * 每个用户填自己的 DeepSeek API Key：
 * - 明文只在提交时经过一次网络传输，服务端 AES-256-GCM 加密落库
 * - 查询接口只回脱敏值（sk-12******3456），明文永不下发
 */

/** 钥匙 · API Key */
export function KeyIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m10.7 12.3 8.3-8.3" />
      <path d="m16.5 6.5 2 2" />
      <path d="m19 4 2 2" />
    </svg>
  );
}

/** 关闭 */
function CloseIcon() {
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
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export default function ApiKeyDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (status: ApiKeyStatus) => void;
}) {
  const [status, setStatus] = useState<ApiKeyStatus | null>(null);
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    api.getApiKey().then(setStatus).catch(() => setStatus(null));
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!value.trim()) {
      setError('请输入 API Key');
      return;
    }
    setLoading(true);
    try {
      const next = await api.saveApiKey(value.trim());
      setStatus(next);
      setValue('');
      setNotice('已保存，之后的对话都会用你自己的 Key');
      onSaved(next);
    } catch (err: any) {
      setError(err?.message ?? '保存失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const remove = async () => {
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const next = await api.deleteApiKey();
      setStatus(next);
      setValue('');
      setNotice('已删除，需重新填写才能继续对话');
      onSaved(next);
    } catch (err: any) {
      setError(err?.message ?? '删除失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md animate-fade-up rounded-2xl border border-night-600 bg-night-800 p-6 shadow-panel">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-night-600 bg-gold/10 text-gold">
              <KeyIcon className="h-4.5 w-4.5" />
            </span>
            <div>
              <h2 className="font-display text-base font-bold text-gold-100">我的 API Key</h2>
              <p className="text-[11px] text-ink-faint">仅用于你本人的对话，不会给其他账号使用</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="cursor-pointer rounded-lg p-1.5 text-ink-muted transition hover:text-ink"
          >
            <CloseIcon />
          </button>
        </div>

        {/* 当前状态 */}
        <div className="mb-4 rounded-xl border border-night-600 bg-night-900/60 px-3 py-2.5">
          <p className="text-xs text-ink-muted">
            当前状态：
            {status?.hasKey ? (
              <span className="ml-1 text-gold">
                已设置 <span className="font-mono">{status.masked}</span>
              </span>
            ) : (
              <span className="ml-1 text-cinnabar-400">未设置</span>
            )}
          </p>
        </div>

        <form onSubmit={save} className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-muted">DeepSeek API Key</span>
            <div className="relative">
              <input
                type={show ? 'text' : 'password'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={status?.hasKey ? '已保存，输入新的可覆盖' : 'sk-xxxxxxxxxxxxxxxx'}
                className="w-full rounded-xl border border-night-600 bg-night-900/70 px-3 py-2.5 pr-16 font-mono text-xs text-ink outline-none transition placeholder:text-ink-faint focus:border-gold/60 focus:shadow-glow-gold-sm"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-md px-2 py-1 text-[11px] text-ink-faint transition hover:text-gold"
              >
                {show ? '隐藏' : '显示'}
              </button>
            </div>
          </label>

          <p className="text-[11px] leading-relaxed text-ink-faint">
            在
            <span className="text-ink-muted"> platform.deepseek.com </span>
            申请；服务端 AES-256-GCM 加密存储，列表/查询只返回脱敏值。
          </p>

          {error && (
            <p className="rounded-xl border border-cinnabar/40 bg-cinnabar/10 px-3 py-2 text-sm text-cinnabar-400">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-xl border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-gold-100">
              {notice}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 cursor-pointer rounded-xl bg-gold-gradient px-4 py-2.5 text-sm font-semibold text-night transition hover:brightness-110 hover:shadow-glow-gold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? '保存中…' : '保存'}
            </button>
            {status?.hasKey && (
              <button
                type="button"
                onClick={remove}
                disabled={loading}
                className="cursor-pointer rounded-xl border border-cinnabar/40 px-4 py-2.5 text-sm text-cinnabar-400 transition hover:bg-cinnabar/10 disabled:opacity-50"
              >
                删除
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
