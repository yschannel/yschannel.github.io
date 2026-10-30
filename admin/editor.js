import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { renderRichNode, escapeText, extractText } from '../rich-text.mjs';
const $ = id => document.getElementById(id);
let session = null, current = null, loading = false, localTimer, cloudTimer, editVersion = 0, savedVersion = 0, busy = false;
const emptyDocument = () => ({type:'doc',content:[{type:'paragraph'}]});
const dateToday = () => {const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;};
function notify(message) { $('toast').textContent=message;$('toast').hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('toast').hidden=true,6500); }
function status(message) { $('save-status').textContent=message; }
const db = await new Promise((resolve,reject)=>{const request=indexedDB.open('yschannel-writing-desk',1);request.onupgradeneeded=()=>request.result.createObjectStore('drafts',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);}).catch(error=>{notify('此浏览器无法保存草稿，请检查隐私或存储设置。');throw error;});
function store(action,value) {return new Promise((resolve,reject)=>{const transaction=db.transaction('drafts',action==='put'?'readwrite':'readonly');const objectStore=transaction.objectStore('drafts');const request=action==='put'?objectStore.put(value):action==='get'?objectStore.get(value):objectStore.getAll();transaction.oncomplete=()=>resolve(request.result);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);});}
async function api(path,method='GET',data) {
  const response=await fetch(`/api/${path}`,{method,credentials:'same-origin',headers:{...(data?{'Content-Type':'application/json'}:{}),...(session?.csrf?{'X-CSRF-Token':session.csrf}:{})},body:data?JSON.stringify(data):undefined});
  const result=await response.json();if(!response.ok)throw new Error(result.error || '操作未完成，请重试');return result;
}
function snapshot() {return {...current,title:$('title').value.trim() || '未命名草稿',tag:$('tag').value.trim() || '随笔',slug:$('slug').value.trim(),publishedAt:$('published-at').value,intro:$('intro').value,content:editor.getJSON(),updatedAt:new Date().toISOString()};}
async function saveLocal() {
  if(!current || loading)return;clearTimeout(localTimer);
  const version=editVersion;const draft=snapshot();await store('put',draft);
  if(current?.id===draft.id){current={...current,...draft};savedVersion=Math.max(savedVersion,version);status(session?.authenticated?'已在此设备保存 · 可同步草稿':'已在此设备保存');}
  await renderDraftList();
}
function changed() {
  if(loading)return;editVersion++;status('正在保存到此设备…');clearTimeout(localTimer);localTimer=setTimeout(()=>saveLocal().catch(error=>notify(`保存失败：${error.message}。请立即导出备份。`)),450);
  clearTimeout(cloudTimer);if(session?.authenticated)cloudTimer=setTimeout(()=>saveCloud(true).catch(error=>notify(`同步未完成：${error.message}`)),45000);
  $('word-count').textContent=`${extractText(editor.getJSON()).replace(/\s/g,'').length.toLocaleString('zh-CN')} 字`;
}
const editor=new Editor({element:$('editor'),extensions:[StarterKit.configure({heading:{levels:[2,3]},link:{openOnClick:false}}),Image.configure({allowBase64:true})],content:emptyDocument(),editorProps:{attributes:{'aria-label':'文章正文',role:'textbox','aria-multiline':'true'},handlePaste(view,event){const images=[...(event.clipboardData?.items??[])].filter(item=>item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);if(!images.length)return false;event.preventDefault();insertImages(images);return true;},handleDrop(view,event){const images=[...(event.dataTransfer?.files??[])].filter(file=>file.type.startsWith('image/'));if(!images.length)return false;event.preventDefault();const position=view.posAtCoords({left:event.clientX,top:event.clientY});if(position)editor.commands.setTextSelection(position.pos);insertImages(images);return true;}},onUpdate:changed,onSelectionUpdate:updateToolbar});
function updateToolbar() {
  document.querySelectorAll('[data-command]').forEach(button=>button.setAttribute('aria-pressed',String(editor.isActive(button.dataset.command))));
  $('text-style').value=editor.isActive('heading',{level:2})?'h2':editor.isActive('heading',{level:3})?'h3':'paragraph';
  $('image-fields').hidden=!editor.isActive('image');
  if(editor.isActive('image')){const attrs=editor.getAttributes('image');$('image-alt').value=attrs.alt??'';$('image-caption').value=attrs.title??'';}
}
document.querySelector('.editor-toolbar').addEventListener('mousedown',event=>{if(event.target.closest('button'))event.preventDefault();});
document.querySelector('.editor-toolbar').addEventListener('click',event=>{const command=event.target.closest('[data-command]')?.dataset.command;if(!command)return;const commands={bold:'toggleBold',italic:'toggleItalic',underline:'toggleUnderline',bulletList:'toggleBulletList',orderedList:'toggleOrderedList',blockquote:'toggleBlockquote',codeBlock:'toggleCodeBlock',undo:'undo',redo:'redo'};editor.chain().focus()[commands[command]]().run();updateToolbar();});
$('text-style').addEventListener('change',()=>{$('text-style').value==='paragraph'?editor.chain().focus().setParagraph().run():editor.chain().focus().setHeading({level:$('text-style').value==='h2'?2:3}).run();});
for(const name of ['title','tag','slug','published-at','intro'])$(name).addEventListener('input',changed);
$('image-alt').addEventListener('input',()=>editor.commands.updateAttributes('image',{alt:$('image-alt').value}));
$('image-caption').addEventListener('input',()=>editor.commands.updateAttributes('image',{title:$('image-caption').value}));
$('add-link').addEventListener('click',()=>{$('link-url').value=editor.getAttributes('link').href??'';$('link-dialog').showModal();$('link-url').focus();});
$('cancel-link').addEventListener('click',()=>$('link-dialog').close());
$('link-form').addEventListener('submit',event=>{event.preventDefault();const href=$('link-url').value;if(!/^https?:\/\//i.test(href)){notify('请填写以 https:// 或 http:// 开头的网址');return;}editor.chain().focus().extendMarkRange('link').setLink({href}).run();$('link-dialog').close();});
async function fileDataURL(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('图片读取失败'));reader.readAsDataURL(file);});}
async function insertImages(files) {
  for(const file of files){try{if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))throw new Error('支持 PNG、JPG、WebP 和 GIF 图片');if(file.size>2*1024*1024)throw new Error('单张图片请控制在 2 MB 以内');const src=await fileDataURL(file);editor.chain().focus().setImage({src,alt:file.name || '粘贴的图片'}).run();await saveLocal();}catch(error){notify(error.message);}}
}
$('add-image').addEventListener('click',()=>$('image-file').click());
$('image-file').addEventListener('change',async()=>{await insertImages([...$('image-file').files]);$('image-file').value='';});
async function openDraft(draft) {
  if(current)await saveLocal();clearTimeout(cloudTimer);loading=true;current=structuredClone(draft);
  $('title').value=current.title;$('tag').value=current.tag;$('slug').value=current.slug;$('published-at').value=current.publishedAt;$('intro').value=current.intro??'';editor.commands.setContent(current.content,{emitUpdate:false});loading=false;editVersion=0;savedVersion=0;$('publish-result').hidden=true;$('word-count').textContent=`${extractText(current.content).replace(/\s/g,'').length} 字`;status('已打开草稿');updateToolbar();await renderDraftList();
}
async function newDraft(){const id=crypto.randomUUID();await openDraft({id,title:'',tag:'随笔',slug:`article-${dateToday()}-${id.slice(0,8)}`,publishedAt:dateToday(),intro:'',content:emptyDocument(),revision:0,updatedAt:new Date().toISOString()});await saveLocal();$('title').focus();}
async function renderDraftList(){const drafts=(await store('all')).filter(draft=>!draft.deletedAt).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));$('draft-list').innerHTML=drafts.map(draft=>`<button class="draft-card${draft.id===current?.id?' selected':''}" type="button" data-id="${draft.id}"><span>${escapeText(draft.tag)}</span><strong>${escapeText(draft.title || '未命名草稿')}</strong><time>${new Date(draft.updatedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</time></button>`).join('');}
$('draft-list').addEventListener('click',async event=>{const id=event.target.closest('[data-id]')?.dataset.id;if(id)await openDraft(await store('get',id));});
$('new-draft').addEventListener('click',()=>newDraft().catch(error=>notify(error.message)));
async function saveCloud(automatic=false){if(busy)return;await saveLocal();if(!session?.authenticated){if(!automatic)notify('已保存到此设备。登录并完成后台部署后可跨设备同步。');return;}busy=true;const submitted=snapshot(),version=editVersion;status('正在保存草稿…');try{const {draft}=await api('drafts','PUT',submitted);if(current.id===draft.id){current.revision=draft.revision;await store('put',snapshot());status(editVersion===version?'草稿已同步保存':'新修改已在此设备保存，等待下次同步');}}finally{busy=false;}}
$('save-draft').addEventListener('click',()=>saveCloud().catch(error=>notify(error.message)));
window.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();saveCloud().catch(error=>notify(error.message));}});
window.addEventListener('beforeunload',event=>{if(editVersion>savedVersion){event.preventDefault();event.returnValue='';}});
$('preview').addEventListener('click',()=>{const draft=snapshot();$('preview-content').innerHTML=`<span class="manuscript-kicker">${escapeText(draft.tag)} / 文章预览</span><h1>${escapeText(draft.title)}</h1><p class="preview-meta">${draft.publishedAt}</p>${draft.intro?`<p class="preview-intro">${escapeText(draft.intro)}</p>`:''}<div class="preview-body">${renderRichNode(draft.content,{allowData:true})}</div>`;$('preview-dialog').showModal();});
$('close-preview').addEventListener('click',()=>$('preview-dialog').close());
$('export-draft').addEventListener('click',async()=>{await saveLocal();const draft=snapshot();const href=URL.createObjectURL(new Blob([JSON.stringify({format:'yschannel-draft-v1',draft},null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=href;link.download=`${draft.slug}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);});
$('import-draft').addEventListener('click',()=>$('import-file').click());
$('import-file').addEventListener('change',async()=>{try{const file=$('import-file').files[0];if(!file)return;if(file.size>18*1024*1024)throw new Error('草稿文件过大');const payload=JSON.parse(await file.text());if(payload.format!=='yschannel-draft-v1'||payload.draft?.content?.type!=='doc')throw new Error('这不是可识别的草稿文件');const draft={...payload.draft,id:crypto.randomUUID(),revision:0,updatedAt:new Date().toISOString()};await openDraft(draft);await saveLocal();notify('已作为新草稿导入，原草稿不会覆盖');}catch(error){notify(error.message);}finally{$('import-file').value='';}});
$('publish').addEventListener('click',()=>{const draft=snapshot();$('publish-review-text').textContent=`《${draft.title}》 · ${draft.tag} · ${draft.publishedAt}`;$('publish-mode-note').textContent=session?.mode==='local'?'当前为本机预览，只会更新这台电脑上的博客。':'确认后，正文与图片将提交到公开 GitHub 仓库，草稿仍保留在后台。';$('publish-dialog').showModal();});
$('cancel-publish').addEventListener('click',()=>$('publish-dialog').close());
$('confirm-publish').addEventListener('click',async()=>{if(busy)return;$('confirm-publish').disabled=true;try{await saveCloud();const result=await api('publish','POST',{id:current.id,revision:current.revision});$('publish-dialog').close();$('publish-result').hidden=false;$('publish-result').textContent=result.message+' ';const link=document.createElement('a');link.href=result.url;link.target='_blank';link.rel='noopener';link.textContent='打开文章 ↗';$('publish-result').append(link);status(result.mode==='local'?'已发布到本机预览':'已提交发布');}catch(error){notify(error.message);}finally{$('confirm-publish').disabled=false;}});
$('logout').addEventListener('click',async()=>{await saveLocal();await api('logout','POST',{});location.reload();});
try{session=await api('session');}catch{session={authenticated:false,configured:false};}
$('account-status').textContent=session.authenticated?`${session.login} · ${session.mode==='local'?'本机预览':'已登录'}`:'未登录';$('login-link').hidden=session.authenticated||!session.configured;$('logout').hidden=!session.authenticated||session.mode==='local';$('publish').disabled=!session.authenticated;$('manage-articles').disabled=!session.authenticated;$('delete-draft').disabled=!session.authenticated;
$('connection-note').textContent=session.mode==='local'?'本机写作预览：草稿会保存到这台电脑；发布只更新本机博客，线上登录尚未接通。':session.authenticated?'已连接写作后台。草稿会先在此设备保存，编辑停顿后同步。':session.configured?'请先用 GitHub 登录，登录后可同步草稿和管理文章。':'在线登录尚未接通。现在可以写作并保存到此设备，建议导出备份。';
if(session.authenticated){try{const remote=await api('drafts');for(const meta of remote.drafts){const local=await store('get',meta.id);if(meta.deletedAt||!local||local.updatedAt<meta.updatedAt||(local.deletedAt&&!meta.deletedAt&&meta.revision>=local.revision)){const {draft}=await api(`drafts/${meta.id}`);await store('put',draft);}}}catch(error){notify(`云端草稿暂时无法读取：${error.message}`);}}
const existing=(await store('all')).filter(draft=>!draft.deletedAt).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));if(existing.length)await openDraft(existing[0]);else await newDraft();

let managedPosts=[], managedDrafts=[], managedVersion=null, pendingManagement=null;
const managementLabels={published:'已发布',unpublished:'已取消发布',deleted:'回收站'};
async function loadManagement(){
  $('manage-state').textContent='正在读取文章与回收站…';$('manage-list').replaceChildren();managedVersion=null;
  try{const [articles,drafts]=await Promise.all([api('posts'),api('drafts')]);managedPosts=articles.posts;managedVersion=articles.version;managedDrafts=drafts.drafts.filter(draft=>draft.deletedAt);renderManagement();}
  catch(error){$('manage-state').textContent=error.message+' 请点击刷新重试。';}
}
function renderManagement(){
  const filter=$('manage-filter').value,query=$('manage-search').value.trim().toLowerCase();
  const rows=[...managedPosts.filter(post=>filter==='trash'?post.status==='deleted':filter==='unpublished'?post.status==='unpublished':post.status!=='deleted').map(post=>({...post,kind:'post'})),...(filter==='trash'?managedDrafts.map(draft=>({...draft,kind:'draft',status:'deleted'})):[])].filter(row=>`${row.title} ${row.tag}`.toLowerCase().includes(query));
  $('manage-state').textContent=rows.length?`${rows.length} 项 · 仅作者可管理`:'这里暂时没有内容。';
  $('manage-list').innerHTML=rows.map((row,index)=>{const actions=row.kind==='draft'?'<button data-action="restore-draft">恢复草稿</button>':row.status==='deleted'?'<button data-action="restore">恢复文章</button>':`${row.status==='published'?'<button data-action="unpublish">取消发布</button>':'<button data-action="republish">重新发布</button>'}<button class="danger-text" data-action="delete">删除文章</button>`;return `<div class="management-row" data-row="${index}"><div><span class="management-status">${row.kind==='draft'?'草稿回收站':managementLabels[row.status]}${row.isDemo?' · 示例文章':''}</span><strong>${escapeText(row.title)}</strong><small>${escapeText(row.tag??'')}</small></div><div class="row-actions">${actions}</div></div>`;}).join('');
  $('manage-list').querySelectorAll('[data-row]').forEach(element=>{element.addEventListener('click',event=>{const action=event.target.closest('[data-action]')?.dataset.action;if(action)reviewManagement(action,rows[Number(element.dataset.row)]);});});
}
function reviewManagement(action,row){
  if(busy){notify('正在保存或处理其他操作，请稍后重试');return;}
  pendingManagement={action,row};
  const titles={'delete-draft':'删除草稿','restore-draft':'恢复草稿',unpublish:'取消发布 / 撤回文章',delete:'删除文章',restore:'恢复文章',republish:'重新发布文章'};
  $('manage-confirm-title').textContent=titles[action];$('manage-confirm-name').textContent=`《${row.title || '未命名草稿'}》`;
  $('manage-confirm-note').textContent=action==='delete-draft'?'草稿将移入回收站，可在其他设备同步恢复。已发布的文章不受影响。':action==='restore-draft'?'恢复后会重新出现在草稿匣中，不会自动发布。':action==='restore'?'恢复为未发布文章，检查后可重新发布。':action==='republish'?'将把保留的文章版本重新公开；未发布的草稿修改不会自动包含在内。':action==='delete'?'从博客移除并放进回收站，关联草稿仍保留。公开仓库的历史记录和图片文件仍会保留。':'撤回公开文章并保留内容，以后可重新发布。公开仓库的历史记录和图片文件仍会保留。';
  $('confirm-manage-action').textContent=titles[action];$('manage-confirm').showModal();
}
$('manage-articles').addEventListener('click',()=>{$('manage-dialog').showModal();loadManagement();});
$('close-manage').addEventListener('click',()=>$('manage-dialog').close());
$('refresh-manage').addEventListener('click',loadManagement);
$('manage-search').addEventListener('input',renderManagement);$('manage-filter').addEventListener('change',renderManagement);
$('delete-draft').addEventListener('click',()=>reviewManagement('delete-draft',snapshot()));
$('cancel-manage-action').addEventListener('click',()=>$('manage-confirm').close());
$('confirm-manage-action').addEventListener('click',async()=>{
  if(busy||!pendingManagement)return;
  const {action,row}=pendingManagement;const button=$('confirm-manage-action');button.disabled=true;
  clearTimeout(cloudTimer);clearTimeout(localTimer);editor.setEditable(false);document.querySelector('.writing-area').inert=true;
  try{
    let result;
    if(action==='delete-draft'){
      await saveCloud();busy=true;
      result=await api(`drafts/${current.id}`,'DELETE',{revision:current.revision});await store('put',result.draft);current=null;
      const remaining=(await store('all')).filter(draft=>!draft.deletedAt).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));if(remaining.length)await openDraft(remaining[0]);else await newDraft();
    }else if(action==='restore-draft'){
      busy=true;const remote=await api(`drafts/${row.id}`);result=await api(`drafts/${row.id}/restore`,'POST',{revision:remote.draft.revision});await store('put',result.draft);await renderDraftList();
    }else{busy=true;result=await api('posts/manage','POST',{slug:row.slug,action,version:managedVersion});}
    $('manage-confirm').close();notify(result.message);if($('manage-dialog').open)await loadManagement();
  }catch(error){notify(error.message);}finally{busy=false;button.disabled=false;editor.setEditable(true);document.querySelector('.writing-area').inert=false;}
});
