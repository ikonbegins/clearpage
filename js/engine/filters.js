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
// 1. Shrink to small blocks, keeping a high-ish percentile of each block. (The brightest
//    pixel would be easier, but in a grainy shadow the brightest pixel is a grain spike,
//    which made shadowed paper come out grey.)
// 2. A "closing" on the small image (grow bright areas, then shrink them back) replaces
//    blocks full of ink by their paper neighbours, but puts the edge of a shadow back
//    where it really is.
// 3. A light blur gives a smooth lighting map.
// The map is fine (about 1/320 of the page) so the edge of a hard shadow lands in the right
// place instead of leaving a grey line along it.
const BG_PERCENTILE = 0.6;
function estimateBackground(arr, stride, offset, w, h) {
  const block = Math.max(2, Math.round(Math.max(w, h) / 320));
  const sw = Math.ceil(w / block), sh = Math.ceil(h / block);
  let small = new Float32Array(sw * sh);
  const bxOf = new Int32Array(w);
  for (let x = 0; x < w; x++) bxOf[x] = (x / block) | 0;
  // One band of blocks at a time: a 64-bin histogram per block (values / 4).
  const hist = new Uint16Array(sw * 64);
  const counts = new Uint16Array(sw);
  for (let by = 0; by < sh; by++) {
    hist.fill(0);
    counts.fill(0);
    const y1 = Math.min(h, (by + 1) * block);
    for (let y = by * block; y < y1; y++) {
      let i = (y * w) * stride + offset;
      for (let x = 0; x < w; x++, i += stride) {
        const b = bxOf[x];
        hist[b * 64 + (arr[i] >> 2)]++;
        counts[b]++;
      }
    }
    for (let b = 0; b < sw; b++) {
      const target = counts[b] * BG_PERCENTILE;
      let acc = 0, bin = 0;
      for (; bin < 64; bin++) {
        acc += hist[b * 64 + bin];
        if (acc >= target) break;
      }
      small[by * sw + b] = bin * 4 + 2;
    }
  }
  small = minFilter(maxFilter(small, sw, sh, 3), sw, sh, 3);
  small = boxBlur(small, sw, sh, 1);
  // Limit brightening to about 8x. A phone or arm blocking a desk lamp easily makes paper
  // 3 to 4 times darker, and that must still come out white. Only near-black areas
  // (darker than 12% of the lit paper) are treated as genuinely dark and left alone.
  const sorted = Float32Array.from(small).sort();
  const paper = sorted[Math.floor(sorted.length * 0.9)] || 255;
  const floor = paper * 0.12;
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

// ---------- noise map ----------

// How grainy the paper is in each part of the page. Brightening a shadow 4x also makes the
// camera's grain 4x stronger, so shadowed areas are much noisier than lit ones.
// Per block we average |pixel - mean of its 4 neighbours| over paper pixels only (not ink),
// which for random grain is about 0.9 x its standard deviation.
function noiseMap(L, w, h, paper) {
  const block = Math.max(8, Math.round(Math.max(w, h) / 60));
  const sw = Math.ceil(w / block), sh = Math.ceil(h / block);
  const sum = new Float32Array(sw * sh), cnt = new Float32Array(sw * sh);
  const minPaper = paper * 0.7;
  for (let y = 1; y < h - 1; y += 2) {
    const row = ((y / block) | 0) * sw;
    for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x;
      const v = L[i];
      if (v < minPaper) continue;
      const n = (L[i - 1] + L[i + 1] + L[i - w] + L[i + w]) / 4;
      if (n < minPaper) continue; // next to ink: the difference is the stroke, not grain
      const k = row + ((x / block) | 0);
      sum[k] += Math.abs(v - n);
      cnt[k]++;
    }
  }
  let small = new Float32Array(sw * sh);
  for (let k = 0; k < small.length; k++) small[k] = cnt[k] > 20 ? (1.12 * sum[k]) / cnt[k] : 0;
  // Blocks with no paper (all ink) borrow from their neighbours.
  small = boxBlur(maxFilter(small, sw, sh, 1), sw, sh, 1);
  return { small, sw, sh, block };
}

// Bilinear lookup of a small map at full-size pixel (x, y).
function sampler(map, w) {
  const up = upsampler(map, w);
  const s = map.small;
  return (x, rowInfo) => {
    const fx = up.fx[x];
    return s[rowInfo.r0 + up.x0[x]] * (1 - fx) * (1 - rowInfo.fy) + s[rowInfo.r0 + up.x1[x]] * fx * (1 - rowInfo.fy) +
      s[rowInfo.r1 + up.x0[x]] * (1 - fx) * rowInfo.fy + s[rowInfo.r1 + up.x1[x]] * fx * rowInfo.fy;
  };
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

// Like sharpenGray, but it looks at the grain map first: clean areas get sharpened,
// grainy areas (brightened shadows) do not, because sharpening grain makes it stronger.
// (Smoothing grainy areas was tried too; it turns fine grain into blotches that are
// harder to remove, so they are just left alone.)
function sharpenOrSmooth(L, w, h, amount, noise) {
  const tmp = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    const r = y * w;
    for (let x = 0; x < w; x++) tmp[r + x] = L[r + (x > 0 ? x - 1 : x)] + L[r + x] + L[r + (x < w - 1 ? x + 1 : x)];
  }
  const sample = sampler(noise, w);
  const up = upsampler(noise, w);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = up.row(y);
    const u = (y > 0 ? y - 1 : y) * w, m = y * w, dn = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) {
      const grain = clamp01((sample(x, row) - 3) / 8);
      const a = amount * (1 - grain);
      const v = L[m + x];
      const blur = (tmp[u + x] + tmp[m + x] + tmp[dn + x]) / 9;
      const o = v + a * (v - blur);
      out[m + x] = o < 0 ? 0 : o > 255 ? 255 : o;
    }
  }
  L.set(out);
}

// 3x3 median, only where the paper is grainy. The middle of 9 values ignores single
// noisy pixels but keeps any line or stroke at least 2 pixels wide, so paper lines and
// pencil survive (a blur would smear them, and lowering the white level would erase them).
function medianWhereGrainy(L, w, h, noise, from = 3, full = 7) {
  const sample = sampler(noise, w);
  const up = upsampler(noise, w);
  const out = new Uint8Array(L);
  const v = new Int32Array(9);
  const sw = (a, b) => {
    if (v[a] > v[b]) {
      const t = v[a];
      v[a] = v[b];
      v[b] = t;
    }
  };
  for (let y = 1; y < h - 1; y++) {
    const row = up.row(y);
    for (let x = 1; x < w - 1; x++) {
      const g = sample(x, row);
      if (g <= from) continue;
      const i = y * w + x;
      v[0] = L[i - w - 1]; v[1] = L[i - w]; v[2] = L[i - w + 1];
      v[3] = L[i - 1]; v[4] = L[i]; v[5] = L[i + 1];
      v[6] = L[i + w - 1]; v[7] = L[i + w]; v[8] = L[i + w + 1];
      // Sorting network that leaves the median of 9 in v[4] (Paeth / Devillard, 19 swaps).
      sw(1, 2); sw(4, 5); sw(7, 8); sw(0, 1); sw(3, 4); sw(6, 7); sw(1, 2); sw(4, 5); sw(7, 8);
      sw(0, 3); sw(5, 8); sw(4, 7); sw(3, 6); sw(1, 4); sw(2, 5); sw(4, 7); sw(4, 2); sw(6, 4); sw(4, 2);
      const a = Math.min(1, (g - from) / (full - from));
      out[i] = L[i] + (v[4] - L[i]) * a;
    }
  }
  L.set(out);
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
    // White level high enough that light blue paper lines (about 80% of the paper's
    // brightness) stay visible; gamma darkens the middle tones so pencil reads clearly.
    white = paper * (0.955 - 0.03 * s);
    gamma = 1 + 0.8 * s;
    sharpen = 0.4 + 0.6 * s;
  } else if (mode === 'inksaver') {
    white = paper * 0.93;
    gamma = 1;
    sharpen = 0.3;
  } else {
    white = paper * 0.98;
    gamma = 1 + 0.4 * s;
    sharpen = 0.25 + 0.25 * s;
  }
  const black = Math.min(ink, white - 60);
  // Grain first (median), then sharpen the clean areas only.
  medianWhereGrainy(L, w, h, noiseMap(L, w, h, paper));
  sharpenOrSmooth(L, w, h, sharpen, noiseMap(L, w, h, paper));
  // Any grain that is left may lower the white level a little, never more than 4% of the
  // paper, so paper lines and light pencil can never be pushed to white.
  const noise = noiseMap(L, w, h, paper);
  const sample = sampler(noise, w);
  const up = upsampler(noise, w);
  const lowest = white - paper * 0.04;
  const keep = 0.75 - 0.3 * s;
  const luts = new Map();
  const lutFor = (wp) => {
    let lut = luts.get(wp);
    if (!lut) {
      lut = levelsLut(black, wp, gamma);
      // Ink saver prints text as dark grey instead of solid black.
      if (mode === 'inksaver') for (let v = 0; v < 256; v++) lut[v] = 255 - (255 - lut[v]) * keep;
      luts.set(wp, lut);
    }
    return lut;
  };
  for (let y = 0; y < h; y++) {
    const row = up.row(y);
    for (let x = 0, i = y * w; x < w; x++, i++) {
      const wp = Math.round(Math.max(lowest, Math.min(white, paper - 1.5 * sample(x, row))));
      L[i] = lutFor(wp)[L[i]];
    }
  }
  // Despeckle (Clean and Ink saver): only a single grey pixel with no grey neighbour at all.
  // Lines and strokes always have neighbours, so they are never touched.
  if (mode !== 'gray') {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (L[i] >= 250) continue;
        if (L[i - w - 1] < 250 || L[i - w] < 250 || L[i - w + 1] < 250 || L[i - 1] < 250 ||
          L[i + 1] < 250 || L[i + w - 1] < 250 || L[i + w] < 250 || L[i + w + 1] < 250) continue;
        L[i] = 255;
      }
    }
  }
  writeGray(img, L, null);
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
  // Measure the grain in each part of the page and keep the threshold above it there.
  // (After the 3x3 smoothing the grain is about 3 times weaker.)
  const noise = noiseMap(raw, w, h, paper);
  const sample = sampler(noise, w);
  const up = upsampler(noise, w);
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
  const C0 = 255 * (0.1 - 0.07 * s);
  const dark = paper * 0.55;
  const sure = paper * 0.95;
  // ink[i] is 0 (paper) to 255 (ink); the reuse of `raw` saves a big allocation.
  const ink = raw;
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1);
    const row = up.row(y);
    for (let x = 0; x < w; x++) {
      const C = Math.max(C0, (4 / 3) * sample(x, row));
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
