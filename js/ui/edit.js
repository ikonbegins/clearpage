// Page editor: filters, strength, shadow removal, rotate, redact, compare with original.
// Edits are only settings (numbers); the original photo is never changed.
import { h, icon, iconButton, toast, actionSheet, clear } from './dom.js';
import { navigate, back, setFlow } from './router.js';
import * as lib from '../services/library.js';
import * as db from '../services/db.js';
import { on } from '../services/events.js';
import { FILTERS, DEFAULT_SHADOWS } from '../engine/filters.js';
import { renderToCanvas } from '../services/render.js';
import { releaseCanvas, blobUrl } from '../services/imageio.js';
import { exportImages } from '../services/export.js';
import { shareFiles } from '../services/share.js';

export async function editScreen(el, params) {
  el.classList.add('dark-screen');
  let page = await db.get('pages', params.id);
  if (!page) return navigate('/', { replace: true });
  const doc = await lib.getDoc(page.docId);
  const index = doc.pageIds.indexOf(page.id);
  const look = {
    filter: page.filter,
    strength: page.strength ?? 0.5,
    shadows: page.shadows ?? DEFAULT_SHADOWS[page.filter],
    rotation: page.rotation || 0,
    redactions: (page.redactions || []).map((r) => r.slice()),
  };
  let destroyed = false;
  let redactMode = false;

  // ---------- elements ----------
  const topbar = h('header', { class: 'topbar' },
    iconButton('back', 'Back to document', () => leave(`/doc/${doc.id}`)),
    h('div', { class: 'title' }, `Page ${index + 1} of ${doc.pageIds.length}`, h('span', { class: 'sub' }, doc.title)),
    iconButton('more', 'More actions', moreMenu));

  const previewHost = h('div', { style: { position: 'relative', display: 'flex', maxWidth: '100%', maxHeight: '100%' } });
  const spinner = h('div', { class: 'spinner small light rendering' });
  const compareTag = h('div', { class: 'compare-tag' }, 'Original');
  const prevBtn = index > 0 ? iconButton('back', 'Previous page', () => go(-1), { class: 'nav prev' }) : null;
  const nextBtn = index < doc.pageIds.length - 1 ? iconButton('next', 'Next page', () => go(1), { class: 'nav next' }) : null;
  const stage = h('div', { class: 'edit-stage', 'aria-label': 'Page preview. Press and hold to compare with the original.' }, previewHost, compareTag, spinner, prevBtn, nextBtn);

  const filterStrip = h('div', { class: 'filters', role: 'radiogroup', 'aria-label': 'Filter' });
  const strength = h('input', { type: 'range', min: 0, max: 100, value: Math.round(look.strength * 100), 'aria-label': 'Filter strength' });
  const shadowToggle = h('input', { type: 'checkbox', checked: look.shadows, 'aria-label': 'Remove shadows' });
  const sliders = h('div', { class: 'sliders' },
    h('label', null, 'Strength', strength),
    h('label', { style: { flex: 'none' } }, 'Shadows', h('span', { class: 'switch' }, shadowToggle, h('span'))));
  const redactHint = h('div', { class: 'redact-hint', style: { display: 'none' } }, 'Drag over anything private. It is burned into the image, so it cannot be uncovered.');
  const panel = h('div', { class: 'edit-panel' }, redactHint, filterStrip, sliders);

  const toolsBar = h('footer', { class: 'bottombar' });
  el.append(topbar, stage, panel, toolsBar);

  function renderTools() {
    clear(toolsBar);
    if (redactMode) {
      toolsBar.append(
        h('button', { class: 'tool', type: 'button', disabled: !look.redactions.length, onclick: () => {
          look.redactions.pop();
          drawBoxes();
          renderTools();
        } }, icon('undo'), 'Undo box'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => setRedact(false) }, 'Done'));
      return;
    }
    toolsBar.append(
      h('button', { class: 'tool', type: 'button', onclick: openCrop }, icon('crop'), 'Crop'),
      h('button', { class: 'tool', type: 'button', onclick: rotate }, icon('rotateRight'), 'Rotate'),
      h('button', { class: 'tool', type: 'button', onclick: () => setRedact(true) }, icon('redact'), 'Redact'),
      h('button', { class: 'tool', type: 'button', onclick: applyAll, disabled: doc.pageIds.length < 2 }, icon('stack'), 'Use on all'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => leave(`/doc/${doc.id}`) }, 'Done'));
  }

  // ---------- preview rendering ----------
  let currentCanvas = null;
  let originalCanvas = null;
  let rendering = false, dirty = false;
  const previewSize = () => {
    const r = stage.getBoundingClientRect();
    return Math.round(Math.min(2000, Math.max(r.width, r.height) * Math.min(2, window.devicePixelRatio || 1)));
  };

  // Sizes the preview in pixels so it always fits the free space, whatever its shape.
  function fit(node, w, hh) {
    const r = stage.getBoundingClientRect();
    const s = Math.min((r.width - 28) / w, (r.height - 20) / hh);
    node.style.width = `${Math.max(1, w * s)}px`;
    node.style.height = `${Math.max(1, hh * s)}px`;
  }

  function showCanvas(c) {
    fit(c, c.width, c.height);
    previewHost.replaceChildren(c);
    if (redactMode) drawBoxes();
  }

  async function refresh() {
    if (rendering) {
      dirty = true;
      return;
    }
    rendering = true;
    spinner.style.display = 'block';
    try {
      do {
        dirty = false;
        const c = await renderToCanvas(page, previewSize(), { ...look, redactions: redactMode ? [] : look.redactions });
        if (destroyed) return releaseCanvas(c);
        if (currentCanvas) releaseCanvas(currentCanvas);
        currentCanvas = c;
        if (!comparing) showCanvas(c);
      } while (dirty && !destroyed);
    } catch (e) {
      console.error(e);
      toast('Could not render this page');
    } finally {
      rendering = false;
      spinner.style.display = 'none';
    }
  }

  // ---------- filter thumbnails ----------
  const thumbCache = new Map();
  let thumbGen = 0;
  function renderFilterStrip() {
    clear(filterStrip);
    for (const f of FILTERS) {
      const ph = h('div', { class: 'ph' });
      const cached = thumbCache.get(f.id);
      if (cached) ph.append(cached);
      filterStrip.append(h('button', { class: `filter ${look.filter === f.id ? 'on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(look.filter === f.id), title: f.hint, onclick: () => pickFilter(f.id) }, ph, f.name));
    }
  }
  async function renderFilterThumbs() {
    const gen = ++thumbGen;
    for (const f of FILTERS) {
      if (thumbCache.has(f.id)) continue;
      try {
        const c = await renderToCanvas(page, 200, { filter: f.id, strength: 0.5, shadows: DEFAULT_SHADOWS[f.id], rotation: look.rotation, redactions: [] });
        if (gen !== thumbGen || destroyed) return releaseCanvas(c);
        thumbCache.set(f.id, c);
        renderFilterStrip();
      } catch (e) {
        console.warn(e);
      }
    }
  }

  function pickFilter(id) {
    if (look.filter === id) return;
    look.filter = id;
    look.shadows = DEFAULT_SHADOWS[id];
    shadowToggle.checked = look.shadows;
    renderFilterStrip();
    refresh();
    commit();
  }

  strength.addEventListener('input', () => {
    look.strength = strength.value / 100;
    refresh();
    commit();
  });
  shadowToggle.addEventListener('change', () => {
    look.shadows = shadowToggle.checked;
    refresh();
    commit();
  });

  // ---------- saving ----------
  let commitTimer = null;
  function commit(now = false) {
    clearTimeout(commitTimer);
    const run = async () => {
      page = await lib.updatePage(page.id, { filter: look.filter, strength: look.strength, shadows: look.shadows, rotation: look.rotation, redactions: look.redactions });
    };
    if (now) return run();
    commitTimer = setTimeout(run, 500);
  }

  async function leave(path) {
    clearTimeout(commitTimer);
    await commit(true);
    navigate(path, { replace: true });
  }

  async function go(delta) {
    const id = doc.pageIds[index + delta];
    if (id) leave(`/page/${id}`);
  }

  // ---------- compare and swipe ----------
  let comparing = false, pressTimer = null, start = null;
  stage.addEventListener('pointerdown', (e) => {
    if (redactMode || e.target.closest('button')) return;
    start = { x: e.clientX, y: e.clientY };
    pressTimer = setTimeout(async () => {
      comparing = true;
      stage.classList.add('comparing');
      if (!originalCanvas) originalCanvas = await renderToCanvas(page, previewSize(), { ...look, filter: 'original', shadows: false, redactions: [] });
      if (comparing) showCanvas(originalCanvas);
    }, 160);
  });
  const endPress = (e) => {
    clearTimeout(pressTimer);
    if (comparing) {
      comparing = false;
      stage.classList.remove('comparing');
      if (currentCanvas) showCanvas(currentCanvas);
    } else if (start && e && e.type === 'pointerup') {
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.abs(dx) > 60 && Math.abs(dy) < 50) go(dx < 0 ? 1 : -1);
    }
    start = null;
  };
  stage.addEventListener('pointerup', endPress);
  stage.addEventListener('pointercancel', endPress);
  stage.addEventListener('pointermove', (e) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 12) clearTimeout(pressTimer);
  });

  // ---------- rotate, crop, apply all ----------
  function rotate() {
    look.rotation = (look.rotation + 1) % 4;
    look.redactions = look.redactions.map(([x, y, w, hh]) => [1 - y - hh, x, hh, w]);
    thumbCache.clear();
    if (originalCanvas) {
      releaseCanvas(originalCanvas);
      originalCanvas = null;
    }
    refresh().then(renderFilterThumbs);
    renderFilterStrip();
    commit();
  }

  async function openCrop() {
    await commit(true);
    setFlow('review', { docId: doc.id, pageIds: [page.id], next: `/page/${page.id}` });
    navigate(`/crop/${doc.id}`);
  }

  async function applyAll() {
    await commit(true);
    await lib.applyLookToAll(doc.id, { filter: look.filter, strength: look.strength, shadows: look.shadows });
    toast(`${FILTERS.find((f) => f.id === look.filter).name} applied to all ${doc.pageIds.length} pages`);
  }

  // ---------- redaction ----------
  const layer = h('div', { class: 'redact-layer' });
  function setRedact(onMode) {
    redactMode = onMode;
    filterStrip.style.display = onMode ? 'none' : '';
    sliders.style.display = onMode ? 'none' : '';
    redactHint.style.display = onMode ? '' : 'none';
    if (onMode) {
      previewHost.append(layer);
      drawBoxes();
    } else {
      layer.remove();
      commit();
    }
    renderTools();
    refresh();
  }

  function drawBoxes() {
    if (!redactMode) return;
    if (!layer.isConnected) previewHost.append(layer);
    Object.assign(layer.style, { inset: '0' });
    clear(layer);
    look.redactions.forEach((b, i) => {
      layer.append(h('div', { class: 'redact-box', style: { left: `${b[0] * 100}%`, top: `${b[1] * 100}%`, width: `${b[2] * 100}%`, height: `${b[3] * 100}%` } },
        h('button', { type: 'button', 'aria-label': 'Remove box', onclick: (e) => {
          e.stopPropagation();
          look.redactions.splice(i, 1);
          drawBoxes();
          renderTools();
        } }, icon('x', 16))));
    });
  }

  let boxStart = null, liveBox = null;
  layer.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = layer.getBoundingClientRect();
    boxStart = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, r };
    liveBox = h('div', { class: 'redact-box' });
    layer.append(liveBox);
    layer.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  layer.addEventListener('pointermove', (e) => {
    if (!boxStart) return;
    const { r } = boxStart;
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const bx = Math.min(x, boxStart.x), by = Math.min(y, boxStart.y);
    Object.assign(liveBox.style, { left: `${bx * 100}%`, top: `${by * 100}%`, width: `${Math.abs(x - boxStart.x) * 100}%`, height: `${Math.abs(y - boxStart.y) * 100}%` });
    boxStart.cur = [bx, by, Math.abs(x - boxStart.x), Math.abs(y - boxStart.y)];
  });
  const endBox = () => {
    if (boxStart && boxStart.cur && boxStart.cur[2] > 0.01 && boxStart.cur[3] > 0.005) look.redactions.push(boxStart.cur);
    boxStart = null;
    liveBox = null;
    drawBoxes();
    renderTools();
  };
  layer.addEventListener('pointerup', endBox);
  layer.addEventListener('pointercancel', endBox);

  // ---------- more menu ----------
  async function moreMenu() {
    const a = await actionSheet({
      title: `Page ${index + 1}`,
      actions: [
        { label: 'Retake photo', icon: 'camera', value: 'retake' },
        { label: 'Recognized text', icon: 'text', value: 'text' },
        { label: 'Share this page as image', icon: 'share', value: 'image' },
        { label: 'Delete page', icon: 'trash', value: 'delete', danger: true },
      ],
    });
    if (a === 'retake') {
      await commit(true);
      navigate(`/camera?doc=${doc.id}&retake=${page.id}&next=${encodeURIComponent(`/page/${page.id}`)}`);
    } else if (a === 'text') {
      await commit(true);
      navigate(`/text/${doc.id}?page=${index}`);
    } else if (a === 'image') {
      await commit(true);
      const files = await exportImages(doc.id, 'jpeg', [page.id]);
      shareSelected(files);
    } else if (a === 'delete') {
      clearTimeout(commitTimer);
      const undo = await lib.deletePage(page.id);
      toast('Page deleted', { action: 'Undo', onAction: undo, duration: 6000 });
      const neighbour = doc.pageIds[index + 1] || doc.pageIds[index - 1];
      navigate(neighbour ? `/page/${neighbour}` : `/doc/${doc.id}`, { replace: true });
    }
  }

  // The share sheet needs a fresh tap after the file is ready.
  function shareSelected(files) {
    toast('Image ready', { action: 'Share', onAction: () => shareFiles(files, doc.title), duration: 8000 });
  }

  // Show the stored image right away while the live preview renders.
  if (page.rendered) {
    const b = await db.getBlob(page.rendered.key);
    if (b) {
      const im = h('img', { class: 'preview', src: blobUrl(page.rendered.key, b), alt: 'Page' });
      fit(im, page.rendered.width, page.rendered.height);
      previewHost.append(im);
    }
  }
  renderTools();
  renderFilterStrip();
  refresh().then(renderFilterThumbs);

  const off = on('page', (p) => {
    if (p.id === page.id) page = p;
  });
  const ro = new ResizeObserver(() => {
    const c = previewHost.firstElementChild;
    if (c && c.tagName === 'CANVAS') fit(c, c.width, c.height);
  });
  ro.observe(stage);
  return {
    destroy() {
      destroyed = true;
      off();
      ro.disconnect();
      clearTimeout(commitTimer);
      thumbCache.forEach(releaseCanvas);
      releaseCanvas(currentCanvas);
      releaseCanvas(originalCanvas);
    },
  };
}
