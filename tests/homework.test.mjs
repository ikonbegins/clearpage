// What a homework scan must keep: the paper's ruled lines and every pen and pencil stroke,
// with even white paper, also under a deep shadow. Uses a flat synthetic page where we know
// exactly where the lines and strokes are, so each can be measured.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildLevels, renderPage } from '../js/engine/render.js';
import { saveJpeg } from './imgutil.mjs';

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const W = 1700, H = 2200;
const LINE_GAP = 64, LINE_W = 3;

// Simple seeded random numbers so the page is the same every run.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function makePage({ shadow, noise, seed = 1 }) {
  const rand = rng(seed);
  const data = new Uint8ClampedArray(W * H * 4);
  const kind = new Uint8Array(W * H); // 0 paper, 1 ruled line, 2 pencil, 3 pen
  const paper = [238, 236, 230];
  const line = [170, 196, 228]; // light blue ruled line
  for (let y = 0; y < H; y++) {
    const onLine = y > 150 && (y - 150) % LINE_GAP < LINE_W;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      kind[i] = onLine ? 1 : 0;
      const c = onLine ? line : paper;
      data.set([c[0], c[1], c[2], 255], i * 4);
    }
  }
  // Handwriting: wavy strokes between the lines. Odd rows of text are light pencil, even rows pen.
  for (let row = 0; row < 28; row++) {
    const baseY = 150 + row * LINE_GAP + 18;
    const pencil = row % 2 === 1;
    const ink = pencil ? [150, 150, 156] : [40, 45, 90];
    let x = 120 + rand() * 60;
    while (x < W - 150) {
      const len = 40 + rand() * 90;
      const amp = 8 + rand() * 14;
      for (let t = 0; t < len; t += 0.5) {
        const px = Math.round(x + t), py = Math.round(baseY + 16 + Math.sin(t / 7 + row) * amp);
        for (let dy = 0; dy < (pencil ? 2 : 3); dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const i = (py + dy) * W + px + dx;
            kind[i] = pencil ? 2 : 3;
            data.set([ink[0], ink[1], ink[2]], i * 4);
          }
        }
      }
      x += len + 20 + rand() * 30;
    }
  }
  // Lighting: a hard-edged diagonal shadow over the right part, 3.5x darker, plus camera grain.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let f = 1;
      if (shadow) {
        const d = (x - W * 0.45 - (y - H / 2) * 0.3) / 12; // signed distance to the shadow edge, soft over ~25 px
        f = 1 - (1 - 0.29) / (1 + Math.exp(-d));
      }
      const n = noise ? (rand() + rand() + rand() - 1.5) * noise * 1.4 : 0;
      for (let c = 0; c < 3; c++) data[i + c] = data[i + c] * f + n;
    }
  }
  return { img: { data, width: W, height: H }, kind };
}

function measure(out, kind, region) {
  const sums = { 0: [0, 0], 1: [0, 0], 2: [0, 0], 3: [0, 0] };
  let darkPaper = 0, paperN = 0;
  for (let y = 200; y < H - 100; y++) {
    for (let x = 100; x < W - 100; x++) {
      const inShadow = x - W * 0.45 - (y - H / 2) * 0.3 > 40;
      const lit = x - W * 0.45 - (y - H / 2) * 0.3 < -40;
      if ((region === 'shadow' && !inShadow) || (region === 'lit' && !lit)) continue;
      const i = y * W + x;
      const k = kind[i];
      // Skip pixels right next to a stroke (anti-aliasing makes them in-between).
      if (k === 0 && (kind[i - 2] || kind[i + 2] || kind[i - 2 * W] || kind[i + 2 * W])) continue;
      const v = out.data[i * 4];
      sums[k][0] += v;
      sums[k][1]++;
      if (k === 0) {
        paperN++;
        if (v < 225) darkPaper++;
      }
    }
  }
  const mean = (k) => sums[k][0] / sums[k][1];
  return { paper: mean(0), line: mean(1), pencil: mean(2), pen: mean(3), speckle: darkPaper / paperN };
}

function run(noise) {
  const { img, kind } = makePage({ shadow: true, noise });
  const out = renderPage(buildLevels(img), { corners: [[0, 0], [1, 0], [1, 1], [0, 1]], rotation: 0, filter: 'clean', strength: 0.5 }, 2600);
  fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
  saveJpeg(path.join(dir, 'out', `homework_clean_noise${noise}.jpg`), out, 90);
  // Also save the input, to compare.
  saveJpeg(path.join(dir, 'out', `homework_input_noise${noise}.jpg`), img, 90);
  const res = {};
  for (const region of ['lit', 'shadow']) {
    const m = measure(out, kind, region);
    const r = (v) => v.toFixed(0);
    console.log(`       grain ${noise} ${region.padEnd(6)} paper ${r(m.paper)}  line ${r(m.line)}  pencil ${r(m.pencil)}  pen ${r(m.pen)}  grey specks ${(m.speckle * 100).toFixed(1)}%`);
    res[region] = m;
  }
  return res;
}

// Lines and writing come first: they must survive at any grain level.
function assertReadable(res, label) {
  for (const [region, m] of Object.entries(res)) {
    const r = (v) => v.toFixed(0);
    assert.ok(m.paper - m.line >= 30, `${label} ${region}: ruled lines faded away (paper ${r(m.paper)}, line ${r(m.line)})`);
    assert.ok(m.line >= 120, `${label} ${region}: ruled lines are too dark (${r(m.line)}), they would compete with the writing`);
    assert.ok(m.pencil <= 140, `${label} ${region}: light pencil is too faint (${r(m.pencil)})`);
    assert.ok(m.pen <= 70, `${label} ${region}: pen is not dark enough (${r(m.pen)})`);
  }
}

export const tests = [
  {
    name: 'Clean: realistic phone grain gives white paper with clear lines and pencil, even in a deep shadow',
    fn() {
      const res = run(5);
      assertReadable(res, 'grain 5');
      for (const [region, m] of Object.entries(res)) {
        assert.ok(m.paper >= 245, `${region}: paper is not white (${m.paper.toFixed(0)})`);
        assert.ok(m.speckle <= 0.03, `${region}: too much grey grain on the paper (${(m.speckle * 100).toFixed(1)}%)`);
      }
    },
  },
  {
    name: 'Clean: extreme grain still keeps every line and stroke readable',
    fn() {
      const res = run(12);
      assertReadable(res, 'grain 12');
      for (const [region, m] of Object.entries(res)) assert.ok(m.paper >= 225, `${region}: paper is too grey (${m.paper.toFixed(0)})`);
    },
  },
];
