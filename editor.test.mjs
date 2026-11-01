import test from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { history, undo } from '@tiptap/pm/history';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { Spoiler, positionAfterSpoiler, unwrapCurrentSpoiler } from './admin/spoiler.mjs';
import { validateDraft, preparePublication } from './backend/content.mjs';
import { renderRichNode, sectionsFromRichDoc } from './rich-text.mjs';

const spoiler = { type:'spoiler', attrs:{label:'包含第 3 集剧情 <点击展开>',open:true}, content:[{type:'paragraph',content:[{type:'text',text:'仅用于验证折叠功能，不包含作品剧情。',marks:[{type:'bold'}]}]},{type:'image',attrs:{src:'data:image/png;base64,iVBORw0KGgo=',alt:'测试配图'}}] };
const draft = () => ({id:'spoiler-test',title:'剧透折叠测试',slug:'spoiler-test',tag:'动漫',publishedAt:'2026-11-01',content:{type:'doc',content:[structuredClone(spoiler),{type:'paragraph',content:[{type:'text',text:'折叠区域外的正文'}]}]}});
test('spoiler schema keeps multiple blocks, and continuation position is outside the wrapper',()=>{
  const schema=getSchema([StarterKit,Image,Spoiler]);const doc=schema.nodeFromJSON(draft().content);doc.check();
  const inside=TextSelection.create(doc,3);assert.equal(positionAfterSpoiler(inside),doc.firstChild.nodeSize);
  const outside=TextSelection.create(doc,doc.firstChild.nodeSize+1);assert.equal(positionAfterSpoiler(outside),null);
});
test('spoiler publication preserves formatting and images but always renders closed without heading leakage',async()=>{
  const published=await preparePublication(draft());assert.equal(published.files.length,1);
  const node=published.post.richDoc.content[0];assert.equal(node.type,'spoiler');assert.equal(node.attrs.open,undefined);
  const html=renderRichNode(node);assert.match(html,/<details class="spoiler rich-spoiler">/);assert.doesNotMatch(html,/<details[^>]*\sopen/);
  assert.match(html,/&lt;点击展开&gt;/);assert.match(html,/<strong>/);assert.match(html,/assets\/uploads\//);
  assert.equal(sectionsFromRichDoc(published.post.richDoc).length,1);
});
test('invalid inline spoiler bodies are rejected and summary HTML is escaped',()=>{
  const invalid=draft();invalid.content.content[0].content=[{type:'text',text:'invalid'}];assert.throws(()=>validateDraft(invalid),/段落/);
  const data=draft();data.content.content[0].attrs.label='<img src=x onerror=alert(1)>';
  const clean=validateDraft(data);const html=renderRichNode(clean.content,{allowData:true});assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img src=x/);
});

test('explicit unwrap preserves all content, affects only the current spoiler and supports undo',()=>{
  const schema=getSchema([StarterKit,Image,Spoiler]);
  const data=draft().content;data.content.push(structuredClone(spoiler));
  const doc=schema.nodeFromJSON(data);
  let state=EditorState.create({schema,doc,selection:TextSelection.create(doc,3),plugins:[history()]});
  const tr=state.tr;
  assert.equal(unwrapCurrentSpoiler({tr,dispatch:()=>{}}),true);state=state.apply(tr);state.doc.check();
  assert.deepEqual(state.doc.child(0).toJSON(),doc.firstChild.child(0).toJSON());
  assert.deepEqual(state.doc.child(1).toJSON(),doc.firstChild.child(1).toJSON());
  assert.equal(state.doc.lastChild.type.name,'spoiler');assert.equal(state.doc.child(2).textContent,'折叠区域外的正文');
  assert.equal(undo(state,transaction=>{state=state.apply(transaction);}),true);assert.ok(state.doc.eq(doc));
});
test('unwrap capability check does not mutate content and does nothing outside a spoiler',()=>{
  const schema=getSchema([StarterKit,Image,Spoiler]),doc=schema.nodeFromJSON(draft().content);
  const state=EditorState.create({schema,doc,selection:TextSelection.create(doc,3)}),tr=state.tr;
  assert.equal(unwrapCurrentSpoiler({tr}),true);assert.equal(tr.steps.length,0);
  const outside=EditorState.create({schema,doc,selection:TextSelection.create(doc,doc.firstChild.nodeSize+1)});
  assert.equal(unwrapCurrentSpoiler({tr:outside.tr,dispatch:()=>{}}),false);
});
