// Hash router: "#/doc/123" shows the document screen, the browser Back button works,
// and each screen cleans up after itself (camera off, listeners removed) when you leave.

const routes = [];
let current = null;
let root = null;

export function route(pattern, screen) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => {
    keys.push(k);
    return '([^/]+)';
  }) + '$');
  routes.push({ re, keys, screen });
}

export function navigate(path, { replace = false } = {}) {
  const url = '#' + path;
  if (replace) {
    history.replaceState(null, '', url);
    replacing = true;
    render();
  } else if (location.hash === url) {
    render();
  } else {
    location.hash = path;
  }
}

// Paths visited inside the app, so Back knows whether there is somewhere to go back to
// (there is not when the app was opened straight on a deep link).
const stack = [];

export function back(fallback = '/') {
  if (stack.length > 1) history.back();
  else navigate(fallback, { replace: true });
}

function track(path, replaced) {
  if (stack[stack.length - 1] === path) return;
  if (stack.length > 1 && stack[stack.length - 2] === path) stack.pop();
  else if (replaced && stack.length) stack[stack.length - 1] = path;
  else stack.push(path);
}

let replacing = false;

function parse() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

async function render() {
  const { path, query } = parse();
  track(location.hash || '#/', replacing);
  replacing = false;
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    if (current && current.destroy) {
      try {
        current.destroy();
      } catch (e) {
        console.error(e);
      }
    }
    // Close any open sheet or dialog that belonged to the previous screen.
    document.getElementById('overlay').replaceChildren();
    const el = document.createElement('section');
    el.className = 'screen';
    root.replaceChildren(el);
    current = { el };
    try {
      const res = await r.screen(el, params, query);
      if (current && current.el === el) current.destroy = res && res.destroy;
    } catch (e) {
      console.error(e);
      el.innerHTML = '';
      const msg = document.createElement('div');
      msg.className = 'empty';
      msg.innerHTML = '<h2>Something went wrong</h2><p></p><a class="btn primary" href="#/">Back to library</a>';
      msg.querySelector('p').textContent = e.message || String(e);
      el.append(msg);
    }
    return;
  }
  navigate('/', { replace: true });
}

export function startRouter(el) {
  root = el;
  window.addEventListener('hashchange', render);
  render();
}

// Hand-over state between screens (for example "these 5 pages were just scanned").
const flowState = {};
export function setFlow(key, value) {
  flowState[key] = value;
}
export function takeFlow(key) {
  const v = flowState[key];
  delete flowState[key];
  return v;
}
export function peekFlow(key) {
  return flowState[key];
}
