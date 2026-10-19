// Home screen: every scanned document, with search, folders and multi-select.
import { h, icon, iconButton, toast, actionSheet, promptDialog, confirmDialog, onLongPress, formatDate, clear } from './dom.js';
import { navigate } from './router.js';
import * as lib from '../services/library.js';
import { on } from '../services/events.js';
import { getSettings, setSettings } from '../services/settings.js';
import { docThumbUrl, importPhotos, chooseFolder, plural } from './shared.js';
import { openExportSheet, shareDocsAsPdf } from './exportSheet.js';

export async function libraryScreen(el) {
  const settings = await getSettings();
  const state = {
    folder: 'all',
    query: '',
    sort: settings.librarySort || 'date',
    view: settings.libraryView || 'grid',
    selecting: false,
    selected: new Set(),
    docs: [],
    folders: [],
    trashCount: 0,
  };

  const titleEl = h('div', { class: 'title big' }, 'ClearPage');
  const selectBtn = h('button', { class: 'btn ghost small', type: 'button', onclick: () => setSelecting(!state.selecting) }, 'Select');
  const topbar = h('header', { class: 'topbar' }, titleEl, selectBtn, iconButton('settings', 'Settings', () => navigate('/settings')));

  const searchInput = h('input', { type: 'search', placeholder: 'Search titles and text', 'aria-label': 'Search documents', enterkeyhint: 'search' });
  searchInput.addEventListener('input', () => {
    state.query = searchInput.value;
    renderDocs();
  });
  const search = h('label', { class: 'search' }, icon('search', 20), searchInput);
  const chips = h('div', { class: 'chips', role: 'tablist' });
  const tools = h('div', { class: 'row-tools' });
  const listHost = h('div');
  const content = h('main', { class: 'content' }, search, chips, tools, listHost);

  const bottom = h('footer', { class: 'bottombar' });
  el.append(topbar, content, bottom);

  function setSelecting(on) {
    state.selecting = on;
    state.selected.clear();
    selectBtn.textContent = on ? 'Done' : 'Select';
    renderBottom();
    renderDocs();
  }

  function renderBottom() {
    clear(bottom);
    if (state.selecting) {
      const n = state.selected.size;
      const ids = () => [...state.selected];
      bottom.append(
        h('button', { class: 'tool', type: 'button', disabled: n < 1, onclick: () => shareSelected(ids()) }, icon('share'), 'Share'),
        h('button', { class: 'tool', type: 'button', disabled: n < 2, onclick: () => mergeSelected(ids()) }, icon('merge'), 'Merge'),
        h('button', { class: 'tool', type: 'button', disabled: n < 1, onclick: () => moveSelected(ids()) }, icon('folderMove'), 'Move'),
        h('button', { class: 'tool danger', type: 'button', disabled: n < 1, onclick: () => deleteDocs(ids()) }, icon('trash'), 'Delete'),
      );
      return;
    }
    bottom.append(
      h('button', { class: 'tool', type: 'button', onclick: () => importPhotos(null) }, icon('photos'), 'Import'),
      h('button', { class: 'scan-btn', type: 'button', onclick: () => navigate('/camera') }, icon('camera', 26), 'Scan'),
      h('button', { class: 'tool', type: 'button', onclick: () => navigate('/trash') }, icon('trash'), state.trashCount ? `Trash (${state.trashCount})` : 'Trash'),
    );
  }

  function renderChips() {
    clear(chips);
    const chip = (label, value, extra = {}) => {
      const b = h('button', { class: `chip ${state.folder === value ? 'on' : ''}`, type: 'button', role: 'tab', 'aria-selected': state.folder === value ? 'true' : 'false', onclick: () => {
        state.folder = value;
        renderChips();
        renderDocs();
      } }, extra.icon ? icon(extra.icon, 16) : null, label);
      if (extra.folder) onLongPress(b, () => folderMenu(extra.folder));
      return b;
    };
    chips.append(chip('All', 'all'));
    for (const f of state.folders) chips.append(chip(f.name, f.id, { icon: 'folder', folder: f }));
    chips.append(h('button', { class: 'chip add', type: 'button', onclick: newFolder }, icon('plus', 16), 'Folder'));
  }

  async function newFolder() {
    const name = await promptDialog({ title: 'New folder', placeholder: 'For example: Calculus', confirmText: 'Create' });
    if (name && name.trim()) {
      const f = await lib.createFolder(name);
      state.folder = f.id;
    }
  }

  async function folderMenu(f) {
    const a = await actionSheet({
      title: f.name,
      actions: [
        { label: 'Rename folder', icon: 'edit', value: 'rename' },
        { label: 'Delete folder (keeps documents)', icon: 'trash', value: 'delete', danger: true },
      ],
    });
    if (a === 'rename') {
      const name = await promptDialog({ title: 'Rename folder', value: f.name });
      if (name) await lib.renameFolder(f.id, name);
    } else if (a === 'delete') {
      if (await confirmDialog({ title: `Delete "${f.name}"?`, message: 'Documents in it move back to All. Nothing is deleted.', confirmText: 'Delete', danger: true })) {
        await lib.deleteFolder(f.id);
        state.folder = 'all';
      }
    }
  }

  function renderTools(count) {
    clear(tools);
    tools.append(
      h('span', { class: 'grow' }, plural(count, 'document')),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Sort by ${state.sort === 'date' ? 'name' : 'date'}`, onclick: () => {
        state.sort = state.sort === 'date' ? 'name' : 'date';
        setSettings({ librarySort: state.sort });
        renderDocs();
      } }, icon('sort', 20), h('span', { style: { fontSize: '0.82rem' } }, state.sort === 'date' ? 'Newest' : 'A to Z')),
      iconButton(state.view === 'grid' ? 'list' : 'gridView', state.view === 'grid' ? 'Show as list' : 'Show as grid', () => {
        state.view = state.view === 'grid' ? 'list' : 'grid';
        setSettings({ libraryView: state.view });
        renderDocs();
      }),
    );
  }

  let renderToken = 0;
  async function renderDocs() {
    const token = ++renderToken;
    let docs = state.docs;
    if (state.folder !== 'all') docs = docs.filter((d) => d.folderId === state.folder);
    docs = await lib.searchDocs(state.query, docs);
    if (token !== renderToken) return;
    docs = docs.slice().sort(state.sort === 'name' ? (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }) : (a, b) => b.updatedAt - a.updatedAt);
    renderTools(docs.length);
    clear(listHost);
    if (!docs.length) {
      listHost.append(state.docs.length
        ? h('div', { class: 'empty' }, h('h2', null, 'Nothing found'), h('p', null, state.query ? 'Try other words. Text inside scans is searchable after you use Recognize text.' : 'This folder is empty.'))
        : h('div', { class: 'empty' },
          h('div', { class: 'art' }, icon('scan')),
          h('h2', null, 'Scan your first page'),
          h('p', null, 'Tap Scan, point at a page, and get a clean PDF.'),
          h('div', { class: 'promise' }, h('span', null, 'No watermarks'), h('span', null, 'No account'), h('span', null, 'Stays on your phone'))));
      return;
    }
    const wrap = h('div', { class: state.view === 'grid' ? 'doc-grid' : 'doc-list' });
    for (const d of docs) wrap.append(docItem(d));
    listHost.append(wrap);
  }

  function docItem(d) {
    const selected = state.selected.has(d.id);
    const thumb = h('div', { class: 'doc-thumb' }, h('div', { class: 'spinner small' }));
    docThumbUrl(d).then((url) => {
      clear(thumb);
      if (url) thumb.append(h('img', { src: url, alt: '', loading: 'lazy' }));
      else thumb.append(icon('page', 28));
      if (state.view === 'grid') thumb.append(h('span', { class: 'count' }, d.pageIds.length));
    });
    const check = state.selecting ? h('span', { class: 'check' }, selected ? icon('check', 16) : null) : null;
    const meta = `${formatDate(d.updatedAt)} · ${plural(d.pageIds.length, 'page')}`;
    const item = state.view === 'grid'
      ? h('button', { class: `doc-card ${selected ? 'selected' : ''}`, type: 'button', 'aria-label': `${d.title}, ${meta}` }, check, thumb, h('div', { class: 'doc-name' }, d.title), h('div', { class: 'doc-meta' }, meta))
      : h('button', { class: `doc-row ${selected ? 'selected' : ''}`, type: 'button' }, check, thumb, h('div', { class: 'info' }, h('div', { class: 'doc-name' }, d.title), h('div', { class: 'doc-meta' }, meta)));
    item.addEventListener('click', () => {
      if (state.selecting) {
        if (state.selected.has(d.id)) state.selected.delete(d.id);
        else state.selected.add(d.id);
        renderBottom();
        renderDocs();
      } else navigate(`/doc/${d.id}`);
    });
    onLongPress(item, () => docMenu(d));
    return item;
  }

  async function docMenu(d) {
    const a = await actionSheet({
      title: d.title,
      actions: [
        { label: 'Share PDF', icon: 'share', value: 'share' },
        { label: 'Rename', icon: 'edit', value: 'rename' },
        { label: 'Move to folder', icon: 'folderMove', value: 'move' },
        { label: 'Select', icon: 'select', value: 'select' },
        { label: 'Delete', icon: 'trash', value: 'delete', danger: true },
      ],
    });
    if (a === 'share') openExportSheet(d.id);
    else if (a === 'rename') {
      const t = await promptDialog({ title: 'Rename', value: d.title });
      if (t != null) await lib.renameDoc(d.id, t);
    } else if (a === 'move') {
      const f = await chooseFolder(d.folderId);
      if (f !== undefined) await lib.moveDocs([d.id], f);
    } else if (a === 'select') {
      setSelecting(true);
      state.selected.add(d.id);
      renderBottom();
      renderDocs();
    } else if (a === 'delete') deleteDocs([d.id]);
  }

  async function deleteDocs(ids) {
    await lib.trashDocs(ids);
    if (state.selecting) setSelecting(false);
    toast(`${plural(ids.length, 'document')} moved to Trash`, { action: 'Undo', onAction: () => lib.restoreDocs(ids), duration: 6000 });
  }

  async function mergeSelected(ids) {
    // Keep the order the documents appear in on screen (oldest first reads naturally).
    const ordered = state.docs.filter((d) => ids.includes(d.id)).sort((a, b) => a.createdAt - b.createdAt).map((d) => d.id);
    if (!(await confirmDialog({ title: `Merge ${ids.length} documents?`, message: 'All pages are combined into the oldest one, in date order.', confirmText: 'Merge' }))) return;
    const target = await lib.mergeDocs(ordered);
    setSelecting(false);
    navigate(`/doc/${target.id}`);
  }

  async function moveSelected(ids) {
    const f = await chooseFolder(undefined);
    if (f === undefined) return;
    await lib.moveDocs(ids, f);
    setSelecting(false);
  }

  async function shareSelected(ids) {
    if (ids.length === 1) return openExportSheet(ids[0]);
    await shareDocsAsPdf(ids);
  }

  async function load() {
    [state.docs, state.folders] = await Promise.all([lib.listDocs(), lib.listFolders()]);
    state.trashCount = (await lib.listDocs({ trash: true })).length;
    if (state.folder !== 'all' && !state.folders.some((f) => f.id === state.folder)) state.folder = 'all';
    for (const id of [...state.selected]) if (!state.docs.some((d) => d.id === id)) state.selected.delete(id);
    renderChips();
    renderBottom();
    renderDocs();
  }

  const offs = [on('docs', load), on('page', (p) => {
    // A first page finished rendering: refresh that card's thumbnail.
    if (state.docs.some((d) => d.pageIds[0] === p.id)) renderDocs();
  })];
  await load();
  return { destroy: () => offs.forEach((f) => f()) };
}
