import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDraft, preparePublication, mergePublication } from './content.mjs';
import { renderRichNode } from '../rich-text.mjs';
const draft = () => ({ id:'test-draft', title:'第一篇文章', slug:'first-post', tag:'随笔', publishedAt:'2026-10-30', content:{type:'doc',content:[{type:'heading',attrs:{level:2},content:[{type:'text',text:'开始'}]},{type:'paragraph',content:[{type:'text',text:'这是粗体',marks:[{type:'bold'}]}]}]} });
test('publication preserves formatting and extracts raster images into static files',async()=>{
  const data=draft();data.content.content.push({type:'image',attrs:{src:'data:image/png;base64,iVBORw0KGgo=',alt:'示例图片'}});
  const result=await preparePublication(data);
  assert.equal(result.files.length,1);
  assert.match(result.files[0].path,/^assets\/uploads\/[a-f0-9]{64}\.png$/);
  assert.equal(result.post.richDoc.content[2].attrs.src,result.files[0].path);
  assert.ok(!JSON.stringify(result.post).includes('base64'));
  assert.match(renderRichNode(result.post.richDoc),/<strong>这是粗体<\/strong>/);
  assert.equal(result.post.isDemo,false);
});
test('dangerous document nodes and image sources are rejected; text is escaped',()=>{
  const data=draft();data.content.content.push({type:'script',text:'alert(1)'});
  assert.throws(()=>validateDraft(data),/格式/);
  const image=draft();image.content.content.push({type:'image',attrs:{src:'javascript:alert(1)'}});
  assert.throws(()=>validateDraft(image),/图片/);
  assert.equal(renderRichNode({type:'text',text:'<script>x</script>'}),'&lt;script&gt;x&lt;/script&gt;');
  assert.equal(renderRichNode({type:'image',attrs:{src:'https://example.com/tracker.png'}}),'');
});
test('slug collisions never overwrite another article and updates replace only matching ids',()=>{
  const existing=[{id:'one',slug:'first',publishedAt:'2026-01-01'}];
  assert.throws(()=>mergePublication(existing,{id:'two',slug:'first',publishedAt:'2026-02-01'}),/另一篇/);
  assert.equal(mergePublication(existing,{id:'one',slug:'renamed',publishedAt:'2026-02-01'}).length,1);
});
