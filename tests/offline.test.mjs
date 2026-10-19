// Checks that the service worker's offline list matches the real app files,
// so the app never breaks offline because a new file was forgotten.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

function listJs(dir) {
  const out = [];
  for (const f of fs.readdirSync(path.join(root, dir))) {
    const rel = `${dir}/${f}`;
    if (fs.statSync(path.join(root, rel)).isDirectory()) out.push(...listJs(rel));
    else if (f.endsWith('.js')) out.push(`./${rel}`);
  }
  return out;
}

export const tests = [
  {
    name: 'every app file is saved for offline use, and every listed file exists',
    fn() {
      const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
      const list = JSON.parse(sw.match(/const SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
      for (const f of listJs('js')) assert.ok(list.includes(f), `${f} is missing from sw.js`);
      for (const f of list) {
        if (f === './') continue;
        assert.ok(fs.existsSync(path.join(root, f)), `${f} is listed in sw.js but does not exist`);
      }
    },
  },
];
