// App start: open storage, apply theme, wire up screens, register offline support.
import { route, startRouter } from './ui/router.js';
import { libraryScreen } from './ui/library.js';
import { cameraScreen } from './ui/camera.js';
import { cropScreen } from './ui/crop.js';
import { editScreen } from './ui/edit.js';
import { documentScreen } from './ui/document.js';
import { settingsScreen } from './ui/settings.js';
import { trashScreen } from './ui/trash.js';
import { textScreen } from './ui/text.js';
import { applyTheme } from './ui/theme.js';
import { toast } from './ui/dom.js';
import { openDb, getAll } from './services/db.js';
import { getSettings } from './services/settings.js';
import { purgeExpiredTrash, requestPersistence } from './services/library.js';
import { queueRender, isRendered } from './services/render.js';

function fatal(message) {
  document.getElementById('app').innerHTML = '';
  const box = document.createElement('div');
  box.className = 'empty';
  box.innerHTML = '<h2>ClearPage cannot start</h2><p></p>';
  box.querySelector('p').textContent = message;
  document.getElementById('app').append(box);
}

async function boot() {
  try {
    await openDb();
  } catch (e) {
    console.error(e);
    return fatal('This browser is not letting the app store files. Private Browsing blocks storage; please open the app in a normal Safari tab.');
  }
  const settings = await getSettings();
  applyTheme(settings.theme);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => applyTheme((await getSettings()).theme));

  route('/', libraryScreen);
  route('/camera', cameraScreen);
  route('/crop/:docId', cropScreen);
  route('/page/:id', editScreen);
  route('/doc/:id', documentScreen);
  route('/text/:docId', textScreen);
  route('/settings', settingsScreen);
  route('/trash', trashScreen);
  startRouter(document.getElementById('app'));

  // Housekeeping after the first screen is up.
  setTimeout(async () => {
    purgeExpiredTrash().catch(console.error);
    requestPersistence();
    // Finish any page renders that were interrupted (for example the app was closed mid-scan).
    try {
      const pages = await getAll('pages');
      const docs = await getAll('docs');
      const live = new Set(docs.filter((d) => !d.deletedAt).flatMap((d) => d.pageIds));
      pages.filter((p) => live.has(p.id) && !isRendered(p)).forEach((p) => queueRender(p.id));
    } catch (e) {
      console.error(e);
    }
  }, 800);

  registerServiceWorker();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.hostname === 'localhost' && location.search.includes('nosw')) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const prompt = (worker) => {
      toast('A new version of ClearPage is ready', {
        action: 'Update',
        duration: 15000,
        onAction: () => worker.postMessage('skipWaiting'),
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w);
      });
    });
  }).catch((e) => console.warn('Offline support is not available', e));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

boot();
