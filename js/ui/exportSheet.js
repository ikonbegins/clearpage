// Export sheet: PDF or images, page size, file size limit, password, searchable text.
// The file is built in the background as soon as the sheet opens, so Share is instant:
// iPhone only allows the share sheet right after a tap, not after a long wait.
import { h, icon, sheet, toast, progressChip, clear } from './dom.js';
import * as lib from '../services/library.js';
import { exportPdf, exportImages } from '../services/export.js';
import { shareFiles, downloadFile, formatBytes } from '../services/share.js';
import { getSettings, setSettings } from '../services/settings.js';
import { recognizeDoc, hasText } from '../services/ocr.js';
import { plural } from './shared.js';

const TARGETS = [1, 2, 5, 10, 20];

function segmented(options, value, onChange, label) {
  const wrap = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
  const draw = (v) => {
    clear(wrap);
    for (const [val, text] of options) {
      wrap.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(val === v), class: val === v ? 'on' : '', onclick: () => {
        draw(val);
        onChange(val);
      } }, text));
    }
  };
  draw(value);
  return wrap;
}

function switchEl(checked, onChange, label) {
  const input = h('input', { type: 'checkbox', checked, 'aria-label': label });
  input.addEventListener('change', () => onChange(input.checked));
  return { el: h('span', { class: 'switch' }, input, h('span')), input };
}

export async function openExportSheet(docId) {
  const doc = await lib.getDoc(docId);
  const pages = await lib.getPages(doc);
  if (!pages.length) return toast('This document has no pages yet');
  const settings = await getSettings();
  const textPages = () => pages.filter(hasText).length;
  const o = {
    format: 'pdf',
    pageSize: settings.pageSize,
    quality: settings.quality,
    targetMB: settings.targetMB,
    searchable: true,
    usePassword: false,
    password: '',
    fileName: doc.title,
  };
  let result = null; // { files, label }
  let gen = 0;
  let timer = null;

  const body = h('div');
  const status = h('div', { class: 'export-status' });
  const shareBtn = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: share }, icon('share', 20), 'Share');
  const saveBtn = h('button', { class: 'btn', type: 'button', disabled: true, onclick: save }, icon('download', 20), 'Save');
  const s = sheet({ title: 'Share', content: h('div', null, body, status, h('div', { class: 'export-actions' }, saveBtn, shareBtn)), onClose: () => gen++ });

  function rebuild(delay = 300) {
    clearTimeout(timer);
    result = null;
    shareBtn.disabled = saveBtn.disabled = true;
    setStatus('busy', 'Getting ready…');
    timer = setTimeout(build, delay);
  }

  function setStatus(kind, text, sub) {
    status.className = `export-status ${kind === 'ok' ? 'ok' : kind === 'warn' ? 'warn' : ''}`;
    clear(status);
    if (kind === 'busy') status.append(h('div', { class: 'spinner small' }));
    else status.append(icon(kind === 'ok' ? 'check' : kind === 'warn' ? 'info' : 'info', 20));
    status.append(h('div', null, h('div', { class: kind === 'busy' ? '' : 'big' }, text), sub ? h('div', { style: { fontSize: '0.8rem', color: 'var(--text-2)' } }, sub) : null));
  }

  async function build() {
    const my = ++gen;
    try {
      if (o.format === 'pdf') {
        if (o.usePassword && !o.password) {
          setStatus('warn', 'Type a password, or turn the password off');
          return;
        }
        const { file, fitsTarget } = await exportPdf(docId, {
          pageSize: o.pageSize,
          quality: o.quality,
          targetBytes: o.targetMB * 1024 * 1024,
          searchable: o.searchable && textPages() > 0,
          password: o.usePassword ? o.password : '',
          fileName: o.fileName,
        }, (label, f) => my === gen && setStatus('busy', `${label}… ${Math.round(f * 100)}%`));
        if (my !== gen) return;
        result = { files: [file] };
        const bits = [plural(pages.length, 'page'), o.usePassword ? 'password protected' : null, o.searchable && textPages() ? 'searchable' : null].filter(Boolean).join(' · ');
        if (o.quality === 'target' && !fitsTarget) setStatus('warn', `${formatBytes(file.size)}: still above ${o.targetMB} MB`, 'This is the smallest it can get. Try fewer pages or the B&W filter.');
        else setStatus('ok', `PDF ready · ${formatBytes(file.size)}`, bits);
      } else {
        const files = await exportImages(docId, o.format, null, (label, f) => my === gen && setStatus('busy', `${label}… ${Math.round(f * 100)}%`));
        if (my !== gen) return;
        result = { files };
        const total = files.reduce((n, f) => n + f.size, 0);
        setStatus('ok', `${plural(files.length, 'image')} ready · ${formatBytes(total)}`, o.format === 'png' ? 'PNG keeps every pixel but is larger' : null);
      }
      shareBtn.disabled = saveBtn.disabled = false;
    } catch (e) {
      console.error(e);
      if (my === gen) setStatus('warn', 'Could not create the file', e.message);
    }
  }

  async function share() {
    if (!result) return;
    const r = await shareFiles(result.files, o.fileName);
    if (r === 'downloaded') toast('Saved to Downloads');
  }

  function save() {
    if (!result) return;
    result.files.forEach(downloadFile);
    toast(result.files.length > 1 ? 'Files saved' : 'File saved');
  }

  async function runOcr() {
    const chip = progressChip('Reading text…');
    try {
      await recognizeDoc(docId, settings.ocrLangs, (f) => chip.update(f, `Reading text… ${Math.round(f * 100)}%`));
      const fresh = await lib.getPages(await lib.getDoc(docId));
      pages.splice(0, pages.length, ...fresh);
      o.searchable = true;
      draw();
      rebuild(0);
    } catch (e) {
      console.error(e);
      toast(navigator.onLine ? 'Text recognition failed' : 'Text recognition needs internet the first time');
    } finally {
      chip.done();
    }
  }

  function draw() {
    clear(body);
    body.append(h('div', { class: 'field' }, segmented([['pdf', 'PDF'], ['jpeg', 'JPG images'], ['png', 'PNG images']], o.format, (v) => {
      o.format = v;
      draw();
      rebuild(0);
    }, 'File type')));
    if (o.format === 'pdf') {
      body.append(h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Page size'), segmented([['auto', 'Same as scan'], ['letter', 'Letter'], ['a4', 'A4']], o.pageSize, (v) => {
        o.pageSize = v;
        setSettings({ pageSize: v });
        rebuild();
      }, 'Page size')));
      const targetSelect = h('select', { class: 'input', 'aria-label': 'Maximum file size', style: { display: o.quality === 'target' ? '' : 'none' } },
        TARGETS.map((mb) => h('option', { value: mb, selected: mb === o.targetMB }, `Under ${mb} MB`)));
      targetSelect.addEventListener('change', () => {
        o.targetMB = Number(targetSelect.value);
        setSettings({ targetMB: o.targetMB });
        rebuild();
      });
      body.append(h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'File size'), segmented([['small', 'Small'], ['medium', 'Medium'], ['high', 'High'], ['target', 'Limit']], o.quality, (v) => {
        o.quality = v;
        targetSelect.style.display = v === 'target' ? '' : 'none';
        setSettings({ quality: v });
        rebuild();
      }, 'File size'), targetSelect));

      const n = textPages();
      if (n) {
        const sw = switchEl(o.searchable, (v) => {
          o.searchable = v;
          rebuild();
        }, 'Searchable text');
        body.append(h('div', { class: 'field-row' }, h('div', { class: 'label' }, 'Searchable text', h('small', null, n === pages.length ? 'Find and copy words in the PDF' : `Text found on ${n} of ${pages.length} pages`)), sw.el));
      } else {
        body.append(h('div', { class: 'field-row' }, h('div', { class: 'label' }, 'Searchable text', h('small', null, 'Lets you find and copy words in the PDF')), h('button', { class: 'btn small', type: 'button', onclick: runOcr }, 'Recognize')));
      }

      const pw = h('input', { class: 'input', type: 'password', placeholder: 'Password to open the PDF', autocomplete: 'new-password', value: o.password, style: { display: o.usePassword ? '' : 'none' } });
      pw.addEventListener('input', () => {
        o.password = pw.value;
        rebuild(600);
      });
      const sw = switchEl(o.usePassword, (v) => {
        o.usePassword = v;
        pw.style.display = v ? '' : 'none';
        if (v) setTimeout(() => pw.focus(), 50);
        rebuild();
      }, 'Password');
      body.append(h('div', { class: 'field-row' }, h('div', { class: 'label' }, 'Password', h('small', null, 'AES-256 encryption')), sw.el), h('div', { class: 'field' }, pw));
    }
    const name = h('input', { class: 'input', type: 'text', value: o.fileName, 'aria-label': 'File name', autocapitalize: 'sentences' });
    name.addEventListener('change', () => {
      o.fileName = name.value.trim() || doc.title;
      rebuild(0);
    });
    body.append(h('div', { class: 'field' }, h('label', null, 'File name'), name));
  }

  draw();
  rebuild(0);
  return s;
}

// Shares several documents at once as PDFs with the default settings.
export async function shareDocsAsPdf(ids) {
  const settings = await getSettings();
  const chip = progressChip('Creating PDFs…');
  const files = [];
  try {
    for (let i = 0; i < ids.length; i++) {
      chip.update(i / ids.length, `Creating PDF ${i + 1} of ${ids.length}`);
      const { file } = await exportPdf(ids[i], { pageSize: settings.pageSize, quality: settings.quality === 'target' ? 'medium' : settings.quality, searchable: true });
      files.push(file);
    }
  } catch (e) {
    console.error(e);
    toast('Could not create the PDFs');
    return;
  } finally {
    chip.done();
  }
  toast(`${plural(files.length, 'PDF')} ready`, { action: 'Share', onAction: () => shareFiles(files, 'Scans'), duration: 10000 });
}
