import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { localExecutors, localTools } from './localTools';
import { mcp } from './mcpTools';
import type { OpenAITool } from '../types';

/**
 * 工具总入口：
 * 1) getAllTools —— 合并【本地工具 + MCP 工具】（OpenAI 描述格式，保留给查询/日志）
 * 2) getLangChainTools —— 把工具清单转成 LangChain 工具，供 Agent 使用
 * 3) dispatchTool —— 根据工具名，分发到 本地执行 / MCP 调用
 */

// 关键节点：Function Calling —— 工具合并（本地 + MCP 远程）
export function getAllTools(): OpenAITool[] {
  return [...localTools, ...mcp.tools];
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
export function getLangChainTools(): DynamicStructuredTool[] {
  return getAllTools().map((t) => toLangChainTool(t));
}

function toLangChainTool(t: OpenAITool): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: t.function.name,
    description: `${t.function.description}\n\n参数结构：${JSON.stringify(t.function.parameters)}`,
    schema: z.object({}).passthrough(),
    func: async (args) => {
      // 模型给出的是结构化对象，序列化后交给 dispatchTool 解析 + 分发
      return dispatchTool(t.function.name, JSON.stringify(args ?? {}));
    },
  });
}

/**
 * 关键节点：Function Calling + MCP —— 工具分发执行
 * @param name 模型返回的工具名
 * @param argsString 模型返回的参数（JSON 字符串）
 * @returns 工具执行结果（纯文本，作为 tool 消息回填给模型）
 */
export async function dispatchTool(name: string, argsString: string): Promise<string> {
  console.log(`[Dispatch] 命中工具: ${name}，入参: ${argsString}`);

  // 解析参数：模型返回的是一段 JSON 字符串
  let args: any = {};
  try {
    args = JSON.parse(argsString || '{}');
  } catch {
    args = { raw: argsString };
  }

  // 分支 1：本地工具 → 直接执行本地函数（同步返回）
  if (localExecutors[name]) {
    const result = localExecutors[name](args);
    return JSON.stringify(result);
  }

  // 分支 2：MCP 远程工具 → 通过 MCP Client 转发给第三方 MCP Server
  if (mcp.tools.some((t) => t.function.name === name)) {
    return mcp.callTool(name, args);
  }

  // 分支 3：未知工具（理论不会发生，兜底报错）
  throw new Error(`未知工具: ${name}`);
}
