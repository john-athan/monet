import { expect, test } from "bun:test";
import { readPpmImage } from "../server/calc";
import { boxesFromMap, ctcDecode, detInput, readingOrder, recInput, REC_H } from "../server/ocr";

test("ppm: header with a comment, size and pixels", () => {
  const head = new TextEncoder().encode("P6\n# vips\n2 1\n255\n");
  const im = readPpmImage(new Uint8Array([...head, 255, 0, 0, 0, 0, 255]));
  expect([im.w, im.h, [...im.px]]).toEqual([2, 1, [255, 0, 0, 0, 0, 255]]);
  expect(() => readPpmImage(new Uint8Array([...head, 1, 2]))).toThrow();
});

test("detector input: long side at most the limit, sides a multiple of 32, BGR normalised", () => {
  const im = { w: 2000, h: 1000, px: new Uint8Array(2000 * 1000 * 3).fill(255) };
  const d = detInput(im);
  expect([d.w, d.h]).toEqual([960, 480]);
  expect(d.data[0]).toBeCloseTo((1 - .485) / .229, 4);
  expect(d.sx).toBeCloseTo(2000 / 960, 6);
});

test("boxes: one region per text blob, weak or tiny regions dropped, grown by the unclip distance", () => {
  const w = 40, h = 20, m = new Float32Array(w * h);
  for (let y = 5; y < 10; y++) for (let x = 5; x < 25; x++) m[y * w + x] = .9; // a line of text
  m[15 * w + 35] = .9; // a speck
  for (let y = 14; y < 18; y++) for (let x = 2; x < 12; x++) m[y * w + x] = .4; // faint: above thresh, below boxThresh
  const b = boxesFromMap(m, w, h);
  expect(b.length).toBe(1);
  const d = (20 * 5 * 1.5) / (2 * 25);
  expect(b[0].x).toBeCloseTo(5 - d, 5); expect(b[0].w).toBeCloseTo(20 + 2 * d, 5);
});

test("recogniser input: 48 high, width in proportion, tall crops turned", () => {
  const im = { w: 100, h: 100, px: new Uint8Array(100 * 100 * 3) };
  expect(recInput(im, { x: 0, y: 0, w: 80, h: 20, score: 1 }).w).toBe(192);
  expect(recInput(im, { x: 0, y: 0, w: 10, h: 80, score: 1 }).w).toBe(384);
  expect(REC_H).toBe(48);
});

test("ctc: repeats merge, blanks separate, the last class is a space", () => {
  const dict = ["a", "b"], C = 4; // blank, a, b, space
  const steps = [1, 1, 0, 1, 2, 3, 2];
  const l = new Float32Array(steps.length * C);
  steps.forEach((c, t) => (l[t * C + c] = .9));
  expect(ctcDecode(l, steps.length, C, dict)).toEqual({ text: "aab b", score: expect.closeTo(.9, 5) as any });
});

test("reading order: top to bottom, left to right within a line", () => {
  const at = (x: number, y: number, t: string) => ({ box: { x, y, w: 30, h: 10, score: 1 }, t });
  expect(readingOrder([at(50, 31, "d"), at(0, 0, "a"), at(40, 2, "b"), at(0, 30, "c")]).map(r => r.t).join("")).toBe("abcd");
});
