// Perspective warp: turns the tilted page in the photo into a flat rectangle.
// For every output pixel we ask "where did this come from in the photo?" (the inverse
// homography) and blend the 4 nearest photo pixels (bilinear sampling).
import { homography } from './geometry.js';

export function warpPerspective(src, quad, outW, outH) {
  const H = homography([[0, 0], [outW, 0], [outW, outH], [0, outH]], quad);
  const out = new Uint8ClampedArray(outW * outH * 4);
  if (!H) return { data: out, width: outW, height: outH };
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = H;
  const sw = src.width, sh = src.height, sd = src.data;
  const maxX = sw - 1, maxY = sh - 1;
  let o = 0;
  for (let v = 0; v < outH; v++) {
    const vy = v + 0.5;
    // Values at u = 0.5; then step by one column at a time (cheaper than recomputing).
    let X = h0 * 0.5 + h1 * vy + h2;
    let Y = h3 * 0.5 + h4 * vy + h5;
    let Z = h6 * 0.5 + h7 * vy + h8;
    for (let u = 0; u < outW; u++) {
      const iz = 1 / Z;
      let x = X * iz - 0.5, y = Y * iz - 0.5;
      X += h0;
      Y += h3;
      Z += h6;
      if (x < 0) x = 0; else if (x > maxX) x = maxX;
      if (y < 0) y = 0; else if (y > maxY) y = maxY;
      const x0 = x | 0, y0 = y | 0;
      const fx = x - x0, fy = y - y0;
      const x1 = x0 < maxX ? x0 + 1 : x0, y1 = y0 < maxY ? y0 + 1 : y0;
      const i00 = (y0 * sw + x0) << 2, i01 = (y0 * sw + x1) << 2;
      const i10 = (y1 * sw + x0) << 2, i11 = (y1 * sw + x1) << 2;
      const w00 = (1 - fx) * (1 - fy), w01 = fx * (1 - fy), w10 = (1 - fx) * fy, w11 = fx * fy;
      out[o] = sd[i00] * w00 + sd[i01] * w01 + sd[i10] * w10 + sd[i11] * w11;
      out[o + 1] = sd[i00 + 1] * w00 + sd[i01 + 1] * w01 + sd[i10 + 1] * w10 + sd[i11 + 1] * w11;
      out[o + 2] = sd[i00 + 2] * w00 + sd[i01 + 2] * w01 + sd[i10 + 2] * w10 + sd[i11 + 2] * w11;
      out[o + 3] = 255;
      o += 4;
    }
  }
  return { data: out, width: outW, height: outH };
}

// Halves an image by averaging 2x2 blocks. Used to build smaller copies for fast previews,
// because bilinear sampling from a much bigger image would look grainy (aliasing).
export function halfSize(src) {
  const w = src.width >> 1, h = src.height >> 1;
  const out = new Uint8ClampedArray(w * h * 4);
  const sw = src.width, sd = src.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = ((2 * y) * sw + 2 * x) << 2, b = a + 4, c = a + (sw << 2), d = c + 4;
      const o = (y * w + x) << 2;
      out[o] = (sd[a] + sd[b] + sd[c] + sd[d] + 2) >> 2;
      out[o + 1] = (sd[a + 1] + sd[b + 1] + sd[c + 1] + sd[d + 1] + 2) >> 2;
      out[o + 2] = (sd[a + 2] + sd[b + 2] + sd[c + 2] + sd[d + 2] + 2) >> 2;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}
