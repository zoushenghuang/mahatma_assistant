import { useEffect, type ReactNode } from 'react';

/**
 * 通用弹窗外壳：遮罩 + 居中面板 + Esc 关闭 + 层级控制。
 * 业务弹窗只负责面板内容与尺寸，不再各自重复实现遮罩逻辑。
 */
export interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
  /** base = z-50（常规弹窗），top = z-[60]（覆盖在其他弹窗之上） */
  layer?: 'base' | 'top';
  panelClassName?: string;
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  backdropClassName?: string;
}

const DEFAULT_PANEL =
  'w-full max-w-md animate-fade-up rounded-2xl border border-night-600 bg-night-800 p-6 shadow-panel';

export function Modal({
  onClose,
  children,
  ariaLabel,
  layer = 'base',
  panelClassName = DEFAULT_PANEL,
  closeOnEscape = true,
  closeOnBackdrop = true,
  backdropClassName = 'bg-black/70',
}: ModalProps) {
  useEffect(() => {
    if (!closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, closeOnEscape]);

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center p-4 ${
        layer === 'top' ? 'z-[60]' : 'z-50'
      }`}
    >
      <div
        className={`absolute inset-0 ${backdropClassName}`}
        onClick={() => {
          if (closeOnBackdrop) onClose();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={`relative z-10 ${panelClassName}`}
      >
        {children}
      </div>
    </div>
  );
}
