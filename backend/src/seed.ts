import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import {
  DEMO_PASSWORD,
  closeDb,
  createSession,
  ensureDemoUser,
  getMessagesBySession,
  initDb,
  insertMessage,
  pool,
} from './db';
import { hashPassword } from './crypto';

/**
 * 演示数据初始化脚本：npm run seed
 *
 * - 默认：仅当 messages 表为空时写入，避免覆盖真实对话
 * - 加 --force：先清空 sessions / messages / 用户(除 demo) 与重置令牌再写入
 *
 * 初始化内容：
 * 1) 两个演示账号（账号 + 密码登录）
 *      demo / demo1234      邮箱 demo@example.com
 *      wukong / wukong1234  邮箱 wukong@example.com
 * 2) 若干会话，分属不同账号（验证数据隔离）
 *    覆盖：本地工具 getWeather、MCP 工具 echo、多轮上下文记忆
 */

const HOUR = 60 * 60 * 1000;

const DEMO_USERS = [
  { username: 'wukong', password: 'wukong1234', email: 'wukong@example.com', nickname: '齐天大圣' },
];

interface SeedMessage {
  role: 'human' | 'ai' | 'tool';
  content: string;
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
  toolCallId?: string;
  /** 相对该会话首条消息的分钟偏移，用于生成自然的时间序列 */
  offsetMin: number;
}

interface SeedSession {
  title: string;
  /** 距离现在的小时数（越大越旧） */
  hoursAgo: number;
  messages: SeedMessage[];
}

const SEED: { username: string; sessions: SeedSession[] }[] = [
  {
    username: 'demo',
    sessions: [
      {
        title: '长沙今天要不要穿棉袄',
        hoursAgo: 26,
        messages: [
          { role: 'human', content: '长沙今天天气怎么样？要不要穿棉袄？', offsetMin: 0 },
          {
            role: 'ai',
            content: '',
            toolCalls: [{ id: 'call_weather_1', name: 'getWeather', args: { city: '长沙' } }],
            offsetMin: 0.1,
          },
          {
            role: 'tool',
            content:
              '{"city":"长沙","weather":"阴转小雨","temperature":"6°C","low":"4°C","high":"9°C","advice":"今天很冷，建议穿棉袄 / 羽绒服","source":"本地内置模拟数据"}',
            toolCallId: 'call_weather_1',
            offsetMin: 0.2,
          },
          {
            role: 'ai',
            content:
              '老孙为你掐指一算：长沙今日**阴转小雨**，气温 6°C（4~9°C）。\n\n这温度必须穿棉袄，最好再加件挡风的，出门记得带伞。',
            offsetMin: 0.3,
          },
        ],
      },
      {
        title: '用 echo 工具输出测试文本',
        hoursAgo: 5,
        messages: [
          { role: 'human', content: '用 echo 工具输出「大圣到此一游」', offsetMin: 0 },
          {
            role: 'ai',
            content: '',
            toolCalls: [{ id: 'call_echo_1', name: 'echo', args: { message: '大圣到此一游' } }],
            offsetMin: 0.1,
          },
          {
            role: 'tool',
            content: '{"content":[{"type":"text","text":"Echo: 大圣到此一游"}]}',
            toolCallId: 'call_echo_1',
            offsetMin: 0.2,
          },
          {
            role: 'ai',
            content: '已调用 MCP 法宝 `echo`，返回结果是：**Echo: 大圣到此一游**。',
            offsetMin: 0.3,
          },
        ],
      },
    ],
  },
  {
    username: 'wukong',
    sessions: [
      {
        title: '查一下深圳天气',
        hoursAgo: 1,
        messages: [
          { role: 'human', content: '深圳天气怎么样？', offsetMin: 0 },
          {
            role: 'ai',
            content: '',
            toolCalls: [{ id: 'call_weather_2', name: 'getWeather', args: { city: '深圳' } }],
            offsetMin: 0.1,
          },
          {
            role: 'tool',
            content:
              '{"city":"深圳","weather":"多云","temperature":"24°C","low":"20°C","high":"27°C","advice":"体感舒适，单衣即可","source":"本地内置模拟数据"}',
            toolCallId: 'call_weather_2',
            offsetMin: 0.2,
          },
          {
            role: 'ai',
            content: '深圳今日**多云**，24°C（20~27°C），体感舒适，一件单衣就够。',
            offsetMin: 0.3,
          },
          { role: 'human', content: '那和刚才那个城市比呢？哪个更冷？', offsetMin: 3 },
          {
            role: 'ai',
            content:
              '刚才问的是**长沙**，6°C 阴转小雨；深圳 24°C 多云。\n\n长沙明显更冷，温差 18°C——在深圳穿单衣，去长沙得套棉袄。',
            offsetMin: 3.1,
          },
        ],
      },
    ],
  },
];

async function count(table: string): Promise<number> {
  const [rows] = await pool.query<(RowDataPacket & { c: number })[]>(
    `SELECT COUNT(*) AS c FROM \`${table}\``,
  );
  return Number(rows[0]?.c ?? 0);
}

async function main() {
  await initDb();

  const force = process.argv.includes('--force');
  const existing = await count('messages');

  if (existing > 0 && !force) {
    console.log(
      `[Seed] messages 表已有 ${existing} 条数据，跳过初始化。若要清空后重写：npm run seed -- --force`,
    );
    await closeDb();
    return;
  }

  if (force) {
    // 顺序：先删子表，避免外键约束报错
    await pool.query('DELETE FROM password_resets');
    await pool.query('DELETE FROM messages');
    await pool.query('DELETE FROM sessions');
    await pool.query("DELETE FROM users WHERE username <> 'demo'");
    console.log('[Seed] 已清空 password_resets / messages / sessions / 非 demo 用户');
  }

  // 1) 确保演示账号存在
  const demo = await ensureDemoUser();
  const users = new Map<string, string>([[demo.username, demo.id]]);
  console.log(`[Seed] 演示账号就绪: demo / ${DEMO_PASSWORD}（${demo.email}）`);

  for (const u of DEMO_USERS) {
    const [rows] = await pool.query<(RowDataPacket & { id: string })[]>(
      'SELECT id FROM users WHERE username = ?',
      [u.username],
    );
    if (rows[0]) {
      users.set(u.username, rows[0].id);
      continue;
    }
    const now = Date.now();
    const id = randomUUID();
    await pool.query(
      `INSERT INTO users (id, username, email, password_hash, nickname, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, u.username, u.email, hashPassword(u.password), u.nickname, now, now],
    );
    users.set(u.username, id);
    console.log(`[Seed] 演示账号就绪: ${u.username} / ${u.password}（${u.email}）`);
  }

  // 2) 按账号写入会话与消息
  const now = Date.now();
  for (const group of SEED) {
    const userId = users.get(group.username)!;
    for (const s of group.sessions) {
      const session = await createSession(userId, s.title);
      const start = now - s.hoursAgo * HOUR;

      for (const m of s.messages) {
        await insertMessage({
          sessionId: session.id,
          role: m.role,
          content: m.content,
          toolCalls: m.toolCalls?.length ? JSON.stringify(m.toolCalls) : null,
          toolCallId: m.toolCallId ?? null,
        });
      }

      // 回填时间戳：让会话列表按「最近活跃」有自然的时间梯度
      const stored = await getMessagesBySession(session.id);
      for (const [i, row] of stored.entries()) {
        const ts = start + Math.round(s.messages[i].offsetMin * 60 * 1000);
        await pool.query('UPDATE messages SET created_at = ? WHERE id = ?', [ts, row.id]);
      }
      await pool.query('UPDATE sessions SET created_at = ?, updated_at = ? WHERE id = ?', [
        start,
        start + Math.round(s.messages.at(-1)!.offsetMin * 60 * 1000),
        session.id,
      ]);

      console.log(`[Seed] ${group.username} 的会话「${s.title}」写入 ${stored.length} 条消息`);
    }
  }

  console.log(
    `[Seed] 完成：users ${await count('users')} 条，sessions ${await count('sessions')} 条，messages ${await count('messages')} 条`,
  );

  await closeDb();
}

main().catch(async (err) => {
  console.error('[Seed] 失败:', err?.message ?? err);
  try {
    await closeDb();
  } finally {
    process.exit(1);
  }
});
