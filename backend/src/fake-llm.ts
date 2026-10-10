import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BindToolsInput,
} from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';

/**
 * 极简 Fake 聊天模型（仅用于 MOCK_LLM=1 演示模式，无真实 API Key 时跑通链路）
 *
 * 行为模拟：
 * - 第一次带工具调用（bindTools 后）：返回一条带 tool_calls 的 AI 消息，
 *   固定触发第一个工具（本地 getWeather 排在最前），模拟「模型决定调工具」
 * - 之后的调用：逐条返回预设 responses 文本，模拟最终回答
 *
 * 用于验证：流式输出、工具调用闭环、历史持久化、会话记忆等链路，
 * 不涉及任何真实网络请求。
 */

export class FakeToolCallingChatModel extends BaseChatModel<BaseChatModelCallOptions> {
  lc_namespace = ['dashasheng', 'fake_llm'];

  private responses: string[];
  private round = 0;

  constructor(fields: { responses?: string[] } = {}) {
    super({});
    this.responses = fields.responses ?? ['（模拟回复）已完成。'];
  }

  _llmType(): string {
    return 'fake-tool-calling';
  }

  // 实现工具绑定（基类中 bindTools 是可选的，这里给出实现以便 TS 确认支持）
  override bindTools(tools: BindToolsInput[], kwargs?: Partial<BaseChatModelCallOptions>) {
    // tools 经运行时 options 透传给 _generate（CallOptions 类型未声明该字段，这里 cast）
    return this.bind({ tools: tools as any, ...(kwargs as any) });
  }

  async _generate(messages: BaseMessage[], options?: BaseChatModelCallOptions): Promise<ChatResult> {
    // 模拟「模型决定调用工具」：绑定工具 + 最后一条是用户消息（尚未进入工具循环）时触发。
    // 用消息内容而非实例 round 判断 —— model 是全局单例，round 会跨请求共享导致
    // 后续对话不再触发工具调用（真实模型每次都会根据上下文重新决策）
    const tools = (options as any)?.tools as { name: string }[] | undefined;
    const last = messages[messages.length - 1];
    const lastIsHuman = last?._getType() === 'human';
    if (tools && tools.length > 0 && lastIsHuman) {
      const name = tools[0].name;
      const args = name === 'getWeather' ? { city: '长沙' } : {};
      return {
        generations: [
          {
            text: '',
            message: new AIMessage({
              content: '',
              tool_calls: [{ id: `call_fake_${Date.now()}`, name, args }],
            }),
          },
        ],
      };
    }

    // 工具结果已回填（最后一条是 ToolMessage）或无需工具时：返回预设文本
    const idx = Math.min(this.round, this.responses.length - 1);
    this.round += 1;
    const text = this.responses[idx];
    return { generations: [{ text, message: new AIMessage(text) }] };
  }
}
