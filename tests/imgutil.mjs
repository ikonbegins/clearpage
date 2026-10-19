// Small image helpers for Node tests (the app itself uses canvas instead).
import fs from 'node:fs';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

export function loadJpeg(path) {
  const raw = jpeg.decode(fs.readFileSync(path), { useTArray: true, maxMemoryUsageInMB: 1024 });
  return { data: new Uint8ClampedArray(raw.data.buffer), width: raw.width, height: raw.height };
}

export function savePng(path, img) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  fs.writeFileSync(path, PNG.sync.write(png));
}

export function saveJpeg(path, img, quality = 85) {
  fs.writeFileSync(path, jpeg.encode({ data: img.data, width: img.width, height: img.height }, quality).data);
}

// Area-average downscale, close to what canvas drawImage does with high smoothing.
export function resize(img, maxSide) {
  const s = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
  const out = new Uint8ClampedArray(w * h * 4);
  const fx = img.width / w, fy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * img.width + xx) * 4;
          r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h, scale: s };
}

export function drawQuad(img, q, color) {
  for (let s = 0; s < 4; s++) {
    const a = q[s], b = q[(s + 1) % 4];
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
    for (let k = 0; k <= n; k++) {
      const x = Math.round(a[0] + ((b[0] - a[0]) * k) / n), y = Math.round(a[1] + ((b[1] - a[1]) * k) / n);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height) continue;
          const i = (yy * img.width + xx) * 4;
          img.data[i] = color[0]; img.data[i + 1] = color[1]; img.data[i + 2] = color[2];
        }
    }
  }
}
