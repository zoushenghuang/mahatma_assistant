// 加载 .env 文件内容到 process.env
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 后端项目根目录（src 的上一级），用于定位本地文件目录 */
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 集中管理所有环境变量配置，后续代码统一从这里读取，
 * 避免到处散落 process.env.xxx。
 */
export const config = {
  // 注意：DeepSeek API Key 由每个用户在前端「我的 Key」中自行填写并加密存库，
  // 服务端不再读取全局 Key（避免共用一份 Key 产生费用）
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
  model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
  port: Number(process.env.PORT ?? 3001),

  // 高德地图 Web 服务 Key（可选）：配置后天气 / 定位走高德（国内稳定、区县精准）；
  // 不配置则自动降级为 Open-Meteo + BigDataCloud 的免 Key 方案
  amapKey: process.env.AMAP_KEY ?? '',

  // JWT 签名密钥（生产环境务必通过环境变量覆盖）
  authSecret: process.env.AUTH_SECRET ?? 'dev-secret-please-change-me',

  // 知识库原始文件落盘目录（默认 backend/data/uploads，可由 UPLOAD_DIR 覆盖）
  uploadDir: process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(backendRoot, 'data', 'uploads'),

  /**
   * 向量检索配置
   *
   * provider:
   * - hash   本地特征哈希向量（零依赖，离线可用，但不是语义模型）
   * - openai OpenAI 兼容的 /embeddings 接口（SiliconFlow、OpenAI、智谱等）
   * - ollama 本地 Ollama（先 `ollama pull bge-m3`）
   */
  embedding: {
    provider: (process.env.EMBEDDING_PROVIDER ?? 'hash').toLowerCase(),
    model: process.env.EMBEDDING_MODEL ?? '',
    baseUrl: process.env.EMBEDDING_BASE_URL ?? '',
    apiKey: process.env.EMBEDDING_API_KEY ?? '',
    /** 向量维度：hash 模式生效；openai/ollama 以接口返回为准 */
    dim: Number(process.env.EMBEDDING_DIM ?? 1024),
    batchSize: Number(process.env.EMBEDDING_BATCH_SIZE ?? 16),
    timeoutMs: Number(process.env.EMBEDDING_TIMEOUT_MS ?? 30000),
    /** 向量召回的最低余弦相似度 */
    minScore: Number(process.env.EMBEDDING_MIN_SCORE ?? 0.2),
  },

  // MySQL 连接配置（首次启动会自动建库建表）
  mysql: {
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? 'root',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'agent_demo',
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT ?? 10),
  },
};

// 启动时检查必填配置，避免运行时才发现缺失
if (!process.env.AUTH_SECRET) {
  console.warn('[Config] 警告：未检测到 AUTH_SECRET，当前使用默认密钥，生产环境请务必设置');
}
