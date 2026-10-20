// Runs sample photos through detect -> flatten -> every filter and checks the results.
// Output images go to tests/out/ so a person can look at them too.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { detectPage } from '../js/engine/detect.js';
import { buildLevels, renderPage } from '../js/engine/render.js';
import { FILTERS } from '../js/engine/filters.js';
import { loadJpeg, resize, saveJpeg } from './imgutil.mjs';

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const outDir = path.join(dir, 'out');

function whiteShare(img) {
  let white = 0;
  for (let j = 0; j < img.data.length; j += 4) if (img.data[j] >= 245 && img.data[j + 1] >= 245 && img.data[j + 2] >= 245) white++;
  return white / (img.data.length / 4);
}

export const tests = [
  {
    name: 'flattens and cleans shadowed homework into white paper with dark ink',
    fn() {
      fs.mkdirSync(outDir, { recursive: true });
      for (const file of ['050_shadow.jpg', '001_dark_desk.jpg', '080_low_light.jpg']) {
        const full = loadJpeg(path.join(dir, 'photos', file));
        const small = resize(full, 480);
        const found = detectPage(small);
        assert.ok(found, `no page in ${file}`);
        const corners = found.corners.map(([x, y]) => [x / small.width, y / small.height]);
        const levels = buildLevels(full);
        for (const f of FILTERS) {
          const t0 = performance.now();
          const img = renderPage(levels, { corners, rotation: 0, filter: f.id, strength: 0.5 }, 1400);
          const ms = performance.now() - t0;
          saveJpeg(path.join(outDir, `render_${file.replace('.jpg', '')}_${f.id}.jpg`), img, 85);
          if (f.id === 'clean' || f.id === 'bw') {
            const share = whiteShare(img);
            assert.ok(share > 0.6, `${file} ${f.id}: only ${(share * 100).toFixed(0)}% white paper`);
          }
          if (file === '050_shadow.jpg' && f.id === 'clean') console.log(`       clean filter at 1400 px: ${ms.toFixed(0)} ms, ${img.width}x${img.height}`);
        }
      }
    },
  },
  {
    name: 'deep, hard shadows become evenly white paper with the Clean filter',
    fn() {
      const answers = JSON.parse(fs.readFileSync(path.join(dir, 'photos', 'answers.json'), 'utf8')).filter((a) => a.category === 'deep_shadow');
      assert.ok(answers.length, 'run "npm run photos" first');
      const worst = [];
      for (const a of answers) {
        const full = loadJpeg(path.join(dir, 'photos', a.file));
        // Use the true corners so this test is only about the filter, not detection.
        const corners = a.corners.map(([x, y]) => [x / full.width, y / full.height]);
        const img = renderPage(buildLevels(full), { corners, rotation: 0, filter: 'clean', strength: 0.5 }, 1600);
        saveJpeg(path.join(outDir, `deep_${a.file.replace('.jpg', '')}_clean.jpg`), img, 85);
        // Paper level per tile = brightness that 85% of the tile's pixels stay under.
        // In a clean scan every tile's paper is close to white, shadowed or not.
        const TX = 6, TY = 8;
        let minTile = 255;
        for (let ty = 0; ty < TY; ty++) {
          for (let tx = 0; tx < TX; tx++) {
            const vals = [];
            const x0 = Math.floor((tx * img.width) / TX), x1 = Math.floor(((tx + 1) * img.width) / TX);
            const y0 = Math.floor((ty * img.height) / TY), y1 = Math.floor(((ty + 1) * img.height) / TY);
            for (let y = y0 + 2; y < y1 - 2; y += 2) for (let x = x0 + 2; x < x1 - 2; x += 2) vals.push(img.data[(y * img.width + x) * 4]);
            vals.sort((p, q) => p - q);
            minTile = Math.min(minTile, vals[Math.floor(vals.length * 0.85)]);
          }
        }
        const share = whiteShare(img);
        worst.push({ file: a.file, minTile, share });
      }
      console.log(`       darkest paper tile / white share: ${worst.map((w) => `${w.file.slice(0, 3)}:${w.minTile}/${(w.share * 100).toFixed(0)}%`).join('  ')}`);
      for (const w of worst) {
        assert.ok(w.minTile >= 230, `${w.file}: a shadowed part of the paper is still grey (${w.minTile})`);
        assert.ok(w.share > 0.7, `${w.file}: only ${(w.share * 100).toFixed(0)}% white paper`);
      }
    },
  },
  {
    name: 'rotation turns the output and swaps width and height',
    fn() {
      const full = loadJpeg(path.join(dir, 'photos', '001_dark_desk.jpg'));
      const small = resize(full, 480);
      const corners = detectPage(small).corners.map(([x, y]) => [x / small.width, y / small.height]);
      const levels = buildLevels(full);
      const a = renderPage(levels, { corners, rotation: 0, filter: 'original' }, 800);
      const b = renderPage(levels, { corners, rotation: 1, filter: 'original' }, 800);
      assert.equal(a.width, b.height);
      assert.equal(a.height, b.width);
    },
  },
  {
    name: 'redaction boxes are burned into the pixels',
    fn() {
      const full = loadJpeg(path.join(dir, 'photos', '001_dark_desk.jpg'));
      const img = renderPage(buildLevels(full), { corners: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]], rotation: 0, filter: 'clean', redactions: [[0.25, 0.25, 0.5, 0.1]] }, 600);
      const cx = Math.floor(img.width / 2), cy = Math.floor(img.height * 0.3);
      const o = (cy * img.width + cx) * 4;
      assert.deepEqual([img.data[o], img.data[o + 1], img.data[o + 2]], [0, 0, 0]);
    },
  },
];
