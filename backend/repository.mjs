export async function github(token, path, method = 'GET', body) {
  const response = await fetch(`https://api.github.com${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'yschannel-writing-desk', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error(response.status === 409 || response.status === 422 ? '仓库有其他更新，请刷新文章管理后重试。' : `GitHub 请求失败（${response.status}），请检查登录和仓库权限。`);
  return response.status === 204 ? null : response.json();
}
export async function readPublic(session, env) {
  if (env.LOCAL_CONTENT) return env.LOCAL_CONTENT.read();
  const base = `/repos/${env.GITHUB_REPOSITORY}`;
  const branch = env.GITHUB_BRANCH || 'main';
  const ref = await github(session.githubToken, `${base}/git/ref/heads/${encodeURIComponent(branch)}`);
  const commit = await github(session.githubToken, `${base}/git/commits/${ref.object.sha}`);
  const tree = await github(session.githubToken, `${base}/git/trees/${commit.tree.sha}?recursive=1`);
  if (tree.truncated) throw new Error('仓库文件过多，无法安全读取完整文章清单');
  if (!tree.tree.some(file => file.path === 'index.html')) throw new Error('请先部署博客基础文件，草稿已保留。');
  async function read(path, fallback) {
    const file = tree.tree.find(item => item.path === path);
    if (!file) return fallback;
    const blob = await github(session.githubToken, `${base}/git/blobs/${file.sha}`);
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(blob.content.replace(/\s/g, '')), char => char.charCodeAt(0))));
  }
  const posts = await read('content/published.json', []);
  const visibility = await read('content/visibility.json', { hiddenSlugs: [] });
  if (!Array.isArray(posts) || !Array.isArray(visibility.hiddenSlugs)) throw new Error('公开文章清单格式无效，已停止修改');
  return { posts, hiddenSlugs: visibility.hiddenSlugs, head: ref.object.sha, tree: commit.tree.sha, base, branch };
}
export async function writePublic(session, env, state, next, files = [], message = 'Update article visibility') {
  if (env.LOCAL_CONTENT) return env.LOCAL_CONTENT.write(state, next, files);
  const entries = [];
  for (const file of files) {
    const blob = await github(session.githubToken, `${state.base}/git/blobs`, 'POST', { content: file.content, encoding: 'base64' });
    entries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  for (const [path, content] of [['content/published.json', next.posts], ['content/visibility.json', { hiddenSlugs: [...new Set(next.hiddenSlugs)].sort() }]]) entries.push({ path, mode: '100644', type: 'blob', content: JSON.stringify(content, null, 2) });
  const tree = await github(session.githubToken, `${state.base}/git/trees`, 'POST', { base_tree: state.tree, tree: entries });
  const commit = await github(session.githubToken, `${state.base}/git/commits`, 'POST', { message, tree: tree.sha, parents: [state.head] });
  await github(session.githubToken, `${state.base}/git/refs/heads/${encodeURIComponent(state.branch)}`, 'PATCH', { sha: commit.sha, force: false });
  return commit.sha;
}
export async function listKV(kv, prefix) {
  const keys = []; let cursor;
  do { const page = await kv.list({ prefix, ...(cursor ? { cursor } : {}) }); keys.push(...page.keys); cursor = page.list_complete ? null : page.cursor; } while (cursor);
  return keys;
}
export async function putKV(kv, key, value, options) {
  try { return await kv.put(key, value, options); }
  catch (error) {
    if (!/429|too many|rate.?limit/i.test(error.message)) throw error;
    // Free KV permits one write per second to the same key.
    await new Promise(resolve => setTimeout(resolve, 1100));
    return kv.put(key, value, options);
  }
}
