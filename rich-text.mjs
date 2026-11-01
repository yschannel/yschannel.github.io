export const escapeText = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export function safeLink(value) {
  return typeof value === 'string' && /^(https?:\/\/|mailto:)/i.test(value) ? value : null;
}
export function safeImage(value, allowData = false) {
  if (typeof value !== 'string') return null;
  if (/^assets\/[a-zA-Z0-9_./-]+$/.test(value) && !value.split('/').includes('..')) return value;
  if (allowData && /^data:image\/(png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(value)) return value;
  return null;
}
export function extractText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'image') return node.attrs?.alt ?? '';
  return (node.content ?? []).map(extractText).join(['paragraph', 'heading', 'doc', 'listItem'].includes(node.type) ? ' ' : '');
}
export function renderRichNode(node, { allowData = false } = {}) {
  if (!node || typeof node !== 'object') return '';
  const inner = () => (node.content ?? []).map(child => renderRichNode(child, { allowData })).join('');
  if (node.type === 'text') {
    let text = escapeText(node.text);
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') text = `<strong>${text}</strong>`;
      if (mark.type === 'italic') text = `<em>${text}</em>`;
      if (mark.type === 'strike') text = `<s>${text}</s>`;
      if (mark.type === 'underline') text = `<u>${text}</u>`;
      if (mark.type === 'code') text = `<code>${text}</code>`;
      if (mark.type === 'link' && safeLink(mark.attrs?.href)) text = `<a href="${escapeText(mark.attrs.href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    }
    return text;
  }
  if (node.type === 'doc') return inner();
  if (node.type === 'paragraph') return `<p>${inner() || '<br>'}</p>`;
  if (node.type === 'heading') { const level = [2, 3].includes(node.attrs?.level) ? node.attrs.level : 2; return `<h${level}>${inner()}</h${level}>`; }
  if (node.type === 'bulletList') return `<ul>${inner()}</ul>`;
  if (node.type === 'orderedList') return `<ol>${inner()}</ol>`;
  if (node.type === 'listItem') return `<li>${inner()}</li>`;
  if (node.type === 'spoiler') return `<details class="spoiler rich-spoiler"><summary>${escapeText(node.attrs?.label || '剧透提示 · 点击展开')}</summary><div>${inner()}</div></details>`;
  if (node.type === 'blockquote') return `<blockquote>${inner()}</blockquote>`;
  if (node.type === 'codeBlock') return `<pre><code>${escapeText(extractText(node))}</code></pre>`;
  if (node.type === 'hardBreak') return '<br>';
  if (node.type === 'horizontalRule') return '<hr>';
  if (node.type === 'image') {
    const src = safeImage(node.attrs?.src, allowData);
    if (!src) return '';
    const image = `<img src="${escapeText(src)}" alt="${escapeText(node.attrs?.alt ?? '')}" loading="lazy" decoding="async">`;
    return `<figure class="rich-figure">${allowData ? image : `<button type="button" class="article-image" data-image="${escapeText(src)}" data-caption="${escapeText(node.attrs?.title ?? '')}" aria-label="放大图片：${escapeText(node.attrs?.alt ?? '文章图片')}">${image}<span>↗ 查看大图</span></button>`}${node.attrs?.title ? `<figcaption>${escapeText(node.attrs.title)}</figcaption>` : ''}</figure>`;
  }
  return '';
}
export function sectionsFromRichDoc(doc) {
  const sections = [];
  for (const node of doc?.content ?? []) {
    if (node.type === 'heading' || !sections.length) sections.push({ id: `section-${sections.length + 1}`, title: node.type === 'heading' ? extractText(node) : '正文', blocks: [] });
    sections.at(-1).blocks.push({ type: 'rich', node });
  }
  return sections.length ? sections : [{ id: 'section-1', title: '正文', blocks: [] }];
}
