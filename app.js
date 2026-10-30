import { HOME_READING, posts, resolveRoute } from './readings.mjs?v=20261030-management';
import { buildSeries, nearestPost, postsOnDate, createArticleSearch } from './archive.mjs?v=20261030-search';
import { renderRichNode, sectionsFromRichDoc } from './rich-text.mjs';

const $ = id => document.getElementById(id);
const meter = $('meter');
const meterWrap = meter.closest('.meter-wrap');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let settledReading = HOME_READING;
let targetReading = HOME_READING;
let frame = 0;
let runId = 0;
let currentRoute = null;
let activeFilter = '全部';
let selectedSlug = posts[0]?.slug;
let selectedDate = null;
let articleQuery = '';
let keyboardEnabled = true;
let homeScrollY = 0;
let progressFrame = 0;
const series = buildSeries(posts);
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const searchArticles = createArticleSearch(posts);
const visiblePosts = () => searchArticles(articleQuery, activeFilter);
function updateKeyboardMode() {
  $('keyboard-mode').setAttribute('aria-pressed', String(keyboardEnabled));
  $('keyboard-mode').textContent = `⌨ 键盘浏览：${keyboardEnabled ? '开' : '关'}`;
  $('keyboard-hint').textContent = keyboardEnabled ? '直接按 ← → 选文，Enter 打开；输入文字时不打扰' : '可滑动或点击箭头选文；点击左侧按钮开启键盘浏览';
}
function renderBlock(block) {
  if (block.type === 'rich') return renderRichNode(block.node);
  if (block.type === 'image') return `<figure><button type="button" class="article-image" data-image="${escapeHTML(block.src)}" data-caption="${escapeHTML(block.caption)}" aria-label="放大图片：${escapeHTML(block.alt)}"><img src="${escapeHTML(block.src)}" alt="${escapeHTML(block.alt)}" width="${block.width}" height="${block.height}" loading="lazy" decoding="async"><span>↗ 查看大图</span></button><figcaption>${escapeHTML(block.caption)}</figcaption></figure>`;
  if (block.type === 'quote') return `<blockquote><p>${escapeHTML(block.text)}</p></blockquote>`;
  if (block.type === 'list') return `<ul>${block.items.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>`;
  if (block.type === 'code') return `<pre><code>${escapeHTML(block.text)}</code></pre>`;
  if (block.type === 'spoiler') return `<details class="spoiler"><summary>${escapeHTML(block.title)}</summary><p>${escapeHTML(block.text)}</p></details>`;
  return `<p>${escapeHTML(block.text)}</p>`;
}
function renderArticle(post) {
  const sections = post.sections ?? (post.richDoc ? sectionsFromRichDoc(post.richDoc) : [{ id: 'main-text', title: '正文', blocks: post.body.map(text => ({ type: 'p', text })) }]);
  const textLength = post.richDoc ? (post.body?.join('').length ?? 0) : sections.reduce((sum, section) => sum + section.blocks.reduce((count, block) => count + (block.text?.length ?? 0) + (block.items?.join('').length ?? 0), 0), 0);
  const content = sections.map(section => `<section class="article-section" id="${section.id}">${post.sections ? `<h2>${escapeHTML(section.title)}</h2>` : ''}${section.blocks.map(renderBlock).join('')}</section>`).join('');
  return `<div class="reader-layout"><article class="article-paper"><header class="article-heading"><span class="article-kicker">${escapeHTML(post.tag)} / ${post.isDemo ? 'ORIGINAL DEMO' : 'ARTICLE'}</span><h1>${escapeHTML(post.title)}</h1><div class="article-meta"><span>${post.isDemo ? '示例日期' : '发布于'} ${post.publishedAt}</span><span>约 ${textLength.toLocaleString('zh-CN')} 字 · ${Math.max(1, Math.ceil(textLength / 350))} 分钟阅读</span></div>${post.intro ? `<p class="article-lead">${escapeHTML(post.intro)}</p>` : (post.isDemo ? '<p class="article-lead">交互与排版示例，非博主已发表正文。</p>' : '')}</header><div class="article-body">${content}${post.spoiler ? renderBlock({ type: 'spoiler', title: '剧透提示示例 · 点击展开', text: post.spoiler }) : ''}<div class="article-ending"><span>— END OF RECORD —</span><a class="exit-article" href="#/">← 返回文章列表</a></div><nav class="next-posts" aria-label="其他文章">${posts.filter(p => p !== post).map(p => `<a href="#/posts/${p.slug}">${escapeHTML(p.title)} ↗</a>`).join('')}</nav></div></article><aside class="reader-toc"><details id="article-toc"${matchMedia('(min-width: 1000px)').matches ? ' open' : ''}><summary>本篇目录 <span>${sections.length} 节</span></summary><nav aria-label="文章目录">${sections.map(section => `<button type="button" class="toc-link" data-section="${section.id}">${escapeHTML(section.title)}</button>`).join('')}</nav></details><p class="reader-note">阅读中可按 Esc 返回文章列表</p></aside></div>`;
}
function updateReadingProgress() {
  if (resolveRoute(location.hash).kind !== 'post') return;
  const article = document.querySelector('.article-paper');
  if (!article) return;
  const rect = article.getBoundingClientRect();
  const total = Math.max(1, article.scrollHeight - innerHeight + 85);
  const progress = Math.round(Math.max(0, Math.min(1, (85 - rect.top) / total)) * 100);
  $('read-progress').textContent = `${progress}%`;
  $('reader-toolbar').style.setProperty('--progress', `${progress}%`);
  let current = document.querySelector('.article-section')?.id;
  document.querySelectorAll('.article-section').forEach(section => { if (section.getBoundingClientRect().top <= 170) current = section.id; });
  document.querySelectorAll('.toc-link').forEach(button => {
    if (button.dataset.section === current) button.setAttribute('aria-current', 'location'); else button.removeAttribute('aria-current');
  });
}
function updateSeriesNote() {
  const note = series.find(entry => entry.title === activeFilter) ?? series[0];
  $('project-title').textContent = note.title === '全部' ? '全部记录' : note.title;
  $('series-label').textContent = note.label;
  $('series-description').textContent = note.description;
  $('series-action').textContent = note.action;
}
const cells = [...HOME_READING].map(character => {
  const tube = document.createElement('div');
  tube.className = `tube${character === '.' ? ' decimal' : ''}`;
  tube.innerHTML = `<div class="glass"><div class="mesh"></div><div class="cathodes">${Array.from({length:10}, (_, n) => `<span>${n}</span>`).join('')}</div><span class="ghost"></span><span class="digit">${character}</span><span class="filament"></span></div><div class="socket"><i></i><i></i><i></i></div>`;
  $('tubes').append(tube);
  return { tube, digit: tube.querySelector('.digit'), ghost: tube.querySelector('.ghost') };
});
function draw(value, previous = '', changing = false) {
  cells.forEach(({ tube, digit, ghost }, index) => {
    digit.textContent = value[index];
    ghost.textContent = changing && index !== 1 && previous[index] !== value[index] ? previous[index] : '';
    tube.classList.toggle('energized', changing && index !== 1 && previous[index] !== value[index]);
  });
}
function finish(value) {
  settledReading = value;
  draw(value);
  meter.classList.remove('shifting', 'dimmed');
  meter.setAttribute('aria-label', `世界线变动率探测仪，当前读数 ${value}`);
  $('announcement').textContent = `观测稳定，当前读数 ${value}`;
}
function transition(from, to) {
  cancelAnimationFrame(frame);
  const token = ++runId;
  targetReading = to;
  if (reducedMotion.matches || from === to) { finish(to); return; }
  draw(from);
  meter.classList.add('shifting', 'dimmed');
  meter.setAttribute('aria-label', '世界线变动率探测仪，读数切换中');
  $('announcement').textContent = '检测到偏移，读数切换中';
  const start = performance.now();
  let lastStep = -1;
  let displayed = from;
  function tick(now) {
    if (token !== runId) return;
    const elapsed = now - start;
    if (elapsed >= 1900) { finish(to); return; }
    if (elapsed > 180) {
      meter.classList.remove('dimmed');
      const step = Math.floor((elapsed - 180) / 90);
      if (step !== lastStep) {
        lastStep = step;
        const value = [...to].map((char, index) => {
          if (index === 1) return '.';
          return elapsed >= 850 + index * 115 ? char : String(Math.floor(Math.random() * 10));
        }).join('');
        draw(value, displayed, true); displayed = value;
      }
    }
    frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);
}
function updateShelfButtons() {
  const items = visiblePosts();
  const index = items.findIndex(item => item.slug === selectedSlug);
  $('shelf-prev').disabled = index <= 0;
  $('shelf-next').disabled = index < 0 || index >= items.length - 1;
}
function updateSelection() {
  const items = visiblePosts();
  const post = items.find(item => item.slug === selectedSlug);
  document.querySelectorAll('.post').forEach(card => {
    const selected = card.dataset.slug === selectedSlug;
    card.classList.toggle('is-selected', selected);
    if (selected) card.setAttribute('aria-current', 'true'); else card.removeAttribute('aria-current');
  });
  $('shelf-ledger').hidden = resolveRoute(location.hash).kind !== 'home' || !post;
  if (post) {
    $('shelf-ledger').innerHTML = `<div class="ledger-entry"><span class="ledger-label">当前卷宗 / ${String(items.indexOf(post) + 1).padStart(2, '0')} OF ${String(items.length).padStart(2, '0')}</span><a href="#/posts/${post.slug}">${escapeHTML(post.title)} <span aria-hidden="true">↗</span></a><span class="ledger-date">${post.publishedAt} · ${escapeHTML(post.tag)}${post.isDemo ? ' · 示例日期' : ''}</span></div><div class="keyboard-guide"><span><kbd>←</kbd> <kbd>→</kbd> 挑选文章</span><span><kbd>Enter</kbd> 打开阅读</span></div>`;
  } else $('shelf-ledger').innerHTML = '';
  updateShelfButtons();
}
function selectArticle(slug, { scroll = true } = {}) {
  if (!visiblePosts().some(item => item.slug === slug)) return;
  selectedSlug = slug;
  updateSelection();
  const rail = $('article-rail');
  const card = [...document.querySelectorAll('.post')].find(item => item.dataset.slug === slug);
  if (scroll && rail && card) {
    rail.scrollTo({ left: rail.scrollLeft + card.getBoundingClientRect().left - rail.getBoundingClientRect().left - 3, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
  }
}
function moveSelection(step) {
  const items = visiblePosts();
  if (!items.length) return;
  const index = Math.max(0, items.findIndex(item => item.slug === selectedSlug));
  const next = items[Math.max(0, Math.min(items.length - 1, index + step))];
  selectedDate = null;
  selectArticle(next.slug);
  $('archive-status').textContent = `已选：${next.title}，${next.publishedAt}。按 Enter 打开。`;
  renderCalendar();
}
function render({ focus = false } = {}) {
  const route = resolveRoute(location.hash);
  const routeKey = JSON.stringify([route.kind, route.post?.slug, route.kind === 'home' ? activeFilter : '', route.kind === 'home' ? articleQuery : '']);
  if (currentRoute === routeKey) return;
  const comingFromHome = currentRoute && JSON.parse(currentRoute)[0] === 'home';
  const leavingArticle = currentRoute && JSON.parse(currentRoute)[0] === 'post';
  if (comingFromHome && route.kind === 'post') homeScrollY = window.scrollY;
  currentRoute = routeKey;
  document.body.classList.toggle('reading', route.kind !== 'home');
  $('shelf-buttons').hidden = route.kind !== 'home';
  $('archive-status').textContent = '';
  $('shelf-ledger').hidden = route.kind !== 'home';
  $('reader-toolbar').hidden = route.kind !== 'post';
  if (route.kind === 'post') $('reader-meter-slot').append(meterWrap);
  else $('meter-home').prepend(meterWrap);
  $('browse-toolbar').hidden = route.kind !== 'home';
  $('article-search-form').hidden = route.kind !== 'home';
  $('search-feedback').hidden = route.kind !== 'home' || !articleQuery.trim();
  $('clear-article-search').hidden = !articleQuery;
  if (route.kind === 'home') {
    const visible = visiblePosts();
    const searching = Boolean(articleQuery.trim());
    if (!visible.some(post => post.slug === selectedSlug)) selectedSlug = visible[0]?.slug;
    $('section-title').textContent = activeFilter === '全部' ? '文章记录' : activeFilter;
    $('section-note').textContent = `${String(visible.length).padStart(2, '0')} ${searching ? '篇匹配' : '篇文章'} · 方向键或滑动挑选`;
    $('search-summary').textContent = searching ? `在${activeFilter === '全部' ? '全部文章' : `「${activeFilter}」`}中查找「${articleQuery.trim()}」：${visible.length} 篇匹配。` : '';
    $('search-all-indexes').hidden = !searching || activeFilter === '全部';
    $('content').innerHTML = `<div class="article-rail${visible.length < 3 ? ' few-posts' : ''}" id="article-rail" role="region" aria-label="可左右滚动的文章标题列表" tabindex="0">${visible.map((post) => `<a class="post" data-slug="${post.slug}" href="#/posts/${post.slug}"><span class="post-meta">${escapeHTML(post.tag)}<span>${post.isDemo ? '示例 · ' : ''}${post.publishedAt}</span></span><h3>${escapeHTML(post.title)}</h3><span class="post-bottom"><span>NO. ${String(posts.indexOf(post) + 1).padStart(3, '0')}</span><span aria-hidden="true">↗</span></span></a>`).join('') || `<div class="empty-index search-empty"><span>EMPTY FILE</span><h3>${searching ? '暂时没有找到相关文章' : '这里还没有文章'}</h3><p>${searching ? '试试更短的关键词，或清空搜索；也可以切换索引扩大范围。' : '选一个其他索引看看，新的记录会慢慢添上。'}</p></div>`}</div>`;
    $('article-rail').addEventListener('focusin', event => {
      const card = event.target.closest('.post');
      if (card) selectArticle(card.dataset.slug, { scroll: false });
    });
    document.title = 'yschannel · 观测记录';
    updateSelection();
    requestAnimationFrame(() => selectArticle(selectedSlug, { scroll: true }));
  } else if (route.kind === 'post') {
    const post = route.post;
    selectedSlug = post.slug;
    $('section-title').textContent = post.title;
    $('section-note').textContent = `${post.tag} / 示例日期 ${post.publishedAt}`;
    $('content').innerHTML = renderArticle(post);
    $('reader-title').textContent = post.title;
    window.scrollTo({ top: 0, behavior: 'instant' });
    requestAnimationFrame(updateReadingProgress);
    document.title = `${post.title} · yschannel`;
  } else {
    $('section-title').textContent = '这里暂时没有记录';
    $('section-note').textContent = '未找到文章';
    $('content').innerHTML = '<article class="article-paper"><a class="back" href="#/">← 返回首页</a></article>';
    document.title = '未找到记录 · yschannel';
  }
  document.querySelectorAll('[data-category]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === activeFilter)));
  updateSeriesNote();
  renderCalendar();
  transition(settledReading, route.reading);
  if (focus) { $('section-title').tabIndex = -1; $('section-title').focus({ preventScroll: true }); }
  if (route.kind === 'post' && focus) { document.querySelector('.article-heading h1').tabIndex = -1; document.querySelector('.article-heading h1').focus({ preventScroll: true }); }
  if (route.kind === 'home' && leavingArticle) requestAnimationFrame(() => window.scrollTo({ top: homeScrollY, behavior: 'instant' }));
}
function selectCategory(category) {
  activeFilter = category;
  selectedDate = null;
  selectedSlug = visiblePosts()[0]?.slug;
  currentRoute = null;
  if (resolveRoute(location.hash).kind !== 'home') location.hash = '#/';
  else render();
}
function renderIndex() {
  const query = $('index-search').value.trim().toLocaleLowerCase();
  const matches = series.filter(entry => entry.title.toLocaleLowerCase().includes(query));
  $('index-count').textContent = `${series.length - 1} INDEXES`;
  $('category-index').innerHTML = matches.map(entry => `<button type="button" data-category="${escapeHTML(entry.title)}" aria-pressed="${entry.title === activeFilter}"><span>${escapeHTML(entry.title)}</span><span>${String(entry.count).padStart(2, '0')}</span></button>`).join('') || '<p class="empty-search">没有找到这个索引</p>';
}
function applyArticleSearch() {
  articleQuery = $('article-search').value;
  selectedDate = null;
  render();
}
function clearArticleSearch() {
  $('article-search').value = '';
  applyArticleSearch();
  $('article-search').focus();
}
$('article-search').addEventListener('input', event => { if (!event.isComposing) applyArticleSearch(); });
$('article-search').addEventListener('compositionend', applyArticleSearch);
$('article-search').addEventListener('keydown', event => {
  if (event.key === 'Escape' && !event.isComposing && $('article-search').value) {
    event.preventDefault(); clearArticleSearch();
  }
});
$('article-search-form').addEventListener('submit', event => {
  event.preventDefault(); applyArticleSearch();
  $('article-rail')?.focus({ preventScroll: true });
});
$('clear-article-search').addEventListener('click', clearArticleSearch);
$('search-all-indexes').addEventListener('click', () => selectCategory('全部'));
$('index-search').addEventListener('input', renderIndex);
renderIndex();
$('category-index').addEventListener('click', event => {
  const button = event.target.closest('[data-category]');
  if (button) selectCategory(button.dataset.category);
});
$('project-link').addEventListener('click', () => {
  selectCategory(activeFilter);
  $('section-title').scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
  $('section-title').tabIndex = -1;
  $('section-title').focus({ preventScroll: true });
});
document.querySelectorAll('.brand, .header-link').forEach(link => link.addEventListener('click', () => {
  articleQuery = ''; $('article-search').value = ''; selectCategory('全部');
}));
$('shelf-prev').addEventListener('click', () => moveSelection(-1));
$('shelf-next').addEventListener('click', () => moveSelection(1));
$('keyboard-mode').addEventListener('click', () => { keyboardEnabled = !keyboardEnabled; updateKeyboardMode(); });
$('reader-top').addEventListener('click', () => window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'instant' : 'smooth' }));
$('content').addEventListener('click', event => {
  const tocButton = event.target.closest('[data-section]');
  if (tocButton) {
    const section = document.getElementById(tocButton.dataset.section);
    if (section) {
      if (!matchMedia('(min-width: 1000px)').matches) $('article-toc').open = false;
      section.scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
    }
  }
  const imageButton = event.target.closest('[data-image]');
  if (imageButton) {
    $('viewer-image').src = imageButton.dataset.image;
    $('viewer-image').alt = imageButton.querySelector('img').alt;
    $('viewer-caption').textContent = imageButton.dataset.caption;
    $('image-viewer').showModal();
  }
});
$('close-image').addEventListener('click', () => $('image-viewer').close());
window.addEventListener('scroll', () => {
  cancelAnimationFrame(progressFrame); progressFrame = requestAnimationFrame(updateReadingProgress);
}, { passive: true });
window.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || $('image-viewer').open) return;
  if (event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
  const route = resolveRoute(location.hash);
  if (route.kind === 'post' && event.key === 'Escape') { event.preventDefault(); location.hash = '#/'; return; }
  if (event.target.closest('summary')) return;
  if (route.kind !== 'home' || !keyboardEnabled) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault(); moveSelection(event.key === 'ArrowRight' ? 1 : -1);
    if (event.target.closest('.post')) document.querySelector('.post.is-selected')?.focus({ preventScroll: true });
  } else if (event.key === 'Enter' && !event.repeat && !event.target.closest('a,button')) {
    const selected = visiblePosts().find(post => post.slug === selectedSlug);
    if (selected) { event.preventDefault(); location.hash = `#/posts/${selected.slug}`; }
  }
});
window.addEventListener('resize', updateShelfButtons);
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) { ++runId; cancelAnimationFrame(frame); finish(targetReading); }
});
window.addEventListener('hashchange', () => render({ focus: true }));

// Calendar markings use publishedAt; sample dates remain explicitly labeled in the UI.
const today = new Date();
let calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
function renderCalendar() {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  $('calendar-month').textContent = `${year} / ${String(month + 1).padStart(2, '0')}`;
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const count = new Date(year, month + 1, 0).getDate();
  const items = visiblePosts();
  $('calendar-days').innerHTML = Array.from({length:offset}, () => '<span aria-hidden="true"></span>').join('') + Array.from({length:count}, (_, i) => {
    const date = i + 1;
    const isoDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
    const matches = postsOnDate(items, isoDate);
    const isToday = year === today.getFullYear() && month === today.getMonth() && date === today.getDate();
    const classes = [isToday ? 'today' : '', matches.length ? 'has-posts' : '', selectedDate === isoDate ? 'selected-date' : ''].filter(Boolean).join(' ');
    return `<button type="button" class="${classes}" data-date="${isoDate}"${isToday ? ' aria-current="date"' : ''} aria-pressed="${selectedDate === isoDate}" aria-label="${year}年${month + 1}月${date}日，${matches.length ? `${matches.length}篇示例文章` : '无文章，定位最近记录'}" title="${matches.length ? `${matches.length} 篇示例文章` : '定位日期最近的文章'}">${date}</button>`;
  }).join('');
}
$('calendar-days').addEventListener('click', event => {
  const button = event.target.closest('[data-date]');
  if (!button) return;
  selectedDate = button.dataset.date;
  const nearest = nearestPost(visiblePosts(), selectedDate);
  if (!nearest) {
    $('archive-status').textContent = articleQuery.trim() ? '当前搜索结果中没有可定位的文章。' : `「${activeFilter}」还没有带发布日期的文章。`;
    renderCalendar(); return;
  }
  selectArticle(nearest.slug);
  const count = postsOnDate(visiblePosts(), selectedDate).length;
  $('archive-status').textContent = nearest.publishedAt === selectedDate
    ? `${selectedDate} 有 ${count} 篇记录，已定位《${nearest.title}》。`
    : `${selectedDate} 没有记录；已定位最近的 ${nearest.publishedAt}《${nearest.title}》。`;
  renderCalendar();
  if (matchMedia('(max-width: 610px)').matches) {
    $('section-title').scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
  }
});
$('previous-month').addEventListener('click', () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1); renderCalendar(); });
$('next-month').addEventListener('click', () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1); renderCalendar(); });
$('calendar-today').addEventListener('click', () => { calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1); renderCalendar(); });
updateKeyboardMode(); renderCalendar(); render();
