// Document screen: all pages of one scan. Tap a page to edit, press and hold to drag it.
import { h, icon, iconButton, toast, actionSheet, promptDialog, confirmDialog, clear, formatDate, progressChip } from './dom.js';
import { navigate, back, setFlow } from './router.js';
import * as lib from '../services/library.js';
import * as db from '../services/db.js';
import { on } from '../services/events.js';
import { isRendered } from '../services/render.js';
import { recognizeDoc, hasText } from '../services/ocr.js';
import { getSettings } from '../services/settings.js';
import { pageThumbUrl, importPhotos, chooseFolder, plural } from './shared.js';
import { openExportSheet } from './exportSheet.js';

export async function documentScreen(el, params) {
  let doc = await lib.getDoc(params.id);
  if (!doc || doc.deletedAt) return navigate('/', { replace: true });
  let pages = [];
  let folders = [];
  let queueSize = 0;

  const titleBtn = h('button', { type: 'button', 'aria-label': 'Rename document', onclick: rename });
  const topbar = h('header', { class: 'topbar' },
    iconButton('back', 'Library', () => back('/')),
    h('div', { class: 'title' }, titleBtn),
    iconButton('more', 'More actions', moreMenu));
  const info = h('div', { class: 'doc-info' });
  const grid = h('div', { class: 'page-grid' });
  const content = h('main', { class: 'content' }, info, grid);
  const bottom = h('footer', { class: 'bottombar' },
    h('button', { class: 'tool', type: 'button', onclick: () => navigate(`/camera?doc=${doc.id}`) }, icon('camera'), 'Add'),
    h('button', { class: 'tool', type: 'button', onclick: () => importPhotos(doc.id) }, icon('photos'), 'Import'),
    h('button', { class: 'tool', type: 'button', onclick: () => navigate(`/text/${doc.id}`) }, icon('text'), 'Text'),
    h('button', { class: 'scan-btn', type: 'button', onclick: () => openExportSheet(doc.id) }, icon('share', 22), 'Share'));
  el.append(topbar, content, bottom);

  function renderInfo() {
    titleBtn.textContent = doc.title;
    clear(info);
    const folder = folders.find((f) => f.id === doc.folderId);
    info.append(h('span', null, plural(pages.length, 'page')), h('span', null, formatDate(doc.updatedAt)));
    if (folder) info.append(h('span', { class: 'tag' }, icon('folder', 14), folder.name));
    const withText = pages.filter(hasText).length;
    if (withText) info.append(h('span', { class: 'tag' }, icon('text', 14), withText === pages.length ? 'Searchable' : `Text on ${withText} of ${pages.length}`));
    if (queueSize) info.append(h('span', { class: 'tag' }, h('span', { class: 'spinner small' }), 'Processing'));
  }

  function pageCard(p, i) {
    const thumb = h('div', { class: 'doc-thumb' });
    const card = h('button', { class: 'page-card', type: 'button', 'aria-label': `Page ${i + 1}. Tap to edit, press and hold to move.`, dataset: { id: p.id } },
      thumb, h('span', { class: 'num' }, String(i + 1)));
    pageThumbUrl(p).then((url) => {
      if (url) thumb.prepend(h('img', { src: url, alt: '', draggable: 'false' }));
      if (!isRendered(p)) thumb.append(h('div', { class: 'status' }, h('div', { class: 'spinner' })));
    });
    card.addEventListener('click', (e) => {
      if (suppressClick) {
        e.preventDefault();
        suppressClick = false;
        return;
      }
      navigate(`/page/${p.id}`);
    });
    attachDrag(card);
    return card;
  }

  function renderGrid() {
    clear(grid);
    pages.forEach((p, i) => grid.append(pageCard(p, i)));
    grid.append(h('button', { class: 'add-card', type: 'button', onclick: () => navigate(`/camera?doc=${doc.id}`) }, icon('plus', 28), 'Add page'));
  }

  // ---------- drag to reorder ----------
  let drag = null;
  let suppressClick = false;
  const blockScroll = (e) => {
    if (drag) e.preventDefault();
  };
  document.addEventListener('touchmove', blockScroll, { passive: false });

  function attachDrag(card) {
    card.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      const sx = e.clientX, sy = e.clientY;
      const timer = setTimeout(() => startDrag(card, e), 380);
      const move = (ev) => {
        if (!drag && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) stop();
        if (drag) moveDrag(ev);
      };
      const up = () => {
        const wasDragging = !!drag;
        stop();
        if (wasDragging) endDrag();
      };
      function stop() {
        clearTimeout(timer);
        if (!drag) {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
        }
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      card._cleanup = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
    });
    card.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function startDrag(card, e) {
    const img = card.querySelector('img');
    const ghost = h('div', { class: 'drag-ghost' }, img ? h('img', { src: img.src, alt: '' }) : h('div', { style: { height: '160px', background: 'var(--surface)' } }));
    document.body.append(ghost);
    card.classList.add('placeholder');
    drag = { card, ghost, x: e.clientX, y: e.clientY, raf: 0 };
    if (navigator.vibrate) navigator.vibrate(15);
    placeGhost();
    autoScroll();
  }

  function placeGhost() {
    Object.assign(drag.ghost.style, { left: `${drag.x}px`, top: `${drag.y}px` });
  }

  function moveDrag(ev) {
    drag.x = ev.clientX;
    drag.y = ev.clientY;
    placeGhost();
    const under = document.elementFromPoint(drag.x, drag.y);
    const target = under && under.closest('.page-card');
    if (!target || target === drag.card || !grid.contains(target)) return;
    const cards = [...grid.querySelectorAll('.page-card')];
    const from = cards.indexOf(drag.card), to = cards.indexOf(target);
    if (from < to) target.after(drag.card);
    else target.before(drag.card);
  }

  // Scrolls the list when dragging near the top or bottom edge.
  function autoScroll() {
    if (!drag) return;
    const r = content.getBoundingClientRect();
    if (drag.y < r.top + 70) content.scrollTop -= 12;
    else if (drag.y > r.bottom - 70) content.scrollTop += 12;
    drag.raf = requestAnimationFrame(autoScroll);
  }

  async function endDrag() {
    const { card, ghost, raf } = drag;
    cancelAnimationFrame(raf);
    ghost.remove();
    card.classList.remove('placeholder');
    if (card._cleanup) card._cleanup();
    drag = null;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 400);
    const order = [...grid.querySelectorAll('.page-card')].map((c) => c.dataset.id);
    if (order.join() !== doc.pageIds.join()) {
      doc = await lib.reorderPages(doc.id, order);
      pages = order.map((id) => pages.find((p) => p.id === id));
      renderGrid();
    }
  }

  // ---------- actions ----------
  async function rename() {
    const t = await promptDialog({ title: 'Rename', value: doc.title });
    if (t != null) doc = await lib.renameDoc(doc.id, t);
    renderInfo();
  }

  async function recognize() {
    const settings = await getSettings();
    const chip = progressChip('Reading text…');
    try {
      await recognizeDoc(doc.id, settings.ocrLangs, (f, m) => {
        const label = m && m.status && m.status.startsWith('loading') ? 'Downloading text engine (first time only)…' : `Reading text… ${Math.round(f * 100)}%`;
        chip.update(f, label);
      });
      toast('Text recognized. The PDF can now be searched and copied from.');
    } catch (e) {
      console.error(e);
      toast(navigator.onLine ? 'Text recognition failed' : 'Text recognition needs internet the first time, to download the language');
    } finally {
      chip.done();
    }
  }

  async function moreMenu() {
    const a = await actionSheet({
      title: doc.title,
      actions: [
        { label: 'Rename', icon: 'edit', value: 'rename' },
        { label: 'Move to folder', icon: 'folderMove', value: 'move' },
        { label: 'Recognize text (searchable PDF)', icon: 'text', value: 'ocr', disabled: !pages.length },
        { label: 'Adjust all crops', icon: 'crop', value: 'crop', disabled: !pages.length },
        { label: 'Delete document', icon: 'trash', value: 'delete', danger: true },
      ],
    });
    if (a === 'rename') rename();
    else if (a === 'move') {
      const f = await chooseFolder(doc.folderId);
      if (f !== undefined) {
        await lib.moveDocs([doc.id], f);
        doc = await lib.getDoc(doc.id);
        renderInfo();
      }
    } else if (a === 'ocr') recognize();
    else if (a === 'crop') {
      setFlow('review', { docId: doc.id, pageIds: doc.pageIds.slice(), next: `/doc/${doc.id}` });
      navigate(`/crop/${doc.id}`);
    } else if (a === 'delete') {
      if (!(await confirmDialog({ title: 'Delete this document?', message: 'It goes to Trash for 30 days, so you can still restore it.', confirmText: 'Delete', danger: true }))) return;
      const id = doc.id;
      await lib.trashDocs([id]);
      toast('Moved to Trash', { action: 'Undo', onAction: () => lib.restoreDocs([id]), duration: 6000 });
      navigate('/', { replace: true });
    }
  }

  async function load() {
    doc = await lib.getDoc(params.id);
    if (!doc || doc.deletedAt) return navigate('/', { replace: true });
    [pages, folders] = await Promise.all([lib.getPages(doc), lib.listFolders()]);
    renderInfo();
    if (!drag) renderGrid();
  }

  const offs = [
    on('docs', load),
    on('page', (p) => {
      if (p.docId === doc.id && !drag) {
        const i = pages.findIndex((x) => x.id === p.id);
        if (i >= 0) {
          pages[i] = p;
          const old = grid.querySelector(`[data-id="${p.id}"]`);
          if (old) old.replaceWith(pageCard(p, i));
          renderInfo();
        }
      }
    }),
    on('render-queue', (n) => {
      queueSize = n;
      renderInfo();
    }),
  ];
  await load();
  return {
    destroy() {
      offs.forEach((f) => f());
      document.removeEventListener('touchmove', blockScroll);
      if (drag) drag.ghost.remove();
    },
  };
}
