// Runs every test file. Usage: node tests/run-tests.mjs [filter]
// Each test module exports `tests`: an array of { name, fn } where fn may be async.
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const filter = process.argv[2] || '';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort();

let pass = 0, fail = 0;
for (const f of files) {
  const mod = await import(pathToFileURL(path.join(dir, f)).href);
  for (const t of mod.tests) {
    if (filter && !`${f} ${t.name}`.includes(filter)) continue;
    const start = Date.now();
    try {
      await t.fn();
      pass++;
      console.log(`  ok   ${f} > ${t.name} (${Date.now() - start} ms)`);
    } catch (e) {
      fail++;
      console.log(`  FAIL ${f} > ${t.name}\n       ${e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n       ') : e}`);
    }
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
