// Main-thread side of the engine worker: turns messages into promises.
// Two workers: one for live camera detection, one for rendering pages,
// so a slow page render never makes the camera outline stutter.

class EngineWorker {
  constructor() {
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.pending = new Map();
    this.seq = 0;
    this.worker.onmessage = (e) => {
      const { id, ok, result, error } = e.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (ok) p.resolve(result);
      else p.reject(new Error(error));
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'Worker error'));
      this.pending.clear();
    };
  }

  call(type, payload = {}, transfer = []) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, payload }, transfer);
    });
  }

  get busy() {
    return this.pending.size > 0;
  }
}

let detector = null;
let renderer = null;

export function getDetector() {
  return (detector ??= new EngineWorker());
}

export function getRenderer() {
  return (renderer ??= new EngineWorker());
}

// Sends ImageData-like pixels to the detector. The buffer is transferred (not copied).
export function detectInWorker(img, opts) {
  const buffer = img.data.buffer;
  return getDetector().call('detect', { buffer, width: img.width, height: img.height, opts }, [buffer]);
}
