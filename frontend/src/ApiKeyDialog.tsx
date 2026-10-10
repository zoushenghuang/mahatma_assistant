import { useEffect, useState } from 'react';
import { api, type ApiKeyStatus } from './api';
import { useSettings } from './settings';

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
  const { t } = useSettings();
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
      setError(t('key.empty'));
      return;
    }
    setLoading(true);
    try {
      const next = await api.saveApiKey(value.trim());
      setStatus(next);
      setValue('');
      setNotice(t('key.saved'));
      onSaved(next);
    } catch (err: any) {
      setError(err?.message ?? t('key.saveFailed'));
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
      setNotice(t('key.removed'));
      onSaved(next);
    } catch (err: any) {
      setError(err?.message ?? t('key.removeFailed'));
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
              <h2 className="font-display text-base font-bold text-gold-100">{t('key.title')}</h2>
              <p className="text-[11px] text-ink-faint">{t('key.sub')}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="cursor-pointer rounded-lg p-1.5 text-ink-muted transition hover:text-ink"
          >
            <CloseIcon />
          </button>
        </div>

        {/* 当前状态 */}
        <div className="mb-4 rounded-xl border border-night-600 bg-night-900/60 px-3 py-2.5">
          <p className="text-xs text-ink-muted">
            {t('key.statusLabel')}
            {status?.hasKey ? (
              <span className="ml-1 text-gold">
                {t('key.configured')} <span className="font-mono">{status.masked}</span>
              </span>
            ) : (
              <span className="ml-1 text-cinnabar-400">{t('key.notConfigured')}</span>
            )}
          </p>
        </div>

        <form onSubmit={save} className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-muted">{t('key.field')}</span>
            <div className="relative">
              <input
                type={show ? 'text' : 'password'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={status?.hasKey ? t('key.placeholderReplace') : 'sk-xxxxxxxxxxxxxxxx'}
                className="w-full rounded-xl border border-night-600 bg-night-900/70 px-3 py-2.5 pr-16 font-mono text-xs text-ink outline-none transition placeholder:text-ink-faint focus:border-gold/60 focus:shadow-glow-gold-sm"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-md px-2 py-1 text-[11px] text-ink-faint transition hover:text-gold"
              >
                {show ? t('key.hide') : t('key.show')}
              </button>
            </div>
          </label>

          <p className="text-[11px] leading-relaxed text-ink-faint">{t('key.help')}</p>

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
              className="flex-1 cursor-pointer rounded-xl bg-gold-gradient px-4 py-2.5 text-sm font-semibold text-accentInk transition hover:brightness-110 hover:shadow-glow-gold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? t('key.saving') : t('key.save')}
            </button>
            {status?.hasKey && (
              <button
                type="button"
                onClick={remove}
                disabled={loading}
                className="cursor-pointer rounded-xl border border-cinnabar/40 px-4 py-2.5 text-sm text-cinnabar-400 transition hover:bg-cinnabar/10 disabled:opacity-50"
              >
                {t('key.delete')}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
