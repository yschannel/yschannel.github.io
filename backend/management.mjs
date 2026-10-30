import { demoPosts } from '../readings.mjs';
import { readPublic, writePublic, listKV, putKV } from './repository.mjs';
export function activePosts(state) {
  const combined = [...state.posts, ...demoPosts.filter(post => !state.posts.some(item => item.slug === post.slug)).map(post => ({ ...post, isDemo: true }))];
  return combined.filter(post => !state.hiddenSlugs.includes(post.slug));
}
export async function listManagedPosts(session, env) {
  const state = await readPublic(session, env);
  const archives = await listKV(env.DRAFTS, 'article:');
  const active = activePosts(state);
  const rows = active.map(post => ({ slug: post.slug, title: post.title, tag: post.tag, publishedAt: post.publishedAt, isDemo: !!post.isDemo, status: 'published' }));
  for (const key of archives) {
    const meta = key.metadata;
    if (meta && !active.some(post => post.slug === meta.slug)) rows.push({ ...meta, status: meta.status === 'deleted' ? 'deleted' : 'unpublished' });
  }
  return { posts: rows, version: state.head };
}
export async function managePost(session, env, input) {
  const { slug, action, version } = input;
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(slug ?? '') || !['unpublish', 'delete', 'restore', 'republish'].includes(action)) throw new Error('文章管理操作无效');
  const state = await readPublic(session, env);
  if (!version || version !== state.head) throw new Error('文章列表已有更新，请刷新后重试');
  const key = `article:${slug}`;
  const archive = await env.DRAFTS.get(key, { type: 'json' });
  const published = activePosts(state).find(post => post.slug === slug);
  const post = published ?? archive?.post;
  if (!post) throw new Error('未找到这篇文章，请刷新文章管理');
  if (action === 'unpublish' && !published) throw new Error('这篇文章已经不在公开博客中');
  if (action === 'restore' && (published || archive?.status !== 'deleted')) throw new Error('这篇文章不在回收站');
  if (action === 'republish' && archive?.status === 'deleted') throw new Error('请先从回收站恢复，再重新发布');
  if (action === 'republish' && published) throw new Error('这篇文章已经发布');
  const status = action === 'delete' ? 'deleted' : action === 'republish' ? 'published' : 'unpublished';
  const record = { post, status, updatedAt: new Date().toISOString() };
  // Keep a private recovery copy before changing the public branch.
  if (!archive) await putKV(env.DRAFTS, key, JSON.stringify({ ...record, status: published ? 'published' : 'unpublished' }), { metadata: { slug, title: post.title, tag: post.tag, status: published ? 'published' : 'unpublished' } });
  const next = { posts: state.posts.filter(item => item.slug !== slug), hiddenSlugs: [...new Set([...state.hiddenSlugs, slug])] };
  if (action === 'republish') {
    if (!post.isDemo) next.posts.push(post);
    next.hiddenSlugs = next.hiddenSlugs.filter(item => item !== slug);
  }
  await writePublic(session, env, state, next, [], `${action} article: ${post.title}`);
  await putKV(env.DRAFTS, key, JSON.stringify(record), { metadata: { slug, title: post.title, tag: post.tag, isDemo: !!post.isDemo, status, updatedAt: record.updatedAt } });
  return { ok: true, status, message: action === 'restore' ? '已恢复为未发布文章，可检查后重新发布。' : action === 'delete' ? '文章已移入回收站，关联草稿仍保留。博客更新需要稍等片刻。' : action === 'unpublish' ? '已撤回公开文章，正文和草稿已保留。博客更新需要稍等片刻。' : '已重新发布，博客更新需要稍等片刻。' };
}
