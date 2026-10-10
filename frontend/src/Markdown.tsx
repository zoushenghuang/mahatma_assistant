import { memo, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { useSettings } from './settings';

/**
 * 流式 Markdown 渲染
 *
 * - react-markdown + remark-gfm：支持标题 / 列表 / 表格 / 引用 / 链接等 GitHub 风格语法
 * - rehype-highlight：代码块语法高亮（配 index.css 里的 .hljs 令牌色，跟随浅色 / 深色主题）
 * - 用 memo 包一层：流式时只有「正在生成的那条消息」内容在变，
 *   历史消息 props 不变可跳过重渲染，避免长会话越聊越卡
 */

/** 复制图标 */
function CopyIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
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
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/** 对勾图标 */
function CheckIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
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
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** 复制按钮（代码块 / 消息共用），带「已复制」反馈 */
export function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const { t } = useSettings();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 剪贴板不可用（非 https / 无权限）时静默失败
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? t('chat.copied') : t('chat.copy')}
      className={`flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-faint transition hover:bg-night-700/60 hover:text-gold ${className}`}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      <span>{copied ? t('chat.copied') : t('chat.copy')}</span>
    </button>
  );
}

/** 递归提取 React 节点中的纯文本（用于复制代码块原文） */
function extractText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  const el = node as { props?: { children?: ReactNode } };
  if (el?.props?.children !== undefined) return extractText(el.props.children);
  return '';
}

/** 代码块外壳：语言标签 + 一键复制 + 横向滚动 */
function CodeBlock({ children }: { children?: ReactNode }) {
  const child = (Array.isArray(children) ? children[0] : children) as
    | { props?: { className?: string; children?: ReactNode } }
    | undefined;
  const className = child?.props?.className ?? '';
  const lang = /language-([\w+-]+)/.exec(className)?.[1] ?? '';
  const code = extractText(child?.props?.children);

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-night-600 bg-night-900/80">
      <div className="flex items-center justify-between gap-2 border-b border-night-700/60 bg-night-800/70 px-3 py-1">
        <span className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">
          {lang || 'text'}
        </span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-relaxed">
        {children}
      </pre>
    </div>
  );
}

const components: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  // 宽表格在小屏下横向滚动，避免撑破气泡
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table>{children}</table>
    </div>
  ),
};

const Markdown = memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

export default Markdown;
