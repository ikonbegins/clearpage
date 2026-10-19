// Enhancement filters. They work on RGBA pixel data in place.
//
// The key trick for paper is "divide by the background": we estimate what the empty paper
// would look like at every spot (including shadows and uneven light), then divide the photo
// by it. Paper becomes even white, ink keeps its darkness. Everything else builds on that.

export const FILTERS = [
  { id: 'original', name: 'Original', hint: 'Crop and flatten only' },
  { id: 'auto', name: 'Auto', hint: 'Even light, more contrast, keeps colour' },
  { id: 'clean', name: 'Clean', hint: 'White paper, dark ink. Best for homework' },
  { id: 'gray', name: 'Grayscale', hint: 'No colour, keeps shading' },
  { id: 'bw', name: 'B&W', hint: 'Pure black text on white' },
  { id: 'boost', name: 'Color boost', hint: 'Whiteboards and slides' },
  { id: 'inksaver', name: 'Ink saver', hint: 'Lighter text for home printing' },
];

export const DEFAULT_SHADOWS = { original: false, auto: true, clean: true, gray: true, bw: true, boost: true, inksaver: true };

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------- background estimation ----------

// Works on one channel of an interleaved array (stride 4 for RGBA, 1 for gray).
// 1. Shrink by taking the brightest pixel of each block: ink is dark, so the block max is paper.
// 2. A "closing" on the small image (grow bright areas, then shrink them back) removes bigger
//    dark things like bold marker, but puts the edge of a shadow back where it really is.
// 3. A light blur gives a smooth lighting map.
function estimateBackground(arr, stride, offset, w, h) {
  const block = Math.max(2, Math.round(Math.max(w, h) / 200));
  const sw = Math.ceil(w / block), sh = Math.ceil(h / block);
  let small = new Float32Array(sw * sh);
  const bxOf = new Int32Array(w);
  for (let x = 0; x < w; x++) bxOf[x] = (x / block) | 0;
  for (let y = 0; y < h; y++) {
    const rowBase = ((y / block) | 0) * sw;
    let i = (y * w) * stride + offset;
    for (let x = 0; x < w; x++, i += stride) {
      const v = arr[i];
      const k = rowBase + bxOf[x];
      if (v > small[k]) small[k] = v;
    }
  }
  small = minFilter(maxFilter(small, sw, sh, 2), sw, sh, 2);
  small = boxBlur(boxBlur(small, sw, sh, 1), sw, sh, 1);
  // Never brighten a spot more than about 2x. Big genuinely dark areas (a photo printed
  // on the page, the desk at the border) should stay dark, not turn grey-white.
  const sorted = Float32Array.from(small).sort();
  const paper = sorted[Math.floor(sorted.length * 0.9)] || 255;
  const floor = paper * 0.45;
  for (let i = 0; i < small.length; i++) if (small[i] < floor) small[i] = floor;
  return { small, sw, sh, block, paper };
}

function maxFilter(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) if (src[y * w + k] > m) m = src[y * w + k];
      tmp[y * w + x] = m;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) if (tmp[k * w + x] > m) m = tmp[k * w + x];
      out[y * w + x] = m;
    }
  }
  return out;
}

function minFilter(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 255;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) if (src[y * w + k] < m) m = src[y * w + k];
      tmp[y * w + x] = m;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 255;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) if (tmp[k * w + x] < m) m = tmp[k * w + x];
      out[y * w + x] = m;
    }
  }
  return out;
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++, n++) s += src[y * w + k];
      tmp[y * w + x] = s / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++, n++) s += tmp[k * w + x];
      out[y * w + x] = s / n;
    }
  }
  return out;
}

// Precomputed bilinear lookups so the full-size loop stays cheap.
function upsampler(bg, w) {
  const { sw, sh, block } = bg;
  const x0 = new Int32Array(w), x1 = new Int32Array(w), fx = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let p = (x + 0.5) / block - 0.5;
    if (p < 0) p = 0;
    if (p > sw - 1) p = sw - 1;
    x0[x] = p | 0;
    x1[x] = Math.min(sw - 1, x0[x] + 1);
    fx[x] = p - x0[x];
  }
  const row = (y) => {
    let p = (y + 0.5) / block - 0.5;
    if (p < 0) p = 0;
    if (p > sh - 1) p = sh - 1;
    const y0 = p | 0;
    return { r0: y0 * sw, r1: Math.min(sh - 1, y0 + 1) * sw, fy: p - y0 };
  };
  return { x0, x1, fx, row };
}

// Divides each colour channel by its own background. This also removes the yellow or
// blue tint of room lights, because each channel's paper level becomes 255.
export function normalizeColor(img) {
  const { data: d, width: w, height: h } = img;
  const bgs = [0, 1, 2].map((c) => estimateBackground(d, 4, c, w, h));
  const up = upsampler(bgs[0], w);
  for (let y = 0; y < h; y++) {
    const { r0, r1, fy } = up.row(y);
    let i = y * w * 4;
    for (let x = 0; x < w; x++, i += 4) {
      const a = r0 + up.x0[x], b = r0 + up.x1[x], c = r1 + up.x0[x], e = r1 + up.x1[x];
      const fx = up.fx[x];
      const w00 = (1 - fx) * (1 - fy), w01 = fx * (1 - fy), w10 = (1 - fx) * fy, w11 = fx * fy;
      for (let ch = 0; ch < 3; ch++) {
        const s = bgs[ch].small;
        const bgv = s[a] * w00 + s[b] * w01 + s[c] * w10 + s[e] * w11;
        d[i + ch] = (d[i + ch] * 255) / (bgv || 1);
      }
    }
  }
}

function normalizeGray(L, w, h) {
  const bg = estimateBackground(L, 1, 0, w, h);
  const up = upsampler(bg, w);
  const s = bg.small;
  for (let y = 0; y < h; y++) {
    const { r0, r1, fy } = up.row(y);
    let i = y * w;
    for (let x = 0; x < w; x++, i++) {
      const fx = up.fx[x];
      const bgv = s[r0 + up.x0[x]] * (1 - fx) * (1 - fy) + s[r0 + up.x1[x]] * fx * (1 - fy) +
        s[r1 + up.x0[x]] * (1 - fx) * fy + s[r1 + up.x1[x]] * fx * fy;
      const v = (L[i] * 255) / (bgv || 1);
      L[i] = v > 255 ? 255 : v;
    }
  }
}

// ---------- helpers ----------

function luminance(img) {
  const { data: d, width: w, height: h } = img;
  const L = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < L.length; i++, j += 4) L[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
  return L;
}

function histogram(L) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < L.length; i++) hist[L[i]]++;
  return hist;
}

function pct(hist, total, p) {
  const target = total * p;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= target) return v;
  }
  return 255;
}

// Unsharp mask with a 3x3 blur: adds back a bit of the difference between the image and
// its blurred copy, which makes pen and pencil strokes crisper.
function sharpenGray(L, w, h, amount) {
  if (amount <= 0) return;
  const tmp = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) {
      tmp[r + x] = L[r + (x > 0 ? x - 1 : x)] + L[r + x] + L[r + (x < w - 1 ? x + 1 : x)];
    }
  }
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : y) * w, mid = y * w, dn = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) {
      const blur = (tmp[up + x] + tmp[mid + x] + tmp[dn + x]) / 9;
      const v = L[mid + x] + amount * (L[mid + x] - blur);
      L[mid + x] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
}

// 3x3 box blur of a gray image into a new array.
function blurGray(L, w, h) {
  const tmp = new Uint16Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) tmp[r + x] = L[r + (x > 0 ? x - 1 : x)] + L[r + x] + L[r + (x < w - 1 ? x + 1 : x)];
  }
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : y) * w, mid = y * w, dn = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) out[mid + x] = (tmp[up + x] + tmp[mid + x] + tmp[dn + x] + 4) / 9;
  }
  return out;
}

function writeGray(img, L, lut) {
  const d = img.data;
  for (let i = 0, j = 0; i < L.length; i++, j += 4) {
    const v = lut ? lut[L[i]] : L[i];
    d[j] = d[j + 1] = d[j + 2] = v;
    d[j + 3] = 255;
  }
}

// Builds a 256 entry lookup table: stretch [black, white] to [0, 255], then a gamma curve.
// Gamma above 1 darkens the middle tones, which makes light pencil readable.
function levelsLut(black, white, gamma) {
  const lut = new Uint8ClampedArray(256);
  const span = Math.max(1, white - black);
  for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(clamp01((v - black) / span), gamma);
  return lut;
}

// ---------- the filters ----------

function colorEnhance(img, s, shadows, o) {
  if (shadows) normalizeColor(img);
  const L = luminance(img);
  const hist = histogram(L);
  const paper = pct(hist, L.length, 0.92);
  const black = pct(hist, L.length, 0.005) * 0.9;
  const white = Math.max(black + 40, paper * (o.white - 0.03 * s));
  const lut = levelsLut(black, white, 1 + o.gamma * s);
  const sat = o.sat + o.satGain * s;
  const d = img.data;
  for (let j = 0; j < d.length; j += 4) {
    const r = lut[d[j]], g = lut[d[j + 1]], b = lut[d[j + 2]];
    const l = (r * 77 + g * 150 + b * 29) >> 8;
    d[j] = l + (r - l) * sat;
    d[j + 1] = l + (g - l) * sat;
    d[j + 2] = l + (b - l) * sat;
  }
  return img;
}

function grayEnhance(img, s, shadows, mode) {
  const { width: w, height: h } = img;
  const L = luminance(img);
  if (shadows) normalizeGray(L, w, h);
  const hist = histogram(L);
  const paper = pct(hist, L.length, 0.9);
  const ink = pct(hist, L.length, 0.005);
  let white, gamma, sharpen;
  if (mode === 'clean') {
    white = paper * (0.93 - 0.07 * s);
    gamma = 1 + 1.0 * s;
    sharpen = 0.4 + 0.6 * s;
  } else if (mode === 'inksaver') {
    white = paper * 0.88;
    gamma = 1;
    sharpen = 0.3;
  } else {
    white = paper * 0.98;
    gamma = 1 + 0.4 * s;
    sharpen = 0.25 + 0.25 * s;
  }
  const black = Math.min(ink, white - 60);
  sharpenGray(L, w, h, sharpen);
  const lut = levelsLut(black, white, gamma);
  if (mode === 'inksaver') {
    // Keep text readable but print it as dark grey instead of solid black.
    const keep = 0.75 - 0.3 * s;
    for (let v = 0; v < 256; v++) lut[v] = 255 - (255 - lut[v]) * keep;
  }
  writeGray(img, L, lut);
  return img;
}

// Black and white with an adaptive threshold: a pixel is ink when it is clearly darker
// than its neighbourhood (window about 1/50 of the page), or simply very dark.
// The 10-level soft ramp keeps letter edges smooth instead of jagged.
function blackWhite(img, s, shadows) {
  const { width: w, height: h } = img;
  const raw = luminance(img);
  if (shadows) normalizeGray(raw, w, h);
  const paper = pct(histogram(raw), raw.length, 0.9);
  // Smooth a little first, so camera noise on the paper does not turn into black speckles.
  const L = blurGray(raw, w, h);
  // Measure the noise that is left on the paper and keep the threshold above it.
  let dev = 0, n = 0;
  for (let i = 0; i < L.length; i += 7) {
    if (L[i] > paper * 0.8) {
      dev += Math.abs(raw[i] - L[i]);
      n++;
    }
  }
  const noise = n ? (1.25 * dev) / n / 3 : 0;
  const r = Math.max(4, Math.round(Math.max(w, h) / 100));
  const W1 = w + 1;
  const sum = new Uint32Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += L[y * w + x];
      sum[(y + 1) * W1 + x + 1] = sum[y * W1 + x + 1] + row;
    }
  }
  const C = Math.max(255 * (0.1 - 0.07 * s), 4 * noise);
  const dark = paper * 0.55;
  const sure = paper * 0.95;
  // ink[i] is 0 (paper) to 255 (ink); the reuse of `raw` saves a big allocation.
  const ink = raw;
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r), xb = Math.min(w, x + r + 1);
      const area = (yb - ya) * (xb - xa);
      const total = sum[yb * W1 + xb] - sum[ya * W1 + xb] - sum[yb * W1 + xa] + sum[ya * W1 + xa];
      const v = L[y * w + x];
      let p = 0;
      if (v < sure) {
        const pa = 0.5 - (v - (total / area - C)) / 10;
        const pg = 0.5 - (v - dark) / 10;
        p = clamp01(pa > pg ? pa : pg);
      }
      ink[y * w + x] = 255 * p;
    }
  }
  // Despeckle: a dark dot with at most one dark neighbour is noise, not writing.
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (ink[i] < 128) continue;
      let nb = 0;
      if (ink[i - w - 1] >= 128) nb++;
      if (ink[i - w] >= 128) nb++;
      if (ink[i - w + 1] >= 128) nb++;
      if (ink[i - 1] >= 128) nb++;
      if (ink[i + 1] >= 128) nb++;
      if (ink[i + w - 1] >= 128) nb++;
      if (ink[i + w] >= 128) nb++;
      if (ink[i + w + 1] >= 128) nb++;
      if (nb <= 1) ink[i] = 0;
    }
  }
  const d = img.data;
  for (let i = 0, o = 0; i < ink.length; i++, o += 4) {
    d[o] = d[o + 1] = d[o + 2] = 255 - ink[i];
    d[o + 3] = 255;
  }
  return img;
}

export function applyFilter(img, filter = 'auto', strength = 0.5, shadows) {
  if (shadows === undefined || shadows === null) shadows = DEFAULT_SHADOWS[filter] ?? true;
  const s = clamp01(strength);
  switch (filter) {
    case 'original':
      if (shadows) normalizeColor(img);
      return img;
    case 'auto':
      return colorEnhance(img, s, shadows, { white: 0.96, gamma: 0.6, sat: 1.05, satGain: 0.3 });
    case 'boost':
      return colorEnhance(img, s, shadows, { white: 0.93, gamma: 0.9, sat: 1.35, satGain: 0.7 });
    case 'clean':
    case 'gray':
    case 'inksaver':
      return grayEnhance(img, s, shadows, filter);
    case 'bw':
      return blackWhite(img, s, shadows);
    default:
      return img;
  }
}

// Burns black boxes into the pixels. Boxes are [x, y, w, h] as fractions of the page.
// Because the pixels themselves change, nothing under a box can be recovered from the file.
export function applyRedactions(img, boxes) {
  if (!boxes || !boxes.length) return img;
  const { data: d, width: w, height: h } = img;
  for (const [bx, by, bw, bh] of boxes) {
    const x0 = Math.max(0, Math.floor(bx * w)), x1 = Math.min(w, Math.ceil((bx + bw) * w));
    const y0 = Math.max(0, Math.floor(by * h)), y1 = Math.min(h, Math.ceil((by + bh) * h));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = (y * w + x) * 4;
        d[o] = d[o + 1] = d[o + 2] = 0;
        d[o + 3] = 255;
      }
    }
  }
  return img;
}
