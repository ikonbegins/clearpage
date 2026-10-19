// A tiny publish/subscribe hub so screens can refresh when data changes elsewhere
// (for example when a page finishes rendering in the background).
const handlers = new Map();

export function on(type, fn) {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type).add(fn);
  return () => handlers.get(type).delete(fn);
}

export function emit(type, detail) {
  const set = handlers.get(type);
  if (set) for (const fn of [...set]) {
    try {
      fn(detail);
    } catch (e) {
      console.error(e);
    }
  }
}
