import { longArticle } from './long-article.mjs';
// Blog-specific fictional readings, deliberately independent of canonical plot values.
export const HOME_READING = '0.000000';
const demoPosts = [
  { slug: 'a-small-beginning', publishedAt: '2026-10-02', title: '从一个小小的想法开始', tag: '随笔', reading: '0.483271', date: '示例文章 01', body: ['这是用来体验仪器交互的示例文章，不是博主已经发表的正文。', '有时，开始记录不需要一个宏大的理由。一个突然冒出的念头，一段想留下来的话，就已经足够。', '看看页面中的辉光管：这篇文章有它自己的固定读数。回到首页，再打开另一篇文章，可以观察下一次变化。'] },
  { slug: 'notes-on-curiosity', publishedAt: '2026-10-11', title: '给好奇心留一个位置', tag: '札记', reading: '0.624813', date: '示例文章 02', body: ['这是交互演示用的示例正文。', '把暂时没有答案的问题记下来，也是一种很好的习惯。等到某一天再回头，也许已经有了新的理解。', '同一篇文章的读数保持不变。刷新、直接打开文章链接，或使用浏览器前进后退，都能回到相同的位置。'] },
  { slug: 'a-desk-at-night', publishedAt: '2026-10-18', title: '夜晚，桌上的一点光', tag: '日常', reading: '0.758426', date: '示例文章 03', body: ['这是交互演示用的示例正文。', '夜深的时候，桌面上的一点暖光会让房间变得安静。玻璃里的橙色数字，也是这个页面的灵感。', '仪器只保留本体，安静地显示当前页面的虚构读数。'] },
  { slug: 'building-a-personal-blog', publishedAt: '2026-10-24', title: '搭一个属于自己的博客', tag: '项目手记', reading: '0.392684', date: '示例文章 04', body: [], ...longArticle },
  { slug: 'stories-worth-keeping', publishedAt: '2026-10-29', title: '那些想慢慢聊的故事', tag: '动漫', reading: '0.867352', date: '示例文章 05', body: ['这是动漫文章的示例，不含任何具体作品的剧情。', '有的故事看完就结束了，有的故事会在生活里停留很久。这个角落留给那些值得慢慢聊的作品。', '需要讨论剧情时，可以使用下面这样的折叠提示。'], spoiler: '这是一段可折叠区域的展示文字，没有作品剧情。正式写作时，这里可以放置需要读者主动展开的内容。' }
];
let publishedPosts = [];
if (typeof window !== 'undefined') {
  try {
    const response = await fetch(new URL('./content/published.json', import.meta.url), { cache: 'no-store' });
    if (response.ok) {
      const manifest = await response.json();
      if (Array.isArray(manifest)) publishedPosts = manifest.filter(post => typeof post.slug === 'string' && /^[a-z0-9][a-z0-9-]{0,100}$/.test(post.slug) && typeof post.title === 'string' && typeof post.tag === 'string' && typeof post.publishedAt === 'string' && post.richDoc?.type === 'doc');
    }
  } catch (error) { console.warn('暂时无法读取已发布文章', error.message); }
}
export const posts = [...publishedPosts, ...demoPosts.filter(demo => !publishedPosts.some(post => post.slug === demo.slug)).map(post => ({ ...post, isDemo: true }))];
export function resolveRoute(hash) {
  if (!hash || hash === '#' || hash === '#/') return { kind: 'home', reading: HOME_READING };
  const match = posts.find(post => hash === `#/posts/${post.slug}`);
  return match ? { kind: 'post', post: match, reading: match.reading } : { kind: 'missing', reading: HOME_READING };
}


