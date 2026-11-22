// Vector helpers: L2 normalisation, cosine, and the base64 little-endian float32 wire format used by /api/index.

export function l2normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Float32Array -> base64 of its little-endian bytes (independent of the host byte order). */
export function encodeVec(v: Float32Array): string {
  const buf = new ArrayBuffer(v.length * 4);
  const dv = new DataView(buf);
  for (let i = 0; i < v.length; i++) dv.setFloat32(i * 4, v[i], true);
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function decodeVec(b64: string): Float32Array {
  const bin = atob(b64);
  const dv = new DataView(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) dv.setUint8(i, bin.charCodeAt(i));
  const out = new Float32Array(bin.length >> 2);
  for (let i = 0; i < out.length; i++) out[i] = dv.getFloat32(i * 4, true);
  return out;
}
