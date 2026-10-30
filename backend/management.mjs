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
    if (meta && !meta.purged && !active.some(post => post.slug === meta.slug)) rows.push({ ...meta, status: meta.status === 'deleted' ? 'deleted' : 'unpublished' });
  }
  return { posts: rows, version: state.head };
}
export async function manageBatch(session, env, input) {
  const { action, items, version } = input;
  if (!['unpublish','delete','restore','republish','purge'].includes(action) || !Array.isArray(items) || !items.length || items.length > 100) throw new Error('请选择 1–100 项执行有效操作');
  if (action === 'purge' && input.confirmation !== '永久删除') throw new Error('永久删除需要输入“永久删除”确认');
  const state = await readPublic(session, env);
  if (!version || version !== state.head) throw new Error('文章列表已有更新，请刷新后重试');
  const seen = new Set(), plans=[];
  for (const item of items) {
    const identifier = item.kind === 'post' ? item.slug : item.id;
    if (!['post','draft'].includes(item.kind) || typeof identifier !== 'string' || !(item.kind === 'post' ? /^[a-z0-9][a-z0-9-]{0,100}$/ : /^[a-zA-Z0-9-]{1,80}$/).test(identifier)) throw new Error('选择的文件无效');
    const key = `${item.kind === 'post' ? 'article' : 'draft'}:${identifier}`;
    if (seen.has(key)) throw new Error('选择中包含重复文件'); seen.add(key);
    const record = await env.DRAFTS.get(key, {type:'json'});
    if (item.kind === 'draft') {
      if (!record || record.purged || record.revision !== item.revision) throw new Error('所选草稿已有更新或已永久删除，请刷新后重试');
      if (!['delete','restore','purge'].includes(action)) throw new Error('此操作不适用于草稿');
      if (action === 'delete' ? !!record.deletedAt : !record.deletedAt) throw new Error('所选草稿状态已改变，请刷新后重试');
      plans.push({item,key,record}); continue;
    }
    const published=activePosts(state).find(post=>post.slug===identifier),post=published??record?.post;
    if (!post || record?.purged) throw new Error('所选文章已不存在，请刷新后重试');
    if (action==='unpublish'&&!published || action==='republish'&&(published||record?.status==='deleted') || ['restore','purge'].includes(action)&&(published||record?.status!=='deleted') || action==='delete'&&!published&&record?.status==='deleted') throw new Error('所选文章状态已改变，请刷新后重试');
    plans.push({item,key,record,post,published});
  }
  const postPlans=plans.filter(plan=>plan.item.kind==='post');let nextVersion=state.head;
  if (postPlans.length) {
    let posts=[...state.posts],hiddenSlugs=[...state.hiddenSlugs];
    for (const plan of postPlans) {
      if(action==='purge') continue;
      if(!plan.record) await putKV(env.DRAFTS,plan.key,JSON.stringify({post:plan.post,status:'published'}),{metadata:{slug:plan.post.slug,title:plan.post.title,status:'published'}});
      posts=posts.filter(post=>post.slug!==plan.post.slug);hiddenSlugs=[...new Set([...hiddenSlugs,plan.post.slug])];
      if(action==='republish'){if(!plan.post.isDemo)posts.push(plan.post);hiddenSlugs=hiddenSlugs.filter(slug=>slug!==plan.post.slug);}
    }
    nextVersion=await writePublic(session,env,state,{posts,hiddenSlugs},[],`${action} ${postPlans.length} articles`);
  }
  const results=[];
  for(const plan of plans) {
    try {
      if(plan.item.kind==='draft') {
        const latest=await env.DRAFTS.get(plan.key,{type:'json'});
        if(!latest||latest.revision!==plan.record.revision||latest.purged)throw new Error('草稿在处理期间已有更新，已保留最新内容');
        const revision=plan.record.revision+1,updatedAt=new Date().toISOString();
        const draft=action==='purge'?{id:plan.item.id,revision,updatedAt,purged:true,deletedAt:updatedAt}:{...plan.record,revision,updatedAt};
        if(action==='restore')delete draft.deletedAt;else draft.deletedAt=updatedAt;
        const metadata=draft.purged?{id:draft.id,revision,updatedAt,purged:true}:{id:draft.id,title:draft.title,tag:draft.tag,revision,updatedAt,deletedAt:draft.deletedAt??null};
        await putKV(env.DRAFTS,plan.key,JSON.stringify(draft),{metadata});results.push({item:plan.item,ok:true,draft});
      }else if(action==='purge') {await env.DRAFTS.delete(plan.key);results.push({item:plan.item,ok:true});}
      else{
        const status=action==='delete'?'deleted':action==='republish'?'published':'unpublished';
        await putKV(env.DRAFTS,plan.key,JSON.stringify({post:plan.post,status,updatedAt:new Date().toISOString()}),{metadata:{slug:plan.post.slug,title:plan.post.title,tag:plan.post.tag,isDemo:!!plan.post.isDemo,status}});
        results.push({item:plan.item,ok:true,status});
      }
    }catch(error){results.push({item:plan.item,ok:false,error:error.message});}
  }
  const count=results.filter(result=>result.ok).length;
  return {ok:count===plans.length,results,version:nextVersion,message:`已处理 ${count} / ${plans.length} 项${count===plans.length?'。':'，部分操作未完成，请刷新查看详情。'}${action==='purge'?'已永久移除后台恢复副本，无法从回收站恢复。':''}${postPlans.length&&action!=='purge'?'博客更新需要稍等片刻。':''}`};
}
export async function managePost(session,env,input) {return manageBatch(session,env,{...input,items:[{kind:'post',slug:input.slug}]});}
