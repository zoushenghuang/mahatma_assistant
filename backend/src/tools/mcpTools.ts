import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { OpenAITool } from '../types';

/**
 * MCP Client（关键节点：MCP）
 *
 * 作用：通过 stdio 拉起官方 server-everything MCP Server 子进程，
 *      然后自动 list 出它的全部工具，并转换成 OpenAI 兼容格式，
 *      让 DeepSeek 把第三方工具和本地工具一样对待。
 */

// 官方示例 MCP Server：通过 npx 一行拉起（首次运行会自动下载）
const MCP_SERVER_COMMAND = 'npx';
const MCP_SERVER_ARGS = ['-y', '@modelcontextprotocol/server-everything'];

class McpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  // 自动发现的第三方工具（OpenAI 格式），初始化完成后即可使用
  tools: OpenAITool[] = [];

  /**
   * 连接 MCP Server 并自动发现全部工具。
   * 关键节点：MCP —— stdio 传输层以"子进程"方式启动 MCP Server，
   * 通过标准输入输出进行 JSON-RPC 通信。
   */
  async connect(): Promise<OpenAITool[]> {
    console.log(`[MCP] 启动子进程: ${MCP_SERVER_COMMAND} ${MCP_SERVER_ARGS.join(' ')}`);

    this.transport = new StdioClientTransport({
      command: MCP_SERVER_COMMAND,
      args: MCP_SERVER_ARGS,
      // 继承当前进程环境变量（过滤掉值为 undefined 的项），保证子进程里能找到 npx / node
      env: Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => v !== undefined),
      ) as Record<string, string>,
    });

    this.client = new Client({ name: 'fc-mcp-demo-client', version: '1.0.0' });
    await this.client.connect(this.transport);

    // 关键节点：MCP —— 自动发现（list）Server 暴露的全部远程工具
    const { tools } = await this.client.listTools();
    console.log(`[MCP] 自动发现工具 ${tools.length} 个`);

    // MCP 工具格式 → OpenAI 工具格式（统一交给 DeepSeek）
    this.tools = tools.map((t) => toOpenAITool(t));
    return this.tools;
  }

  /**
   * 调用远程 MCP 工具。
   * 关键节点：MCP —— 把模型给的参数原样转发给第三方 Server 执行。
   */
  async callTool(name: string, args: Record<string, any>): Promise<string> {
    if (!this.client) {
      throw new Error('MCP Client 尚未连接，请先执行 connect()');
    }
    console.log(`[MCP] 调用远程工具: ${name}，入参: ${JSON.stringify(args)}`);

    const result = await this.client.callTool({ name, arguments: args });
    const text = resultToString(result);

    console.log(`[MCP] 远程工具返回: ${text.slice(0, 200)}`);
    return text;
  }

  /**
   * 关闭连接并结束子进程。
   * 关键节点：MCP —— 程序退出时调用，防止子进程残留（内存泄漏）。
   */
  async close(): Promise<void> {
    try {
      await this.client?.close();
    } catch (err) {
      console.error('[MCP] 关闭 Client 失败:', err);
    }
    try {
      await this.transport?.close();
    } catch (err) {
      console.error('[MCP] 关闭 Transport 失败:', err);
    }
    console.log('[MCP] 已关闭，子进程资源释放完毕');
  }
}

/**
 * MCP 工具定义 → OpenAI 工具定义
 * 主要差异：去掉 JSON Schema 里的 $schema 等元数据字段，DeepSeek 不识别
 */
function toOpenAITool(t: any): OpenAITool {
  const { $schema, ...parameters } = t.inputSchema ?? {};
  return {
    type: 'function',
    function: {
      name: t.name,
      description: t.description ?? '',
      parameters,
    },
  };
}

/**
 * MCP 调用结果 → 纯文本
 * MCP 返回的是 content 块数组（可能有多个 text/image 块），
 * 而 OpenAI 的 tool 消息要求 content 是字符串，需要拼装一下。
 */
function resultToString(result: any): string {
  if (result?.isError) {
    return `[MCP 工具执行失败] ${JSON.stringify(result)}`;
  }
  const texts = (result?.content ?? [])
    .filter((b: any) => b?.type === 'text' && b.text)
    .map((b: any) => b.text);
  return texts.length > 0 ? texts.join('\n') : JSON.stringify(result);
}

// 全局单例：index.ts 负责 connect / close，tools.ts 负责读取 tools
export const mcp = new McpClient();
