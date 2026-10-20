// Main-thread rendering service: feeds photos to the render worker, stores the finished
// page images and thumbnails, and keeps a background queue so scanning never waits.
import * as db from './db.js';
import { emit } from './events.js';
import { getRenderer } from '../engine/client.js';
import { blobToCanvas, canvasPixels, canvasToBlob, pixelsToCanvas, releaseCanvas, thumbnailFromCanvas, ORIGINAL_MAX_SIDE } from './imageio.js';

// Bump when the engine changes in a way that should re-render existing pages.
// 2: stronger shadow removal, grain-aware white point and despeckle.
export const ENGINE_VERSION = 2;
// Long side of the stored page image. Letter paper at about 290 dpi.
export const RENDER_MAX_SIDE = 3200;

export function renderParams(page) {
  return {
    corners: page.corners,
    rotation: page.rotation || 0,
    filter: page.filter,
    strength: page.strength ?? 0.5,
    shadows: page.shadows ?? null,
    redactions: page.redactions || [],
  };
}

export function renderHash(page) {
  return JSON.stringify([ENGINE_VERSION, page.original.key, renderParams(page)]);
}

// Only crop and rotation move the text, so OCR results survive filter changes.
export function geometryHash(page) {
  return JSON.stringify([page.original.key, page.corners, page.rotation || 0]);
}

export function isRendered(page) {
  return !!(page.rendered && page.rendered.hash === renderHash(page));
}

// Makes sure the render worker holds this page's photo.
export async function loadSource(page, canvas) {
  const key = page.original.key;
  const r = getRenderer();
  if (!canvas && (await r.call('hasSource', { key }))) return key;
  let c = canvas;
  if (!c) {
    const blob = await db.getBlob(key);
    if (!blob) throw new Error('Photo is missing for this page');
    c = await blobToCanvas(blob, ORIGINAL_MAX_SIDE);
  }
  const px = canvasPixels(c);
  if (!canvas) releaseCanvas(c);
  await r.call('setSource', { key, buffer: px.data.buffer, width: px.width, height: px.height }, [px.data.buffer]);
  return key;
}

// Renders without saving. Used for live previews while editing.
export async function renderToCanvas(page, maxSide, overrides = {}) {
  const key = await loadSource(page);
  let res;
  try {
    res = await getRenderer().call('render', { key, page: { ...renderParams(page), ...overrides }, maxSide });
  } catch (e) {
    if (e.message !== 'NO_SOURCE') throw e;
    // The worker dropped the photo to save memory; send it again.
    await loadSource(page);
    res = await getRenderer().call('render', { key, page: { ...renderParams(page), ...overrides }, maxSide });
  }
  return pixelsToCanvas({ data: new Uint8ClampedArray(res.buffer), width: res.width, height: res.height });
}

// Renders at full size and stores the page image plus a thumbnail.
export async function renderAndStore(pageId) {
  const page = await db.get('pages', pageId);
  if (!page) return null;
  const hash = renderHash(page);
  if (page.rendered && page.rendered.hash === hash) return page;
  const canvas = await renderToCanvas(page, RENDER_MAX_SIDE);
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
  const thumb = await thumbnailFromCanvas(canvas, 420, 0.82);
  const size = { width: canvas.width, height: canvas.height };
  releaseCanvas(canvas);
  // The page may have been edited or deleted while we were rendering.
  const latest = await db.get('pages', pageId);
  if (!latest || renderHash(latest) !== hash) return latest;
  const renderedKey = `r:${pageId}`;
  const thumbKey = `t:${pageId}`;
  await db.putBlob(renderedKey, blob);
  await db.putBlob(thumbKey, thumb);
  latest.rendered = { key: renderedKey, hash, ...size, bytes: blob.size };
  latest.thumb = { key: thumbKey, hash };
  await db.put('pages', latest);
  emit('page', latest);
  return latest;
}

// ---- background queue ----
const queue = [];
let running = false;
const waiters = new Map();

export function queueRender(pageId) {
  if (!queue.includes(pageId)) queue.push(pageId);
  pump();
  return new Promise((resolve) => {
    if (!waiters.has(pageId)) waiters.set(pageId, []);
    waiters.get(pageId).push(resolve);
  });
}

export function pendingRenders() {
  return queue.length + (running ? 1 : 0);
}

async function pump() {
  if (running) return;
  running = true;
  emit('render-queue', pendingRenders());
  while (queue.length) {
    const id = queue.shift();
    let result = null;
    try {
      result = await renderAndStore(id);
    } catch (e) {
      console.error('render failed', id, e);
    }
    const ws = waiters.get(id);
    waiters.delete(id);
    if (ws) ws.forEach((r) => r(result));
    emit('render-queue', pendingRenders());
  }
  running = false;
  emit('render-queue', 0);
}

// Returns the up-to-date page image, rendering first if needed. Used by export.
export async function getRenderedBlob(pageId) {
  let page = await db.get('pages', pageId);
  if (!isRendered(page)) page = (await queueRender(pageId)) || (await db.get('pages', pageId));
  if (!isRendered(page)) page = await renderAndStore(pageId);
  return { page, blob: await db.getBlob(page.rendered.key) };
}
