/** 当前对话消息 */
export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  /** 该条助手消息是失败提示（Key 无效 / 网络异常等），用警示样式渲染 */
  failed?: boolean;
  /**
   * 仅存在于前端、后端没有记录的消息（失败提示 / 中断残留）。
   * 计算「重新生成 / 编辑重发」的后端索引时需要跳过它们。
   */
  local?: boolean;
}

/** 工具调用日志（结构化，便于卡片化展示） */
export interface ToolLogItem {
  name: string;
  result?: string;
  error?: string;
}

/**
 * 前端消息索引 → 后端展示消息索引
 * （跳过 failed / local 这类只在浏览器里存在的消息，保证与数据库一一对应）
 */
export function toServerIndex(list: ChatMsg[], frontIndex: number): number {
  return list.slice(0, frontIndex).filter((m) => !m.local && !m.failed).length;
}
