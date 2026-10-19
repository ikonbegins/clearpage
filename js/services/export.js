// Turns documents into files: PDF (with size control, password, text layer) or images.
import { getDoc, getPages } from './library.js';
import { getRenderedBlob, geometryHash } from './render.js';
import { buildPdf, layoutPage, jpegSize } from './pdf.js';
import { blobToCanvas, canvasToBlob, releaseCanvas } from './imageio.js';
import { safeFileName } from './share.js';

// Long side in pixels and JPEG quality for each preset. "High" keeps the stored page image as is.
export const QUALITY = {
  high: { label: 'High', maxSide: 3200, q: null },
  medium: { label: 'Medium', maxSide: 2200, q: 0.8 },
  small: { label: 'Small', maxSide: 1500, q: 0.62 },
};

// Steps from best to smallest, used to hit a target file size.
const LADDER = [
  [3200, 0.85], [2800, 0.8], [2500, 0.78], [2200, 0.74], [2000, 0.7], [1800, 0.66], [1600, 0.62],
  [1400, 0.58], [1250, 0.54], [1100, 0.5], [950, 0.46], [800, 0.42],
];

async function encodePage(r, maxSide, q) {
  const { width, height } = r.page.rendered;
  if (q == null && Math.max(width, height) <= maxSide) return new Uint8Array(await r.blob.arrayBuffer());
  const c = await blobToCanvas(r.blob, maxSide);
  const out = await canvasToBlob(c, 'image/jpeg', q ?? 0.9);
  releaseCanvas(c);
  return new Uint8Array(await out.arrayBuffer());
}

function overlaps(a, b) {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}

// OCR words for the text layer. Skips stale OCR and anything under a redaction box,
// so a redacted account number cannot be copied out of the invisible text either.
export function textLayerWords(page) {
  const o = page.ocr;
  if (!o || o.status !== 'done' || !o.words || o.geom !== geometryHash(page)) return [];
  const boxes = page.redactions || [];
  return o.words.filter((w) => !boxes.some((b) => overlaps(w.box, b)));
}

/**
 * opts: { pageSize: 'auto'|'letter'|'a4', quality: 'high'|'medium'|'small'|'target',
 *         targetBytes, password, searchable, pageIds (optional subset) }
 * onProgress(label, fraction)
 * Returns { file, fitsTarget }
 */
export async function exportPdf(docId, opts, onProgress = () => {}) {
  const doc = await getDoc(docId);
  let pages = await getPages(doc);
  if (opts.pageIds) pages = pages.filter((p) => opts.pageIds.includes(p.id));
  if (!pages.length) throw new Error('This document has no pages');
  const rendered = [];
  for (let i = 0; i < pages.length; i++) {
    onProgress('Preparing pages', (i / pages.length) * 0.5);
    rendered.push(await getRenderedBlob(pages[i].id));
  }

  const encodeAll = async (maxSide, q, from, span) => {
    const out = [];
    for (let i = 0; i < rendered.length; i++) {
      onProgress('Compressing', from + (span * i) / rendered.length);
      const bytes = await encodePage(rendered[i], maxSide, q);
      out.push({ bytes, ...jpegSize(bytes), page: rendered[i].page });
    }
    return out;
  };
  // Builds the finished PDF, so size checks include the text layer and encryption too.
  const assemble = (images) => buildPdf(images.map((im) => ({
    jpeg: im.bytes,
    imgW: im.width,
    imgH: im.height,
    ...layoutPage(im.width, im.height, opts.pageSize || 'auto'),
    words: opts.searchable ? textLayerWords(im.page) : [],
  })), { title: doc.title, password: opts.password || '' });

  let bytes;
  let fitsTarget = true;
  if (opts.quality === 'target') {
    // Binary search for the best quality step whose finished PDF still fits under the target.
    let lo = 0, hi = LADDER.length - 1, tries = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const candidate = await assemble(await encodeAll(...LADDER[mid], 0.5 + tries * 0.1, 0.1));
      tries++;
      if (candidate.length <= opts.targetBytes) {
        bytes = candidate;
        hi = mid - 1;
      } else lo = mid + 1;
    }
    if (!bytes) {
      bytes = await assemble(await encodeAll(...LADDER[LADDER.length - 1], 0.9, 0.05));
      fitsTarget = bytes.length <= opts.targetBytes;
    }
  } else {
    const preset = QUALITY[opts.quality] || QUALITY.medium;
    const images = await encodeAll(preset.maxSide, preset.q, 0.5, 0.4);
    onProgress('Writing PDF', 0.95);
    bytes = await assemble(images);
  }
  onProgress('Done', 1);
  const file = new File([bytes], safeFileName(opts.fileName || doc.title, 'pdf'), { type: 'application/pdf' });
  return { file, fitsTarget };
}

// One image file per page. JPEG reuses the stored page image, so it is instant.
export async function exportImages(docId, format = 'jpeg', pageIds, onProgress = () => {}) {
  const doc = await getDoc(docId);
  let pages = await getPages(doc);
  if (pageIds) pages = pages.filter((p) => pageIds.includes(p.id));
  const files = [];
  for (let i = 0; i < pages.length; i++) {
    onProgress('Preparing pages', i / pages.length);
    const { blob } = await getRenderedBlob(pages[i].id);
    const suffix = pages.length > 1 ? ` ${String(i + 1).padStart(2, '0')}` : '';
    if (format === 'png') {
      const c = await blobToCanvas(blob, 4000);
      const png = await canvasToBlob(c, 'image/png');
      releaseCanvas(c);
      files.push(new File([png], safeFileName(doc.title + suffix, 'png'), { type: 'image/png' }));
    } else {
      files.push(new File([blob], safeFileName(doc.title + suffix, 'jpg'), { type: 'image/jpeg' }));
    }
  }
  onProgress('Done', 1);
  return files;
}
