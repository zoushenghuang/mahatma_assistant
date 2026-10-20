import { createRequire } from 'node:module';
import { config } from './config';
import { getChunksByUser, type ChunkWithSource } from './db';
import {
  cosineSimilarity,
  decodeVector,
  embedQuery,
  rrfScore,
} from './embedding';

/**
 * RAG 检索引擎（向量 + 关键词混合召回）
 *
 * 链路：
 * 1. 文档切片时同步生成 embedding，与文本一起存入 MySQL（doc_chunks.embedding）
 * 2. 查询时生成 query 向量，对当前用户的切片做余弦相似度召回
 * 3. 同时保留原有的关键词打分（中文 2-gram / 英文分词），用 RRF 融合两路排名
 *
 * 为什么保留关键词：
 * - 合同编号、错误码、专有名词等「字面精确匹配」场景关键词更稳；
 * - embedding 服务不可用时自动降级，不影响对话主流程。
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

/** 文档预览类型：决定前端用哪种方式展示 */
export type DocKind = 'text' | 'pdf' | 'word' | 'image' | 'other';

/** 判断文档类型（原文件预览 / 下载用） */
export function docKind(filename: string, mime: string): DocKind {
  const ext = extOf(filename);
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (
    ext === 'doc' ||
    ext === 'docx' ||
    mime.includes('wordprocessingml') ||
    mime.includes('msword')
  ) {
    return 'word';
  }
  if (mime.startsWith('image/')) return 'image';
  if (TEXT_EXTS.has(ext) || mime.startsWith('text/') || mime === 'application/json') return 'text';
  return 'other';
}

/**
 * 把切片按顺序拼回全文（用于老文档的预览回退）。
 * chunkText 相邻块带有 overlap，这里用「最长后缀 = 下一块前缀」去重，避免重复段落。
 */
export function mergeChunks(parts: string[]): string {
  let out = '';
  for (const part of parts) {
    if (!part) continue;
    if (!out) {
      out = part;
      continue;
    }
    const max = Math.min(part.length, 600, out.length);
    let overlap = 0;
    for (let i = max; i >= 1; i--) {
      if (out.endsWith(part.slice(0, i))) {
        overlap = i;
        break;
      }
    }
    out += part.slice(overlap);
  }
  return out;
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
  /** RRF 融合分（越大越相关） */
  score: number;
  vectorScore: number;
  keywordScore: number;
  matchType: 'vector' | 'keyword' | 'hybrid';
  content: string;
}

/** 按分数降序返回命中的下标（过滤掉不满足阈值的） */
function rankIndices(scores: number[], accept: (score: number) => boolean): number[] {
  return scores
    .map((score, index) => ({ score, index }))
    .filter((item) => accept(item.score))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.index);
}

/**
 * 在某用户的知识库中做混合检索（向量 + 关键词，RRF 融合）。
 * 数据按 user_id 严格隔离，绝不会召回其他用户的文档。
 */
export async function searchKnowledge(
  userId: string,
  query: string,
  topK = 6,
): Promise<KnowledgeHit[]> {
  const chunks: ChunkWithSource[] = await getChunksByUser(userId);
  if (chunks.length === 0) return [];

  // 1) 关键词路：原有 2-gram / 分词打分
  const terms = extractTerms(query);
  const keywordScores = chunks.map((chunk) =>
    terms.length > 0 ? scoreChunk(chunk.content, terms) : 0,
  );

  // 2) 向量路：查询向量化失败时自动降级
  let queryVector: number[] | null = null;
  let vectorModel: string | null = null;
  let vectorSemantic = false;
  try {
    const embedded = await embedQuery(query);
    if (embedded) {
      queryVector = embedded.vector;
      vectorModel = embedded.model;
      vectorSemantic = embedded.semantic;
    }
  } catch (err) {
    console.warn(
      `[知识库] 查询向量化失败，本次降级为关键词检索: ${(err as Error)?.message ?? err}`,
    );
  }

  const vectorScores = queryVector
    ? chunks.map((chunk) => {
        if (!chunk.embedding || !vectorModel || chunk.embeddingModel !== vectorModel) return 0;
        if (chunk.embeddingDim !== queryVector!.length) return 0;
        const vector = decodeVector(chunk.embedding);
        return vector ? cosineSimilarity(queryVector!, vector) : 0;
      })
    : null;

  // 3) 两路排名 → RRF 融合
  // 语义模型用配置阈值过滤噪声；本地哈希向量整体分偏低，阈值放宽
  const vectorThreshold = vectorSemantic
    ? config.embedding.minScore
    : Math.min(config.embedding.minScore, 0.05);
  const keywordRanked = rankIndices(keywordScores, (score) => score > 0);
  const vectorRanked = vectorScores
    ? rankIndices(vectorScores, (score) => score >= vectorThreshold)
    : [];

  if (keywordRanked.length === 0 && vectorRanked.length === 0) return [];

  const fused = new Map<number, { score: number; keyword: number; vector: number }>();
  const add = (index: number, score: number, kind: 'keyword' | 'vector') => {
    const item = fused.get(index) ?? { score: 0, keyword: 0, vector: 0 };
    item.score += score;
    item[kind] += score;
    fused.set(index, item);
  };
  keywordRanked.forEach((index, rank) => add(index, rrfScore(rank), 'keyword'));
  vectorRanked.forEach((index, rank) => add(index, rrfScore(rank), 'vector'));

  console.log(
    `[知识库] 检索「${query.slice(0, 30)}」关键词命中 ${keywordRanked.length} 段，` +
      `向量命中 ${vectorRanked.length} 段（阈值 ${vectorThreshold}），融合 ${Math.min(fused.size, topK)} 段`,
  );

  return [...fused.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, topK)
    .map(([index, item]) => {
      const chunk = chunks[index];
      const matchType =
        item.keyword > 0 && item.vector > 0
          ? ('hybrid' as const)
          : item.vector > 0
            ? ('vector' as const)
            : ('keyword' as const);
      return {
        filename: chunk.filename,
        chunkIndex: chunk.chunkIndex,
        score: Number(item.score.toFixed(6)),
        vectorScore: Number((vectorScores?.[index] ?? 0).toFixed(4)),
        keywordScore: Number(keywordScores[index].toFixed(4)),
        matchType,
        content: chunk.content,
      };
    });
}
