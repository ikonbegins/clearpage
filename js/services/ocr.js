// Text recognition (OCR) with Tesseract.js, fully on this device.
// The engine (about 4 MB) and each language (about 2 to 10 MB) download the first time
// they are used, then stay cached for offline use. Images never leave the phone.
import * as db from './db.js';
import { emit } from './events.js';
import { getRenderedBlob, geometryHash } from './render.js';
import { blobToCanvas, releaseCanvas } from './imageio.js';
import { getDoc, updateDoc } from './library.js';

export const OCR_LANGS = [
  { id: 'eng', name: 'English' },
  { id: 'rus', name: 'Russian' },
  { id: 'uzb', name: 'Uzbek (Latin)' },
  { id: 'uzb_cyrl', name: 'Uzbek (Cyrillic)' },
  { id: 'spa', name: 'Spanish' },
  { id: 'fra', name: 'French' },
  { id: 'deu', name: 'German' },
  { id: 'tur', name: 'Turkish' },
  { id: 'kor', name: 'Korean' },
  { id: 'chi_sim', name: 'Chinese (Simplified)' },
  { id: 'ara', name: 'Arabic' },
];

let current = null; // { key, promise }
let progressCb = null;

async function getWorker(langs) {
  const key = langs.slice().sort().join('+');
  if (current && current.key === key) return current.promise;
  if (current) {
    try {
      (await current.promise).terminate();
    } catch {}
  }
  const base = new URL('../../vendor/tesseract/', import.meta.url).href;
  const promise = import('../../vendor/tesseract/tesseract.esm.min.js').then(({ default: Tesseract }) =>
    Tesseract.createWorker(langs, 1, {
      workerPath: base + 'worker.min.js',
      corePath: base,
      logger: (m) => progressCb && progressCb(m),
    }),
  );
  current = { key, promise };
  promise.catch(() => {
    if (current && current.promise === promise) current = null;
  });
  return promise;
}

export function isStale(page) {
  return !!(page.ocr && page.ocr.status === 'done' && page.ocr.geom !== geometryHash(page));
}

export function hasText(page) {
  return !!(page.ocr && page.ocr.status === 'done' && !isStale(page) && page.ocr.text && page.ocr.text.trim());
}

// Recognises one page and stores words with their positions (as fractions of the page).
export async function recognizePage(pageId, langs, onProgress) {
  progressCb = (m) => onProgress && onProgress(m);
  const { page, blob } = await getRenderedBlob(pageId);
  const canvas = await blobToCanvas(blob, 2600);
  const W = canvas.width, H = canvas.height;
  let data;
  try {
    const worker = await getWorker(langs);
    ({ data } = await worker.recognize(canvas, {}, { text: true, blocks: true }));
  } finally {
    releaseCanvas(canvas);
    progressCb = null;
  }
  // Tesseract also "reads" noise, sideways text and scribbles as nonsense with low confidence.
  // Lines it is unsure about are dropped, so search and the PDF text layer stay clean.
  const MIN_LINE_CONF = 55, MIN_WORD_CONF = 35;
  const words = [];
  const lines = [];
  const paragraphs = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      const kept = [];
      for (const line of para.lines || []) {
        const ws = (line.words || []).filter((w) => w.text && w.text.trim() && w.confidence >= MIN_WORD_CONF);
        if (!ws.length) continue;
        const conf = ws.reduce((s, w) => s + w.confidence, 0) / ws.length;
        if (conf < MIN_LINE_CONF) continue;
        ws.forEach((w, i) => {
          const { x0, y0, x1, y1 } = w.bbox;
          words.push({ text: w.text.trim(), box: [x0 / W, y0 / H, (x1 - x0) / W, (y1 - y0) / H], conf: Math.round(w.confidence), space: i < ws.length - 1 });
        });
        const text = ws.map((w) => w.text.trim()).join(' ');
        lines.push({ text, conf });
        kept.push(text);
      }
      if (kept.length) paragraphs.push(kept.join('\n'));
    }
  }
  const latest = await db.get('pages', pageId);
  if (!latest) return null;
  latest.ocr = { status: 'done', langs, text: paragraphs.join('\n\n'), words, lines, geom: geometryHash(page), at: Date.now() };
  await db.put('pages', latest);
  emit('page', latest);
  return latest;
}

// A good title is the first confident line that looks like words, e.g. "Worksheet 22".
export function suggestTitle(lines) {
  for (const l of lines || []) {
    const t = l.text.replace(/\s+/g, ' ').trim();
    const letters = (t.match(/\p{L}/gu) || []).length;
    if (l.conf >= 70 && letters >= 4 && t.length <= 60) return t;
  }
  return null;
}

// Recognises every page that needs it. Renames the document if it still has an automatic name.
export async function recognizeDoc(docId, langs, onProgress, { force = false } = {}) {
  const doc = await getDoc(docId);
  let firstLines = null;
  for (let i = 0; i < doc.pageIds.length; i++) {
    const id = doc.pageIds[i];
    let page = await db.get('pages', id);
    if (!page) continue;
    const fresh = !force && page.ocr && page.ocr.status === 'done' && !isStale(page) && (page.ocr.langs || []).join() === langs.join();
    if (!fresh) {
      page = await recognizePage(id, langs, (m) => {
        if (onProgress && m.status === 'recognizing text') onProgress((i + m.progress) / doc.pageIds.length, m);
        else if (onProgress) onProgress(i / doc.pageIds.length, m);
      });
    }
    if (i === 0 && page && page.ocr) firstLines = page.ocr.lines;
    if (onProgress) onProgress((i + 1) / doc.pageIds.length, { status: 'done' });
  }
  const latestDoc = await getDoc(docId);
  if (latestDoc.autoTitle) {
    const t = suggestTitle(firstLines);
    if (t) {
      const day = new Date(latestDoc.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      await updateDoc(docId, { title: `${t} (${day})`, autoTitle: true });
    }
  }
  emit('docs');
}

export async function docText(docId) {
  const doc = await getDoc(docId);
  const parts = [];
  for (let i = 0; i < doc.pageIds.length; i++) {
    const p = await db.get('pages', doc.pageIds[i]);
    parts.push({ index: i, page: p, text: p && p.ocr && p.ocr.status === 'done' ? p.ocr.text : null, stale: p ? isStale(p) : false });
  }
  return parts;
}
