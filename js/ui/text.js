// Recognized text: read, search, copy or listen to the words found in a document.
import { h, icon, iconButton, toast, sheet, clear, progressChip } from './dom.js';
import { back } from './router.js';
import * as lib from '../services/library.js';
import { docText, recognizeDoc, OCR_LANGS } from '../services/ocr.js';
import { getSettings, setSettings } from '../services/settings.js';

export async function textScreen(el, params, query) {
  const doc = await lib.getDoc(params.docId);
  if (!doc) return back('/');
  const settings = await getSettings();
  let parts = [];
  let filter = '';
  let speaking = false;

  const speakBtn = iconButton('speaker', 'Read aloud', speak);
  const topbar = h('header', { class: 'topbar' },
    iconButton('back', 'Back', () => back(`/doc/${doc.id}`)),
    h('div', { class: 'title' }, 'Text', h('span', { class: 'sub' }, doc.title)),
    speakBtn,
    iconButton('copy', 'Copy all text', copyAll));
  const searchInput = h('input', { type: 'search', placeholder: 'Find in text', 'aria-label': 'Find in text' });
  searchInput.addEventListener('input', () => {
    filter = searchInput.value.trim();
    render();
  });
  const langBtn = h('button', { class: 'chip', type: 'button', onclick: chooseLangs });
  const runBtn = h('button', { class: 'chip', type: 'button', onclick: run }, icon('text', 16), 'Recognize again');
  const list = h('div');
  const content = h('main', { class: 'content' },
    h('label', { class: 'search' }, icon('search', 20), searchInput),
    h('div', { class: 'chips' }, langBtn, runBtn),
    h('p', { class: 'note', style: { margin: '0 4px 12px' } }, 'Works best on printed text. Handwriting is often not recognized.'),
    list);
  el.append(topbar, content);

  function langLabel() {
    return settings.ocrLangs.map((id) => (OCR_LANGS.find((l) => l.id === id) || { name: id }).name).join(', ');
  }

  function highlight(text) {
    if (!filter) return [text];
    const out = [];
    const lower = text.toLowerCase(), f = filter.toLowerCase();
    let i = 0;
    for (;;) {
      const j = lower.indexOf(f, i);
      if (j < 0) break;
      out.push(text.slice(i, j), h('mark', null, text.slice(j, j + f.length)));
      i = j + f.length;
    }
    out.push(text.slice(i));
    return out;
  }

  function render() {
    clear(langBtn).append(icon('settings', 16), langLabel());
    clear(list);
    const missing = parts.filter((p) => p.text == null || p.stale).length;
    if (missing === parts.length) {
      list.append(h('div', { class: 'empty' }, h('div', { class: 'art' }, icon('text')), h('h2', null, 'No text yet'),
        h('p', null, 'Recognize the text to search it, copy it, and make the PDF searchable. Everything stays on your phone.'),
        h('button', { class: 'btn primary', type: 'button', onclick: run }, 'Recognize text')));
      return;
    }
    let shown = 0;
    for (const p of parts) {
      const t = p.text || '';
      if (filter && !t.toLowerCase().includes(filter.toLowerCase())) continue;
      shown++;
      const card = h('section', { class: 'text-page', id: `p${p.index}` },
        h('h3', null, h('span', null, `Page ${p.index + 1}`), p.stale ? h('span', { style: { color: 'var(--warn)' } }, 'Crop changed, recognize again') : null),
        p.text == null ? h('div', { class: 'body muted' }, 'Not recognized yet') : t ? h('div', { class: 'body' }, highlight(t)) : h('div', { class: 'body muted' }, 'No text found on this page'));
      list.append(card);
    }
    if (!shown) list.append(h('div', { class: 'empty' }, h('p', null, `No page contains "${filter}"`)));
  }

  async function load() {
    parts = await docText(doc.id);
    render();
    if (query.page && !filter) {
      const target = document.getElementById(`p${query.page}`);
      if (target) target.scrollIntoView({ block: 'start' });
    }
  }

  async function run() {
    const chip = progressChip('Reading text…');
    try {
      // When text already exists, the user asked to run it again (maybe with other languages).
      const force = parts.some((p) => p.text != null && !p.stale);
      await recognizeDoc(doc.id, settings.ocrLangs, (f, m) => {
        chip.update(f, m && m.status && m.status.startsWith('loading') ? 'Downloading text engine (first time only)…' : `Reading text… ${Math.round(f * 100)}%`);
      }, { force });
      await load();
    } catch (e) {
      console.error(e);
      toast(navigator.onLine ? 'Text recognition failed' : 'Text recognition needs internet the first time');
    } finally {
      chip.done();
    }
  }

  function chooseLangs() {
    const chosen = new Set(settings.ocrLangs);
    const listEl = h('div', { class: 'lang-list' }, OCR_LANGS.map((l) => {
      const cb = h('input', { type: 'checkbox', checked: chosen.has(l.id) });
      cb.addEventListener('change', () => {
        if (cb.checked) chosen.add(l.id);
        else chosen.delete(l.id);
      });
      return h('label', null, cb, l.name);
    }));
    sheet({
      title: 'Text languages',
      content: h('div', null, h('p', { class: 'note', style: { margin: '0 0 8px' } }, 'Pick the languages on your pages. Each one downloads once (2 to 10 MB). Fewer languages are faster.'), listEl),
      onClose: async () => {
        const langs = OCR_LANGS.map((l) => l.id).filter((id) => chosen.has(id));
        if (!langs.length) return;
        if (langs.join() !== settings.ocrLangs.join()) {
          await setSettings({ ocrLangs: langs });
          settings.ocrLangs = langs;
          render();
          toast('Languages saved. Tap Recognize again to use them.');
        }
      },
    });
  }

  async function copyAll() {
    const text = parts.filter((p) => p.text).map((p) => p.text).join('\n\n');
    if (!text) return toast('There is no text to copy yet');
    try {
      await navigator.clipboard.writeText(text);
      toast('Text copied');
    } catch {
      toast('Copy failed. Select the text and copy it instead.');
    }
  }

  function speak() {
    if (!('speechSynthesis' in window)) return toast('Read aloud is not supported here');
    if (speaking) {
      speechSynthesis.cancel();
      speaking = false;
      speakBtn.classList.remove('accent');
      return;
    }
    const text = parts.filter((p) => p.text).map((p) => p.text).join('\n\n');
    if (!text) return toast('There is no text to read yet');
    const u = new SpeechSynthesisUtterance(text);
    const lang = { eng: 'en', rus: 'ru', uzb: 'uz', uzb_cyrl: 'uz', spa: 'es', fra: 'fr', deu: 'de', tur: 'tr', kor: 'ko', chi_sim: 'zh', ara: 'ar' }[settings.ocrLangs[0]];
    if (lang) u.lang = lang;
    u.onend = () => {
      speaking = false;
      speakBtn.classList.remove('accent');
    };
    speechSynthesis.speak(u);
    speaking = true;
    speakBtn.classList.add('accent');
  }

  await load();
  return { destroy: () => speaking && speechSynthesis.cancel() };
}
