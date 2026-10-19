import { memo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { CopyButton } from '@/components/ui/CopyButton';

/**
 * 流式 Markdown 渲染
 *
 * - react-markdown + remark-gfm：支持标题 / 列表 / 表格 / 引用 / 链接等 GitHub 风格语法
 * - rehype-highlight：代码块语法高亮（配 styles/index.css 里的 .hljs 令牌色）
 * - 用 memo 包一层：流式时只有「正在生成的那条消息」内容在变，
 *   历史消息 props 不变可跳过重渲染，避免长会话越聊越卡
 */

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
    { props?: { className?: string; children?: ReactNode } } | undefined;
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
