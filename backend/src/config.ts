// 加载 .env 文件内容到 process.env
import 'dotenv/config';

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
