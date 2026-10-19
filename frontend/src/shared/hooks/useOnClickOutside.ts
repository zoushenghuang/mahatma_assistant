import { useEffect, type RefObject } from 'react';

/** 点击元素外部时触发回调（下拉菜单 / 浮层） */
export function useOnClickOutside<T extends HTMLElement>(
  ref: RefObject<T>,
  handler: () => void,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) handler();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [ref, handler, enabled]);
}
