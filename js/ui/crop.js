// Crop screen: fix the page corners for one or more pages (used right after scanning,
// and later from the page editor). Shows the original photo with a draggable outline.
import { h, icon, iconButton, toast, clear } from './dom.js';
import { navigate, back, peekFlow, takeFlow } from './router.js';
import * as lib from '../services/library.js';
import * as db from '../services/db.js';
import { isConvex, polygonArea } from '../engine/geometry.js';
import { blobUrl } from '../services/imageio.js';

const PAD = 26; // keep corner handles reachable at the photo edge

export async function cropScreen(el, params, query) {
  el.classList.add('dark-screen');
  const docId = params.docId;
  const flow = peekFlow('review');
  let pageIds;
  let next;
  if (flow && flow.docId === docId) {
    pageIds = flow.pageIds.slice();
    next = flow.next;
  } else {
    const doc = await lib.getDoc(docId);
    if (!doc) return navigate('/', { replace: true });
    pageIds = query.pages ? query.pages.split(',') : doc.pageIds.slice();
    next = query.next || `/doc/${docId}`;
  }
  let index = Math.min(Number(query.i || 0), pageIds.length - 1);
  let page = null;
  let corners = null;
  let rotation = 0;
  let natural = { w: 1, h: 1 };
  let disp = { x: 0, y: 0, w: 1, h: 1, s: 1 };

  // ---------- elements ----------
  const titleSub = h('span', { class: 'sub' });
  const topbar = h('header', { class: 'topbar' },
    iconButton('back', 'Back', prev),
    h('div', { class: 'title' }, 'Adjust corners', titleSub),
    iconButton('trash', 'Delete this page', removePage));
  const img = h('img', { alt: 'Original photo' });
  const svg = h('svg', { class: 'quad' });
  const shade = h('path', { class: 'shade' });
  const edge = h('polygon', { class: 'edge' });
  svg.append(shade, edge);
  const mids = [0, 1, 2, 3].map((i) => h('rect', { class: 'handle mid', rx: 4, width: 22, height: 8, 'data-edge': i }));
  const midHits = [0, 1, 2, 3].map((i) => h('circle', { class: 'hit', r: 22, 'data-edge': i }));
  const handles = [0, 1, 2, 3].map((i) => h('circle', { class: 'handle', r: 11, 'data-corner': i }));
  const hits = [0, 1, 2, 3].map((i) => h('circle', { class: 'hit', r: 26, 'data-corner': i, role: 'slider', 'aria-label': ['Top left corner', 'Top right corner', 'Bottom right corner', 'Bottom left corner'][i] }));
  svg.append(...mids, ...handles, ...midHits, ...hits);
  const magCanvas = h('canvas', { width: 248, height: 248 });
  const magnifier = h('div', { class: 'magnifier' }, magCanvas);
  const stage = h('div', { class: 'crop-stage' }, img, svg, magnifier);

  const nextBtn = h('button', { class: 'btn primary', type: 'button', onclick: save }, 'Next');
  const bottom = h('footer', { class: 'bottombar' },
    h('button', { class: 'tool', type: 'button', onclick: () => rotate(-1) }, icon('rotateLeft'), 'Left'),
    h('button', { class: 'tool', type: 'button', onclick: () => rotate(1) }, icon('rotateRight'), 'Right'),
    h('button', { class: 'tool', type: 'button', onclick: autoDetect }, icon('wand'), 'Auto'),
    h('button', { class: 'tool', type: 'button', onclick: fullPage }, icon('fullscreen'), 'Full page'),
    nextBtn);
  el.append(topbar, stage, bottom);

  // ---------- layout ----------
  function layout() {
    const r = stage.getBoundingClientRect();
    const s = Math.min((r.width - PAD * 2) / natural.w, (r.height - PAD * 2) / natural.h);
    const w = natural.w * s, hh = natural.h * s;
    disp = { x: (r.width - w) / 2, y: (r.height - hh) / 2, w, h: hh, s, W: r.width, H: r.height };
    Object.assign(img.style, { left: `${disp.x}px`, top: `${disp.y}px`, width: `${w}px`, height: `${hh}px` });
    svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
    drawQuad();
  }

  const toScreen = ([x, y]) => [disp.x + x * disp.w, disp.y + y * disp.h];
  const toNorm = (sx, sy) => [Math.min(1, Math.max(0, (sx - disp.x) / disp.w)), Math.min(1, Math.max(0, (sy - disp.y) / disp.h))];

  function valid(q = corners) {
    return isConvex(q) && polygonArea(q) > 0.01;
  }

  function drawQuad() {
    if (!corners) return;
    const pts = corners.map(toScreen);
    edge.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
    edge.classList.toggle('bad', !valid());
    shade.setAttribute('d', `M0 0H${disp.W}V${disp.H}H0Z M${pts.map((p) => p.join(' ')).join(' L')}Z`);
    pts.forEach(([x, y], i) => {
      handles[i].setAttribute('cx', x);
      handles[i].setAttribute('cy', y);
      hits[i].setAttribute('cx', x);
      hits[i].setAttribute('cy', y);
      const [nx, ny] = pts[(i + 1) % 4];
      const mx = (x + nx) / 2, my = (y + ny) / 2;
      const ang = (Math.atan2(ny - y, nx - x) * 180) / Math.PI;
      mids[i].setAttribute('x', mx - 11);
      mids[i].setAttribute('y', my - 4);
      mids[i].setAttribute('transform', `rotate(${ang} ${mx} ${my})`);
      midHits[i].setAttribute('cx', mx);
      midHits[i].setAttribute('cy', my);
    });
    nextBtn.disabled = !valid();
  }

  function showMagnifier(cornerIndex, px, py) {
    const [cx, cy] = corners[cornerIndex];
    const size = 124;
    let left = px - size / 2, topY = py - size - 46;
    if (topY < 4) topY = py + 46;
    left = Math.max(4, Math.min(disp.W - size - 4, left));
    Object.assign(magnifier.style, { display: 'block', left: `${left}px`, top: `${topY}px` });
    const ctx = magCanvas.getContext('2d');
    const zoom = 3;
    const srcSize = size / (disp.s * zoom);
    const sx = cx * natural.w - srcSize / 2, sy = cy * natural.h - srcSize / 2;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, magCanvas.width, magCanvas.height);
    ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, magCanvas.width, magCanvas.height);
    // Draw the two edges meeting at this corner, so you can line them up with the paper.
    const k = magCanvas.width / srcSize;
    const toMag = ([x, y]) => [(x * natural.w - sx) * k, (y * natural.h - sy) * k];
    ctx.strokeStyle = '#5b8cff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    const a = toMag(corners[(cornerIndex + 3) % 4]), b = toMag(corners[cornerIndex]), c = toMag(corners[(cornerIndex + 1) % 4]);
    ctx.moveTo(...a);
    ctx.lineTo(...b);
    ctx.lineTo(...c);
    ctx.stroke();
  }

  // ---------- dragging ----------
  let drag = null;
  svg.addEventListener('pointerdown', (e) => {
    const t = e.target;
    if (!corners || !t.dataset) return;
    const r = stage.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    if (t.dataset.corner != null) {
      const i = Number(t.dataset.corner);
      const [sx, sy] = toScreen(corners[i]);
      drag = { type: 'corner', i, dx: sx - px, dy: sy - py };
    } else if (t.dataset.edge != null) {
      drag = { type: 'edge', i: Number(t.dataset.edge), sx: px, sy: py, start: corners.map((c) => c.slice()) };
    } else return;
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = stage.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    if (drag.type === 'corner') {
      let p = toNorm(px + drag.dx, py + drag.dy);
      // Snap to the detected corner when close (within about 14 screen pixels).
      if (page.detected) {
        const d = page.detected[drag.i];
        const [dx, dy] = toScreen(d);
        const [qx, qy] = toScreen(p);
        if (Math.hypot(dx - qx, dy - qy) < 14) p = d.slice();
      }
      corners[drag.i] = p;
      drawQuad();
      showMagnifier(drag.i, px, py);
    } else {
      // Move both corners of this edge along the edge's normal.
      const a = drag.start[drag.i], b = drag.start[(drag.i + 1) % 4];
      const ex = (b[0] - a[0]) * disp.w, ey = (b[1] - a[1]) * disp.h;
      const len = Math.hypot(ex, ey) || 1;
      const nx = -ey / len, ny = ex / len;
      const dist = (px - drag.sx) * nx + (py - drag.sy) * ny;
      const off = [(nx * dist) / disp.w, (ny * dist) / disp.h];
      for (const k of [drag.i, (drag.i + 1) % 4]) {
        const s = drag.start[k];
        corners[k] = [Math.min(1, Math.max(0, s[0] + off[0])), Math.min(1, Math.max(0, s[1] + off[1]))];
      }
      drawQuad();
    }
  });
  const endDrag = () => {
    drag = null;
    magnifier.style.display = 'none';
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  // ---------- actions ----------
  function rotate(dir) {
    rotation = (rotation + dir + 4) % 4;
    updateTitle();
  }

  function autoDetect() {
    if (page.detected) {
      corners = page.detected.map((c) => c.slice());
      drawQuad();
    } else toast('No page edges were found in this photo. Drag the corners instead.');
  }

  function fullPage() {
    corners = lib.FULL_FRAME.map((c) => c.slice());
    drawQuad();
  }

  function updateTitle() {
    const turns = ['', ' · turned right', ' · upside down', ' · turned left'][rotation];
    titleSub.textContent = `Page ${index + 1} of ${pageIds.length}${turns}`;
    nextBtn.textContent = index < pageIds.length - 1 ? 'Next' : 'Done';
  }

  async function persist() {
    if (!page || !corners) return;
    const changed = JSON.stringify(corners) !== JSON.stringify(page.corners) || rotation !== (page.rotation || 0);
    if (!changed) return;
    // Redaction boxes follow the page when it turns.
    let redactions = page.redactions || [];
    const turns = (rotation - (page.rotation || 0) + 4) % 4;
    for (let t = 0; t < turns; t++) redactions = redactions.map(([x, y, w, hh]) => [1 - y - hh, x, hh, w]);
    await lib.updatePage(page.id, { corners, rotation, redactions });
  }

  async function save() {
    if (!valid()) return;
    await persist();
    if (index < pageIds.length - 1) {
      index++;
      await show();
    } else done();
  }

  function done() {
    takeFlow('review');
    navigate(next, { replace: true });
  }

  async function prev() {
    if (index > 0) {
      await persist();
      index--;
      await show();
    } else {
      await persist();
      done();
    }
  }

  async function removePage() {
    const id = pageIds[index];
    const undo = await lib.deletePage(id);
    pageIds.splice(index, 1);
    toast('Page deleted', { action: 'Undo', onAction: undo, duration: 6000 });
    if (!pageIds.length) return done();
    index = Math.min(index, pageIds.length - 1);
    await show();
  }

  async function show() {
    page = await db.get('pages', pageIds[index]);
    if (!page) {
      pageIds.splice(index, 1);
      if (!pageIds.length) return done();
      index = Math.min(index, pageIds.length - 1);
      return show();
    }
    corners = page.corners.map((c) => c.slice());
    rotation = page.rotation || 0;
    natural = { w: page.original.width, h: page.original.height };
    updateTitle();
    const blob = await db.getBlob(page.original.key);
    img.src = blobUrl(page.original.key, blob);
    await img.decode().catch(() => {});
    layout();
  }

  const ro = new ResizeObserver(() => layout());
  ro.observe(stage);
  await show();
  return { destroy: () => ro.disconnect() };
}
