// The full page pipeline: flatten -> filter -> redact. Pure functions, no browser APIs,
// so it runs the same in the web worker and in Node tests.
import { rotateCorners, outputSize, dist } from './geometry.js';
import { warpPerspective, halfSize } from './warp.js';
import { applyFilter, applyRedactions } from './filters.js';

// A "pyramid" of the photo: full size, half, quarter... Small previews sample from a small
// copy so they stay smooth (sampling a big photo sparsely looks grainy).
export function buildLevels(full, minSide = 400) {
  const levels = [full];
  let last = full;
  while (Math.min(last.width, last.height) / 2 >= minSide) {
    last = halfSize(last);
    levels.push(last);
  }
  return levels;
}

// page: { corners: normalized [[x,y]x4] TL TR BR BL, rotation: quarter turns clockwise,
//         filter, strength, shadows, redactions }
export function renderPage(levels, page, maxSide = 3000) {
  const full = levels[0];
  const quad = page.corners.map(([x, y]) => [x * full.width, y * full.height]);
  const rq = rotateCorners(quad, page.rotation || 0);
  const size = outputSize(rq, full.width, full.height, maxSide);
  // Pick the smallest copy that still has at least as many pixels as the output needs.
  const longest = Math.max(dist(rq[0], rq[1]), dist(rq[1], rq[2]), dist(rq[2], rq[3]), dist(rq[3], rq[0]));
  const need = Math.max(size.width, size.height) / longest;
  let k = 0;
  while (k + 1 < levels.length && levels[k + 1].width / full.width >= need) k++;
  const lvl = levels[k];
  const f = lvl.width / full.width;
  const img = warpPerspective(lvl, rq.map(([x, y]) => [x * f, y * f]), size.width, size.height);
  applyFilter(img, page.filter, page.strength ?? 0.5, page.shadows);
  applyRedactions(img, page.redactions);
  return img;
}
