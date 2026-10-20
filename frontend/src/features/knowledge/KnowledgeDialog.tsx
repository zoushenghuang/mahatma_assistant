import { Input, Tag } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type KnowledgeDoc } from '@/api';
import {
  BookIcon,
  CloseIcon,
  EyeIcon,
  FileIcon,
  RefreshIcon,
  SearchIcon,
  TrashIcon,
  UploadIcon,
} from '@/components/icons';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import DocumentViewer from '@/features/knowledge/DocumentViewer';
import { useSettings } from '@/features/settings/SettingsProvider';
import { formatSize } from '@/shared/lib/format';
import { readAsBase64 } from './utils';

/**
 * 「我的知识库」弹窗（RAG 数据源管理）
 *
 * 上传流程：前端把文件读成 base64 → POST /api/documents →
 * 后端保存原文件、解析文本并切分为若干片段（chunk）入 MySQL；
 * 之后在对话中提问时，模型会通过 searchKnowledge 工具检索这些片段。
 *
 * 文档数据按 user_id 隔离，只对当前登录用户可见。
 */

/** 单文件大小上限（与后端 FILE_MAX_BYTES 保持一致） */
const MAX_MB = 8;

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
  const [reindexing, setReindexing] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dragging, setDragging] = useState(false);
  const [search, setSearch] = useState('');
  /** 当前正在预览的文档（null = 未打开预览器） */
  const [viewing, setViewing] = useState<KnowledgeDoc | null>(null);
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
      } catch (err) {
        setError((err as Error)?.message ?? t('knowledge.uploadFailed'));
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
      if (viewing?.id === doc.id) setViewing(null);
      const list = await api.listDocuments();
      sync(list);
    } catch {
      setError(t('knowledge.removeFailed'));
    }
  };

  /** 预览器里删除成功：本地同步，避免再拉一次列表 */
  const removeLocally = (id: string) => {
    setViewing(null);
    sync(docs.filter((d) => d.id !== id));
  };

  /** 切换 embedding 模型后，重建全部文档的向量索引 */
  const reindex = async () => {
    setError('');
    setNotice('');
    setReindexing(true);
    try {
      const result = await api.reindexDocuments();
      sync(await api.listDocuments());
      setNotice(t('knowledge.reindexed', { updated: result.updated, model: result.model }));
      if (result.failed > 0) {
        setError(t('knowledge.reindexPartial', { failed: result.failed }));
      }
    } catch (err) {
      setError((err as Error)?.message ?? t('knowledge.reindexFailed'));
    } finally {
      setReindexing(false);
    }
  };

  const keyword = search.trim().toLowerCase();
  const visibleDocs = keyword
    ? docs.filter((d) => d.filename.toLowerCase().includes(keyword))
    : docs;

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
    <>
      <Modal
        onClose={onClose}
        ariaLabel={t('knowledge.title')}
        width={576}
        panelClassName="flex max-h-[85vh] w-full flex-col rounded-2xl border border-night-600 bg-night-800 p-6 shadow-panel"
        closeOnEscape={!busy && !viewing}
        closeOnBackdrop={!busy}
      >
        {/* 头部 */}
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-night-600 bg-gold/10 text-gold">
              <BookIcon />
            </span>
            <div>
              <h2 className="font-display text-base font-bold text-gold-100">
                {t('knowledge.title')}
              </h2>
              <p className="text-[11px] text-ink-faint">{t('knowledge.sub')}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="default"
              size="small"
              icon={<RefreshIcon className="h-3.5 w-3.5" />}
              loading={reindexing}
              disabled={busy || docs.length === 0}
              title={t('knowledge.reindexTitle')}
              onClick={reindex}
              className="!text-[11px]"
            >
              <span className="hidden sm:inline">
                {reindexing ? t('knowledge.reindexing') : t('knowledge.reindex')}
              </span>
            </Button>
            <Button
              variant="text"
              size="small"
              icon={<CloseIcon />}
              aria-label={t('knowledge.close')}
              disabled={busy}
              onClick={onClose}
            />
          </div>
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
            {t('knowledge.uploadHint', {
              types: 'txt / md / json / csv / pdf / docx',
              size: MAX_MB,
            })}
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
        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <span className="shrink-0 text-[11px] font-medium uppercase tracking-widest text-ink-faint">
              {t('knowledge.total', { count: docs.length })}
            </span>
            {docs.length > 0 && (
              <Input
                size="small"
                allowClear
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('knowledge.searchDocs')}
                prefix={<SearchIcon className="h-3.5 w-3.5 text-ink-faint" />}
                className="max-w-[220px]"
              />
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {loading ? (
              <p className="py-6 text-center text-xs text-ink-faint">{t('knowledge.processing')}</p>
            ) : docs.length === 0 ? (
              <p className="py-6 text-center text-xs text-ink-faint">{t('knowledge.empty')}</p>
            ) : visibleDocs.length === 0 ? (
              <p className="py-6 text-center text-xs text-ink-faint">{t('knowledge.noMatch')}</p>
            ) : (
              <div className="space-y-2">
                {visibleDocs.map((doc) => (
                  <div
                    key={doc.id}
                    onClick={() => setViewing(doc)}
                    className="group flex cursor-pointer items-start gap-3 rounded-xl border border-night-700/60 bg-night-900/60 px-3 py-2.5 transition hover:border-gold/40 hover:bg-night-900/90"
                  >
                    <span className="mt-0.5 shrink-0 text-ink-faint transition group-hover:text-gold">
                      <FileIcon />
                    </span>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setViewing(doc);
                        }}
                        className="block max-w-full cursor-pointer truncate text-left text-xs font-medium text-ink transition hover:text-gold group-hover:text-gold-100"
                        title={doc.filename}
                        aria-label={t('knowledge.view', { name: doc.filename })}
                      >
                        {doc.filename}
                      </button>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-faint">
                        <span>{statusBadge(doc)}</span>
                        {doc.status === 'ready' && (
                          <Tag
                            color={doc.embeddedChunks > 0 ? 'gold' : undefined}
                            title={doc.embeddingModel ?? undefined}
                            className="!m-0 !px-1 !text-[10px] !leading-4"
                          >
                            {doc.embeddedChunks > 0
                              ? t('knowledge.vectorized')
                              : t('knowledge.keywordMode')}
                          </Tag>
                        )}
                        {doc.status === 'ready' && (
                          <span>· {t('knowledge.chunks', { count: doc.chunkCount })}</span>
                        )}
                        {doc.embeddedChunks > 0 && (
                          <span>
                            ·{' '}
                            {t('knowledge.vectorCount', {
                              count: doc.embeddedChunks,
                              total: doc.chunkCount,
                            })}
                          </span>
                        )}
                        {doc.textLength > 0 && (
                          <span>· {t('knowledge.characters', { count: doc.textLength })}</span>
                        )}
                        <span>· {formatSize(doc.size)}</span>
                      </p>
                      {doc.status === 'failed' && doc.error && (
                        <p className="mt-1 break-all text-[11px] leading-relaxed text-cinnabar-400">
                          {doc.error}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        variant="text"
                        size="small"
                        icon={<EyeIcon />}
                        aria-label={t('knowledge.view', { name: doc.filename })}
                        title={t('knowledge.view', { name: doc.filename })}
                        onClick={(e) => {
                          e.stopPropagation();
                          setViewing(doc);
                        }}
                      />
                      <Button
                        variant="text"
                        size="small"
                        icon={<TrashIcon />}
                        aria-label={t('knowledge.delete', { name: doc.filename })}
                        disabled={busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(doc);
                        }}
                        className="!text-cinnabar-400"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 使用提示 */}
        <p className="mt-4 border-t border-night-700/60 pt-3 text-[11px] leading-relaxed text-ink-faint">
          {t('knowledge.usage')}
        </p>
      </Modal>

      {/* 文档阅读器（覆盖在知识库弹窗之上） */}
      {viewing && (
        <DocumentViewer doc={viewing} onClose={() => setViewing(null)} onDeleted={removeLocally} />
      )}
    </>
  );
}
