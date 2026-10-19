import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 顶层错误边界：渲染异常时给出可恢复的兜底页，避免整页白屏。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-night px-4">
        <div className="w-full max-w-md rounded-2xl border border-night-600 bg-night-800 p-6 text-center shadow-panel">
          <h1 className="font-display text-lg font-bold text-gold-100">页面出了点问题</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Something went wrong. 刷新页面即可恢复；若持续出现，请查看控制台日志。
          </p>
          <pre className="mt-4 max-h-32 overflow-auto rounded-xl border border-night-700 bg-night-900/70 p-3 text-left font-mono text-[11px] text-cinnabar-400">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 w-full cursor-pointer rounded-xl bg-gold-gradient px-4 py-2.5 text-sm font-semibold text-accentInk transition hover:brightness-110"
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }
}
