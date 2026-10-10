import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatDeepSeek } from '@langchain/deepseek';
import { config } from './config';
import { AuthError } from './auth';
import { FakeToolCallingChatModel } from './fake-llm';

/**
 * LangChain 聊天模型（DeepSeek）
 *
 * 关键节点：LangChain —— ChatDeepSeek 是 @langchain/deepseek 提供的
 * 聊天模型实现，支持：
 * - bindTools()：Function Calling（deepseek-chat 支持工具调用）
 * - .stream()：token 级流式返回
 *
 * 每个用户用自己的 API Key（存在 users.api_key，加密存储），
 * 因此模型实例按「用户 + Key」维度创建，不再使用全局单例。
 *
 * 演示模式：设置环境变量 MOCK_LLM=1 时使用 FakeToolCallingChatModel，
 * 无需真实 API Key 即可跑通「流式 + 工具 + 记忆」全链路。
 */

export const MOCK_MODE = process.env.MOCK_LLM === '1';

/** 当前是否强制要求用户自填 Key（MOCK 模式下不要求） */
export function isApiKeyRequired(): boolean {
  return !MOCK_MODE;
}

/**
 * 按用户的 Key 创建模型
 * @param apiKey 用户自己的 DeepSeek API Key；MOCK 模式下可为空
 */
export function createModel(apiKey?: string | null): BaseChatModel {
  if (MOCK_MODE) {
    return new FakeToolCallingChatModel({
      responses: ['（模拟回复）大圣已为你查得当前位置的实时天气，详情见上方法宝返回。'],
    });
  }

  const key = (apiKey ?? '').trim();
  if (!key) {
    throw new AuthError('请先点击右上角「我的 Key」填写你自己的 DeepSeek API Key', 400);
  }

  return new ChatDeepSeek({
    apiKey: key,
    model: config.model,
    temperature: 0.1,
  });
}
