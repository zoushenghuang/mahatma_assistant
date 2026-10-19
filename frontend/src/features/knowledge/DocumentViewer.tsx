import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { api, type DocumentChunk, type DocumentDetail, type KnowledgeDoc } from '@/api';
import { CloseIcon, DownloadIcon, SearchIcon, TrashIcon } from '@/components/icons';
import { Modal } from '@/components/ui/Modal';
import { useSettings } from '@/features/settings/SettingsProvider';
import { formatSize, saveBlob } from '@/shared/lib/format';
import { buildMarkup } from './utils';

/**
 * 文档预览器（知识库的「打开看」）
 *
 * 三个视角：
 * - 全文：解析出的纯文本，支持关键字高亮 / 上下跳转；超长文档按需加载完整全文
 * - 切片：RAG 实际入库的片段，便于排查「为什么没检索到」
 * - 原文件：PDF / 图片内联渲染，Word 等格式提供下载
 *
 * 原文件与全文都走带 Authorization 的 fetch → Blob，避免把 token 暴露在 URL 上。
 */

type Tab = 'text' | 'chunks' | 'file';

export default function DocumentViewer({
  doc,
  onClose,
  onDeleted,
}: {
  doc: KnowledgeDoc;
  onClose: () => void;
  onDeleted?: (id: string) => void;
}) {
  const { t } = useSettings();

  const [tab, setTab] = useState<Tab>('text');
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fullText, setFullText] = useState('');

  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [matchIndex, setMatchIndex] = useState(0);
  const textRef = useRef<HTMLDivElement>(null);

  const [chunks, setChunks] = useState<DocumentChunk[] | null>(null);
  const [chunksLoading, setChunksLoading] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);

  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState('');

  const text = fullText || detail?.text || '';
  const markup = useMemo(() => buildMarkup(text, deferredQuery), [text, deferredQuery]);

  // 加载文档详情
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getDocument(doc.id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error)?.message ?? t('viewer.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  // Blob URL 回收
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  // 切片按需加载
  useEffect(() => {
    if (tab !== 'chunks' || chunks !== null || chunksLoading) return;
    let cancelled = false;
    setChunksLoading(true);
    api
      .getDocumentChunks(doc.id)
      .then((list) => {
        if (!cancelled) setChunks(list);
      })
      .catch(() => {
        if (!cancelled) setChunks([]);
      })
      .finally(() => {
        if (!cancelled) setChunksLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, doc.id, chunks, chunksLoading]);

  // 原文件按需加载（仅 PDF / 图片需要内联渲染）
  useEffect(() => {
    if (tab !== 'file' || !doc.hasOriginal || blobUrl) return;
    if (doc.kind !== 'pdf' && doc.kind !== 'image') return;

    let cancelled = false;
    setFileLoading(true);
    api
      .getDocumentFile(doc.id)
      .then((blob) => {
        if (!cancelled) setBlobUrl(URL.createObjectURL(blob));
      })
      .catch((err) => {
        if (!cancelled) setFileError((err as Error)?.message ?? t('viewer.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, doc.id, doc.hasOriginal, doc.kind]);

  // 查询词变化 → 回到第一处并滚动
  useEffect(() => {
    setMatchIndex(0);
  }, [deferredQuery]);

  useEffect(() => {
    const root = textRef.current;
    if (!root) return;
    const marks = root.querySelectorAll('mark');
    marks.forEach((m, i) => {
      m.className = i === matchIndex ? 'active' : '';
    });
    if (marks[matchIndex]) {
      marks[matchIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [markup, matchIndex]);

  const loadFull = useCallback(async () => {
    setError('');
    try {
      const all = await api.getDocumentText(doc.id);
      setFullText(all);
    } catch (err) {
      setError((err as Error)?.message ?? t('viewer.loadFailed'));
    }
  }, [doc.id, t]);

  const downloadOriginal = async () => {
    setError('');
    try {
      const blob = await api.getDocumentFile(doc.id);
      saveBlob(blob, doc.filename);
    } catch (err) {
      setError((err as Error)?.message ?? t('viewer.downloadFailed'));
    }
  };

  const downloadText = async () => {
    setError('');
    try {
      const all = text || (await api.getDocumentText(doc.id));
      saveBlob(new Blob([all], { type: 'text/plain;charset=utf-8' }), `${doc.filename}.txt`);
    } catch (err) {
      setError((err as Error)?.message ?? t('viewer.downloadFailed'));
    }
  };

  const remove = async () => {
    if (!window.confirm(t('viewer.deleteConfirm', { name: doc.filename }))) return;
    try {
      await api.deleteDocument(doc.id);
      onDeleted?.(doc.id);
      onClose();
    } catch {
      setError(t('viewer.deleteFailed'));
    }
  };

  const copyChunk = async (chunk: DocumentChunk) => {
    try {
      await navigator.clipboard.writeText(chunk.content);
      setCopied(chunk.index);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // 剪贴板不可用时静默失败
    }
  };

  const chars = fullText.length || detail?.textLength || doc.textLength || 0;
  const truncation = Boolean(detail?.truncated && !fullText);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'text', label: t('viewer.tabText') },
    { key: 'chunks', label: t('viewer.tabChunks') },
    { key: 'file', label: t('viewer.tabFile') },
  ];

  return (
    <Modal
      onClose={onClose}
      ariaLabel={doc.filename}
      layer="top"
      panelClassName="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden animate-fade-up rounded-2xl border border-night-600 bg-night-800 shadow-panel"
    >
      {/* 头部 */}
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-night-700/60 px-5 py-3.5">
        <div className="min-w-0">
          <h2
            className="truncate font-display text-sm font-bold text-gold-100"
            title={doc.filename}
          >
            {doc.filename}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-ink-faint">
            <span>
              {t('viewer.meta', {
                size: formatSize(doc.size),
                chars,
                chunks: doc.chunkCount,
              })}
            </span>
            {doc.status === 'failed' && (
              <span className="text-cinnabar-400">· {t('knowledge.statusFailed')}</span>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {doc.hasOriginal && (
            <button
              onClick={downloadOriginal}
              title={t('viewer.downloadOriginal')}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-night-600 px-2.5 py-1.5 text-[11px] text-ink-muted transition hover:border-gold/40 hover:text-gold"
            >
              <DownloadIcon />
              <span className="hidden sm:inline">{t('viewer.downloadOriginal')}</span>
            </button>
          )}
          {doc.textLength > 0 && (
            <button
              onClick={downloadText}
              title={t('viewer.downloadText')}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-night-600 px-2.5 py-1.5 text-[11px] text-ink-muted transition hover:border-gold/40 hover:text-gold"
            >
              <DownloadIcon />
              <span className="hidden sm:inline">{t('viewer.downloadText')}</span>
            </button>
          )}
          <button
            onClick={remove}
            title={t('viewer.delete')}
            aria-label={t('viewer.delete')}
            className="cursor-pointer rounded-lg border border-night-600 p-1.5 text-ink-muted transition hover:border-cinnabar/50 hover:bg-cinnabar/10 hover:text-cinnabar-400"
          >
            <TrashIcon />
          </button>
          <button
            onClick={onClose}
            title={t('viewer.close')}
            aria-label={t('viewer.close')}
            className="cursor-pointer rounded-lg p-1.5 text-ink-muted transition hover:text-ink"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {/* 页签 + 文档内搜索 */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-night-700/60 px-5 py-2">
        <div className="flex items-center gap-1 rounded-lg border border-night-700 bg-night-900/60 p-0.5">
          {tabs.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              aria-selected={tab === item.key}
              role="tab"
              className={`cursor-pointer rounded-md px-3 py-1 text-xs transition ${
                tab === item.key
                  ? 'bg-gold/15 font-medium text-gold'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              {item.label}
              {item.key === 'chunks' && doc.chunkCount > 0 && (
                <span className="ml-1 text-[10px] text-ink-faint">{doc.chunkCount}</span>
              )}
            </button>
          ))}
        </div>

        {tab === 'text' && (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint">
                <SearchIcon className="h-3.5 w-3.5" />
              </span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('viewer.searchPlaceholder')}
                className="w-full rounded-lg border border-night-600 bg-night-900/60 py-1.5 pl-8 pr-2.5 text-xs text-ink placeholder:text-ink-faint focus:border-gold/50 focus:outline-none"
              />
            </div>
            {query.trim() && (
              <div className="flex shrink-0 items-center gap-1 text-[11px] text-ink-faint">
                <span className={markup.count === 0 ? 'text-cinnabar-400' : 'text-ink-muted'}>
                  {markup.count === 0
                    ? t('viewer.noMatch')
                    : t('viewer.matchPos', {
                        current: Math.min(matchIndex + 1, markup.count),
                        total: markup.count,
                      })}
                </span>
                <button
                  onClick={() =>
                    setMatchIndex((i) => (i - 1 + markup.count) % Math.max(markup.count, 1))
                  }
                  disabled={markup.count === 0}
                  title={t('viewer.prevMatch')}
                  className="cursor-pointer rounded px-1 hover:text-gold disabled:opacity-40"
                >
                  ↑
                </button>
                <button
                  onClick={() => setMatchIndex((i) => (i + 1) % Math.max(markup.count, 1))}
                  disabled={markup.count === 0}
                  title={t('viewer.nextMatch')}
                  className="cursor-pointer rounded px-1 hover:text-gold disabled:opacity-40"
                >
                  ↓
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 提示条 */}
      {error && (
        <p className="mx-5 mt-3 shrink-0 rounded-xl border border-cinnabar/40 bg-cinnabar/10 px-3 py-2 text-xs text-cinnabar-400">
          {error}
        </p>
      )}
      {doc.status === 'failed' && doc.error && (
        <p className="mx-5 mt-3 shrink-0 rounded-xl border border-cinnabar/40 bg-cinnabar/10 px-3 py-2 text-xs text-cinnabar-400">
          {t('viewer.parseFailed', { message: doc.error })}
        </p>
      )}

      {/* 内容区 */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <p className="py-10 text-center text-xs text-ink-faint">{t('viewer.loading')}</p>
        ) : tab === 'text' ? (
          <div className="flex h-full flex-col">
            {truncation && (
              <div className="mx-5 mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-gold/30 bg-gold/10 px-3 py-2 text-[11px] text-gold-100">
                <span>{t('viewer.truncated', { count: detail?.text.length ?? 0 })}</span>
                <button
                  onClick={loadFull}
                  className="cursor-pointer rounded-md border border-gold/40 px-2 py-0.5 font-medium transition hover:bg-gold/15"
                >
                  {t('viewer.loadFull')}
                </button>
              </div>
            )}
            {text ? (
              <div
                ref={textRef}
                className="doc-text min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words px-5 py-4 font-sans text-[13px] leading-7 text-ink"
                dangerouslySetInnerHTML={{ __html: markup.html }}
              />
            ) : (
              <p className="py-10 text-center text-xs text-ink-faint">{t('viewer.empty')}</p>
            )}
          </div>
        ) : tab === 'chunks' ? (
          <div className="h-full overflow-y-auto px-5 py-4">
            <p className="mb-3 text-[11px] text-ink-faint">
              {t('viewer.chunkHint', { count: doc.chunkCount })}
            </p>
            {chunksLoading ? (
              <p className="py-8 text-center text-xs text-ink-faint">{t('viewer.loading')}</p>
            ) : !chunks || chunks.length === 0 ? (
              <p className="py-8 text-center text-xs text-ink-faint">{t('viewer.chunkEmpty')}</p>
            ) : (
              <div className="space-y-2">
                {chunks.map((chunk) => (
                  <div
                    key={chunk.index}
                    className="group rounded-xl border border-night-700/60 bg-night-900/50 px-3.5 py-2.5"
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="font-display text-[11px] font-bold text-gold">
                        {t('viewer.chunkLabel', { index: chunk.index + 1 })}
                        <span className="ml-2 font-sans font-normal text-ink-faint">
                          {t('knowledge.characters', { count: chunk.content.length })}
                        </span>
                      </span>
                      <button
                        onClick={() => copyChunk(chunk)}
                        className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] text-ink-faint opacity-0 transition hover:text-gold group-hover:opacity-100"
                      >
                        {copied === chunk.index ? t('viewer.copied') : t('viewer.copyChunk')}
                      </button>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-ink-muted">
                      {chunk.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full flex-col">
            {!doc.hasOriginal ? (
              <div className="mx-auto mt-10 max-w-md rounded-xl border border-night-700 bg-night-900/50 px-4 py-5 text-center text-xs leading-relaxed text-ink-faint">
                {t('viewer.noOriginal')}
              </div>
            ) : doc.kind === 'pdf' || doc.kind === 'image' ? (
              fileLoading ? (
                <p className="py-10 text-center text-xs text-ink-faint">{t('viewer.loading')}</p>
              ) : fileError ? (
                <p className="py-10 text-center text-xs text-cinnabar-400">{fileError}</p>
              ) : blobUrl ? (
                doc.kind === 'pdf' ? (
                  <iframe
                    src={blobUrl}
                    title={doc.filename}
                    className="h-full w-full border-0 bg-night-700"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center overflow-auto p-4">
                    <img src={blobUrl} alt={doc.filename} className="max-h-full max-w-full" />
                  </div>
                )
              ) : null
            ) : (
              <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 rounded-xl border border-night-700 bg-night-900/50 px-4 py-6 text-center">
                <p className="text-xs leading-relaxed text-ink-faint">
                  {doc.kind === 'text' ? t('viewer.textOriginalHint') : t('viewer.fileUnsupported')}
                </p>
                <button
                  onClick={downloadOriginal}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs font-medium text-gold transition hover:bg-gold/20"
                >
                  <DownloadIcon />
                  {t('viewer.downloadOriginal')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
