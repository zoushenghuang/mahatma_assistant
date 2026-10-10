import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type KnowledgeDoc } from './api';
import { useSettings } from './settings';

/**
 * 「我的知识库」弹窗（RAG 数据源管理）
 *
 * 上传流程：前端把文件读成 base64 → POST /api/documents →
 * 后端解析文本 → 切分为若干片段（chunk）入 MySQL；
 * 之后在对话中提问时，模型会通过 searchKnowledge 工具检索这些片段。
 *
 * 文档数据按 user_id 隔离，只对当前登录用户可见。
 */

/** 单文件大小上限（与后端 FILE_MAX_BYTES 保持一致） */
const MAX_MB = 8;

/** 书本 · 知识库 */
export function BookIcon({ className = 'h-4 w-4' }: { className?: string }) {
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
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

/** 上传 · 向上箭头 */
function UploadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5" />
      <path d="M12 3v12" />
    </svg>
  );
}

/** 文件 · 文档 */
function FileIcon() {
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
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

/** 垃圾桶 */
function TrashIcon() {
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
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
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

/** 人类可读的文件大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 读取本地文件为 base64（去掉 data URL 前缀） */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

export default function KnowledgeDialog({
  onClose,
  onCountChange,
}: {
  onClose: () => void;
  onCountChange?: (count: number) => void;
}) {
  const { t } = useSettings();
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const sync = useCallback(
    (list: KnowledgeDoc[]) => {
      setDocs(list);
      onCountChange?.(list.length);
    },
    [onCountChange],
  );

  // 首次加载文档列表
  useEffect(() => {
    api
      .listDocuments()
      .then((list) => sync(list))
      .catch(() => setError(t('knowledge.uploadFailed')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  /** 逐个上传文件（串行，便于展示进度） */
  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setError('');
    setNotice('');
    setBusy(true);

    const next = [...docs];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgress(`${i + 1}/${files.length}`);

      if (file.size > MAX_MB * 1024 * 1024) {
        setError(t('knowledge.tooLarge', { name: file.name, size: MAX_MB }));
        continue;
      }

      try {
        const data = await readAsBase64(file);
        const doc = await api.uploadDocument({
          filename: file.name,
          mime: file.type || '',
          data,
        });
        next.unshift(doc);
        setDocs([...next]);
        onCountChange?.(next.length);
        if (doc.status === 'failed') {
          setError(doc.error ?? t('knowledge.uploadFailed'));
        } else {
          setNotice(t('knowledge.uploaded', { name: doc.filename, count: doc.chunkCount }));
        }
      } catch (err: any) {
        setError(err?.message ?? t('knowledge.uploadFailed'));
      }
    }

    setProgress('');
    setBusy(false);
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // 允许重复选择同一文件
    uploadFiles(files);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    uploadFiles(Array.from(e.dataTransfer.files ?? []));
  };

  const remove = async (doc: KnowledgeDoc) => {
    setError('');
    setNotice('');
    try {
      await api.deleteDocument(doc.id);
      const list = await api.listDocuments();
      sync(list);
    } catch {
      setError(t('knowledge.removeFailed'));
    }
  };

  /** 状态徽标 */
  const statusBadge = (doc: KnowledgeDoc) => {
    if (doc.status === 'failed') {
      return <span className="text-cinnabar-400">{t('knowledge.statusFailed')}</span>;
    }
    if (doc.status === 'pending') {
      return <span className="text-ink-faint">{t('knowledge.statusPending')}</span>;
    }
    return <span className="text-gold">{t('knowledge.statusReady')}</span>;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={() => !busy && onClose()} />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col animate-fade-up rounded-2xl border border-night-600 bg-night-800 p-6 shadow-panel">
        {/* 头部 */}
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-night-600 bg-gold/10 text-gold">
              <BookIcon className="h-4 w-4" />
            </span>
            <div>
              <h2 className="font-display text-base font-bold text-gold-100">{t('knowledge.title')}</h2>
              <p className="text-[11px] text-ink-faint">{t('knowledge.sub')}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label={t('knowledge.close')}
            className="cursor-pointer rounded-lg p-1.5 text-ink-muted transition hover:text-ink disabled:opacity-40"
          >
            <CloseIcon />
          </button>
        </div>

        {/* 上传区（点击 / 拖拽） */}
        <button
          type="button"
          onClick={() => !busy && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          disabled={busy}
          className={`flex w-full cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition disabled:cursor-not-allowed ${
            dragging
              ? 'border-gold/70 bg-gold/10'
              : 'border-night-600 bg-night-900/50 hover:border-gold/50 hover:bg-night-900/70'
          }`}
        >
          <span className="text-gold">
            <UploadIcon />
          </span>
          <span className="text-sm font-medium text-ink">
            {busy ? `${t('knowledge.processing')} ${progress}` : t('knowledge.upload')}
          </span>
          <span className="text-[11px] text-ink-faint">{t('knowledge.dragHint')}</span>
          <span className="text-[11px] text-ink-faint">
            {t('knowledge.uploadHint', { types: 'txt / md / json / csv / pdf / docx', size: MAX_MB })}
          </span>
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={onPick}
          accept=".txt,.md,.markdown,.json,.csv,.tsv,.log,.yml,.yaml,.xml,.html,.htm,.pdf,.docx,.js,.ts,.tsx,.jsx,.py,.java,.go,.rs,.c,.cpp,.h,.cs,.rb,.php,.sh,.sql,.css,.scss,.ini,.conf"
        />

        {/* 提示 / 错误 */}
        {error && (
          <p className="mt-3 rounded-xl border border-cinnabar/40 bg-cinnabar/10 px-3 py-2 text-xs text-cinnabar-400">
            {error}
          </p>
        )}
        {notice && !error && (
          <p className="mt-3 rounded-xl border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-gold-100">
            {notice}
          </p>
        )}

        {/* 文档列表 */}
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-[11px] font-medium uppercase tracking-widest text-ink-faint">
              {t('knowledge.total', { count: docs.length })}
            </span>
          </div>

          {loading ? (
            <p className="py-6 text-center text-xs text-ink-faint">{t('knowledge.processing')}</p>
          ) : docs.length === 0 ? (
            <p className="py-6 text-center text-xs text-ink-faint">{t('knowledge.empty')}</p>
          ) : (
            <div className="space-y-2">
              {docs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-start gap-3 rounded-xl border border-night-700/60 bg-night-900/60 px-3 py-2.5"
                >
                  <span className="mt-0.5 shrink-0 text-ink-faint">
                    <FileIcon />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-ink" title={doc.filename}>
                      {doc.filename}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-faint">
                      <span>{statusBadge(doc)}</span>
                      {doc.status === 'ready' && <span>· {t('knowledge.chunks', { count: doc.chunkCount })}</span>}
                      <span>· {formatSize(doc.size)}</span>
                    </p>
                    {doc.status === 'failed' && doc.error && (
                      <p className="mt-1 break-all text-[11px] leading-relaxed text-cinnabar-400">{doc.error}</p>
                    )}
                  </div>
                  <button
                    onClick={() => remove(doc)}
                    disabled={busy}
                    aria-label={t('knowledge.delete', { name: doc.filename })}
                    className="shrink-0 cursor-pointer rounded-md p-1 text-ink-faint transition hover:bg-cinnabar/20 hover:text-cinnabar disabled:opacity-40"
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 使用提示 */}
        <p className="mt-4 border-t border-night-700/60 pt-3 text-[11px] leading-relaxed text-ink-faint">
          {t('knowledge.usage')}
        </p>
      </div>
    </div>
  );
}
