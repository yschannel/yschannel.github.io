import { Node, mergeAttributes } from '@tiptap/core';

export const Spoiler = Node.create({
  name: 'spoiler',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,
  addAttributes() {
    return { label: { default: '剧透提示 · 点击展开', parseHTML: element => element.getAttribute('data-label') || '剧透提示 · 点击展开' } };
  },
  parseHTML() { return [{ tag: 'section[data-type="spoiler"]', contentElement: '.spoiler-content' }]; },
  renderHTML({ node, HTMLAttributes }) {
    return ['section', mergeAttributes(HTMLAttributes, { 'data-type': 'spoiler', 'data-label': node.attrs.label, class: 'editor-spoiler' }),
      ['div', { class: 'spoiler-edit-label', contenteditable: 'false' }, `防剧透区域：${node.attrs.label}（编辑时展开）`],
      ['div', { class: 'spoiler-content' }, 0]];
  },
});

export function positionAfterSpoiler(selection) {
  for (let depth = selection.$from.depth; depth > 0; depth--) {
    if (selection.$from.node(depth).type.name === 'spoiler') return selection.$from.after(depth);
  }
  return null;
}
