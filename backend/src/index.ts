import { config } from './config';
import { closeDb, initDb } from './db';
import { startServer } from './server';
import { mcp } from './tools/mcpTools';
import { initAgent } from './agent';

/**
 * 程序入口：
 * 1) 初始化 MySQL（自动建库建表）
 * 2) 启动时连接 MCP Server（server-everything），自动发现远程工具
 * 3) 初始化 LangChain Agent（工具清单含 MCP 工具，须在连接后执行）
 * 4) 启动 HTTP 服务（会话管理 + SSE 对话接口）
 * 5) 监听退出信号，关闭 MCP 子进程与数据库连接池（防止资源泄漏）
 */

async function main() {
  // 建库建表（库不存在会自动创建，表结构幂等）
  await initDb();

  // 关键节点：MCP —— 通过 stdio 拉起 server-everything 子进程，并自动发现全部第三方工具
  try {
    await mcp.connect();
  } catch (err: any) {
    // MCP 连不上时降级运行（只有本地工具可用），不影响学习
    console.error(`[MCP] 连接失败，将仅使用本地工具:`, err?.message ?? err);
  }

  // 关键节点：LangChain —— 初始化 Agent（本地 + MCP 工具合并）
  await initAgent();

  startServer();
}

main().catch((err) => {
  console.error('[Main] 启动失败:', err);
  process.exit(1);
});

// 关键节点：MCP —— 进程退出时关闭子进程，释放资源
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[Main] 收到 ${signal}，正在关闭 MCP 子进程与数据库连接...`);
  try {
    await mcp.close();
    await closeDb();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// 防止未使用的告警（config 由 server 内部使用，这里保留引用以提前加载 .env）
void config;
