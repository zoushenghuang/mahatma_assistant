import { BaseListChatMessageHistory } from '@langchain/core/chat_history';
import {
  AIMessage,
  AIMessageChunk,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { deleteMessagesBySession, getMessagesBySession, insertMessage, type MessageRow } from './db';

/**
 * 注意（关键坑）：
 * @langchain/core 0.3.x 中 AIMessageChunk 直接继承 BaseMessageChunk，
 * 并不是 AIMessage 的子类！因此判断消息类型不能只用 instanceof AIMessage，
 * 且 chunk 的 tool_calls 需要从 tool_call_chunks 组装（args 是 JSON 字符串片段）。
 */

/**
 * MySQL 持久化的消息历史（LangChain RunnableWithMessageHistory 的记忆载体）
 *
 * 继承 BaseListChatMessageHistory，把 LangChain 的 BaseMessage
 * 序列化进 messages 表：
 * - 每个会话（sessionId）对应一个 MysqlChatHistory 实例
 * - getMessages()   —— 从 MySQL 还原完整上下文（含 tool_calls / tool 消息）
 * - addMessage()    —— 每次 Agent 运行结束后自动持久化
 *
 * 关键节点：RunnableWithMessageHistory —— getMessageHistory 工厂函数
 * 返回的就是这个类的实例，session_id 区分不同会话。
 */

/** 前端展示用：只保留 user / assistant 的纯文本消息 */
export interface DisplayMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function getDisplayMessages(sessionId: string): Promise<DisplayMessage[]> {
  const rows = await getMessagesBySession(sessionId);
  return rows
    .filter((m) => (m.role === 'human' || m.role === 'ai') && m.content)
    .map((m) => ({
      role: m.role === 'human' ? ('user' as const) : ('assistant' as const),
      content: m.content as string,
    }));
}

export class MysqlChatHistory extends BaseListChatMessageHistory {
  lc_namespace = ['dashasheng', 'history'];

  constructor(public sessionId: string) {
    super({ sessionId });
  }

  /** 还原该会话的全部消息（顺序 = 写入顺序） */
  async getMessages(): Promise<BaseMessage[]> {
    const rows = await getMessagesBySession(this.sessionId);
    return rows.map(rowToMessage);
  }

  /** 写入一条消息（HumanMessage / AIMessage(含 tool_calls) / ToolMessage / SystemMessage） */
  async addMessage(message: BaseMessage): Promise<void> {
    await insertMessage(messageToRow(this.sessionId, message));
  }

  /** 批量写入 */
  async addMessages(messages: BaseMessage[]): Promise<void> {
    for (const message of messages) {
      await this.addMessage(message);
    }
  }

  /** 清空该会话消息（会话本身保留） */
  async clear(): Promise<void> {
    await deleteMessagesBySession(this.sessionId);
  }
}

// ============ 序列化 / 反序列化 ============

function rowToMessage(row: MessageRow): BaseMessage {
  switch (row.role) {
    case 'system':
      return new SystemMessage(row.content ?? '');
    case 'ai': {
      const toolCalls = row.toolCalls ? JSON.parse(row.toolCalls) : undefined;
      return new AIMessage({ content: row.content ?? '', tool_calls: toolCalls });
    }
    case 'tool':
      return new ToolMessage({ content: row.content ?? '', tool_call_id: row.toolCallId ?? '' });
    case 'human':
    default:
      return new HumanMessage(row.content ?? '');
  }
}

function messageToRow(
  sessionId: string,
  message: BaseMessage,
): Omit<MessageRow, 'id' | 'createdAt'> {
  const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);

  // AIMessage 与 AIMessageChunk 都要识别为 ai 角色（0.3.x 中两者非继承关系）
  if (message instanceof AIMessage || message instanceof AIMessageChunk) {
    const toolCalls = extractToolCalls(message as AIMessage | AIMessageChunk);
    return {
      sessionId,
      role: 'ai',
      content,
      toolCalls: toolCalls?.length ? JSON.stringify(toolCalls) : null,
    };
  }
  if (message instanceof ToolMessage) {
    return { sessionId, role: 'tool', content, toolCallId: message.tool_call_id };
  }
  if (message instanceof SystemMessage) {
    return { sessionId, role: 'system', content };
  }
  // HumanMessage（及其他未知类型兜底）
  return { sessionId, role: 'human', content };
}

/**
 * 提取工具调用列表（统一 AIMessage / AIMessageChunk）：
 * 优先用 tool_calls；chunk 场景下 tool_calls 可能为空，
 * 需从 tool_call_chunks 手动组装（args 是 JSON 字符串片段，逐段拼接）。
 */
function extractToolCalls(message: AIMessage | AIMessageChunk): { id: string; name: string; args: unknown }[] {
  const direct = message.tool_calls;
  if (direct && direct.length > 0) {
    return direct as { id: string; name: string; args: unknown }[];
  }
  const chunks = (message as AIMessageChunk).tool_call_chunks;
  if (!chunks || chunks.length === 0) return [];

  const acc = new Map<number, { id?: string; name?: string; args: string }>();
  for (const c of chunks) {
    if (c.index === undefined) continue;
    const cur = acc.get(c.index) ?? { id: c.id, name: c.name, args: '' };
    if (c.id) cur.id = c.id;
    if (c.name) cur.name = c.name;
    cur.args += c.args ?? '';
    acc.set(c.index, cur);
  }
  return [...acc.values()].map((v) => {
    let args: unknown = {};
    try {
      args = JSON.parse(v.args || '{}');
    } catch {
      args = { raw: v.args };
    }
    return { id: v.id ?? '', name: v.name ?? '', args };
  });
}
