import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, sep, extname, dirname } from 'node:path';
import { handleRequest } from '../backend/worker.mjs';
import { preparePublication, mergePublication } from '../backend/content.mjs';
const root = resolve('.');
const storage = resolve('.blog-admin');
await mkdir(storage, { recursive: true });
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif' };
async function atomicWrite(path, data) { await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.${crypto.randomUUID()}.tmp`; await writeFile(temporary, data); await rename(temporary, path); }
const data = new Map();
try { for (const [key, value] of JSON.parse(await readFile(resolve(storage,'store.json'),'utf8'))) data.set(key,value); } catch {}
let persist = Promise.resolve();
const kv = {
  async get(key, options) { const record = data.get(key); return !record ? null : options?.type === 'json' ? JSON.parse(record.value) : record.value; },
  async put(key, value, options = {}) { data.set(key,{value,metadata:options.metadata}); persist = persist.then(()=>atomicWrite(resolve(storage,'store.json'),JSON.stringify([...data]))); await persist; },
  async delete(key) { data.delete(key); },
  async list({prefix}) { return { keys: [...data].filter(([key])=>key.startsWith(prefix)).map(([name,value])=>({name,metadata:value.metadata})), list_complete:true }; }
};
async function serve(request) {
  let path = decodeURIComponent(new URL(request.url).pathname);
  if (path === '/admin' || path === '/admin/') path = '/admin/dist/index.html';
  else if (path.startsWith('/admin/')) path = `/admin/dist/${path.slice(7)}`;
  else if (path === '/') path = '/index.html';
  const file = resolve(root, `.${path}`);
  if (!file.startsWith(root + sep) || /(^|[\\/])(node_modules|backend|scripts|\.blog-admin|\.git|\.dev\.vars|\.env)/.test(file.slice(root.length))) return new Response('Not found',{status:404});
  try { return new Response(await readFile(file), { headers:{ 'Content-Type':mime[extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' } }); } catch { return new Response('Not found',{status:404}); }
}
const env = {
  LOCAL_SESSION:{id:crypto.randomUUID(),csrf:crypto.randomUUID(),login:'yschannel'}, DRAFTS:kv,
  PUBLIC_SITE_URL:'http://127.0.0.1:4175', ASSETS:{fetch:serve},
  async LOCAL_PUBLISH(draft) {
    const {post,files} = await preparePublication(draft);
    let current = []; try { current=JSON.parse(await readFile('content/published.json','utf8')); } catch {}
    const next = mergePublication(current,post);
    for (const file of files) await atomicWrite(resolve(root,file.path),Buffer.from(file.content,'base64'));
    await atomicWrite(resolve(root,'content/published.json'),JSON.stringify(next,null,2));
    return {mode:'local',slug:post.slug,url:`http://127.0.0.1:4175/#/posts/${post.slug}`,message:'已发布到本机预览。线上发布需要先部署并配置 GitHub 登录。'};
  }
};
const server = http.createServer(async (req,res)=>{
  if (req.headers.host !== '127.0.0.1:4175') { res.writeHead(403); res.end('Invalid host'); return; }
  try {
    const chunks=[];let size=0;
    for await (const chunk of req) {size+=chunk.length;if(size>18*1024*1024){res.writeHead(413);res.end('Payload too large');return;}chunks.push(chunk);}
    const body=Buffer.concat(chunks);
    const request=new Request(`http://127.0.0.1:4175${req.url}`,{method:req.method,headers:req.headers,...(body.length?{body,duplex:'half'}:{})});
    const response=await handleRequest(request,env);
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  } catch {res.writeHead(500);res.end('Local server error');}
});
server.listen(4175,'127.0.0.1',()=>console.log('Blog: http://127.0.0.1:4175\nEditor: http://127.0.0.1:4175/admin/\nLocal drafts stay in .blog-admin; no public account or online deployment has been created.'));
