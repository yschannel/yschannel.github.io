// Add a definition here to give an index its own introduction, even before it has posts.
export const seriesDefinitions = [
  { title: '随笔', label: 'PASSING THOUGHTS', description: '给偶然出现的念头留一页纸，记录想说的话。', action: '翻开随笔' },
  { title: '札记', label: 'NOTES & QUESTIONS', description: '收集问题，整理思路，给尚未想明白的事留个位置。', action: '翻开札记' },
  { title: '日常', label: 'ORDINARY DAYS', description: '留住普通日子里的小片段，和那些值得记下的瞬间。', action: '翻开日常' },
  { title: '项目手记', label: 'WORK IN PROGRESS', description: '把尝试、绕路和发现，都留在做项目的过程里。', action: '翻开项目记录' },
  { title: '动漫', label: 'STORIES & AFTERTHOUGHTS', description: '聊聊喜欢的作品，和故事落幕后仍留在心里的想法。', action: '翻开动漫记录' }
];
export function buildSeries(items, definitions = seriesDefinitions) {
  const all = { title: '全部', label: 'ALL RECORDS', description: '文章、思考和沿途的发现，都收藏在这里。', action: '浏览全部记录', count: items.length };
  const names = [...new Set([...definitions.map(entry => entry.title), ...items.map(item => item.tag)])].filter(name => name && name !== '全部');
  return [all, ...names.map(title => ({
    title, label: 'SERIES NOTES', description: `这里收藏「${title}」的文章与思考。`, action: '浏览系列文章',
    ...definitions.find(entry => entry.title === title),
    count: items.filter(item => item.tag === title).length
  }))];
}
export function dateNumber(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const number = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(number) && new Date(number).toISOString().slice(0, 10) === value ? number : NaN;
}
// Nearest date in the current index; ties prefer the earlier date, then stable slug order.
export function nearestPost(items, date) {
  const target = dateNumber(date);
  if (!Number.isFinite(target)) return null;
  return items.filter(item => Number.isFinite(dateNumber(item.publishedAt))).slice().sort((a, b) => {
    const aDate = dateNumber(a.publishedAt), bDate = dateNumber(b.publishedAt);
    return Math.abs(aDate - target) - Math.abs(bDate - target) || aDate - bDate || a.slug.localeCompare(b.slug);
  })[0] ?? null;
}
export function postsOnDate(items, date) {
  return items.filter(item => item.publishedAt === date && Number.isFinite(dateNumber(date)));
}

const normalizeSearch = text => String(text ?? '').normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/\s+/gu, ' ').trim();
// Build once when articles load. Queries scan cached plain text, never live DOM or HTML.
export function createArticleSearch(items) {
  const records = items.map(post => ({
    post,
    text: normalizeSearch([
      post.title, post.tag, post.intro, ...(post.body ?? []), post.spoiler,
      ...(post.sections ?? []).flatMap(section => [section.title, ...section.blocks.flatMap(block => [block.text, block.title, block.caption, ...(block.items ?? [])])])
    ].filter(Boolean).join(' '))
  }));
  return (query = '', category = '全部') => {
    const terms = normalizeSearch(query).split(' ').filter(Boolean);
    return records.filter(({ post, text }) => (category === '全部' || post.tag === category) && terms.every(term => text.includes(term))).map(({ post }) => post);
  };
}
