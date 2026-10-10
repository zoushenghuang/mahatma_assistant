import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { localExecutors, localTools } from './localTools';
import { knowledgeExecutors, knowledgeTools } from './knowledgeTool';
import { mcp } from './mcpTools';
import type { OpenAITool, ToolContext } from '../types';

/**
 * 工具总入口：
 * 1) getAllTools —— 合并【本地工具 + 知识库工具 + MCP 工具】（OpenAI 描述格式）
 * 2) getLangChainTools —— 把工具清单转成 LangChain 工具，供 Agent 使用
 * 3) dispatchTool —— 根据工具名，分发到 本地执行 / 知识库检索 / MCP 调用
 *
 * 关键节点：RAG —— 知识库检索被包装成一个普通工具，
 * 因此它能和天气、MCP 工具一样被模型自主调度，无需为检索单独开对话链路。
 */

/** 本地工具执行器（同步）与知识库执行器（异步）统一成一张表 */
const executors: Record<string, (args: any, ctx: ToolContext) => unknown> = {
  ...localExecutors,
  ...knowledgeExecutors,
};

// 关键节点：Function Calling —— 工具合并（本地 + 知识库 + MCP 远程）
export function getAllTools(): OpenAITool[] {
  return [...localTools, ...knowledgeTools, ...mcp.tools];
}

/**
 * 关键节点：LangChain —— 把 OpenAI 格式工具清单转换为 LangChain DynamicStructuredTool。
 *
 * 为什么用 DynamicStructuredTool + 宽松 schema：
 * 本地 / MCP 工具的参数千差万别（MCP 自动发现），不逐个写严格 zod schema，
 * 用 z.object({}).passthrough() 接受任意 JSON 对象（保留全部字段），
 * 这样任何工具（含未来动态发现的 MCP 工具）都能零成本接入，且模型以
 * 结构化对象传参（比 DynamicTool 的字符串传参可靠得多）。
 */
export function getLangChainTools(ctx?: ToolContext): DynamicStructuredTool[] {
  return getAllTools().map((t) => toLangChainTool(t, ctx));
}

function toLangChainTool(t: OpenAITool, ctx?: ToolContext): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: t.function.name,
    description: `${t.function.description}\n\n参数结构：${JSON.stringify(t.function.parameters)}`,
    schema: z.object({}).passthrough(),
    func: async (args) => {
      // 实际执行由 agent.ts 显式调用 dispatchTool（带完整上下文）；
      // 这里的 func 仅在 LangChain 自行执行时兜底，缺少上下文则明确报错。
      if (!ctx) throw new Error(`工具 ${t.function.name} 缺少执行上下文（ToolContext）`);
      // 模型给出的是结构化对象，序列化后交给 dispatchTool 解析 + 分发
      return dispatchTool(t.function.name, JSON.stringify(args ?? {}), ctx);
    },
  });
}

/**
 * 关键节点：Function Calling + MCP + RAG —— 工具分发执行
 * @param name 模型返回的工具名
 * @param argsString 模型返回的参数（JSON 字符串）
 * @param ctx 执行上下文（当前用户 / 会话），供按用户隔离的工具使用
 * @returns 工具执行结果（纯文本，作为 tool 消息回填给模型）
 */
export async function dispatchTool(
  name: string,
  argsString: string,
  ctx: ToolContext,
): Promise<string> {
  console.log(`[Dispatch] 命中工具: ${name}，入参: ${argsString}`);

  // 解析参数：模型返回的是一段 JSON 字符串
  let args: any = {};
  try {
    args = JSON.parse(argsString || '{}');
  } catch {
    args = { raw: argsString };
  }

  // 分支 1：本地工具 / 知识库工具 → 执行本地函数（知识库为异步）
  if (executors[name]) {
    const result = await executors[name](args, ctx);
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  // 分支 2：MCP 远程工具 → 通过 MCP Client 转发给第三方 MCP Server
  if (mcp.tools.some((t) => t.function.name === name)) {
    return mcp.callTool(name, args);
  }

  // 分支 3：未知工具（理论不会发生，兜底报错）
  throw new Error(`未知工具: ${name}`);
}
