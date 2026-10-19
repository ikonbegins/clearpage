// Builds PDFs with the app's writer and checks them with an independent reader (PyMuPDF).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import jpeg from 'jpeg-js';
import { buildPdf, jpegSize, layoutPage } from '../js/services/pdf.js';
import { buildLevels, renderPage } from '../js/engine/render.js';
import { loadJpeg } from './imgutil.mjs';

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const outDir = path.join(dir, 'out');

function pageJpeg(file, filter) {
  const full = loadJpeg(path.join(dir, 'photos', file));
  const img = renderPage(buildLevels(full), { corners: [[0.15, 0.1], [0.85, 0.1], [0.85, 0.9], [0.15, 0.9]], rotation: 0, filter }, 900);
  return new Uint8Array(jpeg.encode({ data: img.data, width: img.width, height: img.height }, 80).data);
}

function inspect(pdfPath, password = '') {
  const script = `
import sys, json, pymupdf
out = {"needs_pass": bool(pymupdf.open(sys.argv[1]).needs_pass)}
# Open fresh for each check: MuPDF caches objects read before authenticate().
d = pymupdf.open(sys.argv[1])
if out["needs_pass"]:
    out["auth"] = d.authenticate(sys.argv[2])
out["pages"] = d.page_count
# Note: reading d.needs_pass after authenticate() resets MuPDF decryption, so use the saved value.
if not out["needs_pass"] or out.get("auth"):
    out["text"] = " ".join(p.get_text() for p in d)
    out["title"] = d.metadata.get("title")
    out["size"] = [round(d[0].rect.width, 1), round(d[0].rect.height, 1)]
    pix = d[0].get_pixmap(dpi=40)
    out["pixel_mean"] = sum(pix.samples) / len(pix.samples)
# A failed attempt disturbs MuPDF's state for the whole process, so it goes last.
if out["needs_pass"]:
    out["wrong_ok"] = bool(pymupdf.open(sys.argv[1]).authenticate("wrong-password"))
print(json.dumps(out))
`;
  const res = execFileSync('py', ['-3.14', '-P', '-c', script, pdfPath, password], { encoding: 'utf8' });
  return JSON.parse(res.trim().split('\n').pop());
}

async function makeDoc(password) {
  const pages = [];
  for (const [file, filter] of [['001_dark_desk.jpg', 'clean'], ['015_wood.jpg', 'auto']]) {
    const bytes = pageJpeg(file, filter);
    const { width, height } = jpegSize(bytes);
    const lay = layoutPage(width, height, 'letter');
    pages.push({
      jpeg: bytes, imgW: width, imgH: height, ...lay,
      words: [
        { text: 'Homework', box: [0.1, 0.05, 0.3, 0.04], space: true },
        { text: 'Задача', box: [0.45, 0.05, 0.2, 0.04], space: true },
        { text: 'o‘zbek', box: [0.7, 0.05, 0.2, 0.04] },
      ],
    });
  }
  return buildPdf(pages, { title: 'Calculus HW — 3', password });
}

export const tests = [
  {
    name: 'writes a valid, searchable 2-page PDF',
    async fn() {
      fs.mkdirSync(outDir, { recursive: true });
      const file = path.join(outDir, 'test.pdf');
      fs.writeFileSync(file, await makeDoc(''));
      const r = inspect(file);
      assert.equal(r.needs_pass, false);
      assert.equal(r.pages, 2);
      assert.deepEqual(r.size, [612, 792]);
      assert.equal(r.title, 'Calculus HW — 3');
      for (const w of ['Homework', 'Задача', 'o‘zbek']) assert.ok(r.text.includes(w), `text layer is missing "${w}": ${r.text}`);
      assert.ok(r.pixel_mean > 150, 'page image did not render');
    },
  },
  {
    name: 'AES-256 password protection works and wrong passwords fail',
    async fn() {
      const file = path.join(outDir, 'test_locked.pdf');
      fs.writeFileSync(file, await makeDoc('hunter2 ключ'));
      const r = inspect(file, 'hunter2 ключ');
      assert.equal(r.needs_pass, true);
      assert.equal(r.wrong_ok, false);
      assert.ok(r.auth, 'correct password was rejected');
      assert.equal(r.title, 'Calculus HW — 3');
      assert.ok(r.text.includes('Homework'), JSON.stringify(r));
      assert.ok(r.pixel_mean > 150, 'encrypted page image did not render');
    },
  },
  {
    name: 'layoutPage fits landscape scans on a rotated page',
    fn() {
      const l = layoutPage(2000, 1000, 'a4');
      assert.ok(l.pageW > l.pageH);
      assert.ok(Math.abs(l.place.w - 841.89) < 0.01);
      const a = layoutPage(850, 1100, 'auto');
      assert.equal(a.pageH, 792);
    },
  },
];
