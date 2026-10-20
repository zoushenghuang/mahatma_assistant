import { config } from './config';

/**
 * Embedding 服务（向量化）
 *
 * 三种 provider，按配置自动切换：
 * - hash：本地特征哈希（中文 2/3-gram + 英文词），零依赖、离线可跑；不是语义模型
 * - openai：OpenAI 兼容 /embeddings（SiliconFlow、OpenAI、智谱等）
 * - ollama：本地 Ollama（/api/embed，失败回退 /api/embeddings）
 *
 * 向量统一做 L2 归一化，检索用余弦相似度；存储为 Float32 小端 BLOB。
 */

export type EmbeddingProvider = 'hash' | 'openai' | 'ollama';

export interface EmbeddingRuntime {
  provider: EmbeddingProvider;
  model: string;
  /** hash 模式为固定维度；openai/ollama 未知时为 0，以接口返回为准 */
  dim: number;
  semantic: boolean;
}

export interface QueryEmbedding {
  vector: number[];
  model: string;
  dim: number;
  /** 是否来自语义模型（false = 本地哈希，阈值需要放宽） */
  semantic: boolean;
}

const HASH_MODEL = 'local-hash-ngram-v1';
const DEFAULT_HASH_DIM = 1024;
const RRF_K = 60;

let warnedFallback = false;

function hashRuntime(): EmbeddingRuntime {
  return {
    provider: 'hash',
    model: HASH_MODEL,
    dim: config.embedding.dim || DEFAULT_HASH_DIM,
    semantic: false,
  };
}

/** 当前生效的向量化运行时（配置不完整时自动降级为 hash） */
export function getEmbeddingRuntime(): EmbeddingRuntime {
  const provider = config.embedding.provider;

  if (provider === 'openai') {
    if (!config.embedding.baseUrl || !config.embedding.apiKey || !config.embedding.model) {
      if (!warnedFallback) {
        console.warn(
          '[Embedding] openai 配置不完整（需要 EMBEDDING_BASE_URL / EMBEDDING_API_KEY / EMBEDDING_MODEL），已降级为本地哈希向量',
        );
        warnedFallback = true;
      }
      return hashRuntime();
    }
    return {
      provider: 'openai',
      model: config.embedding.model,
      dim: config.embedding.dim || 0,
      semantic: true,
    };
  }

  if (provider === 'ollama') {
    return {
      provider: 'ollama',
      model: config.embedding.model || 'bge-m3',
      dim: config.embedding.dim || 0,
      semantic: true,
    };
  }

  return hashRuntime();
}

/** 把文本批量转成向量（已归一化） */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const runtime = getEmbeddingRuntime();

  if (runtime.provider === 'openai') return embedWithOpenAI(texts, runtime);
  if (runtime.provider === 'ollama') return embedWithOllama(texts, runtime);

  return texts.map((text) => hashEmbed(text, runtime.dim || DEFAULT_HASH_DIM));
}

/**
 * 把查询语句转成向量。
 * 调用失败时抛错，调用方（检索）自行降级为关键词检索。
 */
export async function embedQuery(text: string): Promise<QueryEmbedding | null> {
  const query = text.trim();
  if (!query) return null;

  const [vector] = await embedTexts([query]);
  if (!vector || vector.length === 0) return null;

  const runtime = getEmbeddingRuntime();
  return { vector, model: runtime.model, dim: vector.length, semantic: runtime.semantic };
}

// ============ 本地特征哈希向量 ============

/** FNV-1a 32 位哈希 */
function fnv1a(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/** 抽取哈希特征：英文/数字按词，中文按 2-gram + 3-gram，并保留短句整体 */
function hashTokens(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();

  for (const match of lower.matchAll(/[a-z0-9_]{2,}/g)) {
    tokens.push(match[0]);
  }

  for (const match of lower.matchAll(/[\u4e00-\u9fa5]+/g)) {
    const run = match[0];
    if (run.length === 1) {
      tokens.push(run);
      continue;
    }
    for (let i = 0; i + 2 <= run.length; i++) tokens.push(run.slice(i, i + 2));
    for (let i = 0; i + 3 <= run.length; i++) tokens.push(run.slice(i, i + 3));
    if (run.length <= 8) tokens.push(run); // 短句整体特征
  }

  return tokens;
}

/** 本地哈希向量（特征空间模型，离线兜底） */
export function hashEmbed(text: string, dim = DEFAULT_HASH_DIM): number[] {
  const vector = new Array<number>(dim).fill(0);
  for (const token of hashTokens(text)) {
    const index = fnv1a(token) % dim;
    vector[index] += 1;
  }
  return normalizeVector(vector);
}

// ============ OpenAI 兼容 embedding ============

interface OpenAIEmbeddingResponse {
  data?: { embedding: number[]; index: number }[];
  error?: { message?: string };
}

async function embedWithOpenAI(texts: string[], runtime: EmbeddingRuntime): Promise<number[][]> {
  const base = config.embedding.baseUrl.replace(/\/+$/, '');
  const endpoint = base.endsWith('/embeddings') ? base : `${base}/embeddings`;
  const result: number[][] = [];

  for (const batch of chunkArray(texts, Math.max(1, config.embedding.batchSize))) {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.embedding.apiKey}`,
      },
      body: JSON.stringify({ model: runtime.model, input: batch }),
      signal: AbortSignal.timeout(config.embedding.timeoutMs),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(
        `Embedding 接口返回 ${resp.status}${body ? `：${body.slice(0, 200)}` : ''}`,
      );
    }

    const json = (await resp.json()) as OpenAIEmbeddingResponse;
    const data = json.data;
    if (!Array.isArray(data) || data.length !== batch.length) {
      throw new Error(json.error?.message ?? 'Embedding 接口返回格式异常');
    }

    // 部分服务不保证顺序，按 index 排序
    const ordered = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    for (const item of ordered) {
      if (!Array.isArray(item.embedding) || item.embedding.length === 0) {
        throw new Error('Embedding 接口返回了空向量');
      }
      result.push(normalizeVector(item.embedding));
    }
  }

  return result;
}

// ============ Ollama ============

interface OllamaEmbedResponse {
  embeddings?: number[][];
  embedding?: number[];
  error?: string;
}

async function embedWithOllama(texts: string[], runtime: EmbeddingRuntime): Promise<number[][]> {
  const base = (config.embedding.baseUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');

  try {
    const result: number[][] = [];
    for (const batch of chunkArray(texts, Math.max(1, config.embedding.batchSize))) {
      const resp = await fetch(`${base}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: runtime.model, input: batch }),
        signal: AbortSignal.timeout(config.embedding.timeoutMs),
      });
      if (!resp.ok) throw new Error(await readOllamaError(resp));
      const json = (await resp.json()) as OllamaEmbedResponse;
      if (!Array.isArray(json.embeddings) || json.embeddings.length !== batch.length) {
        throw new Error(json.error ?? 'Ollama 返回格式异常');
      }
      result.push(...json.embeddings.map((v) => normalizeVector(v)));
    }
    return result;
  } catch (err) {
    // 老版本 Ollama 只有 /api/embeddings（单条），逐条兜底
    console.warn(`[Embedding] /api/embed 失败，回退 /api/embeddings: ${(err as Error).message}`);
    const result: number[][] = [];
    for (const text of texts) {
      const resp = await fetch(`${base}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: runtime.model, prompt: text }),
        signal: AbortSignal.timeout(config.embedding.timeoutMs),
      });
      if (!resp.ok) throw new Error(await readOllamaError(resp));
      const json = (await resp.json()) as OllamaEmbedResponse;
      if (!Array.isArray(json.embedding) || json.embedding.length === 0) {
        throw new Error(json.error ?? 'Ollama 返回了空向量');
      }
      result.push(normalizeVector(json.embedding));
    }
    return result;
  }
}

async function readOllamaError(resp: Response): Promise<string> {
  const body = await resp.text().catch(() => '');
  return `Ollama 返回 ${resp.status}${body ? `：${body.slice(0, 200)}` : ''}`;
}

// ============ 向量工具 ============

/** L2 归一化（原地修改并返回） */
export function normalizeVector(vector: number[]): number[] {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (norm > 0) {
    for (let i = 0; i < vector.length; i++) vector[i] /= norm;
  }
  return vector;
}

/** 余弦相似度（向量已归一化时等同于点积） */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

/** Float32 小端编码（MySQL MEDIUMBLOB） */
export function encodeVector(vector: number[]): Buffer {
  const buffer = Buffer.allocUnsafe(vector.length * 4);
  for (let i = 0; i < vector.length; i++) {
    buffer.writeFloatLE(Number.isFinite(vector[i]) ? vector[i] : 0, i * 4);
  }
  return buffer;
}

/** Float32 小端解码 */
export function decodeVector(buffer: Buffer | null | undefined): number[] | null {
  if (!buffer || buffer.length < 4 || buffer.length % 4 !== 0) return null;
  const vector = new Array<number>(buffer.length / 4);
  for (let i = 0; i < vector.length; i++) vector[i] = buffer.readFloatLE(i * 4);
  return vector;
}

/** RRF 融合分数 */
export function rrfScore(rank: number): number {
  return 1 / (RRF_K + rank + 1);
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}
