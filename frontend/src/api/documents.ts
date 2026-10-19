import { authedFetch, post, requestJson } from './client';
import type { DocumentChunk, DocumentDetail, KnowledgeDoc } from './types';

/** 我的知识库文档列表 */
export function listDocuments(): Promise<KnowledgeDoc[]> {
  return requestJson<KnowledgeDoc[]>('/documents');
}

/** 上传文档（前端把文件读成 base64 后随 JSON 提交） */
export function uploadDocument(input: {
  filename: string;
  mime: string;
  data: string;
}): Promise<KnowledgeDoc> {
  return post<KnowledgeDoc>('/documents', input);
}

/** 文档详情（元信息 + 全文，超长会被截断） */
export function getDocument(id: string): Promise<DocumentDetail> {
  return requestJson<DocumentDetail>(`/documents/${id}`);
}

/** 文档切片（用于「切片」页签） */
export function getDocumentChunks(id: string): Promise<DocumentChunk[]> {
  return requestJson<DocumentChunk[]>(`/documents/${id}/chunks`);
}

/** 读取完整全文（纯文本） */
export async function getDocumentText(id: string): Promise<string> {
  const resp = await authedFetch(`/documents/${id}/text`);
  return resp.text();
}

/** 读取原始文件（PDF / 图片可转 Blob URL 内联预览） */
export async function getDocumentFile(id: string): Promise<Blob> {
  const resp = await authedFetch(`/documents/${id}/file`);
  return resp.blob();
}

/** 删除文档（级联删除其分块与原文件） */
export function deleteDocument(id: string): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>(`/documents/${id}`, { method: 'DELETE' });
}
