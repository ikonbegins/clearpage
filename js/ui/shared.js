// Helpers shared by several screens.
import * as db from '../services/db.js';
import * as lib from '../services/library.js';
import { blobUrl } from '../services/imageio.js';
import { pickFiles, progressChip, toast, actionSheet, promptDialog } from './dom.js';
import { navigate, setFlow } from './router.js';

export async function pageThumbUrl(page) {
  if (!page || !page.thumb) return null;
  const b = await db.getBlob(page.thumb.key);
  return b ? blobUrl(page.thumb.key, b) : null;
}

export async function docThumbUrl(doc) {
  if (!doc.pageIds.length) return null;
  return pageThumbUrl(await db.get('pages', doc.pageIds[0]));
}

// Photo library import: adds pages, then opens the crop review for them.
export async function importPhotos(docId, { index } = {}) {
  const files = await pickFiles({ accept: 'image/*', multiple: true });
  if (!files.length) return;
  let doc = docId ? await lib.getDoc(docId) : await lib.createDoc();
  const chip = progressChip(`Importing ${files.length} photo${files.length > 1 ? 's' : ''}`);
  const added = [];
  try {
    for (let i = 0; i < files.length; i++) {
      chip.update(i / files.length, `Importing ${i + 1} of ${files.length}`);
      try {
        const page = await lib.addPage(doc.id, files[i], { index: index != null ? index + i : undefined });
        added.push(page.id);
      } catch (e) {
        console.error(e);
        toast(`Could not read ${files[i].name || 'a photo'}`);
      }
    }
  } finally {
    chip.done();
  }
  if (!added.length) {
    if (!docId) await lib.purgeDocs([doc.id]);
    return;
  }
  setFlow('review', { docId: doc.id, pageIds: added, next: `/doc/${doc.id}` });
  navigate(`/crop/${doc.id}`);
}

export async function chooseFolder(currentId) {
  const folders = await lib.listFolders();
  const choice = await actionSheet({
    title: 'Move to folder',
    actions: [
      { label: 'No folder', icon: 'page', value: '__none', disabled: currentId == null },
      ...folders.map((f) => ({ label: f.name, icon: 'folder', value: f.id, disabled: f.id === currentId })),
      { label: 'New folder…', icon: 'plus', value: '__new' },
    ],
  });
  if (choice == null) return undefined;
  if (choice === '__none') return null;
  if (choice === '__new') {
    const name = await promptDialog({ title: 'New folder', placeholder: 'For example: Calculus', confirmText: 'Create' });
    if (!name || !name.trim()) return undefined;
    return (await lib.createFolder(name)).id;
  }
  return choice;
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
