// Geometry helpers for the scan engine.
// Points are [x, y] arrays. A quad is always [topLeft, topRight, bottomRight, bottomLeft]
// in image coordinates (y grows downward).

export function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

// Shoelace formula. Returns the absolute area.
export function polygonArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(s) / 2;
}

// Puts 4 points into TL, TR, BR, BL order.
// Sorting by angle around the centre works even when the page is tilted 45 degrees,
// where the simple "smallest x+y" trick can pick the wrong corner.
export function orderCorners(pts) {
  const cx = (pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]) / 4;
  const cy = (pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]) / 4;
  const sorted = pts
    .map((p) => [p[0], p[1]])
    .sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  // atan2 order with y down is clockwise on screen. Start at the point closest to top left.
  let start = 0;
  for (let i = 1; i < 4; i++) {
    if (sorted[i][0] + sorted[i][1] < sorted[start][0] + sorted[start][1]) start = i;
  }
  return [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]);
}

// True when the quad is convex and not twisted (all turns go the same way).
export function isConvex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-9) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

// Interior angle in degrees at each corner.
export function cornerAngles(q) {
  const out = [];
  for (let i = 0; i < 4; i++) {
    const p = q[(i + 3) % 4], c = q[i], n = q[(i + 1) % 4];
    const ax = p[0] - c[0], ay = p[1] - c[1], bx = n[0] - c[0], by = n[1] - c[1];
    const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
    out.push((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI);
  }
  return out;
}

// Rotating the output by 90 degrees clockwise is the same as shifting the corner list:
// the old bottom-left becomes the new top-left. So rotation costs nothing extra in the warp.
export function rotateCorners(q, quarterTurns) {
  const k = ((quarterTurns % 4) + 4) % 4;
  return [0, 1, 2, 3].map((i) => q[(i + 4 - k) % 4]);
}

// Solves the 8 unknowns of a 3x3 homography that maps src[i] -> dst[i].
// Returns a flat array [h0..h8] with h8 = 1.
export function homography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solveLinear(A, b);
  if (!h) return null;
  return [...h, 1];
}

// Gaussian elimination with partial pivoting.
export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function applyHomography(H, x, y) {
  const z = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / z, (H[3] * x + H[4] * y + H[5]) / z];
}

// Estimates the real width/height ratio of the page.
// Simply measuring edge lengths squashes pages photographed at a steep angle,
// so this uses the method from Zhang and He ("Whiteboard scanning", 2007):
// a rectangle seen through a pinhole camera lets us recover the focal length
// and then the true aspect ratio. Falls back to edge lengths when the maths is unstable.
export function estimateAspect(q, imgW, imgH) {
  const [tl, tr, br, bl] = q;
  const edgeW = Math.max(dist(tl, tr), dist(bl, br));
  const edgeH = Math.max(dist(tl, bl), dist(tr, br));
  const simple = edgeW / edgeH;

  const u0 = imgW / 2, v0 = imgH / 2;
  const m = (p) => [p[0] - u0, p[1] - v0, 1];
  const m1 = m(tl), m2 = m(tr), m3 = m(bl), m4 = m(br);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const c14 = cross(m1, m4);
  const k2 = dot(c14, m3) / dot(cross(m2, m4), m3);
  const k3 = dot(c14, m2) / dot(cross(m3, m4), m2);
  const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]];
  const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];

  // Focal length in pixels. Phone main cameras are about 24 to 26 mm "full frame equivalent",
  // which is roughly 0.72 x the long side of the photo. We use that guess when the corners
  // cannot tell us (for example when the phone is tilted on one axis only, the top and bottom
  // edges stay parallel and the maths below divides by zero).
  const longSide = Math.max(imgW, imgH);
  let f2 = (0.72 * longSide) ** 2;
  const denom = n2[2] * n3[2];
  if (Math.abs(n2[2]) > 1e-3 && Math.abs(n3[2]) > 1e-3) {
    const est = -(n2[0] * n3[0] + n2[1] * n3[1]) / denom;
    // Ignore focal lengths no phone has; they mean the corners are a little noisy.
    if (est > (0.4 * longSide) ** 2 && est < (3 * longSide) ** 2) f2 = est;
  }
  const ratio = Math.sqrt((n2[0] ** 2 / f2 + n2[1] ** 2 / f2 + n2[2] ** 2) / (n3[0] ** 2 / f2 + n3[1] ** 2 / f2 + n3[2] ** 2));
  if (!isFinite(ratio) || ratio <= 0) return simple;
  // Never trust an estimate that disagrees wildly with what we can see.
  if (ratio / simple > 1.6 || simple / ratio > 1.6) return simple;
  return ratio;
}

// Common paper shapes. If the estimate is within 3%, snap to the real ratio
// so a Letter page comes out exactly Letter shaped.
const PAPER_RATIOS = [1 / Math.SQRT2, 8.5 / 11, 1];

export function snapAspect(ratio) {
  for (const r of PAPER_RATIOS) {
    for (const target of [r, 1 / r]) {
      if (Math.abs(ratio / target - 1) < 0.03) return target;
    }
  }
  return ratio;
}

// Output size in pixels for a quad given in source pixels.
// Size comes from the longest edges (so no detail is thrown away),
// shape comes from estimateAspect, and the long side is capped at maxSide.
export function outputSize(q, imgW, imgH, maxSide = 3000) {
  const [tl, tr, br, bl] = q;
  const edgeW = Math.max(dist(tl, tr), dist(bl, br));
  const edgeH = Math.max(dist(tl, bl), dist(tr, br));
  const ratio = snapAspect(estimateAspect(q, imgW, imgH));
  // Keep the larger of the two measured sizes and derive the other from the ratio.
  let w, h;
  if (edgeW / ratio >= edgeH) {
    w = edgeW;
    h = edgeW / ratio;
  } else {
    h = edgeH;
    w = edgeH * ratio;
  }
  const scale = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(8, Math.round(w * scale)), height: Math.max(8, Math.round(h * scale)) };
}

// Clips convex polygon `subject` by convex polygon `clip` (Sutherland-Hodgman).
function clipPolygon(subject, clip) {
  let out = subject;
  const orient = signedArea(clip) > 0 ? 1 : -1;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const inside = (p) => orient * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= 0;
    const inter = (p, q) => {
      const x1 = p[0], y1 = p[1], x2 = q[0], y2 = q[1], x3 = a[0], y3 = a[1], x4 = b[0], y4 = b[1];
      const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
      return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
    };
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      const pin = inside(p), qin = inside(q);
      if (pin) out.push(p);
      if (pin !== qin) out.push(inter(p, q));
    }
  }
  return out;
}

function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

// Intersection over union of two convex quads. Used by the tests to grade detection.
export function quadIoU(a, b) {
  const inter = clipPolygon(a, b);
  const ia = inter.length >= 3 ? polygonArea(inter) : 0;
  const ua = polygonArea(a) + polygonArea(b) - ia;
  return ua > 0 ? ia / ua : 0;
}

export function fullFrameQuad(w, h) {
  return [[0, 0], [w, 0], [w, h], [0, h]];
}

// Corners are stored normalized (0..1) so they do not depend on the decode size.
export function normalizeQuad(q, w, h) {
  return q.map(([x, y]) => [x / w, y / h]);
}

export function denormalizeQuad(q, w, h) {
  return q.map(([x, y]) => [x * w, y * h]);
}
