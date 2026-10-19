// Small DOM toolkit: element builder, icons, toasts, sheets and dialogs.

export function h(tag, props, ...children) {
  const el = tag === 'svg' || tag === 'path' || tag === 'polygon' || tag === 'circle' || tag === 'rect' || tag === 'line' || tag === 'g'
    ? document.createElementNS('http://www.w3.org/2000/svg', tag)
    : document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

// 24x24 line icons, drawn with simple paths.
const ICONS = {
  camera: 'M4 8h3l2-3h6l2 3h3v11H4z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  photos: 'M4 5h16v14H4z M4 15l4-4 4 4 3-3 5 5 M15.5 9.5a1.5 1.5 0 1 0 0-.01',
  plus: 'M12 5v14 M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12 M18 6L6 18',
  back: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  share: 'M12 15V3 M7.5 7.5L12 3l4.5 4.5 M5 12v8h14v-8',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4',
  folder: 'M3 6h6l2 2h10v11H3z',
  folderMove: 'M3 6h6l2 2h10v11H3z M10 13.5h6 M13.5 11l2.5 2.5-2.5 2.5',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7.6 7.6 0 0 1-1.7 1L15 20.5h-4l-.4-2.1a7.6 7.6 0 0 1-1.7-1l-1.9.7-2-3.4 1.6-1.2a7.4 7.4 0 0 1 0-2L3 10.3l2-3.4 1.9.7a7.6 7.6 0 0 1 1.7-1L9 3.5h4l.4 2.1a7.6 7.6 0 0 1 1.7 1l1.9-.7 2 3.4-1.6 1.2a7.4 7.4 0 0 1 0 2z',
  rotateLeft: 'M4 4v5h5 M4.6 9A8 8 0 1 1 6 16.5',
  rotateRight: 'M20 4v5h-5 M19.4 9A8 8 0 1 0 18 16.5',
  crop: 'M6 2v14h14 M2 6h14v14',
  text: 'M5 6h14 M12 6v13 M9 19h6',
  lock: 'M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  flash: 'M13 2L5 14h6l-1 8 8-12h-6z',
  flashOff: 'M13 2L9.5 7.5 M5 14h6l-1 8 4-6 M15.5 10H18l-2 3 M3 3l18 18',
  grid: 'M4 4h16v16H4z M9.3 4v16 M14.7 4v16 M4 9.3h16 M4 14.7h16',
  auto: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M8.5 16l3.5-9 3.5 9 M9.7 13h4.6',
  pdf: 'M6 2h9l5 5v15H6z M14 2v6h6 M9 13h6 M9 17h6',
  download: 'M12 3v12 M7.5 10.5L12 15l4.5-4.5 M5 20h14',
  undo: 'M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3',
  merge: 'M4 7l8-4 8 4-8 4z M4 12l8 4 8-4 M4 17l8 4 8-4',
  select: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M8 12l3 3 5-6',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  copy: 'M8 8h12v12H8z M4 16V4h12',
  speaker: 'M4 9h4l5-4v14l-5-4H4z M16.5 8.5a5 5 0 0 1 0 7 M19 6a8.5 8.5 0 0 1 0 12',
  restore: 'M3 12a9 9 0 1 0 3-6.7L3 8 M3 3v5h5',
  wand: 'M15 4V2 M15 16v-2 M8 9h2 M20 9h2 M17.8 11.8l1.4 1.4 M17.8 6.2l1.4-1.4 M12.2 6.2l-1.4-1.4 M15 9L3 21',
  redact: 'M4 6h16 M4 18h16 M6 10h12v4H6z',
  edit: 'M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4',
  list: 'M8 6h12 M8 12h12 M8 18h12 M4 6h.01 M4 12h.01 M4 18h.01',
  gridView: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  sort: 'M7 4v16 M3.5 16.5L7 20l3.5-3.5 M17 20V4 M13.5 7.5L17 4l3.5 3.5',
  sliders: 'M4 6h10 M18 6h2 M4 18h4 M12 18h8 M4 12h2 M10 12h10 M16 4v4 M10 16v4 M8 10v4',
  page: 'M6 3h12v18H6z',
  fullscreen: 'M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5',
  scan: 'M4 8V4h4 M16 4h4v4 M20 16v4h-4 M8 20H4v-4 M4 12h16',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v6 M12 7.5h.01',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M8.5 12l2.5 2.5 4.5-5',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 1v2 M12 21v2 M4.2 4.2l1.4 1.4 M18.4 18.4l1.4 1.4 M1 12h2 M21 12h2 M4.2 19.8l1.4-1.4 M18.4 5.6l1.4-1.4',
  stack: 'M7 3h10v4H7z M5 7h14v14H5z',
  drag: 'M9 6h.01 M15 6h.01 M9 12h.01 M15 12h.01 M9 18h.01 M15 18h.01',
};

export function icon(name, size = 24) {
  const svg = h('svg', { viewBox: '0 0 24 24', width: size, height: size, class: 'icon', 'aria-hidden': 'true' });
  svg.append(h('path', { d: ICONS[name] || ICONS.info }));
  return svg;
}

// Icon button with a visible or screen-reader label.
export function iconButton(name, label, onClick, opts = {}) {
  return h('button', { class: `icon-btn ${opts.class || ''}`, 'aria-label': label, title: label, onclick: onClick, type: 'button', disabled: opts.disabled }, icon(name), opts.showLabel ? h('span', null, label) : null);
}

export function button(label, onClick, opts = {}) {
  return h('button', { class: `btn ${opts.kind || ''} ${opts.class || ''}`, onclick: onClick, type: 'button', disabled: opts.disabled }, opts.icon ? icon(opts.icon, 20) : null, h('span', null, label));
}

// ---------- toasts ----------

export function toast(message, { action, onAction, duration = 3500 } = {}) {
  const host = document.getElementById('toasts');
  const el = h('div', { class: 'toast', role: 'status' }, h('span', null, message));
  let timer;
  const close = () => {
    clearTimeout(timer);
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 250);
  };
  if (action) {
    el.append(h('button', { class: 'toast-action', type: 'button', onclick: () => { close(); onAction && onAction(); } }, action));
  }
  host.append(el);
  timer = setTimeout(close, duration);
  return close;
}

// ---------- overlays ----------

function overlayHost() {
  return document.getElementById('overlay');
}

// Bottom sheet. Returns { el, body, close }. Swipe down on the handle or tap outside closes it.
export function sheet({ title, content, onClose, className = '' }) {
  const backdrop = h('div', { class: 'backdrop' });
  const body = h('div', { class: 'sheet-body' });
  const panel = h('div', { class: `sheet ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Options' },
    h('div', { class: 'sheet-handle' }),
    title ? h('div', { class: 'sheet-title' }, h('h2', null, title), iconButton('x', 'Close', () => close())) : null,
    body,
  );
  if (content) append(body, [content]);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    panel.classList.add('leaving');
    backdrop.classList.add('leaving');
    setTimeout(() => {
      panel.remove();
      backdrop.remove();
    }, 220);
    document.removeEventListener('keydown', onKey);
    onClose && onClose();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  // Swipe the handle down to dismiss.
  let startY = null;
  panel.querySelector('.sheet-handle').addEventListener('pointerdown', (e) => {
    startY = e.clientY;
    panel.setPointerCapture(e.pointerId);
  });
  panel.addEventListener('pointermove', (e) => {
    if (startY == null) return;
    const dy = Math.max(0, e.clientY - startY);
    panel.style.transform = `translateY(${dy}px)`;
  });
  panel.addEventListener('pointerup', (e) => {
    if (startY == null) return;
    const dy = e.clientY - startY;
    startY = null;
    panel.style.transform = '';
    if (dy > 80) close();
  });
  overlayHost().append(backdrop, panel);
  return { el: panel, body, close };
}

export function actionSheet({ title, actions }) {
  return new Promise((resolve) => {
    let chosen = null;
    const list = h('div', { class: 'action-list' },
      actions.filter(Boolean).map((a) => h('button', {
        class: `action-item ${a.danger ? 'danger' : ''}`,
        type: 'button',
        disabled: a.disabled,
        onclick: () => {
          chosen = a;
          s.close();
        },
      }, a.icon ? icon(a.icon, 22) : null, h('span', null, a.label))),
    );
    const s = sheet({
      title,
      content: list,
      onClose: () => {
        resolve(chosen ? chosen.value ?? chosen.label : null);
        if (chosen && chosen.onClick) chosen.onClick();
      },
    });
  });
}

export function dialog({ title, message, content, buttons }) {
  return new Promise((resolve) => {
    const backdrop = h('div', { class: 'backdrop' });
    let result;
    const close = (v) => {
      result = v;
      box.classList.add('leaving');
      backdrop.classList.add('leaving');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => {
        box.remove();
        backdrop.remove();
        resolve(result);
      }, 180);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
    };
    const box = h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': title },
      h('h2', null, title),
      message ? h('p', null, message) : null,
      content || null,
      h('div', { class: 'dialog-buttons' }, buttons.map((b) => h('button', { class: `btn ${b.kind || ''}`, type: 'button', onclick: () => close(b.value) }, b.label))),
    );
    backdrop.addEventListener('click', () => close(null));
    document.addEventListener('keydown', onKey);
    overlayHost().append(backdrop, box);
    const firstInput = box.querySelector('input');
    if (firstInput) setTimeout(() => firstInput.focus(), 50);
  });
}

export async function confirmDialog({ title, message, confirmText = 'OK', danger = false }) {
  const v = await dialog({ title, message, buttons: [{ label: 'Cancel', value: false }, { label: confirmText, value: true, kind: danger ? 'danger' : 'primary' }] });
  return !!v;
}

export async function promptDialog({ title, message, value = '', placeholder = '', confirmText = 'Save' }) {
  const input = h('input', { class: 'input', type: 'text', value, placeholder, enterkeyhint: 'done', autocapitalize: 'sentences' });
  const p = dialog({ title, message, content: input, buttons: [{ label: 'Cancel', value: null }, { label: confirmText, value: 'ok', kind: 'primary' }] });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.closest('.dialog').querySelector('.btn.primary').click();
  });
  setTimeout(() => input.select(), 60);
  const r = await p;
  return r === 'ok' ? input.value : null;
}

// ---------- gestures ----------

// Calls fn after the finger stays down for `ms` without moving much.
export function onLongPress(el, fn, ms = 450) {
  let timer = null, sx = 0, sy = 0, fired = false;
  el.addEventListener('pointerdown', (e) => {
    fired = false;
    sx = e.clientX;
    sy = e.clientY;
    timer = setTimeout(() => {
      fired = true;
      fn(e);
    }, ms);
  });
  const cancel = () => clearTimeout(timer);
  el.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel();
  });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  // Swallow the click that follows a long press.
  el.addEventListener('click', (e) => {
    if (fired) {
      e.stopPropagation();
      e.preventDefault();
      fired = false;
    }
  }, true);
}

// Hidden file input, opened from code. Must be called from a tap handler.
export function pickFiles({ accept = 'image/*', multiple = false, capture } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    if (capture) input.setAttribute('capture', capture);
    input.addEventListener('change', () => {
      resolve([...input.files]);
      input.remove();
    });
    // iOS fires no event when the picker is cancelled; the promise then simply never resolves.
    document.body.append(input);
    input.click();
  });
}

export function formatDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const opts = d.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' };
  return d.toLocaleDateString(undefined, opts);
}

// A small progress pill at the top of the screen for background work.
export function progressChip(label) {
  const host = document.getElementById('toasts');
  const bar = h('div', { class: 'chip-bar' });
  const text = h('span', null, label);
  const el = h('div', { class: 'progress-chip', role: 'status' }, h('div', { class: 'spinner small' }), text, h('div', { class: 'chip-track' }, bar));
  host.prepend(el);
  return {
    update(fraction, newLabel) {
      if (newLabel) text.textContent = newLabel;
      if (fraction != null) bar.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
    },
    done() {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 250);
    },
  };
}
