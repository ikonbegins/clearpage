// Turning files into pixels and pixels back into files, using the browser's canvas.

// Longest side we keep for the stored original. A 12 MP iPhone photo is 4032 px; 3264 keeps
// plenty of detail for a page while staying under iPhone Safari's canvas size limits
// (24 MP photos from newer iPhones would not even fit in one canvas).
export const ORIGINAL_MAX_SIDE = 3264;

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Safari frees canvas memory late. Shrinking it to 0x0 releases it right away.
export function releaseCanvas(c) {
  if (c) {
    c.width = 0;
    c.height = 0;
  }
}

export async function loadImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // The decoded image stays usable after the URL is revoked.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

// Draws any image source into a canvas no bigger than maxSide.
// Big reductions are done in halving steps, which looks much smoother than one giant step.
export function drawScaled(source, srcW, srcH, maxSide) {
  const s = Math.min(1, maxSide / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * s)), h = Math.max(1, Math.round(srcH * s));
  let cur = source, cw = srcW, ch = srcH;
  const temps = [];
  while (cw / 2 > w && ch / 2 > h) {
    const nw = Math.round(cw / 2), nh = Math.round(ch / 2);
    const t = makeCanvas(nw, nh);
    const tx = t.getContext('2d');
    tx.imageSmoothingQuality = 'high';
    tx.drawImage(cur, 0, 0, nw, nh);
    temps.push(t);
    cur = t;
    cw = nw;
    ch = nh;
  }
  const out = makeCanvas(w, h);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, w, h);
  temps.forEach(releaseCanvas);
  return out;
}

export async function blobToCanvas(blob, maxSide) {
  const img = await loadImage(blob);
  return drawScaled(img, img.naturalWidth, img.naturalHeight, maxSide);
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, quality);
  });
}

export function canvasPixels(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function pixelsToCanvas({ data, width, height }) {
  const c = makeCanvas(width, height);
  const arr = data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data);
  c.getContext('2d').putImageData(new ImageData(arr, width, height), 0, 0);
  return c;
}

// Imports a photo: shrink to our working size and re-encode as JPEG.
// Re-encoding through canvas also drops EXIF data, so GPS location never ends up in a scan.
export async function prepareOriginal(file) {
  const canvas = await blobToCanvas(file, ORIGINAL_MAX_SIDE);
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
  const out = { blob, width: canvas.width, height: canvas.height, canvas };
  return out;
}

export async function thumbnailFromCanvas(canvas, maxSide = 360, quality = 0.8) {
  const t = drawScaled(canvas, canvas.width, canvas.height, maxSide);
  const blob = await canvasToBlob(t, 'image/jpeg', quality);
  releaseCanvas(t);
  return blob;
}

// Object URLs for showing stored blobs in <img>. Cached per key and freed when replaced.
const urlCache = new Map();
export function blobUrl(key, blob) {
  const old = urlCache.get(key);
  if (old && old.blob === blob) return old.url;
  if (old) URL.revokeObjectURL(old.url);
  const url = URL.createObjectURL(blob);
  urlCache.set(key, { blob, url });
  return url;
}

export function forgetBlobUrl(key) {
  const old = urlCache.get(key);
  if (old) {
    URL.revokeObjectURL(old.url);
    urlCache.delete(key);
  }
}
