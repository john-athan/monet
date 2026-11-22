import { test, expect } from "bun:test";
import { lightFor, nextMode, parseMode } from "../client/lib/light";
import { bytes, monthShort, word, ago, fullDate, num } from "../client/lib/format";

test("the light follows the clock: morgen 6-10, mittag 10-17, abend 17-21, nacht 21-6", () => {
  const at = (h: number) => lightFor(h);
  expect([5, 6, 9, 10, 16, 17, 20, 21, 23, 0].map(at)).toEqual(["nacht", "morgen", "morgen", "mittag", "mittag", "abend", "abend", "nacht", "nacht", "nacht"]);
  expect(lightFor(12, true)).toBe("nacht"); // the dark scheme forces the night
});

test("the button cycles through every light and back to automatic", () => {
  let m = nextMode("auto"); const seen = [m];
  for (let i = 0; i < 4; i++) { m = nextMode(m); seen.push(m); }
  expect(seen).toEqual(["morgen", "mittag", "abend", "nacht", "auto"]);
  expect(parseMode("abend")).toBe("abend");
  expect(parseMode("blau")).toBe("auto");
  expect(parseMode(null)).toBe("auto");
});

test("German formats", () => {
  expect(num(52310)).toBe("52.310");
  expect(bytes(3_800_000)).toBe("3,8 MB");
  expect(bytes(412e9)).toBe("412 GB");
  expect(monthShort("2026-11")).toBe("Nov. 2026");
  expect(word(3)).toBe("drei");
  expect(word(14)).toBe("14");
  expect(ago(Date.now() - 4 * 60_000)).toBe("vor vier Minuten");
  expect(ago(null)).toBe("noch nie");
  // 11:20 in Oberstdorf in winter is UTC+1
  expect(fullDate(Date.UTC(2015, 1, 14, 10, 20), 60)).toBe("Samstag, 14. Februar 2015");
});

test("no dash characters from the figure dash to the horizontal bar anywhere in the client", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dashes = new RegExp("[" + String.fromCharCode(0x2012) + "-" + String.fromCharCode(0x2015) + "]");
  const bad: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (!p.endsWith("/ml")) walk(p); } else if (/\.(ts|svelte|css|html|js)$/.test(f) && dashes.test(readFileSync(p, "utf8"))) bad.push(p); } };
  walk(join(import.meta.dir, "../client"));
  expect(bad).toEqual([]);
});

test("the viewer's ground follows the photo's hue, greys stand on the night", async () => {
  const { groundFor, NIGHT_GROUND } = await import("../client/lib/light");
  expect(groundFor("#4C8A52")).toBe("#1F3524"); // green: garten
  expect(groundFor("#2F7F86")).toBe("#173A3E"); // teal: teich
  expect(groundFor("#C8707A")).toBe("#45242C"); // rose: atelier
  expect(groundFor("#E2AE1C")).toBe("#3E3214"); // ochre: esszimmer
  expect(groundFor("#D9532A")).toBe("#43251A"); // orange: abend
  expect(groundFor("#3D6FB0")).toBe("#1A1E44"); // blue: the night
  expect(groundFor("#808080")).toBe(NIGHT_GROUND);
  expect(groundFor(null)).toBe(NIGHT_GROUND);
});

test("the painted ground shifts colour like an impressionist: no black, violet shadows, warm light", async () => {
  const { impress } = await import("../client/lib/ground");
  const [hd, , ld] = impress(0, 0, 0);
  expect(ld).toBeGreaterThanOrEqual(.2); // black becomes a dark colour
  expect(hd).toBeGreaterThan(200); expect(hd).toBeLessThan(290); // and that colour is blue violet
  const [hw, , lw] = impress(255, 255, 255);
  expect(lw).toBeLessThan(.85); // white is not paper white
  expect(hw).toBeGreaterThan(20); expect(hw).toBeLessThan(70); // it is warm
  const [, sg] = impress(76, 138, 82);
  expect(sg).toBeGreaterThan(.3); // colour gets louder
});
