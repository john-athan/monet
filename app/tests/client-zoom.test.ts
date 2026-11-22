import { test, expect } from "bun:test";
import { clamp, zoomAt, levelFor, tilesFor, maxScale, oneToOne, type Box, type Pyramid } from "../client/lib/zoom";

// a 4000 x 3000 photo fitted into an 800 x 800 stage: 800 x 600, 100 px from the top
const b: Box = { fx: 0, fy: 100, fw: 800, fh: 600, W: 800, H: 800 };
const p: Pyramid = { w: 4000, h: 3000, tile: 510, overlap: 1, maxLevel: 12 };

test("fitted, the picture stays centred; zoomed, it never shows a gap at an edge", () => {
  expect(clamp({ s: 1, x: 50, y: -30 }, b, 10)).toEqual({ s: 1, x: 0, y: 0 });
  const v = clamp({ s: 2, x: 100, y: 0 }, b, 10);
  expect(v.x).toBe(0); // left edge pinned
  expect(clamp({ s: 2, x: -2000, y: 0 }, b, 10).x).toBe(-800); // right edge pinned: 1600 wide in 800
  expect(clamp({ s: 2, x: 0, y: 500 }, b, 10).y).toBe(-100); // 1200 tall in 800: top edge at the stage top
  expect(clamp({ s: 0.5, x: 0, y: 0 }, b, 10).s).toBe(1);
  expect(clamp({ s: 99, x: 0, y: 0 }, b, 10).s).toBe(10);
});
test("zooming keeps the point under the finger where it is", () => {
  const v = zoomAt({ s: 1, x: 0, y: 0 }, 3, 200, 400, b);
  // the picture point under (200, 400) was (200, 300) in fitted px; after zooming it is still at (200, 400)
  expect(b.fx + v.x + 3 * 200).toBeCloseTo(200); expect(b.fy + v.y + 3 * 300).toBeCloseTo(400);
});
test("the level covers the screen; below the base picture no tiles are needed", () => {
  expect(levelFor(p, b, 1, 2, 2048)).toBe(-1); // 1600 device px: the 2048 copy is enough
  const L = levelFor(p, b, 4, 2, 2048); // 6400 device px wanted, the photo has 4000: the full level
  expect(L).toBe(12);
  const L2 = levelFor(p, b, 2, 2, 2048); // 3200 wanted: level 12 (4000), since level 11 is 2000
  expect(L2).toBe(12);
  expect(levelFor(p, { ...b, fw: 300 }, 3, 2, 1000)).toBe(11); // 1800 wanted: level 11 is 2000 wide
});
test("only the tiles on screen, with the overlap of their neighbours", () => {
  const all = tilesFor(p, 12, { s: 1, x: 0, y: 0 }, b);
  expect(all.length).toBe(8 * 6); // 4000/510 -> 8 columns, 3000/510 -> 6 rows
  const t = all.find(x => x.col === 1 && x.row === 0)!;
  expect(t.left).toBeCloseTo(509 / 4000 * 100); expect(t.width).toBeCloseTo(512 / 4000 * 100);
  // zoomed 4x into the top left corner: only the first two columns and rows are visible
  const some = tilesFor(p, 12, { s: 4, x: 0, y: -100 }, b);
  expect(new Set(some.map(x => x.col))).toEqual(new Set([0, 1]));
  expect(tilesFor(p, -1, { s: 1, x: 0, y: 0 }, b)).toEqual([]);
});
test("the zoom limits", () => {
  expect(oneToOne(b, 4000, 2)).toBe(2.5);
  expect(maxScale(b, 4000, 2)).toBe(5);
  expect(maxScale(b, 400, 2)).toBe(2);
});
