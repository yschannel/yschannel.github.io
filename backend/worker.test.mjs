import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './worker.mjs';
function environment(){const data=new Map();return{LOCAL_SESSION:{id:'session',csrf:'csrf',login:'yschannel'},DRAFTS:{async get(key,{type}={}){const value=data.get(key);return value?(type==='json'?JSON.parse(value.value):value.value):null;},async put(key,value,options={}){data.set(key,{value,metadata:options.metadata});},async list(){return{keys:[...data].map(([name,value])=>({name,metadata:value.metadata})),list_complete:true};}},ASSETS:{fetch:()=>new Response('editor')}};}
const request=(path,method='GET',data,headers={})=>new Request(`http://127.0.0.1:4175${path}`,{method,headers:{Cookie:'ysc_local_session=session',Origin:'http://127.0.0.1:4175','X-CSRF-Token':'csrf',...headers},body:data?JSON.stringify(data):undefined});
test('drafts require a valid session and mutations require the correct origin and CSRF token',async()=>{
  const env=environment();assert.equal((await handleRequest(request('/api/drafts','GET',null,{Cookie:''}),env)).status,401);
  assert.equal((await handleRequest(request('/api/drafts','PUT',{}, {Origin:'https://other.example'}),env)).status,403);
  assert.equal((await handleRequest(request('/api/drafts','PUT',{}, {'X-CSRF-Token':'wrong'}),env)).status,403);
});
test('saving persists private drafts and stale revisions are rejected',async()=>{
  const env=environment();const draft={id:'sample',title:'草稿',slug:'sample',tag:'随笔',publishedAt:'2026-10-30',content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'正文'}]}]}};
  const first=await handleRequest(request('/api/drafts','PUT',draft),env);assert.equal(first.status,200);const {draft:saved}=await first.json();assert.equal(saved.revision,1);
  assert.equal((await handleRequest(request('/api/drafts','PUT',draft),env)).status,409);
  const list=await (await handleRequest(request('/api/drafts'),env)).json();assert.equal(list.drafts[0].title,'草稿');
  assert.equal((await handleRequest(request('/api/publish','POST',{id:'sample',revision:0}),env)).status,409);
});
