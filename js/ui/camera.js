// Camera screen: live outline, auto-capture, batch mode, flash, document modes.
import { h, icon, iconButton, toast, pickFiles, clear } from './dom.js';
import { navigate, back, setFlow } from './router.js';
import * as lib from '../services/library.js';
import { getSettings, setSettings, PRESETS } from '../services/settings.js';
import { detectInWorker } from '../engine/client.js';
import { makeCanvas, releaseCanvas } from '../services/imageio.js';

const DETECT_SIZE = 480;      // long side of the frame copy used for live detection
const FRAME_MS = 90;          // about 10 detections per second
const STABLE_MS = 1000;       // how long the page must stay still for auto-capture
const SMOOTH_FRAMES = 5;      // outline = average of the last 5 detections
const JUMP = 0.15;            // a jump bigger than 15% of the width means "new position"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const maxCornerDist = (a, b) => Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1])));
const average = (qs) => [0, 1, 2, 3].map((i) => [qs.reduce((s, q) => s + q[i][0], 0) / qs.length, qs.reduce((s, q) => s + q[i][1], 0) / qs.length]);

// A tiny 24x32 grey copy of what is inside the outline, with brightness and contrast
// normalised. Comparing two of these tells "same page still there" from "a new page".
const FP_W = 24, FP_H = 32;
const fpCanvas = document.createElement('canvas');
fpCanvas.width = FP_W;
fpCanvas.height = FP_H;
function fingerprint(source, quad) {
  const xs = quad.map((p) => p[0]), ys = quad.map((p) => p[1]);
  const x = Math.max(0, Math.min(...xs)), y = Math.max(0, Math.min(...ys));
  const w = Math.min(source.width, Math.max(...xs)) - x, hh = Math.min(source.height, Math.max(...ys)) - y;
  if (w < 8 || hh < 8) return null;
  const ctx = fpCanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, x, y, w, hh, 0, 0, FP_W, FP_H);
  const d = ctx.getImageData(0, 0, FP_W, FP_H).data;
  const v = new Float32Array(FP_W * FP_H);
  let mean = 0;
  for (let i = 0; i < v.length; i++) mean += v[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
  mean /= v.length;
  let sd = 0;
  for (let i = 0; i < v.length; i++) sd += (v[i] -= mean) ** 2;
  sd = Math.sqrt(sd / v.length) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= sd;
  return v;
}
// Normalised correlation: 1 = identical, near 0 = unrelated.
function similarity(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s / a.length;
}

export async function cameraScreen(el, params, query) {
  el.classList.add('camera');
  const settings = await getSettings();
  const st = {
    docId: query.doc || null,
    retake: query.retake || null,
    insertAt: query.at != null ? Number(query.at) : null,
    next: query.next || null,
    preset: settings.preset,
    auto: settings.autoShutter,
    batch: query.retake ? false : settings.batch,
    grid: settings.grid,
    torch: false,
    captured: [],
    busy: 0,
    quad: null,
    history: [],
    misses: 0,
    stableSince: 0,
    armed: true,
    armedRef: null,
    fpRef: null,
    capturing: false,
    destroyed: false,
    stream: null,
    track: null,
    finishing: false,
  };
  let saveChain = Promise.resolve();
  let wakeLock = null;

  // ---------- elements ----------
  const video = h('video', { playsinline: true, muted: true, autoplay: true, 'aria-label': 'Camera preview' });
  video.muted = true;
  const svg = h('svg', { class: 'overlay', 'aria-hidden': 'true' });
  const poly = h('polygon', { points: '' });
  svg.append(poly);
  const gridEl = h('div', { class: 'gridlines', style: { display: st.grid ? 'block' : 'none' } });
  const flashfx = h('div', { class: 'flashfx' });
  const hint = h('div', { class: 'cam-hint' }, 'Starting camera…');
  const busyPill = h('div', { class: 'busy-pill', style: { display: 'none' } }, h('div', { class: 'spinner small light' }), h('span', null, 'Saving'));
  const stage = h('div', { class: 'stage' }, video, gridEl, svg, flashfx, hint, busyPill);

  const torchBtn = iconButton('flash', 'Flash', toggleTorch, { class: 'torch' });
  torchBtn.style.display = 'none';
  const gridBtn = iconButton('grid', 'Grid', () => {
    st.grid = !st.grid;
    gridEl.style.display = st.grid ? 'block' : 'none';
    gridBtn.classList.toggle('on', st.grid);
    setSettings({ grid: st.grid });
  }, { class: st.grid ? 'on' : '' });
  const autoBtn = h('button', { class: `icon-btn ${st.auto ? 'on' : ''}`, type: 'button', 'aria-label': 'Auto capture', 'aria-pressed': String(st.auto), onclick: () => {
    st.auto = !st.auto;
    autoBtn.classList.toggle('on', st.auto);
    autoBtn.setAttribute('aria-pressed', String(st.auto));
    autoBtn.querySelector('span').textContent = st.auto ? 'Auto' : 'Manual';
    setSettings({ autoShutter: st.auto });
    toast(st.auto ? 'Auto capture on: hold the phone still over a page' : 'Auto capture off: tap the round button');
  } }, icon('auto'), h('span', { style: { fontSize: '0.75rem', fontWeight: 650 } }, st.auto ? 'Auto' : 'Manual'));
  const batchBtn = h('button', { class: `icon-btn ${st.batch ? 'on' : ''}`, type: 'button', 'aria-label': 'Batch mode', 'aria-pressed': String(st.batch), onclick: () => {
    if (st.retake) return;
    st.batch = !st.batch;
    batchBtn.classList.toggle('on', st.batch);
    batchBtn.setAttribute('aria-pressed', String(st.batch));
    batchBtn.querySelector('span').textContent = st.batch ? 'Batch' : 'Single';
    setSettings({ batch: st.batch });
  } }, icon('stack'), h('span', { style: { fontSize: '0.75rem', fontWeight: 650 } }, st.batch ? 'Batch' : 'Single'));
  if (st.retake) batchBtn.style.display = 'none';

  const top = h('div', { class: 'cam-top' },
    iconButton('x', 'Close camera', close),
    h('div', { class: 'spacer' }),
    iconButton('camera', 'Use the iPhone camera app (full resolution)', nativeCamera),
    torchBtn, gridBtn, autoBtn, batchBtn,
  );
  stage.append(top);

  const modes = h('div', { class: 'modes', role: 'radiogroup', 'aria-label': 'Document type' });
  function renderModes() {
    clear(modes);
    for (const p of PRESETS) {
      modes.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(p.id === st.preset), class: p.id === st.preset ? 'on' : '', title: p.hint, onclick: () => setPreset(p.id) }, p.name));
    }
  }
  renderModes();

  const ring = h('svg', { viewBox: '0 0 88 88', 'aria-hidden': 'true' });
  const ringCircle = h('circle', { cx: 44, cy: 44, r: 41, 'stroke-dasharray': `${2 * Math.PI * 41}`, 'stroke-dashoffset': `${2 * Math.PI * 41}` });
  ring.append(ringCircle);
  const shutter = h('button', { class: 'shutter', type: 'button', 'aria-label': 'Take photo', onclick: () => capture() }, ring);
  const thumbImg = h('img', { alt: '' });
  const badge = h('span', { class: 'badge' }, '0');
  const thumbBtn = h('button', { class: 'batch-thumb', type: 'button', 'aria-label': 'Finish and review pages', onclick: finish, style: { visibility: 'hidden' } }, thumbImg, badge);
  const doneBtn = h('button', { class: 'done-btn', type: 'button', onclick: finish, style: { display: 'none' } }, 'Done');
  const photosBtn = iconButton('photos', 'Import from Photos', importFromPhotos);
  const bottom = h('div', { class: 'cam-bottom' }, modes,
    h('div', { class: 'shutter-row' },
      h('div', { class: 'batch' }, thumbBtn),
      shutter,
      h('div', { class: 'cam-right' }, photosBtn, doneBtn)));

  el.append(stage, bottom);

  // ---------- helpers ----------
  function setHint(text) {
    if (hint.textContent !== text) hint.textContent = text;
    hint.style.display = text ? 'block' : 'none';
  }

  function updateBusy() {
    busyPill.style.display = st.busy > 0 ? 'flex' : 'none';
  }

  async function setPreset(id) {
    st.preset = id;
    renderModes();
    setSettings({ preset: id });
    if (st.docId) await lib.updateDoc(st.docId, { preset: id });
  }

  function contentRect() {
    const r = stage.getBoundingClientRect();
    const vw = video.videoWidth || 1, vh = video.videoHeight || 1;
    const s = Math.min(r.width / vw, r.height / vh);
    const w = vw * s, hgt = vh * s;
    return { x: (r.width - w) / 2, y: (r.height - hgt) / 2, s, w, h: hgt, W: r.width, H: r.height };
  }

  function draw() {
    const cr = contentRect();
    svg.setAttribute('viewBox', `0 0 ${cr.W} ${cr.H}`);
    Object.assign(gridEl.style, { left: `${cr.x}px`, top: `${cr.y}px`, width: `${cr.w}px`, height: `${cr.h}px` });
    if (!st.quad) {
      poly.setAttribute('points', '');
    } else {
      poly.setAttribute('points', st.quad.map(([x, y]) => `${cr.x + x * cr.s},${cr.y + y * cr.s}`).join(' '));
      poly.classList.toggle('ready', st.armed && st.auto);
    }
    const circ = 2 * Math.PI * 41;
    let frac = 0;
    if (st.auto && st.quad && st.armed && st.stableSince) frac = Math.min(1, (performance.now() - st.stableSince) / STABLE_MS);
    ringCircle.setAttribute('stroke-dashoffset', String(circ * (1 - frac)));
    if (!video.videoWidth) return;
    if (!st.quad) setHint(st.captured.length && st.batch ? `Next page (${st.captured.length} done)` : 'Point at a page');
    else if (!st.armed) setHint(st.batch ? 'Got it. Show the next page' : 'Saving…');
    else setHint(st.auto ? 'Hold still…' : 'Tap the button to capture');
  }

  function onDetection(q, vw, vh, fpNow) {
    const now = performance.now();
    if (!q) {
      st.misses++;
      if (st.misses >= 3) {
        st.history = [];
        st.quad = null;
        st.stableSince = 0;
        st.armed = true; // the page left the view, so the next one can be captured
      }
    } else {
      st.misses = 0;
      const last = st.history[st.history.length - 1];
      if (last && maxCornerDist(last, q) > JUMP * vw) {
        st.history = [q];
        st.stableSince = now;
      } else {
        st.history.push(q);
        if (st.history.length > SMOOTH_FRAMES) st.history.shift();
      }
      const prev = st.quad;
      st.quad = average(st.history);
      const moved = prev ? maxCornerDist(prev, st.quad) / Math.max(vw, vh) : 1;
      if (moved > 0.012 || !st.stableSince) st.stableSince = now;
      if (!st.armed && st.armedRef && maxCornerDist(st.armedRef, st.quad) > 0.1 * Math.max(vw, vh)) st.armed = true;
      // Same place, different content: the next page was slid in without leaving the view.
      if (!st.armed && st.fpRef) {
        const now2 = fpNow();
        if (now2 && similarity(st.fpRef, now2) < 0.75) {
          st.armed = true;
          st.stableSince = now;
        }
      }
    }
    draw();
    if (st.auto && st.quad && st.armed && !st.capturing && !st.finishing && now - st.stableSince > STABLE_MS) capture();
  }

  let lastFrame = null;
  async function detectLoop() {
    const small = makeCanvas(1, 1);
    const ctx = small.getContext('2d', { willReadFrequently: true });
    try {
      while (!st.destroyed) {
        const t0 = performance.now();
        if (video.readyState >= 2 && video.videoWidth && !document.hidden) {
          const vw = video.videoWidth, vh = video.videoHeight;
          const s = DETECT_SIZE / Math.max(vw, vh);
          const w = Math.round(vw * s), hh = Math.round(vh * s);
          if (small.width !== w || small.height !== hh) {
            small.width = w;
            small.height = hh;
          }
          ctx.drawImage(video, 0, 0, w, hh);
          const px = ctx.getImageData(0, 0, w, hh);
          let res = null;
          try {
            res = await detectInWorker(px);
          } catch (e) {
            console.warn(e);
          }
          if (st.destroyed) break;
          const smallQuad = res ? res.corners : null;
          lastFrame = { canvas: small, quad: smallQuad };
          onDetection(res ? res.corners.map(([x, y]) => [x / s, y / s]) : null, vw, vh, () => (smallQuad ? fingerprint(small, smallQuad) : null));
        } else {
          draw();
        }
        await sleep(Math.max(10, FRAME_MS - (performance.now() - t0)));
      }
    } finally {
      releaseCanvas(small);
    }
  }

  async function ensureDoc() {
    if (!st.docId) st.docId = (await lib.createDoc({ preset: st.preset })).id;
    return st.docId;
  }

  // Saves one photo. Saves run one after another so page order is always right.
  function savePage(source, hintQuad) {
    st.busy++;
    updateBusy();
    const job = saveChain.then(async () => {
      try {
        const docId = await ensureDoc();
        const index = st.insertAt != null ? st.insertAt + st.captured.length : undefined;
        const page = await lib.addPage(docId, source, { cornersHint: hintQuad, replacePageId: st.retake, index });
        st.captured.push(page.id);
      } catch (e) {
        console.error(e);
        toast('Could not save that photo');
      } finally {
        if (source instanceof HTMLCanvasElement) releaseCanvas(source);
        st.busy--;
        updateBusy();
      }
    });
    saveChain = job;
    return job;
  }

  function showCaptured(canvasOrUrl, count) {
    thumbImg.src = typeof canvasOrUrl === 'string' ? canvasOrUrl : lib.quickThumb(canvasOrUrl, 160);
    badge.textContent = String(count);
    thumbBtn.style.visibility = 'visible';
    doneBtn.style.display = 'block';
  }

  let shotCount = 0;
  async function capture() {
    if (st.capturing || !video.videoWidth || st.finishing) return;
    st.capturing = true;
    st.armed = false;
    st.armedRef = st.quad;
    st.fpRef = lastFrame && lastFrame.quad ? fingerprint(lastFrame.canvas, lastFrame.quad) : null;
    flashfx.classList.remove('go');
    void flashfx.offsetWidth;
    flashfx.classList.add('go');
    const vw = video.videoWidth, vh = video.videoHeight;
    const c = makeCanvas(vw, vh);
    c.getContext('2d').drawImage(video, 0, 0, vw, vh);
    const hintQuad = st.quad ? st.quad.map(([x, y]) => [x / vw, y / vh]) : null;
    shotCount++;
    showCaptured(c, shotCount);
    st.capturing = false;
    const job = savePage(c, hintQuad);
    if (!st.batch || st.retake) {
      await job;
      finish();
    }
  }

  async function importFiles(files) {
    if (!files.length) return;
    for (const f of files) {
      shotCount++;
      badge.textContent = String(shotCount);
      thumbBtn.style.visibility = 'visible';
      doneBtn.style.display = 'block';
      const url = URL.createObjectURL(f);
      thumbImg.src = url;
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      savePage(f, null);
      if (st.retake) break;
    }
    if (!st.batch || st.retake) {
      await saveChain;
      finish();
    }
  }

  async function importFromPhotos() {
    importFiles(await pickFiles({ accept: 'image/*', multiple: !st.retake }));
  }

  async function nativeCamera() {
    importFiles(await pickFiles({ accept: 'image/*', capture: 'environment' }));
  }

  async function toggleTorch() {
    if (!st.track) return;
    st.torch = !st.torch;
    try {
      await st.track.applyConstraints({ advanced: [{ torch: st.torch }] });
      torchBtn.classList.toggle('on', st.torch);
      clear(torchBtn).append(icon(st.torch ? 'flash' : 'flashOff'));
    } catch {
      st.torch = false;
      toast('Flash is not available');
    }
  }

  async function finish() {
    if (st.finishing) return;
    st.finishing = true;
    setHint(st.busy ? 'Saving pages…' : '');
    await saveChain;
    if (st.destroyed) return;
    if (!st.captured.length) {
      st.finishing = false;
      return back('/');
    }
    const next = st.next || `/doc/${st.docId}`;
    setFlow('review', { docId: st.docId, pageIds: st.captured.slice(), next });
    navigate(`/crop/${st.docId}`, { replace: true });
  }

  async function close() {
    if (st.captured.length || st.busy) return finish();
    back('/');
  }

  function showFallback(message) {
    clear(stage);
    stage.append(h('div', { class: 'cam-fallback' },
      h('h2', null, 'Live camera is not available'),
      h('p', null, message),
      h('button', { class: 'btn primary', type: 'button', onclick: nativeCamera }, icon('camera', 20), 'Take a photo'),
      h('button', { class: 'btn', type: 'button', onclick: importFromPhotos }, icon('photos', 20), 'Choose from Photos'),
      h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Cancel')));
    shutter.disabled = true;
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showFallback(window.isSecureContext ? 'This browser cannot use the camera.' : 'The camera only works when the app is opened over https.');
      return false;
    }
    try {
      st.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
      });
    } catch (e) {
      showFallback(e && e.name === 'NotAllowedError'
        ? 'Camera permission was denied. You can allow it in Settings > Safari > Camera, or take a photo below.'
        : 'Could not open the camera. You can still take a photo below.');
      return false;
    }
    if (st.destroyed) {
      st.stream.getTracks().forEach((t) => t.stop());
      return false;
    }
    video.srcObject = st.stream;
    st.track = st.stream.getVideoTracks()[0];
    try {
      await video.play();
    } catch {}
    const caps = (st.track.getCapabilities && st.track.getCapabilities()) || {};
    if (caps.torch) {
      torchBtn.style.display = '';
      clear(torchBtn).append(icon('flashOff'));
    }
    if (caps.focusMode && caps.focusMode.includes('continuous')) st.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    st.track.addEventListener('ended', () => {
      if (!st.destroyed && !document.hidden) startCamera();
    });
    try {
      if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen');
    } catch {}
    return true;
  }

  // iOS stops the camera when the app goes to the background; restart it on return.
  const onVisible = () => {
    if (!document.hidden && !st.destroyed && st.track && st.track.readyState === 'ended') startCamera();
  };
  document.addEventListener('visibilitychange', onVisible);
  const onResize = () => draw();
  window.addEventListener('resize', onResize);

  if (await startCamera()) detectLoop();

  return {
    destroy() {
      st.destroyed = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('resize', onResize);
      if (st.stream) st.stream.getTracks().forEach((t) => t.stop());
      if (wakeLock) wakeLock.release().catch(() => {});
    },
  };
}
