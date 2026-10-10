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

// 工具执行上下文：让工具能拿到「是谁在调用」，用于按用户隔离数据（如知识库检索）
export interface ToolContext {
  userId: string;
  sessionId?: string;
  // 用户当前所在位置（由前端浏览器定位上报），供获取当前位置天气等工具使用
  location?: { latitude: number; longitude: number };
}

// 一次对话消耗的 token 用量（由上游模型返回的 usage 汇总而来）
export interface TokenUsage {
  inputTokens: number; // 输入（提示词 + 历史 + 工具结果）
  outputTokens: number; // 输出（模型生成）
  totalTokens: number; // 合计
}

// 通过 SSE 推送给前端的事件类型
export type AgentEvent =
  | { type: 'content'; text: string } // 文本增量（前端逐字渲染）
  | { type: 'tool_start'; name: string } // 开始执行工具
  | { type: 'tool_end'; name: string; result: string } // 工具执行完成
  // 整轮对话的 token 用量：工具循环可能有多轮请求，这里是各轮累加后的总量
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'done' } // 整轮对话结束
  // 出错：message 已是面向用户的友好文案
  // fatal = true（默认）表示本轮对话失败，前端作为一条助手消息展示；
  // fatal = false 表示仅某个工具执行失败，前端只记在法宝日志里，对话继续
  | { type: 'error'; message: string; fatal?: boolean };
