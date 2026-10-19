import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeZip, readZip, crc32 } from '../js/services/zip.js';

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

export const tests = [
  {
    name: 'crc32 matches the standard check value',
    fn() {
      assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
    },
  },
  {
    name: 'ZIP files open in Python and read back the same',
    async fn() {
      const bytes = new Uint8Array(5000).map((_, i) => (i * 7) & 255);
      const zip = await makeZip([
        { name: 'library.json', data: '{"ok":true}' },
        { name: 'PDFs/Домашка №1.pdf', data: new Blob([bytes]) },
        { name: 'originals/a.jpg', data: bytes },
      ]);
      fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
      const file = path.join(dir, 'out', 'test.zip');
      fs.writeFileSync(file, Buffer.from(await zip.arrayBuffer()));
      const py = 'import zipfile,sys,json; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps([z.testzip(), z.namelist()]))';
      const [bad, names] = JSON.parse(execFileSync('py', ['-3.14', '-P', '-c', py, file], { encoding: 'utf8' }));
      assert.equal(bad, null);
      assert.deepEqual(names, ['library.json', 'PDFs/Домашка №1.pdf', 'originals/a.jpg']);
      const back = await readZip(zip);
      assert.equal(await back.get('library.json').text(), '{"ok":true}');
      assert.deepEqual(new Uint8Array(await back.get('PDFs/Домашка №1.pdf').arrayBuffer()), bytes);
    },
  },
];
