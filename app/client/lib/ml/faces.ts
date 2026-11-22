// Face pipeline maths: YuNet output decoding, NMS, the similarity transform for SFace alignment, and the warp.

export const ARCFACE_TEMPLATE: [number, number][] = [
  [38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041],
];

export type Det = { x: number; y: number; w: number; h: number; score: number; lm: number[] }; // pixels of the detector input

export type OutTensor = { data: Float32Array | ArrayLike<number>; dims: readonly number[] };

/**
 * YuNet 2023mar decode, as in OpenCV's FaceDetectorYNImpl::postProcess: strides 8/16/32, score = sqrt(cls * obj)
 * (both clamped to 0..1), box centre = (cell + offset) * stride, size = exp(v) * stride, landmarks = (cell + v) * stride.
 * `out` is keyed by output name: cls_8, obj_8, bbox_8, kps_8 and the same for 16 and 32.
 */
export function decodeYunet(out: Record<string, OutTensor>, W: number, H: number, scoreThr = 0.6): Det[] {
  const dets: Det[] = [];
  for (const s of [8, 16, 32]) {
    const cls = out[`cls_${s}`].data, obj = out[`obj_${s}`].data, bbox = out[`bbox_${s}`].data, kps = out[`kps_${s}`].data;
    const cols = Math.floor(W / s), rows = Math.floor(H / s);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const score = Math.sqrt(Math.min(Math.max(cls[i], 0), 1) * Math.min(Math.max(obj[i], 0), 1));
      if (score < scoreThr) continue;
      const cx = (c + bbox[i * 4]) * s, cy = (r + bbox[i * 4 + 1]) * s;
      const w = Math.exp(bbox[i * 4 + 2]) * s, h = Math.exp(bbox[i * 4 + 3]) * s;
      const lm: number[] = [];
      for (let n = 0; n < 5; n++) lm.push((kps[i * 10 + 2 * n] + c) * s, (kps[i * 10 + 2 * n + 1] + r) * s);
      dets.push({ x: cx - w / 2, y: cy - h / 2, w, h, score, lm });
    }
  }
  return dets;
}

export function iou(a: Det, b: Det): number {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}

export function nms(dets: Det[], thr = 0.3): Det[] {
  const sorted = [...dets].sort((a, b) => b.score - a.score), keep: Det[] = [];
  for (const d of sorted) if (keep.every(k => iou(k, d) <= thr)) keep.push(d);
  return keep;
}

/** Similarity transform x' = a x - b y + tx, y' = b x + a y + ty (rotation, uniform scale, translation). */
export type Sim = { a: number; b: number; tx: number; ty: number };

/** Umeyama's least-squares similarity (no reflection), in its closed form for 2D via complex numbers. */
export function umeyama(src: number[][], dst: number[][]): Sim {
  const n = src.length;
  let msx = 0, msy = 0, mdx = 0, mdy = 0;
  for (let i = 0; i < n; i++) { msx += src[i][0]; msy += src[i][1]; mdx += dst[i][0]; mdy += dst[i][1]; }
  msx /= n; msy /= n; mdx /= n; mdy /= n;
  let num_re = 0, num_im = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - msx, sy = src[i][1] - msy, dx = dst[i][0] - mdx, dy = dst[i][1] - mdy;
    num_re += sx * dx + sy * dy; // conj(s) * d
    num_im += sx * dy - sy * dx;
    den += sx * sx + sy * sy;
  }
  const a = num_re / den, b = num_im / den;
  return { a, b, tx: mdx - (a * msx - b * msy), ty: mdy - (b * msx + a * msy) };
}

export function applySim(t: Sim, x: number, y: number): [number, number] {
  return [t.a * x - t.b * y + t.tx, t.b * x + t.a * y + t.ty];
}

/**
 * Warp the face into a size x size crop. `m` maps source -> crop; for each crop pixel the source point is found by
 * the inverse, then bilinear sampling (zero outside the image, like cv::warpAffine). Returns RGB bytes, HWC.
 */
export function warpFace(rgba: Uint8ClampedArray | Uint8Array, W: number, H: number, m: Sim, size = 112): Uint8Array {
  const out = new Uint8Array(size * size * 3), d = m.a * m.a + m.b * m.b;
  for (let v = 0; v < size; v++) for (let u = 0; u < size; u++) {
    const px = u - m.tx, py = v - m.ty;
    const sx = (m.a * px + m.b * py) / d, sy = (-m.b * px + m.a * py) / d;
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    for (let c = 0; c < 3; c++) {
      const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : rgba[(y * W + x) * 4 + c]);
      const val = at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy;
      out[(v * size + u) * 3 + c] = Math.round(val);
    }
  }
  return out;
}

/** Detection score times a size factor: faces under 112 px on the short side count for less. */
export function faceQuality(score: number, wPx: number, hPx: number): number {
  return score * Math.min(1, Math.min(wPx, hPx) / 112);
}
