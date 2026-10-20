import type { OpenAITool, ToolContext } from '../types';
import { searchKnowledge } from '../knowledge';

/**
 * 知识库检索工具（RAG 的「检索」入口）
 *
 * 关键节点：RAG + Function Calling ——
 * 它和其他工具一样交给模型自主决定是否调用：
 * 当用户问的是「我上传的文档 / 资料」相关内容时，模型会调用本工具，
 * 后端按当前用户检索出最相关的片段，作为工具结果回填，模型再据此作答。
 *
 * 注意：检索必须按 user_id 隔离，因此执行时依赖 ToolContext（见 types.ts）。
 */

export const knowledgeTools: OpenAITool[] = [
  {
    type: 'function',
    function: {
      name: 'searchKnowledge',
      description:
        '在用户本人的知识库中做「向量 + 关键词」混合检索（用户上传的文档资料）。' +
        '当问题与用户上传的文件/资料相关，或用户提到「根据文档 / 我上传的文件 / 资料里 / 这份材料」时调用。' +
        'query 请填入能代表问题的关键术语或完整问题，而不是整段寒暄。',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '检索关键词或问题要点，尽量包含专有名词、术语，例如：“合同 违约条款 赔偿”',
          },
        },
        required: ['query'],
      },
    },
  },
];

/** 知识库工具的本地实现（异步：需要访问 MySQL） */
export const knowledgeExecutors: Record<
  string,
  (args: any, ctx: ToolContext) => Promise<unknown> | unknown
> = {
  searchKnowledge: async (args, ctx) => {
    const query = String(args?.query ?? '').trim();
    if (!query) {
      return { error: '缺少参数：query（检索关键词）' };
    }

    const hits = await searchKnowledge(ctx.userId, query, 6);
    console.log(`[知识库] 用户 ${ctx.userId.slice(0, 8)} 检索「${query}」命中 ${hits.length} 段`);

    if (hits.length === 0) {
      return {
        found: 0,
        note: '知识库中没有找到与该问题相关的片段。若用户尚未上传文档，请提示其先上传；否则可建议换个说法。',
      };
    }

    return {
      found: hits.length,
      retrieval: 'hybrid(vector+keyword)',
      results: hits.map((h) => ({
        file: h.filename,
        chunk: h.chunkIndex,
        match: h.matchType,
        score: h.score,
        vectorScore: h.vectorScore,
        snippet: h.content,
      })),
    };
  },
};
