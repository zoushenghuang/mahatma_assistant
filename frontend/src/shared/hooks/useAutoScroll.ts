import { useEffect, type RefObject } from 'react';

/** 依赖变化时平滑滚动到底部（消息流 / 工具日志） */
export function useAutoScroll(ref: RefObject<HTMLElement>, deps: readonly unknown[]): void {
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
