import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './worker.mjs';
import { activePosts } from './management.mjs';
function environment(login='yschannel') {
  const data = new Map();
  let state = { posts: [], hiddenSlugs: [], head: 'v0' }; let revision=0;
  return { LOCAL_SESSION:{id:'session',csrf:'csrf',login}, DRAFTS:{
    async get(key,{type}={}) {const entry=data.get(key);return entry?(type==='json'?JSON.parse(entry.value):entry.value):null;},
    async delete(key){data.delete(key);},
    async put(key,value,options={}){data.set(key,{value,metadata:options.metadata});},
    async list({prefix}){return{keys:[...data].filter(([name])=>name.startsWith(prefix)).map(([name,entry])=>({name,metadata:entry.metadata})),list_complete:true};}
  }, LOCAL_CONTENT:{async read(){return structuredClone(state);},async write(previous,next){assert.equal(previous.head,state.head,'compare-and-swap');state={...structuredClone(next),head:`v${++revision}`};return state.head;}}, ASSETS:{fetch:()=>new Response('editor')}, inspect:()=>structuredClone(state) };
}
const request=(path,method='GET',body,headers={})=>new Request(`http://127.0.0.1:4175${path}`,{method,headers:{Cookie:'ysc_local_session=session',Origin:'http://127.0.0.1:4175','X-CSRF-Token':'csrf',...headers},body:body?JSON.stringify(body):undefined});
const draft={id:'sample',title:'测试文章',slug:'sample',tag:'随笔',publishedAt:'2026-10-30',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'保留的正文'}]}]}};
async function list(env){return (await handleRequest(request('/api/posts'),env)).json();}
async function act(env,slug,action,version){return handleRequest(request('/api/posts/manage','POST',{slug,action,version:version??(await list(env)).version}),env);}
test('all management and draft mutations reject anonymous, non-owner, bad CSRF and cross-origin sessions',async()=>{
  const paths=[['/api/posts','GET'],['/api/posts/manage','POST'],['/api/manage/batch','POST'],['/api/drafts/sample','DELETE'],['/api/drafts/sample/restore','POST'],['/api/drafts','PUT'],['/api/publish','POST']];
  for(const [path,method] of paths){
    assert.equal((await handleRequest(request(path,method,method==='GET'?undefined:{}, {Cookie:''}),environment())).status,401);
    assert.equal((await handleRequest(request(path,method,method==='GET'?undefined:{}),environment('another-reader'))).status,403);
    if(method!=='GET')for(const headers of [{'X-CSRF-Token':'wrong'},{Origin:'https://other.example'}]) assert.equal((await handleRequest(request(path,method,{},headers),environment())).status,403);
  }
});
test('sample posts can be withdrawn, deleted, recovered privately and explicitly republished',async()=>{
  const env=environment();const slug='building-a-personal-blog';
  assert.equal((await act(env,slug,'unpublish')).status,200);
  assert.ok(!activePosts(env.inspect()).some(post=>post.slug===slug));
  assert.equal((await list(env)).posts.find(post=>post.slug===slug).status,'unpublished');
  assert.equal((await act(env,slug,'delete')).status,200);
  assert.equal((await list(env)).posts.find(post=>post.slug===slug).status,'deleted');
  assert.notEqual((await act(env,slug,'republish')).status,200);
  assert.equal((await act(env,slug,'restore')).status,200);
  assert.ok(!activePosts(env.inspect()).some(post=>post.slug===slug));
  assert.equal((await act(env,slug,'republish')).status,200);
  assert.ok(activePosts(env.inspect()).some(post=>post.slug===slug));
});
test('real post withdrawal keeps draft and rich content; stale list cannot remove another revision',async()=>{
  const env=environment();const saved=await (await handleRequest(request('/api/drafts','PUT',draft),env)).json();
  assert.equal((await handleRequest(request('/api/publish','POST',{id:draft.id,revision:saved.draft.revision}),env)).status,200);
  const version=(await list(env)).version;
  assert.equal((await act(env,draft.slug,'delete')).status,200);
  assert.equal(env.inspect().posts.length,0);
  assert.equal((await env.DRAFTS.get('draft:sample',{type:'json'})).content.content[0].content[0].text,'保留的正文');
  assert.notEqual((await act(env,'a-small-beginning','delete',version)).status,200);
  await act(env,draft.slug,'restore');await act(env,draft.slug,'republish');
  assert.equal(env.inspect().posts[0].richDoc.content[0].content[0].text,'保留的正文');
});
test('draft trash is persistent, reversible and cannot be resurrected by an old device autosave',async()=>{
  const env=environment();const saved=(await (await handleRequest(request('/api/drafts','PUT',draft),env)).json()).draft;
  assert.equal((await handleRequest(request('/api/drafts/sample','DELETE',{revision:0}),env)).status,409);
  const deleted=(await (await handleRequest(request('/api/drafts/sample','DELETE',{revision:saved.revision}),env)).json()).draft;
  assert.ok(deleted.deletedAt);
  assert.equal((await handleRequest(request('/api/drafts','PUT',saved),env)).status,409);
  assert.equal((await handleRequest(request('/api/publish','POST',{id:draft.id,revision:deleted.revision}),env)).status,409);
  const metas=(await (await handleRequest(request('/api/drafts'),env)).json()).drafts;assert.ok(metas[0].deletedAt);
  const restored=(await (await handleRequest(request('/api/drafts/sample/restore','POST',{revision:deleted.revision}),env)).json()).draft;
  assert.equal(restored.deletedAt,undefined);assert.ok(restored.revision>deleted.revision);
  assert.equal((await handleRequest(request('/api/drafts','PUT',saved),env)).status,409);
  assert.equal((await handleRequest(request('/api/drafts','PUT',restored),env)).status,200);
});

const batch=async(env,action,items,extra={})=>handleRequest(request('/api/manage/batch','POST',{action,items,version:(await list(env)).version,...extra}),env);
test('batch withdrawal makes one public commit and validates the entire selection before writing',async()=>{
  const env=environment();const items=['a-small-beginning','notes-on-curiosity'].map(slug=>({kind:'post',slug}));
  assert.equal((await batch(env,'unpublish',[...items,{kind:'post',slug:'missing'}])).status,400);assert.equal(env.inspect().head,'v0');
  const result=await (await batch(env,'unpublish',items)).json();assert.equal(result.results.length,2);assert.equal(result.ok,true);assert.equal(env.inspect().head,'v1');
  assert.ok(items.every(item=>!activePosts(env.inspect()).some(post=>post.slug===item.slug)));
  assert.equal((await batch(env,'delete',[items[0],items[0]])).status,400);
});
test('permanent deletion requires explicit confirmation and only accepts recycle-bin items',async()=>{
  const env=environment(),item={kind:'post',slug:'a-small-beginning'};
  assert.equal((await batch(env,'purge',[item])).status,400);
  assert.equal((await batch(env,'purge',[item],{confirmation:'永久删除'})).status,400);
  await batch(env,'delete',[item]);
  assert.ok(await env.DRAFTS.get('article:a-small-beginning'));
  const response=await batch(env,'purge',[item],{confirmation:'永久删除'});assert.equal(response.status,200);assert.equal((await response.json()).ok,true);
  assert.equal(await env.DRAFTS.get('article:a-small-beginning'),null);
  assert.ok(!activePosts(env.inspect()).some(post=>post.slug===item.slug));
  assert.equal((await batch(env,'restore',[item])).status,400);
  assert.ok(!(await list(env)).posts.some(post=>post.slug===item.slug));
});
test('mixed recycle-bin cleanup destroys draft content and blocks stale-device resurrection',async()=>{
  const env=environment();const saved=(await (await handleRequest(request('/api/drafts','PUT',draft),env)).json()).draft;
  await handleRequest(request('/api/drafts/sample','DELETE',{revision:saved.revision}),env);
  const trashed=await env.DRAFTS.get('draft:sample',{type:'json'}),post={kind:'post',slug:'notes-on-curiosity'};await batch(env,'delete',[post]);
  const result=await (await batch(env,'purge',[post,{kind:'draft',id:'sample',revision:trashed.revision}],{confirmation:'永久删除'})).json();assert.equal(result.ok,true);assert.equal(result.results.length,2);
  const tombstone=await env.DRAFTS.get('draft:sample',{type:'json'});assert.equal(tombstone.purged,true);assert.equal(tombstone.content,undefined);assert.equal(tombstone.title,undefined);
  assert.equal((await handleRequest(request('/api/drafts/sample'),env)).status,404);
  assert.equal((await handleRequest(request('/api/drafts','PUT',saved),env)).status,409);
  assert.equal((await handleRequest(request('/api/drafts/sample/restore','POST',{revision:tombstone.revision}),env)).status,410);
});
test('invalid mixed selection cannot permanently erase another valid recycle-bin item',async()=>{
  const env=environment();const item={kind:'post',slug:'a-small-beginning'};await batch(env,'delete',[item]);
  const response=await batch(env,'purge',[item,{kind:'draft',id:'missing',revision:0}],{confirmation:'永久删除'});
  assert.equal(response.status,400);assert.ok(await env.DRAFTS.get('article:a-small-beginning'));
});
