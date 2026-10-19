// Web worker: runs the heavy pixel maths off the main thread so the UI never freezes.
// Messages: { id, type, payload } -> replies { id, ok, result | error }.
import { detectPage } from './detect.js';
import { buildLevels, renderPage } from './render.js';

// Decoded photos, kept so that changing a filter does not re-send 30 MB of pixels.
const sources = new Map();
const MAX_SOURCES = 2;

function asImage(p) {
  return { data: new Uint8ClampedArray(p.buffer), width: p.width, height: p.height };
}

self.onmessage = (e) => {
  const { id, type, payload } = e.data;
  try {
    let result = null;
    const transfer = [];
    if (type === 'detect') {
      const found = detectPage(asImage(payload), payload.opts || {});
      result = found ? { corners: found.corners, score: found.score, support: found.support } : null;
    } else if (type === 'setSource') {
      sources.delete(payload.key);
      sources.set(payload.key, buildLevels(asImage(payload)));
      while (sources.size > MAX_SOURCES) sources.delete(sources.keys().next().value);
      result = true;
    } else if (type === 'hasSource') {
      result = sources.has(payload.key);
    } else if (type === 'render') {
      const levels = sources.get(payload.key);
      if (!levels) throw new Error('NO_SOURCE');
      // Touch the entry so it counts as recently used.
      sources.delete(payload.key);
      sources.set(payload.key, levels);
      const img = renderPage(levels, payload.page, payload.maxSide);
      result = { buffer: img.data.buffer, width: img.width, height: img.height };
      transfer.push(img.data.buffer);
    } else if (type === 'dropSource') {
      sources.delete(payload.key);
    } else {
      throw new Error('Unknown message ' + type);
    }
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
