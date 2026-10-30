import test from 'node:test';
import assert from 'node:assert/strict';
import { HOME_READING, posts, resolveRoute } from './readings.mjs';
test('home, article direct links, and missing routes resolve deterministically', () => {
  assert.equal(resolveRoute('').reading, HOME_READING);
  assert.equal(resolveRoute('#/').kind, 'home');
  for (const post of posts) {
    const route = resolveRoute(`#/posts/${post.slug}`);
    assert.equal(route.post, post);
    assert.equal(route.reading, post.reading);
    assert.deepEqual(resolveRoute(`#/posts/${post.slug}`), route);
  }
  assert.equal(resolveRoute('#/posts/missing').kind, 'missing');
});
test('readings have one integer, a fixed decimal point, six decimals, and no collisions', () => {
  const values = [HOME_READING, ...posts.map(p => p.reading)];
  assert.equal(new Set(values).size, values.length);
  for (const reading of values) assert.match(reading, /^\d\.\d{6}$/);
});
