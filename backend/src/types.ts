/**
 * 全局共享类型定义
 */

// 对话消息（与 OpenAI / DeepSeek messages 数组格式保持一致）
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  // 当 role === 'tool' 时必填：对应 assistant 消息里那条 tool_call 的 id
  tool_call_id?: string;
  // 当 role === 'assistant' 且调用了工具时必填
  tool_calls?: ToolCall[];
}

// 一次工具调用的完整信息（由流式分片累积而来）
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON 字符串，例如 '{"city":"长沙"}'
  };
}

// OpenAI 兼容的工具描述格式（本地工具和 MCP 工具都转成这个格式）
export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// 通过 SSE 推送给前端的事件类型
export type AgentEvent =
  | { type: 'content'; text: string } // 文本增量（前端逐字渲染）
  | { type: 'tool_start'; name: string } // 开始执行工具
  | { type: 'tool_end'; name: string; result: string } // 工具执行完成
  | { type: 'done' } // 整轮对话结束
  | { type: 'error'; message: string }; // 出错
