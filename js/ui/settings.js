// Settings: scanning defaults, PDF defaults, text languages, storage, backup, theme.
import { h, icon, iconButton, toast, confirmDialog, pickFiles, progressChip, clear } from './dom.js';
import { back, navigate } from './router.js';
import { getSettings, setSettings, PRESETS } from '../services/settings.js';
import { OCR_LANGS } from '../services/ocr.js';
import * as lib from '../services/library.js';
import { createBackup, restoreBackup } from '../services/backup.js';
import { shareFiles, downloadFile, formatBytes } from '../services/share.js';
import { applyTheme } from './theme.js';

export const APP_VERSION = '1.0.0';

export async function settingsScreen(el) {
  let s = await getSettings();
  const content = h('main', { class: 'content' });
  el.append(h('header', { class: 'topbar' }, iconButton('back', 'Back', () => back('/')), h('div', { class: 'title' }, 'Settings')), content);

  const select = (value, options, onChange, label) => {
    const sel = h('select', { 'aria-label': label }, options.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  };
  const toggle = (checked, onChange, label) => {
    const input = h('input', { type: 'checkbox', checked, 'aria-label': label });
    input.addEventListener('change', () => onChange(input.checked));
    return h('span', { class: 'switch' }, input, h('span'));
  };
  const item = (label, sub, control) => h('div', { class: 'item' }, h('div', { class: 'label' }, label, sub ? h('small', null, sub) : null), control);
  const save = async (patch) => {
    s = await setSettings(patch);
  };

  async function render() {
    clear(content);
    content.append(
      h('div', { class: 'group-title' }, 'Scanning'),
      h('div', { class: 'group' },
        item('Default mode', 'Sets the filter for new scans', select(s.preset, PRESETS.map((p) => [p.id, p.name]), (v) => save({ preset: v }), 'Default mode')),
        item('Auto capture', 'Takes the photo when the page is held still', toggle(s.autoShutter, (v) => save({ autoShutter: v }), 'Auto capture')),
        item('Batch mode', 'Keep the camera open for more pages', toggle(s.batch, (v) => save({ batch: v }), 'Batch mode')),
        item('Grid lines', null, toggle(s.grid, (v) => save({ grid: v }), 'Grid lines'))),

      h('div', { class: 'group-title' }, 'PDF'),
      h('div', { class: 'group' },
        item('Page size', null, select(s.pageSize, [['auto', 'Same as scan'], ['letter', 'US Letter'], ['a4', 'A4']], (v) => save({ pageSize: v }), 'Page size')),
        item('File size', null, select(s.quality, [['small', 'Small'], ['medium', 'Medium'], ['high', 'High'], ['target', 'Limit']], (v) => save({ quality: v }), 'File size')),
        item('Size limit', 'Used when File size is Limit. Many school portals allow 2 to 10 MB.', select(String(s.targetMB), [['1', '1 MB'], ['2', '2 MB'], ['5', '5 MB'], ['10', '10 MB'], ['20', '20 MB']], (v) => save({ targetMB: Number(v) }), 'Size limit'))),

      h('div', { class: 'group-title' }, 'Text recognition'),
      h('div', { class: 'group' },
        h('div', { class: 'item stack' },
          h('div', { class: 'label' }, 'Languages', h('small', null, 'Each language downloads once (2 to 10 MB), then works offline.')),
          h('div', { class: 'chips', style: { margin: 0, padding: '2px 0', flexWrap: 'wrap' } }, OCR_LANGS.map((l) => {
            const on = s.ocrLangs.includes(l.id);
            return h('button', { class: `chip ${on ? 'on' : ''}`, type: 'button', 'aria-pressed': String(on), onclick: async () => {
              const next = on ? s.ocrLangs.filter((x) => x !== l.id) : [...s.ocrLangs, l.id];
              if (!next.length) return toast('Keep at least one language');
              await save({ ocrLangs: OCR_LANGS.map((x) => x.id).filter((id) => next.includes(id)) });
              render();
            } }, l.name);
          })))),

      h('div', { class: 'group-title' }, 'Appearance'),
      h('div', { class: 'group' },
        item('Theme', null, select(s.theme, [['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']], async (v) => {
          await save({ theme: v });
          applyTheme(v);
        }, 'Theme'))),
    );

    // Storage and backup
    const est = await lib.storageEstimate();
    const docs = await lib.listDocs();
    const usage = est ? `${formatBytes(est.usage)} used${est.quota ? ` of about ${formatBytes(est.quota)} available` : ''}` : 'Unknown';
    const meter = est && est.quota ? h('div', { class: 'meter' }, h('div', { style: { width: `${Math.min(100, (est.usage / est.quota) * 100).toFixed(1)}%` } })) : null;
    content.append(
      h('div', { class: 'group-title' }, 'Storage and backup'),
      h('div', { class: 'group' },
        h('div', { class: 'item stack' }, h('div', { class: 'label' }, `${docs.length} documents`, h('small', null, usage)), meter),
        h('button', { class: 'item', type: 'button', onclick: backup }, icon('download', 22), h('div', { class: 'label' }, 'Back up everything', h('small', null, 'One ZIP with all PDFs, original photos and an index. Save it to Files or iCloud Drive.'))),
        h('button', { class: 'item', type: 'button', onclick: restore }, icon('restore', 22), h('div', { class: 'label' }, 'Restore from backup', h('small', null, 'Adds documents from a ClearPage ZIP. Nothing here is overwritten.'))),
        h('button', { class: 'item', type: 'button', onclick: () => navigate('/trash') }, icon('trash', 22), h('div', { class: 'label' }, 'Trash', h('small', null, 'Deleted documents stay 30 days')))),
      h('p', { class: 'note' }, 'Your scans are stored only in this browser on this device. Back up from time to time, and add the app to your Home Screen so iOS keeps its storage.'),

      h('div', { class: 'group-title' }, 'About'),
      h('div', { class: 'group' },
        h('div', { class: 'item' }, icon('shield', 22), h('div', { class: 'label' }, 'Private by design', h('small', null, 'No account, no ads, no tracking, no watermarks. Photos are processed on this device and never uploaded. Only the text engine and language files are downloaded when you first use text recognition.'))),
        item(`ClearPage ${APP_VERSION}`, 'Text recognition by Tesseract.js (Apache 2.0)', null)),
    );
  }

  async function backup() {
    const chip = progressChip('Creating backup…');
    let file;
    try {
      file = await createBackup({ includePdfs: true }, (label, f) => chip.update(f, label));
    } catch (e) {
      console.error(e);
      toast('Backup failed: ' + e.message);
      return;
    } finally {
      chip.done();
    }
    toast(`Backup ready (${formatBytes(file.size)})`, { action: 'Save', onAction: async () => {
      const r = await shareFiles([file], file.name);
      if (r === 'downloaded') toast('Saved to Downloads');
    }, duration: 15000 });
  }

  async function restore() {
    const [file] = await pickFiles({ accept: '.zip,application/zip' });
    if (!file) return;
    if (!(await confirmDialog({ title: 'Restore this backup?', message: `${file.name}\nDocuments that are already here are skipped.`, confirmText: 'Restore' }))) return;
    const chip = progressChip('Restoring…');
    try {
      const r = await restoreBackup(file, (label, f) => chip.update(f, label));
      toast(`Restored ${r.addedDocs} documents (${r.addedPages} pages)`);
      render();
    } catch (e) {
      console.error(e);
      toast(e.message || 'Restore failed');
    } finally {
      chip.done();
    }
  }

  await render();
}
