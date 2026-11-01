import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Spoiler, positionAfterSpoiler, unwrapCurrentSpoiler } from './spoiler.mjs';
import { renderRichNode, escapeText, extractText } from '../rich-text.mjs';
const $ = id => document.getElementById(id);
let session = null, current = null, loading = false, localTimer, cloudTimer, editVersion = 0, savedVersion = 0, busy = false, composing = false;
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
  if(!current || loading || composing)return;clearTimeout(localTimer);
  const version=editVersion;const draft=snapshot();await store('put',draft);
  if(current?.id===draft.id){current={...current,...draft};savedVersion=Math.max(savedVersion,version);status(session?.authenticated?'已在此设备保存 · 可同步草稿':'已在此设备保存');}
  await renderDraftList();
}
function changed() {
  if(loading)return;editVersion++;if(composing)return;status('正在保存到此设备…');clearTimeout(localTimer);localTimer=setTimeout(()=>saveLocal().catch(error=>notify(`保存失败：${error.message}。请立即导出备份。`)),450);
  clearTimeout(cloudTimer);if(session?.authenticated)cloudTimer=setTimeout(()=>saveCloud(true).catch(error=>notify(`同步未完成：${error.message}`)),45000);
  $('word-count').textContent=`${extractText(editor.getJSON()).replace(/\s/g,'').length.toLocaleString('zh-CN')} 字`;
}
const editor=new Editor({element:$('editor'),extensions:[StarterKit.configure({heading:{levels:[2,3]},link:{openOnClick:false}}),Image.configure({allowBase64:true}),Spoiler],content:emptyDocument(),editorProps:{handleDOMEvents:{compositionstart(){composing=true;clearTimeout(localTimer);clearTimeout(cloudTimer);return false;},compositionend(){composing=false;setTimeout(()=>{if(!editor.isDestroyed){changed();updateToolbar();}},0);return false;}},attributes:{'aria-label':'文章正文',role:'textbox','aria-multiline':'true'},handlePaste(view,event){const images=[...(event.clipboardData?.items??[])].filter(item=>item.type.startsWith('image/')).map(item=>item.getAsFile()).filter(Boolean);if(!images.length)return false;event.preventDefault();insertImages(images);return true;},handleDrop(view,event){const images=[...(event.dataTransfer?.files??[])].filter(file=>file.type.startsWith('image/'));if(!images.length)return false;event.preventDefault();const position=view.posAtCoords({left:event.clientX,top:event.clientY});if(position)editor.commands.setTextSelection(position.pos);insertImages(images);return true;}},onUpdate:changed,onSelectionUpdate:updateToolbar});
function updateToolbar() {
  if(composing)return;
  const inSpoiler=editor.isActive('spoiler');$('spoiler-fields').hidden=!inSpoiler;$('add-spoiler').setAttribute('aria-pressed',String(inSpoiler));let includesSpoiler=inSpoiler;if(!includesSpoiler)editor.state.doc.nodesBetween(editor.state.selection.from,editor.state.selection.to,node=>{if(node.type.name==='spoiler')includesSpoiler=true;});$('add-spoiler').disabled=includesSpoiler;
  if(inSpoiler&&document.activeElement!==$('spoiler-label'))$('spoiler-label').value=editor.getAttributes('spoiler').label;
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
$('add-spoiler').addEventListener('click',()=>{if($('add-spoiler').disabled)return;editor.chain().focus().wrapIn('spoiler').run();updateToolbar();});
$('remove-spoiler').addEventListener('mousedown',event=>event.preventDefault());
$('remove-spoiler').addEventListener('click',()=>{if(editor.chain().focus().command(unwrapCurrentSpoiler).run())notify('已取消当前剧透折叠，内容已还原为普通正文');updateToolbar();});
$('spoiler-label').addEventListener('input',()=>editor.commands.updateAttributes('spoiler',{label:$('spoiler-label').value.slice(0,120)}));
$('leave-spoiler').addEventListener('click',()=>{
  const position=positionAfterSpoiler(editor.state.selection);if(position===null)return;
  const next=editor.state.doc.nodeAt(position);
  const chain=editor.chain().focus();if(next?.type.name!=='paragraph')chain.insertContentAt(position,{type:'paragraph'});
  chain.setTextSelection(position+1).run();updateToolbar();
});
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
async function saveCloud(automatic=false){if(composing){if(!automatic)notify('请先完成输入法选字，再保存草稿');return;}if(busy)return;await saveLocal();if(!session?.authenticated){if(!automatic)notify('已保存到此设备。登录并完成后台部署后可跨设备同步。');return;}busy=true;const submitted=snapshot(),version=editVersion;status('正在保存草稿…');try{const {draft}=await api('drafts','PUT',submitted);if(current.id===draft.id){current.revision=draft.revision;await store('put',snapshot());status(editVersion===version?'草稿已同步保存':'新修改已在此设备保存，等待下次同步');}}finally{busy=false;}}
$('save-draft').addEventListener('click',()=>saveCloud().catch(error=>notify(error.message)));
window.addEventListener('keydown',event=>{if(event.isComposing||event.keyCode===229||composing)return;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();saveCloud().catch(error=>notify(error.message));}});
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
$('account-status').textContent=session.authenticated?`${session.login} · ${session.mode==='local'?'本机预览':'已登录'}`:'未登录';$('login-link').hidden=session.authenticated||!session.configured;$('logout').hidden=!session.authenticated||session.mode==='local';$('publish').disabled=!session.authenticated;$('manage-articles').disabled=!session.authenticated;$('delete-draft').disabled=!session.authenticated;$('open-trash').disabled=!session.authenticated;
$('connection-note').textContent=session.mode==='local'?'本机写作预览：草稿会保存到这台电脑；发布只更新本机博客，线上登录尚未接通。':session.authenticated?'已连接写作后台。草稿会先在此设备保存，编辑停顿后同步。':session.configured?'请先用 GitHub 登录，登录后可同步草稿和管理文章。':'在线登录尚未接通。现在可以写作并保存到此设备，建议导出备份。';
if(session.authenticated){try{const remote=await api('drafts');for(const meta of remote.drafts){const local=await store('get',meta.id);if(meta.purged){await store('put',{...meta,deletedAt:meta.updatedAt});continue;}if(meta.deletedAt||!local||local.updatedAt<meta.updatedAt||(local.deletedAt&&!meta.deletedAt&&meta.revision>=local.revision)){const {draft}=await api(`drafts/${meta.id}`);await store('put',draft);}}}catch(error){notify(`云端草稿暂时无法读取：${error.message}`);}}
const existing=(await store('all')).filter(draft=>!draft.deletedAt).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));if(existing.length)await openDraft(existing[0]);else await newDraft();

let managedPosts=[],managedDrafts=[],managedVersion=null,pendingManagement=null,visibleRows=[],managementMode='files',fileSection='published';
const selectedFiles=new Map();
const fileKey=row=>`${row.kind}:${row.kind==='post'?row.slug:row.id}`;
const labels={published:'已发布',unpublished:'已撤回 / 未发布',deleted:'回收站'};
function trashRows(){return [...managedPosts.filter(row=>row.status==='deleted').map(row=>({...row,kind:'post'})),...managedDrafts.filter(row=>row.deletedAt&&!row.purged).map(row=>({...row,kind:'draft',status:'deleted'}))];}
async function loadManagement(){
  $('manage-state').textContent='正在读取文件…';$('manage-list').replaceChildren();selectedFiles.clear();updateSelection();managedVersion=null;
  try{
    const [articles,drafts]=await Promise.all([api('posts'),api('drafts')]);managedPosts=articles.posts;managedVersion=articles.version;
    const local=await store('all');managedDrafts=[...drafts.drafts,...local.filter(row=>!drafts.drafts.some(meta=>meta.id===row.id)&&!row.deletedAt&&!row.purged).map(row=>({...row,localOnly:true}))];renderManagement();
  }catch(error){$('manage-state').textContent=error.message+' 请点击刷新重试。';}
}
function renderManagement(){
  const query=$('manage-search').value.trim().toLowerCase(),trash=managementMode==='trash';
  $('manage-title').textContent=trash?'回收站':'文件管理';$('file-sections').hidden=trash;$('empty-trash').hidden=!trash;$('empty-trash').disabled=!trashRows().length;
  $('manage-description').textContent=trash?'删除的文章和草稿在这里。恢复后不会自动公开；永久删除后无法从后台找回。':'绿色是已公开的文章；琥珀色是草稿和已撤回内容。可以勾选多个文件一起处理。';
  const published=managedPosts.filter(row=>row.status==='published'),unpublished=managedPosts.filter(row=>row.status==='unpublished'),drafts=managedDrafts.filter(row=>!row.deletedAt&&!row.purged);
  document.querySelector('[data-section="published"]').textContent=`已发布文章 · ${published.length}`;document.querySelector('[data-section="unpublished"]').textContent=`草稿 / 未发布 · ${unpublished.length+drafts.length}`;
  document.querySelectorAll('[data-section]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.section===fileSection)));
  visibleRows=(trash?trashRows():fileSection==='published'?published.map(row=>({...row,kind:'post'})):[...drafts.map(row=>({...row,kind:'draft',status:'draft'})),...unpublished.map(row=>({...row,kind:'post'}))]).filter(row=>`${row.title} ${row.tag}`.toLowerCase().includes(query));
  $('manage-state').textContent=visibleRows.length?`${visibleRows.length} 项 · 仅作者可管理`:'这里暂时没有内容。';
  $('manage-list').innerHTML=visibleRows.map((row,index)=>{
    const actions=trash?'<button data-action="restore">恢复</button><button class="danger-text" data-action="purge">永久删除</button>':row.kind==='draft'?'<button data-action="edit">编辑草稿</button><button data-action="delete" class="danger-text">删除草稿</button>':`${row.status==='published'?'<button data-action="unpublish">取消发布</button>':'<button data-action="republish">重新发布</button>'}<button data-action="delete" class="danger-text">删除文章</button>`;
    const tone=trash?'trash-row':row.status==='published'?'published-row':'unpublished-row';
    return `<div class="management-row ${tone}" data-row="${index}"><label class="file-select"><input type="checkbox" data-select="${index}" aria-label="选择 ${escapeText(row.title)}" ${selectedFiles.has(fileKey(row))?'checked':''}></label><div class="file-info"><span class="management-status">${row.kind==='draft'?'草稿'+(row.localOnly?' · 仅本机':''):labels[row.status]}${row.isDemo?' · 示例':''}</span><strong>${escapeText(row.title||'未命名草稿')}</strong><small>${escapeText(row.tag??'')}</small></div><div class="row-actions">${actions}</div></div>`;
  }).join('');updateSelection();
}
function updateSelection(){
  const rows=[...selectedFiles.values()];$('selected-count').textContent=`已选 ${rows.length} 项`;
  const visibleSelected=visibleRows.filter(row=>selectedFiles.has(fileKey(row))).length;$('select-visible').checked=visibleRows.length>0&&visibleSelected===visibleRows.length;$('select-visible').indeterminate=visibleSelected>0&&visibleSelected<visibleRows.length;
  let actions=[];if(rows.length){if(managementMode==='trash')actions=[['restore','批量恢复'],['purge','永久删除所选']];else{if(rows.every(row=>row.status==='published'))actions.push(['unpublish','批量取消发布']);if(rows.every(row=>row.kind==='post'&&row.status==='unpublished'))actions.push(['republish','批量重新发布']);actions.push(['delete','批量删除']);}}
  $('batch-actions').innerHTML=actions.map(([action,label])=>`<button type="button" data-batch="${action}" class="${action==='purge'?'danger-text':''}">${label}</button>`).join('');
}
async function showManagement(mode){if(busy){notify('请等待当前操作完成');return;}managementMode=mode;$('manage-search').value='';visibleRows=[];selectedFiles.clear();renderManagement();$('manage-dialog').showModal();await loadManagement();}
function reviewManagement(action,rows){
  if(busy){notify('正在保存或处理其他操作，请稍后重试');return;}if(!rows.length)return;
  pendingManagement={action,rows:structuredClone(rows)};
  const title={delete:'删除所选文件',restore:'恢复所选文件',purge:'永久删除',unpublish:'取消发布 / 撤回文章',republish:'重新发布文章'}[action];
  $('manage-confirm-title').textContent=title;$('manage-confirm-name').textContent=`共 ${rows.length} 项：`+rows.map(row=>`《${row.title||'未命名草稿'}》`).join('、');
  $('manage-confirm-note').textContent=action==='purge'?'将永久删除所选内容在后台的恢复副本，无法撤销。文章对应的独立草稿不会一起删除；GitHub 历史记录和已发布图片仍保留。':action==='delete'?'移入回收站后可以恢复。删除草稿不影响已发布文章；删除文章不影响独立草稿。':action==='restore'?'草稿返回草稿区，文章恢复为未发布，不会自动公开。':action==='republish'?'将重新公开保留的文章版本，不包含尚未发布的草稿修改。':'从博客撤回，保留内容供以后重新发布。博客更新需要稍等片刻。';
  $('purge-label').hidden=action!=='purge';$('purge-phrase').value='';$('confirm-manage-action').disabled=action==='purge';$('confirm-manage-action').textContent=title;$('manage-confirm').showModal();
}
$('purge-phrase').addEventListener('input',()=>{$('confirm-manage-action').disabled=$('purge-phrase').value!=='永久删除';});
$('manage-articles').addEventListener('click',()=>showManagement('files'));$('open-trash').addEventListener('click',()=>showManagement('trash'));
$('close-manage').addEventListener('click',()=>$('manage-dialog').close());$('refresh-manage').addEventListener('click',loadManagement);
$('manage-search').addEventListener('input',renderManagement);
$('file-sections').addEventListener('click',event=>{const section=event.target.closest('[data-section]')?.dataset.section;if(section){fileSection=section;selectedFiles.clear();renderManagement();}});
$('select-visible').addEventListener('change',event=>{for(const row of visibleRows){if(event.target.checked)selectedFiles.set(fileKey(row),row);else selectedFiles.delete(fileKey(row));}renderManagement();});
$('clear-selection').addEventListener('click',()=>{selectedFiles.clear();renderManagement();});
$('batch-actions').addEventListener('click',event=>{const action=event.target.closest('[data-batch]')?.dataset.batch;if(action)reviewManagement(action,[...selectedFiles.values()]);});
$('empty-trash').addEventListener('click',()=>reviewManagement('purge',trashRows()));
$('manage-list').addEventListener('change',event=>{const index=event.target.dataset.select;if(index===undefined)return;const row=visibleRows[Number(index)];if(event.target.checked)selectedFiles.set(fileKey(row),row);else selectedFiles.delete(fileKey(row));updateSelection();});
$('manage-list').addEventListener('click',async event=>{
  const action=event.target.closest('[data-action]')?.dataset.action;if(!action)return;const row=visibleRows[Number(event.target.closest('[data-row]').dataset.row)];
  if(action==='edit'){try{const local=await store('get',row.id);const remote=row.localOnly?null:(await api(`drafts/${row.id}`)).draft;await openDraft(local&&(!remote||local.updatedAt>remote.updatedAt)?local:remote);$('manage-dialog').close();}catch(error){notify(error.message);}return;}
  reviewManagement(action,[row]);
});
$('delete-draft').addEventListener('click',()=>reviewManagement('delete',[{...snapshot(),kind:'draft',localOnly:!current.revision}]));
$('cancel-manage-action').addEventListener('click',()=>$('manage-confirm').close());
$('confirm-manage-action').addEventListener('click',async()=>{
  if(busy||!pendingManagement)return;const {action,rows}=pendingManagement;if(action==='purge'&&$('purge-phrase').value!=='永久删除')return;
  const button=$('confirm-manage-action');button.disabled=true;clearTimeout(cloudTimer);clearTimeout(localTimer);editor.setEditable(false);document.querySelector('.writing-area').inert=true;
  let succeeded=0,failed=0;
  try{
    await saveLocal();
    if(action==='delete'&&rows.some(row=>row.kind==='draft'&&row.id===current?.id)){await saveCloud();for(const row of rows)if(row.kind==='draft'&&row.id===current.id){row.revision=current.revision;row.localOnly=false;}}
    busy=true;
    for(const row of rows)if(row.kind==='draft'&&row.localOnly){const local=await store('get',row.id);const saved=await api('drafts','PUT',local);row.revision=saved.draft.revision;await store('put',saved.draft);}
    if(!managedVersion||!$('manage-dialog').open)managedVersion=(await api('posts')).version;
    for(let offset=0;offset<rows.length;offset+=100){
      const items=rows.slice(offset,offset+100).map(row=>row.kind==='post'?{kind:'post',slug:row.slug}:{kind:'draft',id:row.id,revision:row.revision});
      const result=await api('manage/batch','POST',{action,items,version:managedVersion,...(action==='purge'?{confirmation:'永久删除'}:{})});managedVersion=result.version;
      for(const item of result.results){if(item.ok){succeeded++;if(item.draft)await store('put',item.draft);}else failed++;}
    }
    if(rows.some(row=>row.kind==='draft'&&row.id===current?.id)){const local=await store('get',current.id);if(local?.deletedAt||local?.purged){current=null;const next=(await store('all')).filter(row=>!row.deletedAt&&!row.purged).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));if(next.length)await openDraft(next[0]);else await newDraft();}}
    await renderDraftList();$('manage-confirm').close();notify(`已处理 ${succeeded} 项${failed?`，${failed} 项未完成，请刷新后重试`:''}。${action==='purge'?'已永久删除后台恢复副本。':''}`);if($('manage-dialog').open)await loadManagement();
  }catch(error){notify(`${succeeded?`已处理 ${succeeded} 项。`:''}${error.message}`);if($('manage-dialog').open)await loadManagement();}
  finally{busy=false;button.disabled=false;editor.setEditable(true);document.querySelector('.writing-area').inert=false;}
});
