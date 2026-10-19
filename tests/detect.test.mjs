// Grades the page detector on the synthetic photo set (tests/make_photos.py).
// A photo passes when the detected page overlaps the true page with IoU above 0.9,
// the same bar the plan sets. Failures are drawn to tests/out/ for a quick look.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { detectPage } from '../js/engine/detect.js';
import { quadIoU } from '../js/engine/geometry.js';
import { loadJpeg, resize, drawQuad, savePng } from './imgutil.mjs';

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const photos = path.join(dir, 'photos');
const outDir = path.join(dir, 'out');

export const tests = [
  {
    name: 'detects the page in at least 95% of the test photos',
    fn() {
      const answersPath = path.join(photos, 'answers.json');
      if (!fs.existsSync(answersPath)) throw new Error('Run "npm run photos" first');
      const answers = JSON.parse(fs.readFileSync(answersPath, 'utf8'));
      fs.mkdirSync(outDir, { recursive: true });
      for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));
      const byCat = {};
      let ok = 0, total = 0, ms = 0;
      for (const a of answers) {
        const full = loadJpeg(path.join(photos, a.file));
        const small = resize(full, 480);
        const t0 = performance.now();
        const res = detectPage(small);
        ms += performance.now() - t0;
        const truth = a.corners.map(([x, y]) => [x * small.scale, y * small.scale]);
        const iou = res ? quadIoU(res.corners, truth) : 0;
        const cat = (byCat[a.category] ??= { ok: 0, n: 0, fails: [] });
        if (!a.expect) {
          // Pages with a corner just outside the frame. Either "no outline" or the
          // right page (edges extended past the frame) is fine; a wrong quad is not.
          cat.n++;
          if (!res || iou > 0.85) cat.ok++;
          else cat.fails.push(`${a.file} iou=${iou.toFixed(2)}`);
          continue;
        }
        total++;
        cat.n++;
        if (iou > 0.9) {
          ok++;
          cat.ok++;
        } else {
          cat.fails.push(`${a.file} iou=${iou.toFixed(2)}${res ? ' ' + res.method : ' none'}`);
          drawQuad(small, truth, [0, 220, 0]);
          if (res) drawQuad(small, res.corners, [255, 0, 0]);
          savePng(path.join(outDir, a.file.replace('.jpg', '.png')), small);
        }
      }
      for (const [c, v] of Object.entries(byCat)) {
        console.log(`       ${c.padEnd(15)} ${v.ok}/${v.n}${v.fails.length ? '  fails: ' + v.fails.join(', ') : ''}`);
      }
      const rate = ok / total;
      console.log(`       overall ${ok}/${total} = ${(rate * 100).toFixed(1)}%, avg ${(ms / answers.length).toFixed(1)} ms per photo`);
      assert.ok(rate >= 0.95, `accuracy ${(rate * 100).toFixed(1)}% is below 95%`);
    },
  },
];
