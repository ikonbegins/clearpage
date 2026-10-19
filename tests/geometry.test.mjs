import assert from 'node:assert/strict';
import {
  orderCorners, isConvex, homography, applyHomography, rotateCorners, outputSize, estimateAspect, quadIoU, polygonArea,
} from '../js/engine/geometry.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// Projects a flat page of size pw x ph through a pinhole camera.
// The page is tilted by `tilt` (around the x axis) and turned by `yaw` (around the y axis).
function photographPage(pw, ph, tilt, f = 1500, imgW = 1200, imgH = 1600, yaw = 0) {
  const pts = [[-pw / 2, -ph / 2], [pw / 2, -ph / 2], [pw / 2, ph / 2], [-pw / 2, ph / 2]];
  return pts.map(([x, y]) => {
    let X = x, Y = y * Math.cos(tilt), Z = y * Math.sin(tilt);
    [X, Z] = [X * Math.cos(yaw) + Z * Math.sin(yaw), -X * Math.sin(yaw) + Z * Math.cos(yaw)];
    Z += 1800;
    return [imgW / 2 + (f * X) / Z, imgH / 2 + (f * Y) / Z];
  });
}

export const tests = [
  {
    name: 'orderCorners handles any input order and a 45 degree tilt',
    fn() {
      const q = [[10, 10], [100, 12], [98, 150], [8, 148]];
      assert.deepEqual(orderCorners([q[2], q[0], q[3], q[1]]), q);
      const diamond = [[50, 0], [100, 50], [50, 100], [0, 50]];
      const o = orderCorners(diamond);
      assert.equal(polygonArea(o), 5000);
      assert.ok(isConvex(o));
    },
  },
  {
    name: 'homography maps the four corners exactly',
    fn() {
      const src = [[0, 0], [400, 0], [400, 500], [0, 500]];
      const dst = [[37, 22], [411, 51], [390, 530], [20, 480]];
      const H = homography(src, dst);
      src.forEach((p, i) => {
        const [x, y] = applyHomography(H, p[0], p[1]);
        near(x, dst[i][0], 1e-6, 'x');
        near(y, dst[i][1], 1e-6, 'y');
      });
    },
  },
  {
    name: 'rotateCorners turns the output a quarter at a time',
    fn() {
      const q = [[0, 0], [1, 0], [1, 1], [0, 1]];
      assert.deepEqual(rotateCorners(q, 1), [[0, 1], [0, 0], [1, 0], [1, 1]]);
      assert.deepEqual(rotateCorners(q, 4), q);
      assert.deepEqual(rotateCorners(rotateCorners(q, 1), 3), q);
    },
  },
  {
    name: 'estimateAspect recovers a Letter page shot at a steep, twisted angle',
    fn() {
      const q = photographPage(850, 1100, 0.7, 1500, 1200, 1600, 0.35);
      const naive = Math.max(Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]), Math.hypot(q[2][0] - q[3][0], q[2][1] - q[3][1])) /
        Math.max(Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]), Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1]));
      const est = estimateAspect(q, 1200, 1600);
      near(est, 850 / 1100, 0.02, 'aspect');
      // The simple edge-length method is clearly worse here, which is why we do this.
      assert.ok(Math.abs(naive - 850 / 1100) > 0.05, `naive was ${naive}`);
    },
  },
  {
    name: 'estimateAspect uses a typical phone lens when the tilt is on one axis only',
    fn() {
      const q = photographPage(850, 1100, 0.7, 0.75 * 1600);
      near(estimateAspect(q, 1200, 1600), 850 / 1100, 0.03, 'aspect');
    },
  },
  {
    name: 'outputSize snaps to Letter and caps the long side',
    fn() {
      const q = photographPage(850, 1100, 0.4, 0.72 * 1600);
      const s = outputSize(q, 1200, 1600, 500);
      assert.equal(Math.max(s.width, s.height), 500);
      near(s.width / s.height, 8.5 / 11, 0.003, 'ratio');
    },
  },
  {
    name: 'quadIoU is 1 for equal quads and lower for shifted ones',
    fn() {
      const a = [[0, 0], [10, 0], [10, 10], [0, 10]];
      near(quadIoU(a, a), 1, 1e-9, 'same');
      const b = a.map(([x, y]) => [x + 5, y]);
      near(quadIoU(a, b), 50 / 150, 1e-9, 'half');
    },
  },
];
