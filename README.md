# mahatma_assistant

一个自研的 AI 聊天助手（学习 Demo）：覆盖 **文档上传 / RAG 检索 → Function Calling → MCP 工具自动发现 → 多轮记忆 → SSE 流式输出** 的完整闭环，并带有账号体系与多会话管理。

## 功能特性

- **账号体系**：注册 / 登录 / 找回密码（JWT 鉴权，密码加盐哈希），会话与消息按用户隔离
- **自带 Key**：每个用户在「我的 Key」里填写自己的 DeepSeek Key，AES-256-GCM 加密落库，只回传脱敏值
- **多会话**：新建 / 切换 / 删除会话，首条消息自动生成会话标题，历史消息持久化到 MySQL
- **流式对话**：后端 SSE 逐 token 推送，前端边生成边渲染，可随时中断
- **Function Calling**：内置本地工具 `getWeather`（查天气 + 穿衣建议），工具调用过程在界面上以卡片展示
- **MCP 集成**：启动时通过 stdio 拉起 `server-everything` 子进程，自动发现第三方工具并转成 OpenAI 工具格式，与本地工具一起交给模型
- **知识库 RAG**：上传 `txt / md / json / csv / pdf / docx` 等文档，后端解析文本并切分为片段存入 MySQL；对话时模型通过 `searchKnowledge` 工具检索相关片段作答，文档与检索结果严格按用户隔离
- **Mock 模式**：设置 `MOCK_LLM=1` 无需真实 Key 即可跑通全链路

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 18 + TypeScript + Vite + TailwindCSS |
| 后端 | Node.js（原生 `http`，无框架）+ TypeScript + tsx |
| 模型 | DeepSeek（`deepseek-chat`）via LangChain / `@langchain/deepseek` |
| 工具 | 原生 Function Calling + `@modelcontextprotocol/sdk` |
| 存储 | MySQL 8（`mysql2` 连接池，启动时自动建库建表） |

## 目录结构

```
backend/
  src/
    index.ts        # 入口：建表 → 连 MCP → 初始化 Agent → 起服务 → 优雅退出
    config.ts       # 环境变量集中管理
    server.ts       # HTTP 路由与 SSE 对话接口
    auth.ts         # 注册/登录/找回密码 + JWT
    db.ts           # MySQL 数据层（users / sessions / messages / documents / doc_chunks）
    agent.ts        # LangChain Agent：工具绑定 + 流式执行
    llm.ts          # 按用户 Key 创建模型（含 Mock 模式）
    history.ts      # 会话历史 ↔ 模型上下文
    knowledge.ts    # 轻量 RAG：文件解析 + 文本分块 + 关键词检索打分
    crypto.ts       # 密码哈希、Key 加解密、脱敏
    tools/          # localTools / knowledgeTool（RAG 检索）/ mcpTools（MCP Client）/ tools（合并与分发）
  .env.example      # 环境变量模板
frontend/
  src/
    App.tsx         # 聊天主界面（会话列表 + 消息流 + 工具卡片）
    AuthPage.tsx    # 登录 / 注册 / 找回密码
    ApiKeyDialog.tsx# 「我的 Key」管理
    KnowledgeDialog.tsx # 「我的知识库」上传 / 列表 / 删除
    api.ts          # 接口封装与 SSE 解析
```

## 快速开始

### 1. 前置条件

- Node.js ≥ 18
- 可用的 MySQL（后端首次启动会自动建库建表）
- 一个 DeepSeek API Key（或直接用 Mock 模式）

### 2. 配置环境变量

```bash
cd backend
cp .env.example .env   # 然后按需修改
```

主要配置项：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `DEEPSEEK_BASE_URL` | OpenAI 兼容 Base URL | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | 模型名（`deepseek-chat` 支持工具调用） | `deepseek-chat` |
| `PORT` | 后端端口 | `3001` |
| `AUTH_SECRET` | JWT 签名密钥，**生产必须修改** | 开发默认值 |
| `MYSQL_*` | MySQL 主机 / 端口 / 用户 / 密码 / 库名 | 127.0.0.1:3306 / agent_demo |
| `MOCK_LLM` | 设为 `1` 开启 Mock 模式，无需 Key | 不开启 |

### 3. 启动

```bash
# 后端（http://localhost:3001）
cd backend && npm install && npm run dev

# 前端（http://localhost:5173，已配置 /api 代理到 3001）
cd frontend && npm install && npm run dev
```

可选：

```bash
cd backend && npm run seed        # 写入演示账号与会话（demo/demo1234、wukong/wukong1234）
cd backend && npm run typecheck   # 类型检查
cd frontend && npm run build      # 前端构建
```

> 首次启动会通过 `npx` 拉取 `@modelcontextprotocol/server-everything`，需要一点时间；若拉取失败会降级为仅本地工具，不影响主流程。

## 接口一览

公开接口：

- `GET /api/health`
- `POST /api/auth/register`、`POST /api/auth/login`
- `POST /api/auth/forgot-password`、`POST /api/auth/reset-password`

需登录（`Authorization: Bearer <token>`）：

- `GET /api/auth/me`
- `GET|PUT|DELETE /api/user/api-key`
- `GET /api/sessions`、`POST /api/sessions`、`DELETE /api/sessions/:id`
- `GET /api/sessions/:id/messages`
- `GET /api/documents`、`POST /api/documents`（body: `{ filename, mime, data(base64) }`）、`DELETE /api/documents/:id`
- `POST /api/chat`（SSE，body: `{ sessionId, message }`）

## 注意事项

- 本项目为学习 / 演示用途，`AUTH_SECRET` 在生产环境必须替换为随机长字符串。
- 用户的 API Key 加密存储且只用于本人会话，服务端不再持有全局 Key。
- `backend/data/` 下的数据库文件为本地运行产物，不需要提交。
