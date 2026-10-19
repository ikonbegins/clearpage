// Backup you control: one ZIP with readable PDFs, the original photos and a JSON index.
// Restoring brings back documents with full editing (crop, filters) intact.
import * as db from './db.js';
import { emit } from './events.js';
import { makeZip, readZip } from './zip.js';
import { exportPdf } from './export.js';
import { safeFileName } from './share.js';
import { queueRender } from './render.js';

const FORMAT = 'clearpage-backup';

export async function createBackup({ includePdfs = true } = {}, onProgress = () => {}) {
  const docs = (await db.getAll('docs')).filter((d) => !d.deletedAt);
  const folders = await db.getAll('folders');
  const pages = [];
  const entries = [];
  const usedNames = new Set();
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    onProgress(`Backing up ${doc.title}`, i / docs.length);
    for (const id of doc.pageIds) {
      const p = await db.get('pages', id);
      if (!p) continue;
      const blob = await db.getBlob(p.original.key);
      if (!blob) continue;
      entries.push({ name: `originals/${p.original.key.replace(/[^a-z0-9-]/gi, '_')}.jpg`, data: blob });
      const { rendered, thumb, ...rest } = p;
      pages.push(rest);
    }
    if (includePdfs && doc.pageIds.length) {
      const folder = folders.find((f) => f.id === doc.folderId);
      let name = (folder ? safeFileName(folder.name, '').slice(0, -1) + '/' : '') + safeFileName(doc.title, 'pdf');
      for (let n = 2; usedNames.has(name); n++) name = name.replace(/( \(\d+\))?\.pdf$/, ` (${n}).pdf`);
      usedNames.add(name);
      const { file } = await exportPdf(doc.id, { quality: 'medium', pageSize: 'auto', searchable: true });
      entries.push({ name: `PDFs/${name}`, data: file });
    }
  }
  const settings = await db.get('kv', 'settings');
  const index = { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), folders, docs, pages, settings };
  entries.unshift({ name: 'library.json', data: JSON.stringify(index, null, 1) });
  onProgress('Packing ZIP', 0.95);
  const zip = await makeZip(entries);
  const date = new Date().toISOString().slice(0, 10);
  return new File([zip], `ClearPage backup ${date}.zip`, { type: 'application/zip' });
}

// Adds everything from a backup that is not already here. Existing documents are left alone.
export async function restoreBackup(file, onProgress = () => {}) {
  const files = await readZip(file);
  const indexBlob = files.get('library.json');
  if (!indexBlob) throw new Error('This ZIP is not a ClearPage backup');
  const index = JSON.parse(await indexBlob.text());
  if (index.format !== FORMAT) throw new Error('This ZIP is not a ClearPage backup');
  let addedDocs = 0, addedPages = 0;
  for (const f of index.folders || []) if (!(await db.get('folders', f.id))) await db.put('folders', f);
  const pagesById = new Map(index.pages.map((p) => [p.id, p]));
  for (let i = 0; i < index.docs.length; i++) {
    const doc = index.docs[i];
    onProgress(`Restoring ${doc.title}`, i / index.docs.length);
    if (await db.get('docs', doc.id)) continue;
    const kept = [];
    for (const pid of doc.pageIds) {
      const p = pagesById.get(pid);
      if (!p) continue;
      const blob = files.get(`originals/${p.original.key.replace(/[^a-z0-9-]/gi, '_')}.jpg`);
      if (!blob) continue;
      await db.putBlob(p.original.key, new Blob([blob], { type: 'image/jpeg' }));
      await db.put('pages', { ...p, rendered: null, thumb: null });
      kept.push(pid);
      addedPages++;
    }
    await db.put('docs', { ...doc, pageIds: kept, deletedAt: null });
    addedDocs++;
    kept.forEach((id) => queueRender(id));
  }
  emit('docs');
  onProgress('Done', 1);
  return { addedDocs, addedPages };
}
