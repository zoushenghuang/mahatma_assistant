import { Modal as AntModal } from 'antd';
import type { ReactNode } from 'react';

/**
 * 通用弹窗外壳（基于 antd Modal）
 *
 * 只保留项目需要的 props，内部把 antd 默认的 header / footer / padding 清空，
 * 面板视觉仍由各业务组件的 panelClassName 控制；
 * 焦点管理、Esc、遮罩、滚动锁定、层级由 antd 负责。
 */
/** 默认面板视觉：antd 的 content 已清空背景，这里兜底，避免调用方漏传 panelClassName 出现透明弹窗 */
const DEFAULT_PANEL = 'w-full rounded-2xl border border-night-600 bg-night-800 p-6 shadow-panel';

export interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
  /** base = 常规弹窗，top = 覆盖在其他弹窗之上 */
  layer?: 'base' | 'top';
  /** 面板样式（尺寸以外的视觉样式） */
  panelClassName?: string;
  /** 弹窗宽度（默认 480） */
  width?: number | string;
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
}

export function Modal({
  onClose,
  children,
  ariaLabel,
  layer = 'base',
  panelClassName = DEFAULT_PANEL,
  width = 480,
  closeOnEscape = true,
  closeOnBackdrop = true,
}: ModalProps) {
  return (
    <AntModal
      open
      onCancel={onClose}
      footer={null}
      closable={false}
      centered
      width={width}
      maskClosable={closeOnBackdrop}
      keyboard={closeOnEscape}
      zIndex={layer === 'top' ? 1200 : 1100}
      title={ariaLabel ? <span className="sr-only">{ariaLabel}</span> : undefined}
      styles={{
        content: { padding: 0, background: 'transparent', boxShadow: 'none' },
        body: { padding: 0 },
        header: {
          padding: 0,
          margin: 0,
          minHeight: 0,
          borderBottom: 'none',
          background: 'transparent',
        },
        mask: { background: 'rgba(0, 0, 0, 0.72)' },
      }}
    >
      <div className={`w-full ${panelClassName}`}>{children}</div>
    </AntModal>
  );
}
