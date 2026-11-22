import { test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { STYLES, THEME_KEYS, LIGHTS, tokens } from "../shared/styles";
import { styleCss, nativeKotlin, nativeSwift, argb, KOTLIN_PATH, SWIFT_PATH } from "../tools/styles";
import { startServer, seedSession, pairDevice, ROOT } from "./helpers";

test("the Android and Mac copies of the styles are generated from shared/styles.ts as it is now", () => {
  // stale means someone changed a style and did not run `bun tools/styles.ts`: the apps would wear the old one
  expect(readFileSync(KOTLIN_PATH, "utf8")).toBe(nativeKotlin());
  expect(readFileSync(SWIFT_PATH, "utf8")).toBe(nativeSwift());
});

test("every style has every token in every light, a technique for every element and its mark", () => {
  const keys = (t: (typeof THEME_KEYS)[number]) => Object.keys(tokens(t, "mittag")).sort();
  for (const t of THEME_KEYS) {
    for (const l of LIGHTS) expect(Object.keys(tokens(t, l)).sort()).toEqual(keys(t));
    // every style can stand in for Monet: it defines at least what Monet does
    for (const k of keys("monet")) expect(tokens(t, "mittag")).toHaveProperty(k);
    expect(Object.keys(STYLES[t].technique).sort()).toEqual(["band", "card", "map", "sun", "underline"]);
    expect(existsSync(join(ROOT, "client/icons", STYLES[t].mark.file))).toBe(true);
    expect(tokens(t, "nacht").scheme).toBe("dark");
  }
});

test("the generated CSS gives each style its own block per light and the night for a dark system", () => {
  const css = styleCss();
  expect(css).toContain(":root{--");
  for (const t of THEME_KEYS.filter(t => t !== "monet")) {
    expect(css).toContain(`:root[data-theme=${t}]{`);
    expect(css).toContain(`:root[data-theme=${t}][data-light=nacht]{`);
    expect(css).toContain(`@media (prefers-color-scheme: dark){:root[data-theme=${t}]:not([data-light]){`);
  }
});

test("colours parse for the native apps, with alpha", () => {
  expect(argb("#EEF2EA")).toBe(0xFFEEF2EA);
  expect(argb("rgb(34 48 94 / .52)")).toBe(((Math.round(0.52 * 255) << 24) | 0x22305e) >>> 0);
  expect(argb("linear-gradient(red, blue)")).toBeNull();
});

test("a paired device learns the style of its library from /api/status and follows a change", async () => {
  const srv = await startServer();
  try {
    const cookie = await seedSession(srv);
    const dev = await pairDevice(srv, cookie, "android");
    const st = async () => (await (await srv.fetch("/api/status", { token: dev.token })).json()) as { theme: string };
    expect((await st()).theme).toBe("monet");
    expect((await srv.fetch("/api/household/me", { method: "PATCH", cookie, json: { theme: "magritte" } })).status).toBe(200);
    expect((await st()).theme).toBe("magritte");
  } finally { await srv.stop(); }
});
