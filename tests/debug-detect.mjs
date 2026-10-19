// Debug helper: node tests/debug-detect.mjs 029_white_on_white.jpg
// Prints every candidate quad with its score and writes the edge map + candidates as PNG.
import path from 'node:path';
import { detectPage } from '../js/engine/detect.js';
import { quadIoU } from '../js/engine/geometry.js';
import { loadJpeg, resize, drawQuad, savePng } from './imgutil.mjs';
import fs from 'node:fs';

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const file = process.argv[2];
const answers = JSON.parse(fs.readFileSync(path.join(dir, 'photos', 'answers.json'), 'utf8'));
const a = answers.find((x) => x.file === file);
const small = resize(loadJpeg(path.join(dir, 'photos', file)), 480);
const truth = a.corners.map(([x, y]) => [x * small.scale, y * small.scale]);
const dbg = detectPage(small, { debug: true, forceSecondPass: process.argv[3] === "2" });
console.log('thresholds', dbg.threshold);
for (const t of dbg.tried.sort((p, q) => q.score - p.score).slice(0, 12)) {
  console.log(t.method.padEnd(7), 'score', t.score.toFixed(3), 'sup', t.sup.sides.map((s) => s.toFixed(2)).join(' '),
    'iou', quadIoU(t.q, truth).toFixed(2));
}
console.log('best', dbg.best && dbg.best.method, dbg.best && quadIoU(dbg.best.corners, truth).toFixed(3));
const em = { width: small.width, height: small.height, data: new Uint8ClampedArray(small.width * small.height * 4) };
for (let i = 0; i < dbg.edges.length; i++) {
  const v = dbg.edges[i] ? 255 : 0;
  em.data.set([v, v, v, 255], i * 4);
}
drawQuad(em, truth, [0, 200, 0]);
if (dbg.best) drawQuad(em, dbg.best.corners, [255, 0, 0]);
fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
savePng(path.join(dir, 'out', 'debug-edges.png'), em);
