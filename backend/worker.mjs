import { validateDraft, preparePublication, mergePublication } from './content.mjs';
import { github, readPublic, writePublic, listKV, putKV } from './repository.mjs';
import { listManagedPosts, managePost, manageBatch } from './management.mjs';
const SESSION_TTL = 8 * 60 * 60;
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
const cookieName = url => url.protocol === 'https:' ? '__Host-ysc_session' : 'ysc_local_session';
const cookieValue = (request, name) => request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
function cookie(url, name, value, maxAge, sameSite = 'Strict') { return `${name}=${value}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${url.protocol === 'https:' ? '; Secure' : ''}`; }
async function getSession(request, env) {
  const url = new URL(request.url);
  const id = cookieValue(request, cookieName(url));
  if (env.LOCAL_SESSION) return id === env.LOCAL_SESSION.id ? env.LOCAL_SESSION : null;
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) return null;
  return env.DRAFTS?.get(`session:${id}`, { type: 'json' });
}
async function readJSON(request) {
  if (Number(request.headers.get('content-length')) > 18 * 1024 * 1024) throw new Error('文章超过 18 MB，请减少大图');
  const body = await request.text();
  if (body.length > 18 * 1024 * 1024) throw new Error('文章超过 18 MB，请减少大图');
  try { return JSON.parse(body); } catch { throw new Error('提交的数据无法读取'); }
}
async function publishToGithub(session, env, draft) {
  const state = await readPublic(session, env);
  const publication = await preparePublication(draft);
  const posts = mergePublication(state.posts, publication.post);
  const hiddenSlugs = state.hiddenSlugs.filter(slug => slug !== draft.slug);
  const commit = await writePublic(session, env, state, { posts, hiddenSlugs }, publication.files, `Publish article: ${draft.title}`);
  return { slug: draft.slug, commit, url: `${env.PUBLIC_SITE_URL || 'https://yschannel.github.io'}/#/posts/${draft.slug}`, mode: env.LOCAL_CONTENT ? 'local' : 'github', message: env.LOCAL_CONTENT ? '已发布到本机预览。' : '已提交到 GitHub，网站更新需要等待 Pages 发布完成。' };
}
function isOwner(session, env) { return session?.login?.toLowerCase() === (env.ALLOWED_GITHUB_USER || 'yschannel').toLowerCase(); }
export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  try {
    if (path === '/auth/login') {
      if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.DRAFTS) return json({ error: '在线登录尚未配置，请先完成后台部署。' }, 503);
      const state = crypto.randomUUID();
      const verifier = crypto.randomUUID() + crypto.randomUUID();
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
      const challenge = btoa(String.fromCharCode(...hash)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
      await putKV(env.DRAFTS, `oauth:${state}`, JSON.stringify({ verifier }), { expirationTtl: 600 });
      const target = new URL('https://github.com/login/oauth/authorize');
      target.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: `${url.origin}/auth/callback`, scope: 'public_repo', state, code_challenge: challenge, code_challenge_method: 'S256' });
      return new Response(null, { status: 302, headers: { Location: target.href, 'Set-Cookie': cookie(url, '__Host-ysc_oauth', state, 600, 'Lax'), 'Cache-Control': 'no-store' } });
    }
    if (path === '/auth/callback') {
      const state = url.searchParams.get('state');
      if (!state || state !== cookieValue(request, '__Host-ysc_oauth')) return json({ error: '登录校验失败，请重新登录。' }, 403);
      const pending = await env.DRAFTS.get(`oauth:${state}`, { type: 'json' });
      if (!pending || !url.searchParams.get('code')) return json({ error: '登录请求已过期。' }, 403);
      await env.DRAFTS.delete(`oauth:${state}`);
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code: url.searchParams.get('code'), redirect_uri: `${url.origin}/auth/callback`, code_verifier: pending.verifier }) });
      const tokens = await tokenResponse.json();
      if (!tokens.access_token) return json({ error: 'GitHub 登录失败，请重试。' }, 401);
      const user = await github(tokens.access_token, '/user');
      if (user.login.toLowerCase() !== (env.ALLOWED_GITHUB_USER || 'yschannel').toLowerCase()) return json({ error: '此账号没有博客写作权限。' }, 403);
      const id = crypto.randomUUID();
      await putKV(env.DRAFTS, `session:${id}`, JSON.stringify({ id, login: user.login, csrf: crypto.randomUUID(), githubToken: tokens.access_token }), { expirationTtl: Math.min(SESSION_TTL, tokens.expires_in || SESSION_TTL) });
      const headers = new Headers({ Location: '/', 'Cache-Control': 'no-store' });
      headers.append('Set-Cookie', cookie(url, cookieName(url), id, SESSION_TTL));
      headers.append('Set-Cookie', cookie(url, '__Host-ysc_oauth', '', 0, 'Lax'));
      return new Response(null, { status: 302, headers });
    }
    if (path === '/api/session') {
      const session = env.LOCAL_SESSION ?? await getSession(request, env);
      if (!session || !isOwner(session, env)) return json({ authenticated: false, configured: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.DRAFTS), siteUrl: env.PUBLIC_SITE_URL || 'https://yschannel.github.io' });
      return json({ authenticated: true, login: session.login, csrf: session.csrf, mode: env.LOCAL_SESSION ? 'local' : 'online', siteUrl: env.PUBLIC_SITE_URL || 'https://yschannel.github.io' }, 200, env.LOCAL_SESSION ? { 'Set-Cookie': cookie(url, cookieName(url), session.id, SESSION_TTL) } : {});
    }
    if (path.startsWith('/api/')) {
      const session = await getSession(request, env);
      if (!session) return json({ error: '请先登录写作后台。' }, 401);
      if (!isOwner(session, env)) return json({ error: '只有博客作者可以管理文章与草稿。' }, 403);
      if (request.method !== 'GET' && (request.headers.get('Origin') !== url.origin || request.headers.get('X-CSRF-Token') !== session.csrf)) return json({ error: '请求校验失败，请刷新后台。' }, 403);
      if (path === '/api/logout' && request.method === 'POST') {
        if (!env.LOCAL_SESSION) await env.DRAFTS.delete(`session:${session.id}`);
        return json({ ok: true }, 200, { 'Set-Cookie': cookie(url, cookieName(url), '', 0) });
      }
      if (path === '/api/drafts' && request.method === 'GET') {
        const keys = await listKV(env.DRAFTS, 'draft:');
        return json({ drafts: keys.map(key => key.metadata).filter(Boolean) });
      }
      if (path === '/api/posts' && request.method === 'GET') return json(await listManagedPosts(session, env));
      if (path === '/api/posts/manage' && request.method === 'POST') return json(await managePost(session, env, await readJSON(request)));
      if (path === '/api/manage/batch' && request.method === 'POST') return json(await manageBatch(session, env, await readJSON(request)));
      const draftAction = path.match(/^\/api\/drafts\/([a-zA-Z0-9-]{1,80})(\/restore)?$/);
      if (draftAction && (request.method === 'DELETE' && !draftAction[2] || request.method === 'POST' && draftAction[2])) {
        const key = `draft:${draftAction[1]}`;
        const draft = await env.DRAFTS.get(key, { type: 'json' });
        if (!draft || draft.purged) return json({ error: '草稿不存在或已永久删除' }, 410);
        const input = await readJSON(request);
        if (draft.revision !== input.revision) return json({ error: '草稿已有更新，请重新打开后再操作。' }, 409);
        const restoring = !!draftAction[2];
        if (restoring !== !!draft.deletedAt) return json({ error: restoring ? '草稿不在回收站' : '草稿已在回收站' }, 409);
        draft.revision += 1;
        draft.updatedAt = new Date().toISOString();
        if (restoring) delete draft.deletedAt; else draft.deletedAt = draft.updatedAt;
        await putKV(env.DRAFTS, key, JSON.stringify(draft), { metadata: { id: draft.id, title: draft.title, tag: draft.tag, updatedAt: draft.updatedAt, revision: draft.revision, deletedAt: draft.deletedAt ?? null } });
        return json({ draft, message: restoring ? '草稿已恢复。' : '草稿已移入回收站，已发布的文章不受影响。' });
      }
      const match = path.match(/^\/api\/drafts\/([a-zA-Z0-9-]{1,80})$/);
      if (match && request.method === 'GET') {
        const draft = await env.DRAFTS.get(`draft:${match[1]}`, { type: 'json' });
        return draft && !draft.purged ? json({ draft }) : json({ error: '未找到草稿' }, 404);
      }
      if (path === '/api/drafts' && request.method === 'PUT') {
        const draft = validateDraft(await readJSON(request));
        const old = await env.DRAFTS.get(`draft:${draft.id}`, { type: 'json' });
        if (old?.deletedAt || old?.purged) return json({ error: '这份草稿已在其他设备删除，请先从回收站恢复。' }, 409);
        if (old && old.revision !== draft.revision) return json({ error: '这份草稿已在其他页面修改。请先导出当前内容，再重新打开服务器版本。' }, 409);
        draft.revision += 1;
        await putKV(env.DRAFTS, `draft:${draft.id}`, JSON.stringify(draft), { metadata: { id: draft.id, title: draft.title, tag: draft.tag, updatedAt: draft.updatedAt, revision: draft.revision, deletedAt: null } });
        return json({ draft });
      }
      if (path === '/api/publish' && request.method === 'POST') {
        const input = await readJSON(request);
        const draft = await env.DRAFTS.get(`draft:${input.id}`, { type: 'json' });
        if (!draft || draft.deletedAt || draft.revision !== input.revision) return json({ error: '请先保存最新草稿，再发布。' }, 409);
        const result = env.LOCAL_PUBLISH ? await env.LOCAL_PUBLISH(draft) : await publishToGithub(session, env, draft);
        return json(result);
      }
      return json({ error: '未找到接口' }, 404);
    }
    return env.ASSETS.fetch(request);
  } catch (error) {
    return json({ error: error.message || '操作未完成，草稿已保留，请重试。' }, 400);
  }
}
export default { fetch: handleRequest };
