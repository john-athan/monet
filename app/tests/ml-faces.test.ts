import { describe, expect, test } from "bun:test";
import { ARCFACE_TEMPLATE, applySim, decodeYunet, faceQuality, iou, nms, umeyama, warpFace, type Det } from "../client/lib/ml/faces";

describe("Umeyama similarity", () => {
  test("recovers a known rotation, scale and translation", () => {
    const a = 0.8 * Math.cos(0.4), b = 0.8 * Math.sin(0.4);
    const src = ARCFACE_TEMPLATE.map(([x, y]) => [x, y]);
    const dst = src.map(([x, y]) => [a * x - b * y + 30, b * x + a * y - 12]);
    const t = umeyama(src, dst);
    expect(t.a).toBeCloseTo(a, 9); expect(t.b).toBeCloseTo(b, 9); expect(t.tx).toBeCloseTo(30, 7); expect(t.ty).toBeCloseTo(-12, 7);
  });
  test("maps landmarks of a scaled copy of the template back onto the template", () => {
    const lm = ARCFACE_TEMPLATE.map(([x, y]) => [x * 3 + 200, y * 3 + 80]);
    const t = umeyama(lm, ARCFACE_TEMPLATE);
    lm.forEach(([x, y], i) => { const [u, v] = applySim(t, x, y); expect(u).toBeCloseTo(ARCFACE_TEMPLATE[i][0], 6); expect(v).toBeCloseTo(ARCFACE_TEMPLATE[i][1], 6); });
    expect(Math.hypot(t.a, t.b)).toBeCloseTo(1 / 3, 9);
  });
  test("noisy points: least squares residual is small and the result is a proper rotation", () => {
    const lm = ARCFACE_TEMPLATE.map(([x, y], i) => [x * 2 + 10 + (i % 2 ? 0.3 : -0.3), y * 2 + 5 + (i % 2 ? -0.2 : 0.2)]);
    const t = umeyama(lm, ARCFACE_TEMPLATE);
    for (let i = 0; i < 5; i++) { const [u, v] = applySim(t, lm[i][0], lm[i][1]); expect(Math.hypot(u - ARCFACE_TEMPLATE[i][0], v - ARCFACE_TEMPLATE[i][1])).toBeLessThan(0.6); }
  });
});

describe("warpFace", () => {
  test("identity transform copies pixels, zero outside the image", () => {
    const W = 4, H = 4, rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) rgba.set([i * 10, i * 5, 255 - i, 255], i * 4);
    const out = warpFace(rgba, W, H, { a: 1, b: 0, tx: 0, ty: 0 }, 6);
    expect(Array.from(out.slice(0, 3))).toEqual([0, 0, 255]);
    expect(Array.from(out.slice((1 * 6 + 2) * 3, (1 * 6 + 2) * 3 + 3))).toEqual([60, 30, 249]);
    expect(Array.from(out.slice((5 * 6 + 5) * 3, (5 * 6 + 5) * 3 + 3))).toEqual([0, 0, 0]);
  });
  test("2x zoom samples between pixels (bilinear)", () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255, 100, 100, 100, 255, 0, 0, 0, 255, 100, 100, 100, 255]); // 2x2
    const out = warpFace(rgba, 2, 2, { a: 2, b: 0, tx: 0, ty: 0 }, 2); // crop pixel (1,0) <- source x 0.5
    expect(out[3]).toBe(50);
  });
});

function synthetic(W: number, H: number, hit: { s: number; r: number; c: number; cls: number; obj: number; bbox: number[]; kps: number[] }[]) {
  const out: Record<string, { data: Float32Array; dims: number[] }> = {};
  for (const s of [8, 16, 32]) {
    const n = (W / s) * (H / s);
    out[`cls_${s}`] = { data: new Float32Array(n), dims: [1, n, 1] }; out[`obj_${s}`] = { data: new Float32Array(n), dims: [1, n, 1] };
    out[`bbox_${s}`] = { data: new Float32Array(n * 4), dims: [1, n, 4] }; out[`kps_${s}`] = { data: new Float32Array(n * 10), dims: [1, n, 10] };
  }
  for (const h of hit) {
    const i = h.r * (W / h.s) + h.c;
    out[`cls_${h.s}`].data[i] = h.cls; out[`obj_${h.s}`].data[i] = h.obj;
    out[`bbox_${h.s}`].data.set(h.bbox, i * 4); out[`kps_${h.s}`].data.set(h.kps, i * 10);
  }
  return out;
}

describe("YuNet decode", () => {
  test("one cell at stride 16 becomes the expected box, score and landmarks", () => {
    const kps = [-1, -0.5, 1, -0.5, 0, 0, -1, 1, 1, 1];
    const out = synthetic(640, 640, [{ s: 16, r: 10, c: 20, cls: 0.81, obj: 1, bbox: [0.5, 0.5, Math.log(4), Math.log(5)], kps }]);
    const d = decodeYunet(out, 640, 640, 0.6);
    expect(d.length).toBe(1);
    // centre (20.5*16, 10.5*16) = (328, 168), size 64 x 80
    expect(d[0].score).toBeCloseTo(0.9, 6);
    expect(d[0].x).toBeCloseTo(328 - 32, 4); expect(d[0].y).toBeCloseTo(168 - 40, 4);
    expect(d[0].w).toBeCloseTo(64, 4); expect(d[0].h).toBeCloseTo(80, 4);
    expect(d[0].lm[0]).toBeCloseTo((20 - 1) * 16, 4); expect(d[0].lm[1]).toBeCloseTo((10 - 0.5) * 16, 4);
    expect(d[0].lm[8]).toBeCloseTo((20 + 1) * 16, 4); expect(d[0].lm[9]).toBeCloseTo((10 + 1) * 16, 4);
  });
  test("score threshold, and cls/obj are clamped to 0..1", () => {
    const out = synthetic(640, 640, [
      { s: 8, r: 3, c: 3, cls: 0.5, obj: 0.5, bbox: [0, 0, 1, 1], kps: new Array(10).fill(0) }, // 0.5 < 0.6
      { s: 32, r: 2, c: 2, cls: 3, obj: 2, bbox: [0, 0, 1, 1], kps: new Array(10).fill(0) }, // clamps to 1
    ]);
    const d = decodeYunet(out, 640, 640, 0.6);
    expect(d.length).toBe(1);
    expect(d[0].score).toBe(1);
  });
  test("NMS keeps the best of overlapping boxes and both of disjoint ones", () => {
    const mk = (x: number, s: number): Det => ({ x, y: 0, w: 100, h: 100, score: s, lm: [] });
    const kept = nms([mk(0, 0.7), mk(10, 0.9), mk(500, 0.8)], 0.3);
    expect(kept.map(k => k.score)).toEqual([0.9, 0.8]);
    expect(iou(mk(0, 1), mk(0, 1))).toBe(1);
    expect(iou(mk(0, 1), mk(100, 1))).toBe(0);
  });
  test("quality is the score times a size factor capped at 1", () => {
    expect(faceQuality(0.9, 224, 300)).toBeCloseTo(0.9, 9);
    expect(faceQuality(0.9, 56, 80)).toBeCloseTo(0.45, 9);
  });
});
