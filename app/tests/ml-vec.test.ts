import { describe, expect, test } from "bun:test";
import { decodeVec, dot, encodeVec, l2normalize } from "../client/lib/ml/vec";
import { coverRect, imageConfig, placeRect, rgbaToNchw } from "../client/lib/ml/preprocess";
import { LABELS, labelPrompt } from "../shared/labels";

describe("vectors", () => {
  test("base64 roundtrip is exact for 768 floats", () => {
    const v = Float32Array.from({ length: 768 }, (_, i) => Math.sin(i) * 3 - 0.5);
    const out = decodeVec(encodeVec(v));
    expect(out.length).toBe(768);
    for (let i = 0; i < 768; i++) expect(out[i]).toBe(v[i]);
  });
  test("wire format is little-endian float32", () => {
    // 1.0 = 0x3F800000 -> bytes 00 00 80 3F
    expect(Buffer.from(encodeVec(Float32Array.of(1)), "base64").toString("hex")).toBe("0000803f");
    expect(Array.from(decodeVec(Buffer.from("0000803f000000c0", "hex").toString("base64")))).toEqual([1, -2]);
  });
  test("l2normalize gives unit length and keeps zero", () => {
    const v = l2normalize(Float32Array.of(3, 4));
    expect(dot(v, v)).toBeCloseTo(1, 6);
    expect(Array.from(l2normalize(new Float32Array(3)))).toEqual([0, 0, 0]);
  });
});

describe("image preprocessing", () => {
  test("SigLIP config: fixed size, no crop", () => {
    const c = imageConfig({ size: { height: 256, width: 256 }, image_mean: [0.5, 0.5, 0.5], image_std: [0.5, 0.5, 0.5], rescale_factor: 0.5, do_resize: true });
    expect(c).toEqual({ size: 256, crop: false, mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5], rescale: 0.5 });
    expect(placeRect(4000, 3000, c)).toEqual({ dx: 0, dy: 0, dw: 256, dh: 256 });
  });
  test("CLIP-style config: shortest side, center crop", () => {
    const c = imageConfig({ crop_size: { width: 224, height: 224 }, do_center_crop: true, image_mean: [1, 2, 3], image_std: [4, 5, 6], rescale_factor: 0.5 });
    expect(c).toEqual({ size: 224, crop: true, mean: [1, 2, 3], std: [4, 5, 6], rescale: 0.5 });
    expect(placeRect(448, 224, c)).toEqual(coverRect(448, 224, 224));
  });
  test("coverRect: shortest side to 224, center crop", () => {
    expect(coverRect(448, 224, 224)).toEqual({ dx: -112, dy: 0, dw: 448, dh: 224 });
    expect(coverRect(100, 400, 224)).toEqual({ dx: 0, dy: -336, dw: 224, dh: 896 });
  });
  test("rgbaToNchw values", () => {
    const rgba = Uint8Array.of(255, 0, 51, 255); // one pixel
    const out = rgbaToNchw(rgba, 1, { size: 1, mean: [0.5, 0.5, 0.5], std: [0.5, 0.25, 1], rescale: 1 / 255 });
    expect(Array.from(out).map(x => +x.toFixed(4))).toEqual([1, -2, -0.3]);
  });
});

describe("labels", () => {
  test("about 300 unique German labels with English twins", () => {
    expect(LABELS.length).toBeGreaterThanOrEqual(280);
    expect(new Set(LABELS.map(l => l.de)).size).toBe(LABELS.length);
    expect(new Set(LABELS.map(l => l.en)).size).toBe(LABELS.length);
    for (const l of LABELS) expect(l.de && l.en).toBeTruthy();
    expect(LABELS.map(l => l.de)).toContain("Quittung");
    expect(labelPrompt({ de: "Strand", en: "beach" })).toBe("a photo of beach");
  });
  test("no long dashes anywhere in the vocabulary", () => {
    const bad = [0x2012, 0x2013, 0x2014, 0x2015].map(c => String.fromCharCode(c));
    expect(bad.some(c => JSON.stringify(LABELS).includes(c))).toBe(false);
  });
});
