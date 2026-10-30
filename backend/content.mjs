import { extractText, safeImage, safeLink } from '../rich-text.mjs';
const nodeTypes = new Set(['doc', 'paragraph', 'heading', 'text', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock', 'hardBreak', 'horizontalRule', 'image']);
const markTypes = new Set(['bold', 'italic', 'strike', 'underline', 'code', 'link']);
export function validateDraft(input) {
  if (!input || typeof input !== 'object') throw new Error('文章数据无效');
  const title = String(input.title ?? '').trim();
  if (!title || title.length > 180) throw new Error('请填写 1–180 字的标题');
  const slug = String(input.slug ?? '').trim();
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(slug)) throw new Error('文章链接只能使用小写字母、数字和连字符');
  const tag = String(input.tag ?? '').trim();
  if (!tag || tag.length > 40 || tag === '全部') throw new Error('请填写 1–40 字的分类名称');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.publishedAt ?? '') || new Date(`${input.publishedAt}T00:00:00Z`).toISOString().slice(0,10) !== input.publishedAt) throw new Error('发布日期无效');
  let count = 0, imageCount = 0;
  function clean(node, depth = 0) {
    if (depth > 30 || ++count > 20000 || !nodeTypes.has(node?.type)) throw new Error('正文格式无效或内容过大');
    const out = { type: node.type };
    if (node.type === 'text') { if (typeof node.text !== 'string') throw new Error('正文文字无效'); out.text = node.text; }
    if (node.type === 'heading') out.attrs = { level: node.attrs?.level === 3 ? 3 : 2 };
    if (node.type === 'image') {
      if (++imageCount > 30) throw new Error('单篇文章最多放置 30 张图片');
      const src = safeImage(node.attrs?.src, true);
      if (!src) throw new Error('请使用粘贴或上传的图片');
      if (src.startsWith('data:') && src.length > 3 * 1024 * 1024) throw new Error('图片过大，请将单张图片控制在 2 MB 左右');
      out.attrs = { src, alt: String(node.attrs?.alt ?? '').slice(0, 500), title: String(node.attrs?.title ?? '').slice(0, 500) };
    }
    if (node.marks) out.marks = node.marks.filter(mark => markTypes.has(mark.type)).map(mark => mark.type === 'link' ? { type: 'link', attrs: { href: safeLink(mark.attrs?.href) ?? '' } } : { type: mark.type });
    if (node.content) { if (!Array.isArray(node.content)) throw new Error('正文格式无效'); out.content = node.content.map(child => clean(child, depth + 1)); }
    return out;
  }
  if (input.content?.type !== 'doc') throw new Error('正文格式无效');
  const content = clean(input.content);
  return { id: /^[a-zA-Z0-9-]{1,80}$/.test(input.id ?? '') ? input.id : crypto.randomUUID(), title, slug, tag, publishedAt: input.publishedAt, intro: String(input.intro ?? '').slice(0, 1000), content, revision: Number.isSafeInteger(input.revision) ? input.revision : 0, updatedAt: new Date().toISOString() };
}
function readingFor(slug) {
  let hash = 2166136261;
  for (const char of slug) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return `0.${String(100000 + hash % 800000)}`;
}
export async function preparePublication(draft) {
  const valid = validateDraft(draft);
  if (!extractText(valid.content).trim() && !JSON.stringify(valid.content).includes('"image"')) throw new Error('请先写一点正文');
  const richDoc = structuredClone(valid.content);
  const files = new Map();
  async function walk(node) {
    if (node.type === 'image' && node.attrs.src.startsWith('data:')) {
      const match = node.attrs.src.match(/^data:image\/(png|jpeg|webp|gif);base64,(.+)$/s);
      const binary = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', binary))].map(value => value.toString(16).padStart(2,'0')).join('');
      const path = `assets/uploads/${hash}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`;
      files.set(path, { path, content: match[2], encoding: 'base64' });
      node.attrs.src = path;
    }
    for (const child of node.content ?? []) await walk(child);
  }
  await walk(richDoc);
  const post = { id: valid.id, slug: valid.slug, title: valid.title, tag: valid.tag, intro: valid.intro, publishedAt: valid.publishedAt, updatedAt: valid.updatedAt, reading: readingFor(valid.slug), body: [extractText(richDoc)], richDoc, isDemo: false };
  return { post, files: [...files.values()] };
}
export function mergePublication(existing, post) {
  if (existing.some(item => item.slug === post.slug && item.id !== post.id)) throw new Error('此文章链接已被另一篇文章使用，请修改链接');
  return [...existing.filter(item => item.id !== post.id), post].sort((a,b) => b.publishedAt.localeCompare(a.publishedAt));
}
