// Documents, pages and folders: everything the screens do to the stored data goes through here.
import * as db from './db.js';
import { emit } from './events.js';
import { prepareOriginal, drawScaled, canvasPixels, releaseCanvas, canvasToBlob, makeCanvas, ORIGINAL_MAX_SIDE } from './imageio.js';
import { detectInWorker } from '../engine/client.js';
import { orderCorners } from '../engine/geometry.js';
import { loadSource, queueRender, geometryHash } from './render.js';
import { getSettings, presetById } from './settings.js';

export const FULL_FRAME = [[0, 0], [1, 0], [1, 1], [0, 1]];
export const TRASH_DAYS = 30;

// ---------------- documents ----------------

export function defaultTitle(presetName = 'Scan', date = new Date()) {
  const day = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${presetName} ${day}, ${time}`;
}

export async function createDoc({ title, folderId = null, preset } = {}) {
  const now = Date.now();
  const p = presetById(preset || (await getSettings()).preset);
  const doc = {
    id: db.uid(),
    title: title || defaultTitle(p.name),
    autoTitle: !title,
    folderId,
    preset: p.id,
    createdAt: now,
    updatedAt: now,
    pageIds: [],
    deletedAt: null,
  };
  await db.put('docs', doc);
  emit('docs');
  return doc;
}

export const getDoc = (id) => db.get('docs', id);

export async function listDocs({ trash = false } = {}) {
  const all = await db.getAll('docs');
  return all.filter((d) => (trash ? !!d.deletedAt : !d.deletedAt));
}

export async function updateDoc(id, patch) {
  const doc = await db.get('docs', id);
  if (!doc) return null;
  Object.assign(doc, patch, { updatedAt: Date.now() });
  await db.put('docs', doc);
  emit('docs');
  return doc;
}

export function renameDoc(id, title) {
  return updateDoc(id, { title: title.trim() || 'Untitled', autoTitle: false });
}

export async function trashDocs(ids) {
  const now = Date.now();
  for (const id of ids) {
    const doc = await db.get('docs', id);
    if (doc) {
      doc.deletedAt = now;
      await db.put('docs', doc);
    }
  }
  emit('docs');
}

export async function restoreDocs(ids) {
  for (const id of ids) {
    const doc = await db.get('docs', id);
    if (doc) {
      doc.deletedAt = null;
      await db.put('docs', doc);
    }
  }
  emit('docs');
}

// Permanently removes documents with all their pages and images.
export async function purgeDocs(ids) {
  for (const id of ids) {
    const doc = await db.get('docs', id);
    if (!doc) continue;
    const pages = await db.getByIndex('pages', 'docId', id);
    for (const p of pages) await removePageData(p);
    await db.del('docs', id);
  }
  emit('docs');
}

export async function purgeExpiredTrash() {
  const limit = Date.now() - TRASH_DAYS * 864e5;
  const old = (await listDocs({ trash: true })).filter((d) => d.deletedAt < limit);
  if (old.length) await purgeDocs(old.map((d) => d.id));
  return old.length;
}

export async function emptyTrash() {
  const all = await listDocs({ trash: true });
  await purgeDocs(all.map((d) => d.id));
}

export async function moveDocs(ids, folderId) {
  for (const id of ids) await updateDoc(id, { folderId });
}

// Appends the pages of the other documents to the first one, then removes the emptied ones.
export async function mergeDocs(ids) {
  const [targetId, ...rest] = ids;
  const target = await db.get('docs', targetId);
  for (const id of rest) {
    const doc = await db.get('docs', id);
    if (!doc) continue;
    for (const pid of doc.pageIds) {
      const p = await db.get('pages', pid);
      if (!p) continue;
      p.docId = targetId;
      await db.put('pages', p);
      target.pageIds.push(pid);
    }
    // Its pages now live in the target, so the empty document is simply removed.
    await db.del('docs', id);
  }
  target.updatedAt = Date.now();
  await db.put('docs', target);
  emit('docs');
  return target;
}

// ---------------- pages ----------------

export async function getPages(doc) {
  const pages = await Promise.all(doc.pageIds.map((id) => db.get('pages', id)));
  return pages.filter(Boolean);
}

export const getPage = (id) => db.get('pages', id);

// Finds the page in a photo. Returns normalized corners, or null if nothing convincing.
export async function detectCorners(canvas) {
  const small = drawScaled(canvas, canvas.width, canvas.height, 640);
  const px = canvasPixels(small);
  releaseCanvas(small);
  const res = await detectInWorker(px);
  if (!res) return null;
  return orderCorners(res.corners.map(([x, y]) => [x / px.width, y / px.height]));
}

// Adds a photo as a new page (or replaces the photo of an existing page when retaking).
// source: a File/Blob from the photo picker, or a canvas from the live camera.
export async function addPage(docId, source, opts = {}) {
  const settings = await getSettings();
  const doc = await db.get('docs', docId);
  const preset = presetById(doc.preset || settings.preset);
  let canvas, blob;
  if (source instanceof HTMLCanvasElement) {
    canvas = source.width > ORIGINAL_MAX_SIDE || source.height > ORIGINAL_MAX_SIDE
      ? drawScaled(source, source.width, source.height, ORIGINAL_MAX_SIDE)
      : source;
    blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
  } else {
    ({ canvas, blob } = await prepareOriginal(source));
  }
  let detected = null;
  try {
    detected = await detectCorners(canvas);
  } catch (e) {
    console.warn('detection failed', e);
  }
  const corners = detected || opts.cornersHint || FULL_FRAME;

  let page;
  const existing = opts.replacePageId ? await db.get('pages', opts.replacePageId) : null;
  const originalKey = `o:${db.uid()}`;
  await db.putBlob(originalKey, blob);
  if (existing) {
    await db.delBlob(existing.original.key);
    page = existing;
    page.original = { key: originalKey, width: canvas.width, height: canvas.height };
    page.corners = corners;
    page.detected = detected;
    page.rotation = 0;
    page.redactions = [];
    page.ocr = null;
  } else {
    page = {
      id: db.uid(),
      docId,
      createdAt: Date.now(),
      original: { key: originalKey, width: canvas.width, height: canvas.height },
      corners,
      detected,
      rotation: 0,
      filter: opts.filter || preset.filter,
      strength: opts.strength ?? preset.strength,
      shadows: null,
      redactions: [],
      rendered: null,
      thumb: null,
      ocr: null,
    };
  }
  await db.put('pages', page);
  if (!existing) {
    const d = await db.get('docs', docId);
    const at = opts.index ?? d.pageIds.length;
    d.pageIds.splice(at, 0, page.id);
    d.updatedAt = Date.now();
    await db.put('docs', d);
  }
  // Hand the pixels we already have to the renderer, so it does not decode the JPEG again.
  try {
    await loadSource(page, canvas);
  } catch (e) {
    console.warn(e);
  }
  if (canvas !== source) releaseCanvas(canvas);
  emit('docs');
  emit('page', page);
  queueRender(page.id);
  return page;
}

// Saves page edits. A render is queued if the look of the page changed.
export async function updatePage(id, patch) {
  const page = await db.get('pages', id);
  if (!page) return null;
  const beforeGeom = geometryHash(page);
  Object.assign(page, patch);
  if (page.ocr && geometryHash(page) !== beforeGeom) page.ocr = { ...page.ocr, stale: true };
  await db.put('pages', page);
  const doc = await db.get('docs', page.docId);
  if (doc) {
    doc.updatedAt = Date.now();
    await db.put('docs', doc);
  }
  emit('page', page);
  queueRender(id);
  return page;
}

async function removePageData(page) {
  await db.delBlob(page.original && page.original.key);
  await db.delBlob(page.rendered && page.rendered.key);
  await db.delBlob(page.thumb && page.thumb.key);
  await db.del('pages', page.id);
}

// Removes a page from its document. Returns an undo function that puts it back.
// The page data is only really deleted when the undo window closes.
export async function deletePage(pageId) {
  const page = await db.get('pages', pageId);
  if (!page) return () => {};
  const doc = await db.get('docs', page.docId);
  const index = doc.pageIds.indexOf(pageId);
  doc.pageIds = doc.pageIds.filter((id) => id !== pageId);
  doc.updatedAt = Date.now();
  await db.put('docs', doc);
  emit('docs');
  let undone = false;
  const timer = setTimeout(() => {
    if (!undone) removePageData(page).catch(console.error);
  }, 8000);
  return async () => {
    undone = true;
    clearTimeout(timer);
    const d = await db.get('docs', page.docId);
    d.pageIds.splice(Math.min(index, d.pageIds.length), 0, pageId);
    await db.put('docs', d);
    emit('docs');
  };
}

export async function reorderPages(docId, ids) {
  return updateDoc(docId, { pageIds: ids });
}

// Applies one look (filter settings) to every page of a document.
export async function applyLookToAll(docId, look) {
  const doc = await db.get('docs', docId);
  for (const id of doc.pageIds) await updatePage(id, look);
}

// ---------------- folders ----------------

export async function listFolders() {
  return (await db.getAll('folders')).sort((a, b) => a.name.localeCompare(b.name));
}

export async function createFolder(name) {
  const f = { id: db.uid(), name: name.trim() || 'Folder', createdAt: Date.now() };
  await db.put('folders', f);
  emit('docs');
  return f;
}

export async function renameFolder(id, name) {
  const f = await db.get('folders', id);
  f.name = name.trim() || f.name;
  await db.put('folders', f);
  emit('docs');
}

export async function deleteFolder(id) {
  const docs = await db.getAll('docs');
  for (const d of docs) {
    if (d.folderId === id) {
      d.folderId = null;
      await db.put('docs', d);
    }
  }
  await db.del('folders', id);
  emit('docs');
}

// ---------------- search ----------------

// Case and accent insensitive search over titles and recognised text.
export function fold(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export async function searchDocs(query, docs) {
  const q = fold(query).trim();
  if (!q) return docs;
  const pages = await db.getAll('pages');
  const textByDoc = new Map();
  for (const p of pages) {
    if (p.ocr && p.ocr.text) textByDoc.set(p.docId, (textByDoc.get(p.docId) || '') + ' ' + p.ocr.text);
  }
  const terms = q.split(/\s+/);
  return docs.filter((d) => {
    const hay = fold(d.title) + ' ' + fold(textByDoc.get(d.id));
    return terms.every((t) => hay.includes(t));
  });
}

// ---------------- storage ----------------

export async function storageEstimate() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  return navigator.storage.estimate();
}

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      return await navigator.storage.persist();
    }
    return true;
  } catch {
    return false;
  }
}

// Used by the camera screen to show a quick thumbnail before the real render is done.
export function quickThumb(canvas, maxSide = 200) {
  const t = drawScaled(canvas, canvas.width, canvas.height, maxSide);
  const url = t.toDataURL('image/jpeg', 0.7);
  releaseCanvas(t);
  return url;
}

export { makeCanvas };
