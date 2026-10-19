// Trash: deleted documents wait here for 30 days before they are removed for good.
import { h, icon, iconButton, toast, confirmDialog, clear } from './dom.js';
import { back } from './router.js';
import * as lib from '../services/library.js';
import { on } from '../services/events.js';
import { docThumbUrl, plural } from './shared.js';

export async function trashScreen(el) {
  const emptyBtn = h('button', { class: 'btn ghost small', type: 'button', onclick: emptyAll }, 'Empty');
  const list = h('div');
  el.append(h('header', { class: 'topbar' }, iconButton('back', 'Back', () => back('/')), h('div', { class: 'title' }, 'Trash'), emptyBtn),
    h('main', { class: 'content' }, h('p', { class: 'note', style: { margin: '0 4px 12px' } }, `Documents here are deleted for good after ${lib.TRASH_DAYS} days.`), list));

  async function render() {
    const docs = (await lib.listDocs({ trash: true })).sort((a, b) => b.deletedAt - a.deletedAt);
    emptyBtn.disabled = !docs.length;
    clear(list);
    if (!docs.length) {
      list.append(h('div', { class: 'empty' }, h('div', { class: 'art' }, icon('trash')), h('h2', null, 'Trash is empty')));
      return;
    }
    const group = h('div', { class: 'group' });
    for (const d of docs) {
      const daysLeft = Math.max(0, Math.ceil((d.deletedAt + lib.TRASH_DAYS * 864e5 - Date.now()) / 864e5));
      const thumb = h('div', { class: 'doc-thumb' });
      docThumbUrl(d).then((u) => u && thumb.append(h('img', { src: u, alt: '' })));
      group.append(h('div', { class: 'trash-row' }, thumb,
        h('div', { class: 'info' }, h('div', { class: 'doc-name' }, d.title), h('div', { class: 'doc-meta' }, `${plural(d.pageIds.length, 'page')} · ${plural(daysLeft, 'day')} left`)),
        h('button', { class: 'btn small', type: 'button', onclick: async () => {
          await lib.restoreDocs([d.id]);
          toast('Restored');
        } }, 'Restore'),
        iconButton('trash', 'Delete for good', async () => {
          if (await confirmDialog({ title: 'Delete for good?', message: `"${d.title}" cannot be recovered after this.`, confirmText: 'Delete', danger: true })) await lib.purgeDocs([d.id]);
        })));
    }
    list.append(group);
  }

  async function emptyAll() {
    const n = (await lib.listDocs({ trash: true })).length;
    if (await confirmDialog({ title: 'Empty Trash?', message: `${plural(n, 'document')} will be deleted for good.`, confirmText: 'Empty Trash', danger: true })) await lib.emptyTrash();
  }

  const off = on('docs', render);
  await render();
  return { destroy: off };
}
