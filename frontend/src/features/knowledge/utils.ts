import { escapeHtml } from '@/shared/lib/format';

/** 读取本地文件为 base64（去掉 data URL 前缀） */
export function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

/**
 * 把正文按查询词切成 <mark> 片段（最多 500 处，避免超长文档卡顿）。
 * 文本先转义再插入标记，不会引入 XSS。
 */
export function buildMarkup(text: string, query: string): { html: string; count: number } {
  const q = query.trim();
  if (!q) return { html: escapeHtml(text), count: 0 };

  const lower = text.toLowerCase();
  const target = q.toLowerCase();
  let html = '';
  let from = 0;
  let count = 0;

  while (count < 500) {
    const hit = lower.indexOf(target, from);
    if (hit < 0) break;
    html += escapeHtml(text.slice(from, hit));
    html += `<mark>${escapeHtml(text.slice(hit, hit + q.length))}</mark>`;
    from = hit + q.length;
    count += 1;
  }
  html += escapeHtml(text.slice(from));
  return { html, count };
}
