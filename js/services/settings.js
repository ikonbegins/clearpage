// User preferences, stored in the database next to the documents.
import * as db from './db.js';
import { emit } from './events.js';

export const PRESETS = [
  { id: 'homework', name: 'Homework', filter: 'clean', strength: 0.5, hint: 'Handwriting and pencil on paper' },
  { id: 'document', name: 'Document', filter: 'auto', strength: 0.5, hint: 'Printed pages and forms' },
  { id: 'receipt', name: 'Receipt', filter: 'bw', strength: 0.5, hint: 'Small print, black and white' },
  { id: 'whiteboard', name: 'Whiteboard', filter: 'boost', strength: 0.6, hint: 'Boards and slides' },
  { id: 'book', name: 'Book', filter: 'gray', strength: 0.5, hint: 'Book pages in grayscale' },
  { id: 'photo', name: 'Photo', filter: 'original', strength: 0.5, hint: 'Keep the colours as they are' },
];

const DEFAULTS = {
  preset: 'homework',
  autoShutter: true,
  batch: true,
  grid: false,
  pageSize: 'auto',
  quality: 'medium',
  targetMB: 2,
  ocrLangs: ['eng'],
  autoOcr: false,
  theme: 'system',
};

let cache = null;

export async function getSettings() {
  if (!cache) cache = { ...DEFAULTS, ...((await db.get('kv', 'settings')) || {}) };
  return cache;
}

export async function setSettings(patch) {
  cache = { ...(await getSettings()), ...patch };
  await db.put('kv', cache, 'settings');
  emit('settings', cache);
  return cache;
}

export function presetById(id) {
  return PRESETS.find((p) => p.id === id) || PRESETS[0];
}
