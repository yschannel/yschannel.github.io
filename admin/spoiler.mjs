import { Node, mergeAttributes } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

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

// lift/toggleWrap cannot cross an isolating node. Replace just its wrapper,
// preserving the original block nodes (including marks, images and nested blocks).
export function unwrapCurrentSpoiler({ tr, dispatch }) {
  const selection = tr.selection;
  let position, node;
  if (selection.node?.type.name === 'spoiler') {
    position = selection.from; node = selection.node;
  } else {
    for (let depth = selection.$from.depth; depth > 0; depth--) {
      if (selection.$from.node(depth).type.name === 'spoiler') {
        position = selection.$from.before(depth); node = selection.$from.node(depth); break;
      }
    }
  }
  if (!node) return false;
  if (dispatch) {
    const cursor = selection.node ? position + 1 : selection.from - 1;
    tr.replaceWith(position, position + node.nodeSize, node.content);
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, Math.min(cursor, tr.doc.content.size)))));
    tr.scrollIntoView();
  }
  return true;
}
