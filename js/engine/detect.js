// Finds the four corners of a page in a small photo (about 300 to 700 px on the long side).
//
// Two independent ways to find candidates, then one shared judge:
//   A. Edges: Canny edge map -> connected edge groups -> convex hull -> best 4-corner shape.
//   B. Brightness: paper is usually the brightest big area -> Otsu threshold -> same hull step.
// Every candidate is refined by fitting straight lines to the real edge pixels near each side,
// then scored by "edge support": how much of each side actually sits on an edge.
// The convex hull trick means a page outline with gaps (a finger, a shadow) still works.

import { orderCorners, isConvex, polygonArea, cornerAngles } from './geometry.js';

export function toGray(img) {
  const { data, width, height } = img;
  const n = width * height;
  const g = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    g[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
  }
  return g;
}

// 5x5 Gaussian blur done as two 1D passes with weights 1 4 6 4 1.
export function blur5(src, w, h) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = x > 1 ? x - 2 : 0, x1 = x > 0 ? x - 1 : 0;
      const x3 = x < w - 1 ? x + 1 : w - 1, x4 = x < w - 2 ? x + 2 : w - 1;
      tmp[row + x] = (src[row + x0] + 4 * src[row + x1] + 6 * src[row + x] + 4 * src[row + x3] + src[row + x4]) / 16;
    }
  }
  for (let y = 0; y < h; y++) {
    const y0 = (y > 1 ? y - 2 : 0) * w, y1 = (y > 0 ? y - 1 : 0) * w;
    const y3 = (y < h - 1 ? y + 1 : h - 1) * w, y4 = (y < h - 2 ? y + 2 : h - 1) * w;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      out[row + x] = (tmp[y0 + x] + 4 * tmp[y1 + x] + 6 * tmp[row + x] + 4 * tmp[y3 + x] + tmp[y4 + x]) / 16;
    }
  }
  return out;
}

export function sobel(g, w, h) {
  const n = w * h;
  const gx = new Float32Array(n), gy = new Float32Array(n), mag = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = g[i - w - 1], b = g[i - w], c = g[i - w + 1];
      const d = g[i - 1], f = g[i + 1];
      const p = g[i + w - 1], q = g[i + w], r = g[i + w + 1];
      const sx = c + 2 * f + r - a - 2 * d - p;
      const sy = p + 2 * q + r - a - 2 * b - c;
      gx[i] = sx;
      gy[i] = sy;
      mag[i] = Math.sqrt(sx * sx + sy * sy);
    }
  }
  return { gx, gy, mag };
}

function percentile(arr, p) {
  const bins = new Uint32Array(2048);
  let count = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v <= 0) continue;
    bins[Math.min(2047, v | 0)]++;
    count++;
  }
  const target = count * p;
  let acc = 0;
  for (let b = 0; b < 2048; b++) {
    acc += bins[b];
    if (acc >= target) return b;
  }
  return 2047;
}

// Classic Canny: thin the gradient to 1 px ridges (non maximum suppression),
// then keep weak edges only when they touch strong ones (hysteresis).
export function canny(gx, gy, mag, w, h, lo, hi) {
  const n = w * h;
  const nms = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i];
      if (m < lo) continue;
      const ax = Math.abs(gx[i]), ay = Math.abs(gy[i]);
      let m1, m2;
      if (ay <= ax * 0.4142) {
        m1 = mag[i - 1]; m2 = mag[i + 1];
      } else if (ay >= ax * 2.4142) {
        m1 = mag[i - w]; m2 = mag[i + w];
      } else if (gx[i] * gy[i] > 0) {
        m1 = mag[i - w - 1]; m2 = mag[i + w + 1];
      } else {
        m1 = mag[i - w + 1]; m2 = mag[i + w - 1];
      }
      if (m > m1 && m >= m2) nms[i] = m;
    }
  }
  const edges = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  for (let i = 0; i < n; i++) {
    if (nms[i] >= hi && !edges[i]) {
      edges[i] = 1;
      stack[sp++] = i;
      while (sp) {
        const k = stack[--sp];
        const ky = (k / w) | 0, kx = k - ky * w;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = ky + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = kx + dx;
            if (xx < 0 || xx >= w) continue;
            const j = yy * w + xx;
            if (!edges[j] && nms[j] >= lo) {
              edges[j] = 1;
              stack[sp++] = j;
            }
          }
        }
      }
    }
  }
  return edges;
}

function dilate(mask, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w) out[yy * w + xx] = 1;
        }
      }
    }
  }
  return out;
}

function erode(mask, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (mask[i] && mask[i - 1] && mask[i + 1] && mask[i - w] && mask[i + w]) out[i] = 1;
    }
  }
  return out;
}

// Otsu's method: picks the threshold that best splits the histogram into two groups.
function otsu(g) {
  const hist = new Float64Array(256);
  for (let i = 0; i < g.length; i++) hist[Math.max(0, Math.min(255, g[i] | 0))]++;
  const total = g.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, bestT = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      bestT = t;
    }
  }
  return bestT;
}

// Labels 8-connected groups of set pixels. Returns per-group stats.
function components(mask, w, h, minCount) {
  const n = w * h;
  const labels = new Int32Array(n);
  const stack = new Int32Array(n);
  const stats = [];
  let next = 1;
  for (let s = 0; s < n; s++) {
    if (!mask[s] || labels[s]) continue;
    const label = next++;
    let count = 0, minX = w, maxX = 0, minY = h, maxY = 0;
    let sp = 0;
    stack[sp++] = s;
    labels[s] = label;
    while (sp) {
      const k = stack[--sp];
      const ky = (k / w) | 0, kx = k - ky * w;
      count++;
      if (kx < minX) minX = kx;
      if (kx > maxX) maxX = kx;
      if (ky < minY) minY = ky;
      if (ky > maxY) maxY = ky;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = ky + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = kx + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (mask[j] && !labels[j]) {
            labels[j] = label;
            stack[sp++] = j;
          }
        }
      }
    }
    if (count >= minCount) stats.push({ label, count, minX, maxX, minY, maxY, bboxArea: (maxX - minX + 1) * (maxY - minY + 1) });
  }
  return { labels, stats };
}

// For hull building we only need the leftmost and rightmost pixel of each row of a group.
function extremePoints(labels, w, h, wanted) {
  const slot = new Map();
  wanted.forEach((s, i) => slot.set(s.label, i));
  const k = wanted.length;
  const rowMin = new Int32Array(k * h).fill(-1);
  const rowMax = new Int32Array(k * h).fill(-1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const l = labels[row + x];
      if (!l) continue;
      const si = slot.get(l);
      if (si === undefined) continue;
      const idx = si * h + y;
      if (rowMin[idx] < 0) rowMin[idx] = x;
      rowMax[idx] = x;
    }
  }
  const out = [];
  for (let si = 0; si < k; si++) {
    const pts = [];
    for (let y = 0; y < h; y++) {
      const idx = si * h + y;
      if (rowMin[idx] < 0) continue;
      pts.push([rowMin[idx], y]);
      if (rowMax[idx] !== rowMin[idx]) pts.push([rowMax[idx], y]);
    }
    out.push(pts);
  }
  return out;
}

// Andrew's monotone chain. Returns hull points in order.
export function convexHull(points) {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

// Visvalingam simplification: keep removing the vertex that adds the least area
// until only `maxPts` remain. Corners of a page add a lot of area, so they survive.
function simplify(poly, maxPts) {
  const pts = poly.slice();
  const tri = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  while (pts.length > maxPts) {
    let minA = Infinity, minI = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = tri(pts[(i + pts.length - 1) % pts.length], pts[i], pts[(i + 1) % pts.length]);
      if (a < minA) {
        minA = a;
        minI = i;
      }
    }
    pts.splice(minI, 1);
  }
  return pts;
}

// Largest-area quadrilateral using 4 of the hull's (few) vertices.
function maxAreaQuad(poly) {
  const n = poly.length;
  if (n < 4) return null;
  if (n === 4) return poly.slice();
  let best = null, bestA = -1;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++) {
          const q = [poly[a], poly[b], poly[c], poly[d]];
          const ar = polygonArea(q);
          if (ar > bestA) {
            bestA = ar;
            best = q;
          }
        }
  return best;
}

function quadFromPoints(points) {
  const hull = convexHull(points);
  if (hull.length < 4) return null;
  const q = maxAreaQuad(simplify(hull, 10));
  return q ? orderCorners(q) : null;
}

// Walks along each side and checks, a few pixels either way, for an edge pixel
// whose gradient points across the side. Returns the fraction of each side that is supported.
function edgeSupport(q, edges, gx, gy, w, h, reach, maxSteps = Infinity) {
  const sides = [];
  for (let s = 0; s < 4; s++) {
    const a = q[s], b = q[(s + 1) % 4];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 4) return { mean: 0, min: 0, sides: [0, 0, 0, 0] };
    const dx = (b[0] - a[0]) / len, dy = (b[1] - a[1]) / len;
    const nx = -dy, ny = dx;
    const steps = Math.min(maxSteps, Math.max(8, Math.floor(len / 2)));
    let hits = 0, total = 0;
    for (let k = 0; k <= steps; k++) {
      const t = 0.03 + (0.94 * k) / steps;
      const px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t;
      if (px < 1 || py < 1 || px > w - 2 || py > h - 2) {
        total++;
        continue;
      }
      total++;
      for (let r = 0; r <= reach; r++) {
        let found = false;
        for (const sgn of r ? [1, -1] : [1]) {
          const x = Math.round(px + nx * r * sgn), y = Math.round(py + ny * r * sgn);
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const i = y * w + x;
          if (!edges[i]) continue;
          const gxv = gx[i], gyv = gy[i];
          const gm = Math.hypot(gxv, gyv);
          if (gm && Math.abs(gxv * nx + gyv * ny) / gm > 0.8) {
            found = true;
            break;
          }
        }
        if (found) {
          hits++;
          break;
        }
      }
    }
    sides.push(total ? hits / total : 0);
  }
  return { mean: (sides[0] + sides[1] + sides[2] + sides[3]) / 4, min: Math.min(...sides), sides };
}

// A page edge stops at the corner. A line in the background (table edge, stripe, floor tile)
// keeps going. This measures how much edge support continues past the corners, from 0 to 1.
function extensionSupport(q, edges, gx, gy, w, h, reach) {
  let sum = 0;
  for (let s = 0; s < 4; s++) {
    const a = q[s], b = q[(s + 1) % 4];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dx = (b[0] - a[0]) / len, dy = (b[1] - a[1]) / len;
    const nx = -dy, ny = dx;
    let hits = 0, total = 0;
    for (const [start, sign] of [[b, 1], [a, -1]]) {
      for (let k = 3; k <= len * 0.2; k += 2) {
        const px = start[0] + dx * k * sign, py = start[1] + dy * k * sign;
        if (px < 1 || py < 1 || px > w - 2 || py > h - 2) break;
        total++;
        for (let r = -reach; r <= reach; r++) {
          const x = Math.round(px + nx * r), y = Math.round(py + ny * r);
          const i = y * w + x;
          if (!edges[i]) continue;
          const gm = Math.hypot(gx[i], gy[i]);
          if (gm && Math.abs(gx[i] * nx + gy[i] * ny) / gm > 0.8) {
            hits++;
            break;
          }
        }
      }
    }
    sum += total >= 4 ? hits / total : 0;
  }
  return sum / 4;
}

// Moves each side onto the real edge: collect nearby edge pixels that point the right way,
// fit a straight line through them, then intersect neighbouring lines to get sharp corners.
function refineQuad(q, edges, gx, gy, w, h) {
  const diag = Math.hypot(w, h);
  const band = Math.max(3, Math.round(diag * 0.02));
  const lines = [];
  for (let s = 0; s < 4; s++) {
    const a = q[s], b = q[(s + 1) % 4];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dx = (b[0] - a[0]) / len, dy = (b[1] - a[1]) / len;
    const nx = -dy, ny = dx;
    const steps = Math.max(10, Math.floor(len));
    let pts = [];
    for (let k = 0; k <= steps; k++) {
      const t = 0.08 + (0.84 * k) / steps;
      const px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t;
      let best = null, bestD = Infinity;
      for (let r = -band; r <= band; r++) {
        const x = Math.round(px + nx * r), y = Math.round(py + ny * r);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = y * w + x;
        if (!edges[i]) continue;
        const gm = Math.hypot(gx[i], gy[i]);
        if (!gm || Math.abs(gx[i] * nx + gy[i] * ny) / gm < 0.85) continue;
        if (Math.abs(r) < bestD) {
          bestD = Math.abs(r);
          best = [x, y];
        }
      }
      if (best) pts.push(best);
    }
    if (pts.length < Math.max(6, steps * 0.3)) {
      lines.push({ px: a[0], py: a[1], dx, dy });
      continue;
    }
    let line = fitLine(pts);
    // One round of outlier rejection makes the fit robust to stray text edges.
    const kept = pts.filter(([x, y]) => Math.abs((x - line.px) * -line.dy + (y - line.py) * line.dx) < 1.5);
    if (kept.length >= 6) line = fitLine(kept);
    // Keep the original direction sign so intersections stay in order.
    if (line.dx * dx + line.dy * dy < 0) {
      line.dx = -line.dx;
      line.dy = -line.dy;
    }
    lines.push(line);
  }
  const out = [];
  for (let s = 0; s < 4; s++) {
    const p = intersect(lines[(s + 3) % 4], lines[s]);
    if (!p) return null;
    out.push(p);
  }
  return out;
}

// Total least squares line fit: the line through the centroid along the main direction.
function fitLine(pts) {
  let mx = 0, my = 0;
  for (const [x, y] of pts) {
    mx += x;
    my += y;
  }
  mx /= pts.length;
  my /= pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) {
    const ux = x - mx, uy = y - my;
    sxx += ux * ux;
    syy += uy * uy;
    sxy += ux * uy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { px: mx, py: my, dx: Math.cos(angle), dy: Math.sin(angle) };
}

function intersect(l1, l2) {
  const d = l1.dx * l2.dy - l1.dy * l2.dx;
  if (Math.abs(d) < 1e-6) return null;
  const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / d;
  return [l1.px + l1.dx * t, l1.py + l1.dy * t];
}

// Hough transform: every edge pixel votes for the lines that could pass through it.
// Using the gradient direction, each pixel only votes for nearly one angle, which is fast and clean.
// Returns the strongest straight lines, a few per direction so that one busy direction
// (for example a striped tablecloth) cannot crowd out the page's other sides.
function houghLines(edges, gx, gy, w, h) {
  const diag = Math.ceil(Math.hypot(w, h));
  const nT = 180, nR = 2 * diag + 1;
  const acc = new Uint16Array(nT * nR);
  const cos = new Float32Array(nT), sin = new Float32Array(nT);
  for (let t = 0; t < nT; t++) {
    cos[t] = Math.cos((t * Math.PI) / nT);
    sin[t] = Math.sin((t * Math.PI) / nT);
  }
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!edges[i]) continue;
      let phi = Math.atan2(gy[i], gx[i]);
      if (phi < 0) phi += Math.PI;
      const tc = Math.round((phi / Math.PI) * nT);
      for (let dt = -2; dt <= 2; dt++) {
        const t = (tc + dt + nT) % nT;
        const r = Math.round(x * cos[t] + y * sin[t]) + diag;
        acc[t * nR + r]++;
      }
    }
  }
  const minVotes = Math.max(15, Math.min(w, h) * 0.12);
  const peaks = [];
  for (let t = 0; t < nT; t++) {
    for (let r = 1; r < nR - 1; r++) {
      const v = acc[t * nR + r];
      if (v < minVotes) continue;
      let isMax = true;
      for (let dt = -2; dt <= 2 && isMax; dt++) {
        const tt = (t + dt + nT) % nT;
        for (let dr = -3; dr <= 3; dr++) {
          if (!dt && !dr) continue;
          const rr = r + dr;
          if (rr < 0 || rr >= nR) continue;
          const u = acc[tt * nR + rr];
          if (u > v || (u === v && (dt < 0 || (dt === 0 && dr < 0)))) {
            isMax = false;
            break;
          }
        }
      }
      if (isMax) peaks.push({ t, r: r - diag, v });
    }
  }
  peaks.sort((a, b) => b.v - a.v);
  const chosen = [];
  const perBucket = new Map();
  for (const p of peaks) {
    if (chosen.length >= 40) break;
    const bucket = Math.floor(p.t / 15);
    if ((perBucket.get(bucket) || 0) >= 6) continue;
    const near = chosen.some((c) => {
      let dt = Math.abs(c.t - p.t);
      let dr = Math.abs(c.r - p.r);
      if (dt > nT / 2) {
        dt = nT - dt;
        dr = Math.abs(c.r + p.r);
      }
      return dt < 4 && dr < 8;
    });
    if (near) continue;
    chosen.push(p);
    perBucket.set(bucket, (perBucket.get(bucket) || 0) + 1);
  }
  // Line as point + direction, like fitLine returns.
  return chosen.map((p) => {
    const th = (p.t * Math.PI) / nT;
    const c = Math.cos(th), s = Math.sin(th);
    return { px: p.r * c, py: p.r * s, dx: -s, dy: c, theta: th, rho: p.r, votes: p.v };
  });
}

// Builds quads from two roughly parallel pairs of lines that cross each other.
function houghQuads(lines, w, h, minArea) {
  const minSep = 0.15 * Math.min(w, h);
  const pairs = [];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i], b = lines[j];
      const c = a.dx * b.dx + a.dy * b.dy;
      if (Math.abs(c) < Math.cos((25 * Math.PI) / 180)) continue;
      // Distance between the two lines, measured at the midpoint of a's visible part.
      const mx = w / 2, my = h / 2;
      const da = (mx - a.px) * -a.dy + (my - a.py) * a.dx;
      const db = (mx - b.px) * -b.dy + (my - b.py) * b.dx;
      const sep = Math.abs(da - Math.sign(c) * db);
      if (sep < minSep) continue;
      pairs.push([a, b]);
    }
  }
  const quads = [];
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const [a1, a2] = pairs[i], [b1, b2] = pairs[j];
      const cross = Math.abs(a1.dx * b1.dy - a1.dy * b1.dx);
      if (cross < Math.sin((40 * Math.PI) / 180)) continue;
      const pts = [intersect(a1, b1), intersect(a1, b2), intersect(a2, b2), intersect(a2, b1)];
      if (pts.some((p) => !p)) continue;
      const q = orderCorners(pts);
      if (!plausible(q, w, h, minArea)) continue;
      quads.push(q);
    }
  }
  return quads;
}

// Paper is nearly always brighter than what it lies on. Counts the sides where
// the inside of the quad is brighter than the outside, and turns that into a soft factor.
function brightnessFactor(q, g, w, h) {
  const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4;
  const cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
  const off = Math.max(2, Math.round(Math.hypot(w, h) / 200));
  let good = 0;
  for (let s = 0; s < 4; s++) {
    const a = q[s], b = q[(s + 1) % 4];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if ((cx - mx) * nx + (cy - my) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    let inside = 0, outside = 0, n = 0;
    for (let k = 1; k < 12; k++) {
      const t = k / 12;
      const px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t;
      const ix = Math.round(px + nx * off), iy = Math.round(py + ny * off);
      const ox = Math.round(px - nx * off), oy = Math.round(py - ny * off);
      if (ox < 0 || oy < 0 || ox >= w || oy >= h || ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
      inside += g[iy * w + ix];
      outside += g[oy * w + ox];
      n++;
    }
    if (n && inside > outside + 2 * n) good++;
  }
  return good >= 3 ? 1 : good === 2 ? 0.85 : 0.6;
}

function plausible(q, w, h, minArea) {
  if (!q || !isConvex(q)) return false;
  const margin = 0.03 * Math.max(w, h);
  for (const [x, y] of q) {
    if (x < -margin || y < -margin || x > w + margin || y > h + margin) return false;
  }
  const ar = polygonArea(q) / (w * h);
  if (ar < minArea || ar > 1.02) return false;
  const ang = cornerAngles(q);
  return ang.every((a) => a > 35 && a < 145);
}

// Paper-coloured regions do not depend on the edge threshold, so they are found once.
function brightQuads(g, w, h, minArea) {
  const g8 = new Uint8Array(w * h);
  for (let i = 0; i < g8.length; i++) g8[i] = g[i];
  const t = otsu(g8);
  let mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = g8[i] > t ? 1 : 0;
  // Opening (erode then dilate) cuts thin bridges to other bright things.
  mask = dilate(dilate(erode(erode(mask, w, h), w, h), w, h), w, h);
  const comps = components(mask, w, h, minArea * w * h * 0.5);
  const big = comps.stats.sort((a, b) => b.count - a.count).slice(0, 3);
  const out = [];
  for (const pts of extremePoints(comps.labels, w, h, big)) {
    const q = quadFromPoints(pts);
    if (q) out.push({ q, method: 'bright' });
  }
  return out;
}

function runPass(ctx, lo, hi) {
  const { g, gx, gy, mag, w, h, minArea, reach } = ctx;
  const edges = canny(gx, gy, mag, w, h, lo, hi);
  const raw = ctx.bright.slice();

  // A. Connected groups of edge pixels.
  const dil = dilate(edges, w, h);
  const comps = components(dil, w, h, (w + h) * 0.3);
  const big = comps.stats
    .filter((s) => s.bboxArea >= minArea * w * h)
    .sort((a, b) => b.bboxArea - a.bboxArea)
    .slice(0, 6);
  for (const pts of extremePoints(comps.labels, w, h, big)) {
    const q = quadFromPoints(pts);
    if (q) raw.push({ q, method: 'edges' });
  }

  // C. Straight lines. Quick score with a few samples per side, keep the best few.
  const hq = houghQuads(houghLines(edges, gx, gy, w, h), w, h, minArea)
    .map((q) => ({ q, rough: edgeSupport(q, edges, gx, gy, w, h, reach, 12).mean * Math.pow(polygonArea(q) / (w * h), 0.3) }))
    .sort((a, b) => b.rough - a.rough)
    .slice(0, 8);
  for (const c of hq) raw.push({ q: c.q, method: 'lines' });

  let best = null;
  const tried = [];
  for (const c of raw) {
    const options = [c.q];
    const refined = refineQuad(c.q, edges, gx, gy, w, h);
    if (refined) options.push(orderCorners(refined));
    for (const q of options) {
      if (!plausible(q, w, h, minArea)) continue;
      const sup = edgeSupport(q, edges, gx, gy, w, h, reach);
      const areaRatio = polygonArea(q) / (w * h);
      const ext = extensionSupport(q, edges, gx, gy, w, h, reach);
      const score = sup.mean * Math.pow(areaRatio, 0.3) * brightnessFactor(q, g, w, h) * (1 - 0.6 * ext);
      tried.push({ q, score, sup, method: c.method });
      // Accept when every side has some support, or when three sides are strong and the
      // fourth is merely faint (one edge in shadow or against a similar colour).
      const top3 = (sup.sides[0] + sup.sides[1] + sup.sides[2] + sup.sides[3] - sup.min) / 3;
      const ok = (sup.min >= 0.25 && sup.mean >= 0.5) || (sup.min >= 0.1 && top3 >= 0.8);
      if (!ok) continue;
      if (!best || score > best.score) best = { corners: q, score, support: sup.mean, ext, method: c.method };
    }
  }
  return { best, tried, edges, threshold: { lo, hi } };
}

export function detectPage(img, opts = {}) {
  const { width: w, height: h } = img;
  const minArea = opts.minArea ?? 0.12;
  const g = blur5(toGray(img), w, h);
  const { gx, gy, mag } = sobel(g, w, h);
  const reach = Math.max(2, Math.round(Math.hypot(w, h) / 300));
  const ctx = { g, gx, gy, mag, w, h, minArea, reach, bright: brightQuads(g, w, h, minArea) };

  // Pass 1 uses a threshold from this photo's own gradients, so dark and bright rooms both work.
  const hi1 = Math.min(300, Math.max(28, percentile(mag, 0.9)));
  let res = opts.forceSecondPass ? { best: null, tried: [] } : runPass(ctx, hi1 * 0.45, hi1);
  // Pass 2 is more sensitive, for faint outlines like white paper on a white desk.
  // It also runs when the winner's sides run on past its corners, a sign of a background line.
  if (!res.best || res.best.support < 0.75 || res.best.ext > 0.25) {
    const hi2 = Math.max(12, hi1 * 0.4);
    const res2 = runPass(ctx, hi2 * 0.45, hi2);
    if (opts.forceSecondPass || (res2.best && (!res.best || res2.best.score * 0.95 > res.best.score))) {
      if (res2.best) res2.best.score *= 0.95;
      res = { ...res2, tried: res.tried.concat(res2.tried) };
    }
  }
  if (opts.debug) return res;
  return res.best;
}
