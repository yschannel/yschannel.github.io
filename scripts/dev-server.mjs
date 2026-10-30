import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, sep, extname, dirname } from 'node:path';
import { handleRequest } from '../backend/worker.mjs';

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
  async delete(key) { data.delete(key); persist = persist.then(()=>atomicWrite(resolve(storage,'store.json'),JSON.stringify([...data]))); await persist; },
  async list({prefix}) { return { keys: [...data].filter(([key])=>key.startsWith(prefix)).map(([name,value])=>({name,metadata:value.metadata})), list_complete:true }; }
};
async function serve(request) {
  let path = decodeURIComponent(new URL(request.url).pathname);
  if (path === '/admin' || path === '/admin/') path = '/admin/dist/index.html';
  else if (path.startsWith('/admin/')) path = `/admin/dist/${path.slice(7)}`;
  else if (path === '/') path = '/index.html';
  const file = resolve(root, `.${path}`);
  if (!file.startsWith(root + sep) || /(^|[\\/])(node_modules|backend|scripts|\.blog-admin|\.blog-deploy|\.wrangler|\.git|\.dev\.vars|\.env)/.test(file.slice(root.length))) return new Response('Not found',{status:404});
  try { return new Response(await readFile(file), { headers:{ 'Content-Type':mime[extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' } }); } catch { return new Response('Not found',{status:404}); }
}
const env = {
  LOCAL_SESSION:{id:crypto.randomUUID(),csrf:crypto.randomUUID(),login:'yschannel'}, DRAFTS:kv,
  PUBLIC_SITE_URL:'http://127.0.0.1:4175', ASSETS:{fetch:serve},
  LOCAL_CONTENT: {
    async read() {
      const posts = JSON.parse(await readFile(resolve(root,'content/published.json'),'utf8'));
      let hiddenSlugs = []; try { hiddenSlugs=JSON.parse(await readFile(resolve(root,'content/visibility.json'),'utf8')).hiddenSlugs; } catch {}
      const head = Buffer.from(JSON.stringify({posts,hiddenSlugs})).toString('base64url');
      return {posts,hiddenSlugs,head};
    },
    async write(state,next,files) {
      const current = await this.read();
      if(current.head !== state.head) throw new Error('文章列表已有更新，请刷新后重试');
      for(const file of files) await atomicWrite(resolve(root,file.path),Buffer.from(file.content,'base64'));
      await atomicWrite(resolve(root,'content/published.json'),JSON.stringify(next.posts,null,2));
      await atomicWrite(resolve(root,'content/visibility.json'),JSON.stringify({hiddenSlugs:next.hiddenSlugs},null,2));
      return (await this.read()).head;
    }
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
