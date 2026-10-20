// ============ 后端接口的领域类型 ============

export interface Session {
  id: string;
  userId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface DisplayMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  nickname: string;
  status: number;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
}

export interface AuthResult {
  token: string;
  user: User;
}

/** 我的 API Key 状态（后端只回脱敏值） */
export interface ApiKeyStatus {
  hasKey: boolean;
  masked: string | null;
  required: boolean;
}

/** 用户当前位置坐标（浏览器定位后随对话请求上报） */
export interface GeoLocation {
  latitude: number;
  longitude: number;
}

/** 文档预览类型（决定用哪种方式展示原文件） */
export type DocKind = 'text' | 'pdf' | 'word' | 'image' | 'other';

/** 知识库文档（RAG 数据源） */
export interface KnowledgeDoc {
  id: string;
  userId: string;
  filename: string;
  mime: string;
  size: number;
  chunkCount: number;
  status: 'pending' | 'ready' | 'failed';
  error: string | null;
  /** 解析出的全文字符数 */
  textLength: number;
  /** 是否保留了原始文件（旧文档可能没有） */
  hasOriginal: boolean;
  kind: DocKind;
  /** 向量模型（null = 未建立向量索引，只能关键词检索） */
  embeddingModel: string | null;
  embeddingDim: number;
  /** 已向量化的切片数 */
  embeddedChunks: number;
  createdAt: number;
}

/** 重建向量索引的结果 */
export interface ReindexResult {
  total: number;
  updated: number;
  failed: number;
  chunks: number;
  provider: string;
  model: string;
  semantic: boolean;
  errors: string[];
}

/** 文档详情：元信息 + 全文（超长时截断） */
export interface DocumentDetail extends KnowledgeDoc {
  text: string;
  /** 是否只返回了前面一段（完整内容走 /text） */
  truncated: boolean;
}

/** 文档切片 */
export interface DocumentChunk {
  index: number;
  content: string;
}

/** 一次对话消耗的 token 用量（工具循环会多轮请求，后端已累加） */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** 后端通过 SSE 推送的事件 */
export type SseEvent =
  | { type: 'content'; text: string }
  | { type: 'tool_start'; name: string }
  | { type: 'tool_end'; name: string; result: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'done' }
  // message 已是面向用户的友好文案；fatal 为 false 时仅工具失败（对话继续）
  | { type: 'error'; message: string; fatal?: boolean };
