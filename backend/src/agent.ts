import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { RunnableSequence, RunnableWithMessageHistory } from '@langchain/core/runnables';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { createModel } from './llm';
import { dispatchTool, getLangChainTools } from './tools/tools';
import { MysqlChatHistory } from './history';
import { getUserApiKey, type UserRow } from './db';
import { sha256 } from './crypto';
import type { AgentEvent, TokenUsage } from './types';

/**
 * Agent（LangChain 版本）
 *
 * 架构（关键节点：LangChain）：
 * - RunnableWithMessageHistory
 *   —— 官方记忆组件：按 session_id 从 MySQL 还原上下文；
 *      每次运行结束自动把【用户消息 + AI 回答】持久化
 * - model.bindTools(tools)
 *   —— 官方 Function Calling：模型自主决定是否/如何调用工具
 * - .stream()
 *   —— token 级流式返回（打字机效果），经 SSE 逐字推给前端
 *
 * 工具循环说明：
 * LangChain 0.3 的 AgentExecutor.stream() 是「步骤级」流（工具轮/最终轮各
 * 一块），拿不到最终回答的 token 级增量。因此这里用 RunnableWithMessageHistory
 * 包装「prompt → 绑定了工具的模型」，第一轮走记忆链流式；若模型决定调工具，
 * 则把工具结果以 ToolMessage 写回历史（与 AI 的 tool_calls 消息配对），
 * 再用同一模型继续流式，直到模型直接作答。工具执行事件实时经 emit 转 SSE。
 */

/**
 * 大圣助手 · 系统提示词
 *
 * 关键：必须同时说清「通用助手」与「工具增强」两重身份。
 * 早期版本只强调工具清单，模型会误以为自己只能回答工具相关问题，
 * 遇到通用知识（如「js概念」「langchain 怎么用」）就回「不知道 / 不在我的能力范围」。
 */
const SYSTEM_PROMPT = `你是"大圣助手"，一个神通广大的**通用智能助手**。

你有两类能力：
1. 通用问答（主要能力）：概念解释、编程、写作、翻译、学习辅导、闲聊等，
   直接用你自己的知识认真作答，条理清晰、必要时给出示例或代码。
2. 工具增强（辅助能力）：手边有这些法宝（工具）——
   - 本地法宝：getWeather（查询指定城市或**用户当前位置**的实时天气、多天预报与穿衣建议）
   - 知识库法宝：searchKnowledge（在用户本人上传的文档资料中检索相关片段）
   - MCP 法宝：通过 MCP 协议自动接入的第三方工具（如 echo、add 等）

使用规则：
- 先判断：只有问题确实需要**实时/外部数据**或**只有工具才能办到的事**
  （如查天气、需要 MCP 提供的能力）时才调用工具，拿到真实结果后再回答
- 用户询问天气但**没有指明城市**时（如"今天天气怎么样""明天冷不冷""要不要带伞"），
  说明用户问的是**当前位置**的天气：**直接调用 getWeather，且不要填 city 参数**，
  系统会自动按用户当前所在位置查询（如"长沙岳麓区"）。
  工具会返回位置、实况、今日与未来几天预报、穿衣建议，请如实、分点地组织成回答，
  **不要编造工具未返回的数据**；若返回 error=no_location，再请用户说出城市名
- 涉及「用户上传的文档 / 资料」的问题（例如"根据我上传的文件回答…"、
  "合同里关于违约是怎么写的"），**必须先调用 searchKnowledge 检索**，
  并依据检索到的片段作答；检索结果里没有的内容不要编造，
  如实告诉用户"资料中未提及"，可建议换个问法或补充文档
- 纯知识类问题（概念、代码、写作、闲聊等）**不要调用工具**，
  也**绝不能说"不知道""不在我的能力范围""这不属于我的法宝"**，直接凭知识回答
- 工具结果要如实转述，不要编造
- 确实超出能力时（例如需要实时信息但工具取不到），才简要说明局限并给出可行的替代建议
- 语气可带一点仙侠风格但不过度，简洁友好`;

// 单轮工具循环的最大迭代次数（防止模型陷入无限工具调用）
const MAX_ITERATIONS = 5;

/**
 * 每个用户的 Agent 组合（记忆链 + 绑定工具的模型）
 *
 * 为什么不能全局单例：每个用户用自己的 API Key，模型实例必须跟着用户走。
 * 这里按「用户 id + Key 哈希」缓存，Key 不变就复用，改 Key 后自动失效。
 */
interface AgentBundle {
  withHistory: RunnableWithMessageHistory<any, any>;
  modelWithTools: ReturnType<NonNullable<BaseChatModel['bindTools']>>;
}

const bundleCache = new Map<string, AgentBundle>();

/** 用户更新 Key 后清掉旧缓存 */
export function invalidateAgentCache(userId: string): void {
  for (const key of bundleCache.keys()) {
    if (key.startsWith(`${userId}:`)) bundleCache.delete(key);
  }
}

// 关键节点：LangChain —— Prompt 模板：系统指令 + 历史占位 + 用户输入
const prompt = ChatPromptTemplate.fromMessages([
  ['system', SYSTEM_PROMPT],
  new MessagesPlaceholder('chat_history'), // RunnableWithMessageHistory 注入的历史
  ['human', '{input}'],
]);

/**
 * 初始化 Agent（必须在 MCP 连接完成后调用，
 * 因为工具清单包含 MCP 自动发现的远程工具）
 */
export async function initAgent(): Promise<void> {
  const tools = getLangChainTools();
  console.log(
    `[Agent] 工具清单就绪，共 ${tools.length} 个工具: ${tools.map((t) => t.name).join(', ')}`,
  );
}

/** 取（或构建）某个用户的 Agent：用自己的 Key 建模型 + 绑定工具 + 记忆包装 */
async function getAgent(user: UserRow): Promise<AgentBundle> {
  const apiKey = await getUserApiKey(user.id);
  const cacheKey = `${user.id}:${sha256(apiKey ?? '')}`;

  const cached = bundleCache.get(cacheKey);
  if (cached) return cached;

  // 关键节点：LangChain —— 用该用户自己的 Key 创建模型
  const model = createModel(apiKey);

  // 关键节点：LangChain —— Function Calling：把工具绑定到模型
  if (!model.bindTools) {
    throw new Error('当前模型不支持工具绑定（bindTools）');
  }
  // 工具需要「当前用户」上下文（如知识库按 user_id 隔离检索）
  const modelWithTools = model.bindTools(getLangChainTools({ userId: user.id }));

  // 关键节点：LangChain —— 记忆链：prompt → 绑定了工具的模型
  const chain = RunnableSequence.from([prompt, modelWithTools]);

  // 关键节点：LangChain —— 记忆包装：getMessageHistory 工厂按 sessionId 返回 MySQL 记忆
  const withHistory = new RunnableWithMessageHistory({
    runnable: chain,
    getMessageHistory: (sessionId) => new MysqlChatHistory(sessionId),
    inputMessagesKey: 'input',
    historyMessagesKey: 'chat_history',
  });

  const bundle: AgentBundle = { withHistory, modelWithTools };
  bundleCache.set(cacheKey, bundle);
  return bundle;
}

/**
 * 执行一轮对话（流式）：
 * 1) 第一轮走 RunnableWithMessageHistory（自动保存用户消息 + AI 输出）
 * 2) 若模型决定调用工具：把 AI(tool_calls) 已入历史，逐个执行工具并发 SSE，
 *    将 ToolMessage 写回历史，再用模型继续流式，直到直接作答
 */
export async function runChat(
  sessionId: string,
  userText: string,
  emit: (data: AgentEvent) => void,
  options: {
    signal?: AbortSignal;
    user: UserRow;
    // 用户当前位置（前端浏览器定位上报），供 getWeather 查询"当前位置"天气
    location?: { latitude: number; longitude: number };
  },
): Promise<void> {
  // 用当前登录用户自己的 API Key 构建（或复用）Agent
  const { withHistory, modelWithTools } = await getAgent(options.user);

  console.log(
    `[Agent] 用户 ${options.user.username} · 会话 ${sessionId.slice(0, 8)} 收到消息: ${userText.slice(0, 50)}`,
  );

  const history = new MysqlChatHistory(sessionId);
  const signal = options.signal;

  // 本轮对话的 token 用量：工具循环会多次请求模型，这里把每轮的 usage 累加起来
  const turnUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let hasUsage = false;
  const collectUsage = (usage: TokenUsage | null) => {
    if (!usage) return;
    hasUsage = true;
    turnUsage.inputTokens += usage.inputTokens;
    turnUsage.outputTokens += usage.outputTokens;
    turnUsage.totalTokens += usage.totalTokens;
  };
  const emitUsage = () => {
    if (!hasUsage) return; // MOCK 模型不返回 usage，静默跳过
    console.log(
      `[Agent] 本轮 token 用量: 输入 ${turnUsage.inputTokens} / 输出 ${turnUsage.outputTokens} / 合计 ${turnUsage.totalTokens}`,
    );
    emit({ type: 'usage', usage: { ...turnUsage } });
  };

  // ===== 第一轮：记忆链流式（用户消息 + 首轮 AI 输出由 RunnableWithMessageHistory 自动持久化）=====
  const first = await streamModelRound(
    await withHistory.stream({ input: userText }, { configurable: { sessionId }, signal }),
    emit,
  );
  let { toolCalls, text } = first;
  collectUsage(first.usage);

  // 首轮若已直接作答（无工具调用），RunnableWithMessageHistory 已把本轮完整保存，直接结束
  if (toolCalls.length === 0) {
    console.log(`[Agent] 会话 ${sessionId.slice(0, 8)} 回复完成`);
    emitUsage();
    return;
  }

  // ===== 后续轮：模型决定调用工具则继续，直到直接作答 =====
  let iterations = 0;
  while (toolCalls.length > 0) {
    iterations += 1;
    if (iterations >= MAX_ITERATIONS) {
      console.warn(`[Agent] 达到最大工具循环次数 ${MAX_ITERATIONS}，终止`);
      break;
    }

    // 逐个执行工具：SSE 日志 + 结果写回历史
    // （注意：第一轮带 tool_calls 的 AI 输出已由 RunnableWithMessageHistory 自动保存，
    //   这里只需补 ToolMessage 与之配对）
    for (const tc of toolCalls) {
      console.log(`[Agent] 调用工具: ${tc.name}，入参: ${JSON.stringify(tc.args)}`);
      emit({ type: 'tool_start', name: tc.name });

      let result: string;
      try {
        result = await dispatchTool(tc.name, JSON.stringify(tc.args), {
          userId: options.user.id,
          sessionId,
          location: options.location,
        });
        console.log(`[Agent] 工具 ${tc.name} 执行完成: ${result.slice(0, 120)}`);
        emit({ type: 'tool_end', name: tc.name, result });
      } catch (err: any) {
        result = `工具执行出错: ${err?.message ?? err}`;
        console.error(`[Agent] 工具 ${tc.name} 执行出错: ${err?.message ?? err}`);
        // fatal: false —— 只是这一个工具失败，对话继续，前端记进法宝日志即可
        emit({ type: 'error', message: result, fatal: false });
      }
      await history.addMessage(new ToolMessage({ content: result, tool_call_id: tc.id }));
    }

    // 关键节点：LangChain —— 携带工具结果继续推理（从 MySQL 读回完整上下文）
    const messages = await history.getMessages();
    const next = await streamModelRound(await modelWithTools.stream(messages, { signal }), emit);
    collectUsage(next.usage);
    toolCalls = next.toolCalls;
    text = next.text;

    // 若仍要调工具，本轮的 AI 输出（含 tool_calls）也入历史，与下一批 ToolMessage 配对
    if (toolCalls.length > 0) {
      await history.addMessage(
        new AIMessage({ content: text, tool_calls: toolCalls.map((t) => ({ id: t.id, name: t.name, args: t.args })) }),
      );
    } else if (text) {
      // 最终回答：工具循环内的轮次不走 RunnableWithMessageHistory，需手动持久化，
      // 保证上下文记忆（后续对话）与前端历史（刷新不丢）都完整
      await history.addMessage(new AIMessage(text));
    }
  }

  console.log(`[Agent] 会话 ${sessionId.slice(0, 8)} 回复完成`);
  emitUsage();
}

interface PendingToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/**
 * 消费一个模型流：
 * - 文本增量：逐 chunk 经 emit 转发（token 级流式）
 * - tool_call_chunks：按 index 累积拼接，最后组装成完整工具调用列表
 * - usage_metadata：记录本轮请求的 token 用量
 * 返回模型决定调用的工具（空数组 = 本轮直接作答，无需再循环）
 */
async function streamModelRound(
  stream: AsyncIterable<any>,
  emit: (data: AgentEvent) => void,
): Promise<{ toolCalls: PendingToolCall[]; text: string; usage: TokenUsage | null }> {
  let text = '';
  let usage: TokenUsage | null = null;

  // 按 index 累积工具调用：
  // - 流式形态：tool_call_chunks，args 是 JSON 字符串片段，需逐段拼接
  // - 非流式形态（未实现 _streamResponseChunks 的模型，如 MOCK 模型）：
  //   chunk.tool_calls 直接是完整对象，args 已是对象
  const acc = new Map<number, { id?: string; name?: string; args: string }>();

  for await (const chunk of stream) {
    // 关键节点：token 用量 —— OpenAI 兼容接口（DeepSeek）会在流末尾的 chunk 上
    // 返回 usage（LangChain 已自动携带 stream_options.include_usage），这里取最后一次
    const meta = chunk?.usage_metadata;
    if (meta && (meta.input_tokens || meta.output_tokens || meta.total_tokens)) {
      const inputTokens = Number(meta.input_tokens ?? 0);
      const outputTokens = Number(meta.output_tokens ?? 0);
      usage = {
        inputTokens,
        outputTokens,
        totalTokens: Number(meta.total_tokens ?? 0) || inputTokens + outputTokens,
      };
    }

    // 文本增量
    const content = chunk?.content;
    if (typeof content === 'string' && content.length > 0) {
      text += content;
      emit({ type: 'content', text: content });
    }

    // 方式 1：流式 tool_call_chunks
    for (const tcc of chunk?.tool_call_chunks ?? []) {
      if (tcc.index === undefined) continue;
      const cur = acc.get(tcc.index) ?? { id: tcc.id, name: tcc.name, args: '' };
      if (tcc.id) cur.id = tcc.id;
      if (tcc.name) cur.name = tcc.name;
      cur.args += tcc.args ?? '';
      acc.set(tcc.index, cur);
    }

    // 方式 2：完整 tool_calls（非流式模型 invoke 的一次性结果）
    const full = chunk?.tool_calls;
    if (Array.isArray(full) && full.length > 0 && !chunk?.tool_call_chunks?.length) {
      for (const tc of full) {
        const index = tc.index ?? acc.size;
        acc.set(index, {
          id: tc.id ?? '',
          name: tc.name ?? '',
          args: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args ?? {}),
        });
      }
    }
  }

  // 组装完整工具调用
  const toolCalls: PendingToolCall[] = [];
  for (const cur of acc.values()) {
    if (!cur.name) continue;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(cur.args || '{}');
    } catch {
      args = { raw: cur.args }; // 解析失败兜底，原样传给工具
    }
    toolCalls.push({ id: cur.id ?? '', name: cur.name, args });
  }
  return { toolCalls, text, usage };
}
