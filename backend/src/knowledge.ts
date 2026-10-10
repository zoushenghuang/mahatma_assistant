import { createRequire } from 'node:module';
import { getChunksByUser, type ChunkWithSource } from './db';

/**
 * 轻量 RAG 引擎（关键词检索 + 内存打分）
 *
 * 为什么不上向量库：
 * - 本项目按「用户自带 DeepSeek Key」运行，而 DeepSeek 暂不提供 embedding 接口，
 *   无法稳定地为每个用户生成向量；
 * - 学习 Demo 更关注「上传 → 切块 → 检索 → 注入模型」这条主链路是否清晰可讲，
 *   因此这里用一套**不依赖任何外部服务**的关键词检索：
 *   中文按 2-gram 切词、英文按单词切词，命中词频 + 词多样性 + 长度归一化打分，
 *   效果足够支撑「根据我的文档回答」这类场景。
 *
 * 关键节点：RAG —— 文档切片（chunk）是检索的最小单元，
 * 检索命中的片段会作为工具结果回填给模型，由模型组织成最终回答。
 */

// 用于「可选」加载 PDF / DOCX 解析器：未安装依赖时降级提示，不影响其余功能
const require = createRequire(import.meta.url);

/** 纯文本类扩展名：直接 UTF-8 解码即可 */
const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'yml', 'yaml', 'xml', 'html', 'htm',
  'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'cs', 'rb', 'php',
  'sh', 'sql', 'css', 'scss', 'ini', 'conf', 'env', 'toml',
]);

/** 上传时提示用户支持的格式 */
export const SUPPORTED_HINT = 'txt / md / json / csv / pdf / docx / 各类代码文件';

/** 取小写扩展名（不含点） */
export function extOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : '';
}

/**
 * 从上传的二进制内容中抽取纯文本。
 * 文本类直接解码；PDF / DOCX 走可选解析器（动态加载，缺失则抛出可读错误）。
 */
export async function extractText(filename: string, mime: string, buffer: Buffer): Promise<string> {
  const ext = extOf(filename);

  if (TEXT_EXTS.has(ext) || mime.startsWith('text/')) {
    // 去掉 UTF-8 BOM，避免污染首块内容
    return buffer.toString('utf8').replace(/^\uFEFF/, '');
  }

  if (ext === 'pdf' || mime === 'application/pdf') {
    return extractPdf(buffer);
  }

  if (ext === 'docx' || mime.includes('wordprocessingml')) {
    return extractDocx(buffer);
  }

  if (ext === 'doc') {
    throw new Error('暂不支持旧版 .doc 格式，请另存为 .docx 或 PDF 后再上传');
  }

  throw new Error(`暂不支持的文件类型：.${ext || '未知'}（支持 ${SUPPORTED_HINT}）`);
}

/** PDF → 文本（可选依赖 pdf-parse；直接引子路径以绕过其 index.js 的调试分支） */
async function extractPdf(buffer: Buffer): Promise<string> {
  let pdfParse: (buf: Buffer) => Promise<{ text: string }>;
  try {
    pdfParse = require('pdf-parse/lib/pdf-parse.js');
  } catch {
    throw new Error('当前环境未安装 PDF 解析依赖（pdf-parse），请上传文本类文件或先执行 npm install');
  }
  const result = await pdfParse(buffer);
  return result?.text ?? '';
}

/** DOCX → 文本（可选依赖 mammoth） */
async function extractDocx(buffer: Buffer): Promise<string> {
  let mammoth: { extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }> };
  try {
    mammoth = require('mammoth');
  } catch {
    throw new Error('当前环境未安装 DOCX 解析依赖（mammoth），请上传文本类文件或先执行 npm install');
  }
  const result = await mammoth.extractRawText({ buffer });
  return result?.value ?? '';
}

/**
 * 把长文本切成带重叠的小块。
 * 切分优先落在段落 / 换行 / 句号处，尽量不截断语义。
 *
 * @param size 单块目标字符数
 * @param overlap 相邻块重叠字符数（避免关键句正好被切断）
 */
export function chunkText(text: string, size = 700, overlap = 80): string[] {
  const clean = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!clean) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);

    // 非末尾块：尝试在最近的语义边界断开
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const candidates = [
        window.lastIndexOf('\n\n'),
        window.lastIndexOf('\n'),
        window.lastIndexOf('。'),
        window.lastIndexOf('！'),
        window.lastIndexOf('？'),
        window.lastIndexOf('. '),
      ];
      const cut = Math.max(...candidates);
      if (cut > size * 0.5) end = start + cut + 1;
    }

    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    // 步进 = 块长 - 重叠，且至少前进 1，防止死循环
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

/**
 * 从查询串中抽取检索词：
 * - 英文 / 数字：按单词切，长度 ≥ 2
 * - 中文：连续汉字段生成 2-gram（覆盖绝大多数中文词的长度），短词组额外整体加入
 */
export function extractTerms(query: string): string[] {
  const terms = new Set<string>();

  for (const word of query.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? []) {
    terms.add(word);
  }

  for (const run of query.match(/[\u4e00-\u9fa5]+/g) ?? []) {
    if (run.length <= 2) {
      terms.add(run);
      continue;
    }
    for (let i = 0; i + 2 <= run.length; i++) {
      terms.add(run.slice(i, i + 2));
    }
    if (run.length <= 6) terms.add(run); // 短词精确命中加权
  }

  return [...terms];
}

/** 统计子串出现次数（小写化后匹配） */
function countOccurrences(haystackLower: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = haystackLower.indexOf(needle, from);
    if (idx === -1) break;
    count += 1;
    from = idx + needle.length;
  }
  return count;
}

/**
 * 给单个分块打分：
 * - 命中词越多、频次越高，得分越高（词频用对数压缩，避免堆词）
 * - 命中词种类越多，额外加成（覆盖面广比重复同一个词更有价值）
 * - 按块长度做归一化（长块天然更容易命中，需抑制）
 */
export function scoreChunk(content: string, terms: string[]): number {
  const lower = content.toLowerCase();
  let score = 0;
  let hitKinds = 0;

  for (const term of terms) {
    const count = countOccurrences(lower, term);
    if (count > 0) {
      hitKinds += 1;
      score += 1 + Math.log(count);
    }
  }

  if (hitKinds === 0) return 0;
  const lengthPenalty = Math.sqrt(content.length / 300 + 1);
  return (score / lengthPenalty) * (1 + 0.15 * (hitKinds - 1));
}

/** 一条检索结果 */
export interface KnowledgeHit {
  filename: string;
  chunkIndex: number;
  score: number;
  content: string;
}

/**
 * 在某用户的知识库中检索最相关的若干片段。
 * 数据按 user_id 严格隔离，绝不会召回其他用户的文档。
 */
export async function searchKnowledge(
  userId: string,
  query: string,
  topK = 4,
): Promise<KnowledgeHit[]> {
  const terms = extractTerms(query);
  if (terms.length === 0) return [];

  const chunks: ChunkWithSource[] = await getChunksByUser(userId);

  return chunks
    .map((c) => ({ chunk: c, score: scoreChunk(c.content, terms) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((x) => ({
      filename: x.chunk.filename,
      chunkIndex: x.chunk.chunkIndex,
      score: Number(x.score.toFixed(4)),
      content: x.chunk.content,
    }));
}
