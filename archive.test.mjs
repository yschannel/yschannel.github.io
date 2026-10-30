import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSeries, nearestPost, postsOnDate, dateNumber, createArticleSearch } from './archive.mjs';

test('indexes can grow and include zero-post definitions or automatically discovered tags', () => {
  const definitions = Array.from({ length: 30 }, (_, index) => ({ title: `索引${index}`, description: `简介${index}` }));
  const items = [{ tag: '索引0' }, { tag: '新索引' }, { tag: '新索引' }];
  const indexes = buildSeries(items, definitions);
  assert.equal(indexes.length, 32);
  assert.equal(indexes[0].count, 3);
  assert.equal(indexes.find(item => item.title === '索引29').count, 0);
  assert.equal(indexes.find(item => item.title === '索引29').description, '简介29');
  assert.equal(indexes.find(item => item.title === '新索引').count, 2);
});
test('calendar chooses exact dates, earlier dates on ties, and handles month and year boundaries', () => {
  const items = [
    { slug: 'earlier', publishedAt: '2025-12-31' },
    { slug: 'later', publishedAt: '2026-01-02' },
    { slug: 'invalid', publishedAt: '2026-02-30' }
  ];
  assert.equal(nearestPost(items, '2026-01-02').slug, 'later');
  assert.equal(nearestPost(items, '2026-01-01').slug, 'earlier');
  assert.equal(nearestPost(items, '2025-12-01').slug, 'earlier');
  assert.equal(nearestPost(items, '2026-12-01').slug, 'later');
  assert.equal(nearestPost([], '2026-01-01'), null);
  assert.equal(nearestPost(items, '2026-02-30'), null);
  assert.ok(Number.isNaN(dateNumber('2026-2-3')));
  assert.ok(Number.isFinite(dateNumber('2024-02-29')));
});
test('calendar counts multiple posts on a day within the provided category', () => {
  const items = [{ slug: 'b', tag: 'a', publishedAt: '2026-10-24' }, { slug: 'a', tag: 'b', publishedAt: '2026-10-24' }];
  assert.equal(postsOnDate(items, '2026-10-24').length, 2);
  assert.equal(postsOnDate(items.filter(item => item.tag === 'a'), '2026-10-24').length, 1);
  assert.equal(nearestPost(items, '2026-10-24').slug, 'a');
});

test('article search covers short and structured text with category scope and AND keywords', () => {
  const records = [
    { slug: 'short', title: '夜晚', tag: '日常', body: ['桌上的暖光'], spoiler: '折叠区域' },
    { slug: 'long', title: '博客', tag: '项目', intro: '写作开始', sections: [{ title: '保存图片', blocks: [{ type: 'p', text: 'GitHub Pages' }, { type: 'list', items: ['备份草稿'] }, { type: 'image', caption: '发布流程图' }] }] }
  ];
  const search = createArticleSearch(records);
  assert.deepEqual(search('  '), records);
  assert.deepEqual(search('暖光').map(p => p.slug), ['short']);
  assert.deepEqual(search('折叠区域').map(p => p.slug), ['short']);
  assert.deepEqual(search('ＧＩＴＨＵＢ pages 图片').map(p => p.slug), ['long']);
  assert.deepEqual(search('草稿 流程图').map(p => p.slug), ['long']);
  assert.deepEqual(search('写作', '日常'), []);
  assert.deepEqual(search('不存在'), []);
  assert.deepEqual(search('[<script>.*'), []);
  assert.deepEqual(search('项目').map(p => p.slug), ['long']);
});
