// A stand-in server for developing the client: JSON in the shape of docs/spec.md and shared/types.ts, the photos of
// a folder you name served as media (every size is the same file). Everyone is logged in unless MOCK_LOGGED_OUT=1.
//   MONET_TESTDATA=<folder of jpg/png> bun tools/dev-mock.ts    after bun run build.ts --dev
//   (PORT=4321, MOCK_ITEMS=2400, MOCK_THEME=ernst for your own style)
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import type { ItemSummary, TimelineDay, ItemDetail } from "../shared/types";

const PORT = Number(process.env.PORT ?? 4321), DIST = join(import.meta.dir, "../dist");
const DIR = process.env.MONET_TESTDATA ?? "";
if (!DIR || !existsSync(DIR)) { console.error("dev-mock: set MONET_TESTDATA to a folder of jpg or png photos"); process.exit(2); }
let loggedIn = process.env.MOCK_LOGGED_OUT !== "1";
const ZOOM = require("node:fs").mkdtempSync(join(require("node:os").tmpdir(), "monet-mock-zoom-"));
const files = readdirSync(DIR).filter(f => /\.(jpe?g|png)$/i.test(f)).sort();
const dims = files.map(f => { const o = Bun.spawnSync(["sips", "-g", "pixelWidth", "-g", "pixelHeight", join(DIR, f)]).stdout.toString(); return { w: Number(/pixelWidth: (\d+)/.exec(o)?.[1] ?? 4000), h: Number(/pixelHeight: (\d+)/.exec(o)?.[1] ?? 3000) }; });
const COLORS = ["#8E9FB8", "#C7B79A", "#6F8F72", "#B98B73", "#7F7FA8", "#A5B4C8", "#D9C08E", "#5E7F8A"];
const rnd = (i: number) => { const x = Math.sin(i * 12.9898 + 4.1) * 43758.5453; return x - Math.floor(x); };
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WEEK = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const SIGN = ["#9E3B22", "#2A6468", "#3D3A78", "#2F6A4A", "#7A3F6E", "#9E3513", "#4A5A1E"], SIGN_N = ["#F2A08A", "#8FD0CF", "#B9B4F0", "#9FD3A0", "#E0A6D4", "#FFB07A", "#CFE08A"];
const PLACES = ["München", "Chiemsee", "Oberstdorf", "Berlin", "Toskana", "Hamburg"];

// ---- library: months back to 2009, a handful of days each
const now = new Date(); const items: ItemSummary[] = []; const dayOf = new Map<number, string>(); let id = 1;
const total = Number(process.env.MOCK_ITEMS ?? 2400);
const monthsList: { y: number; m: number }[] = [];
for (let y = 2009; y <= now.getFullYear(); y++) for (let m = 0; m < 12; m++) { if (y === now.getFullYear() && m > now.getMonth()) break; monthsList.push({ y, m }); }
const weights = monthsList.map(({ y, m }) => (y < 2012 && rnd(y * 12 + m) < 0.4 ? 0.2 : y < 2015 ? 0.7 : 1.4) * (0.4 + rnd(y * 12 + m + 9)));
const wsum = weights.reduce((a, b) => a + b, 0);
const entries: { t: number; tz: number }[] = [];
monthsList.forEach((mo, k) => {
  const n = Math.round(weights[k] / wsum * total), days = 1 + Math.floor(rnd(k + 3) * 4);
  for (let d = 0; d < days; d++) {
    const day = 1 + Math.floor(rnd(k * 7 + d) * 27), per = Math.max(1, Math.round(n / days));
    for (let j = 0; j < per; j++) entries.push({ t: Date.UTC(mo.y, mo.m, day, 8 + Math.floor(rnd(k * 31 + d * 7 + j) * 12), Math.floor(rnd(j + k) * 59)), tz: 60 });
  }
});
// today and the days before are always there, like on the phone canvas
for (let j = 0; j < 5; j++) entries.push({ t: now.getTime() - j * 3600_000, tz: 60 });
for (let j = 0; j < 9; j++) entries.push({ t: Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - 2, 10 + j, 5), tz: 60 });
entries.sort((a, b) => b.t - a.t);
while (entries.length && entries[0].t > now.getTime()) entries.shift();
const takenAtOf = new Map<number, number>();
for (const e of entries) {
  const k = id % files.length, d = dims[k];
  const video = id % 23 === 0, burst = id % 17 === 0;
  items.push({ id, kind: video ? "video" : "photo", w: d.w, h: d.h, color: COLORS[id % COLORS.length], takenAt: e.t, ...(video ? { durationMs: 42_000 + (id % 9) * 11_000 } : {}), ...(burst ? { burst: { count: 3 + (id % 5) } } : {}), favorite: id % 11 === 0 });
  takenAtOf.set(id, e.t); id++;
}
const byId = new Map(items.map(i => [i.id, i])); const deleted = new Set<number>();

function title(date: Date) {
  const key = (x: Date) => x.toISOString().slice(0, 10), today = new Date(), yest = new Date(Date.now() - 86400000);
  if (key(date) === key(today)) return "Heute"; if (key(date) === key(yest)) return "Gestern";
  return `${WEEK[date.getUTCDay()]}, ${date.getUTCDate()}. ${MONTHS[date.getUTCMonth()]}${date.getUTCFullYear() === today.getFullYear() ? "" : " " + date.getUTCFullYear()}`;
}
function days(): TimelineDay[] {
  const map = new Map<string, ItemSummary[]>();
  for (const it of items) { if (deleted.has(it.id)) continue; const k = new Date(it.takenAt + 3600_000).toISOString().slice(0, 10); (map.get(k) ?? map.set(k, []).get(k)!).push(it); }
  return [...map.entries()].map(([date, its]) => { const h = Math.floor(rnd(Number(date.replace(/-/g, "")) % 997) * 7); return { date, title: title(new Date(date + "T12:00:00Z")), place: PLACES[h % PLACES.length], sign: SIGN[h], signNight: SIGN_N[h], items: its }; });
}
const band = () => { const m = new Map<string, number>(); for (const it of items) if (!deleted.has(it.id)) { const k = new Date(it.takenAt).toISOString().slice(0, 7); m.set(k, (m.get(k) ?? 0) + 1); } const P = [["#9FB0CF", "#C9D3E6", "#7D7BB8"], ["#AEB9D2", "#E1E6F0", "#8C86BE"], ["#B9C49A", "#E5D9C8", "#9DAFD0"], ["#A8C886", "#F0C9D2", "#E8E2B0"], ["#86B86A", "#F2D46B", "#C9A3D9"], ["#7DAE5E", "#E9C24A", "#5E92C8"], ["#D9B44E", "#8DBB6A", "#4E86C2"], ["#3F7CB8", "#7FC2D6", "#F0D18A"], ["#BFA562", "#8EAE6B", "#D88E5A"], ["#CC7A3E", "#E2A84F", "#8E5A8E"], ["#8F8A9A", "#B9A27E", "#6F7FA8"], ["#B8C6DE", "#E8ECF4", "#8B84C0"]]; return { months: [...m.entries()].sort().map(([ym, n]) => ({ ym, n, colors: P[Number(ym.slice(5)) - 1] })) }; };

// ---- people, places, albums, series
let people = [
  { id: 1, name: "Ben" as string | null, count: 3881, face: 101, hidden: false }, { id: 2, name: "Nora", count: 2950, face: 102, hidden: false }, { id: 3, name: "Oma", count: 1204, face: 103, hidden: false },
  { id: 4, name: "Clara", count: 611, face: 104, hidden: false }, { id: 5, name: "Opa", count: 402, face: 105, hidden: false }, { id: 6, name: "Tim", count: 288, face: 106, hidden: false },
  { id: 7, name: null, count: 37, face: 107, hidden: false }, { id: 8, name: null, count: 12, face: 108, hidden: false }, { id: 9, name: null, count: 9, face: 109, hidden: false },
];
const movedFaces = new Set<number>();
let albums = [{ id: 1, name: "Italien 2023", count: 214, cover: items[40].id }, { id: 2, name: "Hochzeit Clara und Felix", count: 388, cover: items[120].id }, { id: 3, name: "Die Wohnung", count: 61, cover: items[200].id }];
const series = [
  { key: "oberstdorf-winter", title: "Oberstdorf im Winter", subtitle: "Dieselben Berge, sechs Winter", items: [2019, 2020, 2021, 2022, 2023, 2025].map((year, i) => ({ id: items[10 + i * 9].id, year })) },
  { key: "chiemsee-herbst", title: "Chiemsee im Herbst", subtitle: "Jedes Jahr dieselbe Bank", items: [2018, 2019, 2021, 2024].map((year, i) => ({ id: items[300 + i * 7].id, year })) },
];
const places = PLACES.map((name, i) => ({ id: i + 1, name, country: "Deutschland", count: 800 - i * 90, item: items[i * 13 + 5].id }));
const pageOf = (list: ItemSummary[]) => list.filter(i => !deleted.has(i.id));

let devices = [
  { id: 1, name: "MacBook Pro", kind: "mac", scopes: ["upload", "index"], createdAt: Date.now() - 40 * 86400000, lastSeenAt: Date.now() - 30_000, revokedAt: null, uploads: 5210, lastUpload: Date.now() - 600_000 },
  { id: 2, name: "Pixel 9", kind: "android", scopes: ["upload"], createdAt: Date.now() - 30 * 86400000, lastSeenAt: Date.now() - 240_000, revokedAt: null, uploads: 41208, lastUpload: Date.now() - 240_000 },
];
let sessions = [{ id: "s1", kind: "browser", device: null, createdAt: Date.now() - 86400000, lastSeenAt: Date.now(), userAgent: "Chrome, macOS", current: true }, { id: "s2", kind: "browser", device: null, createdAt: Date.now() - 6 * 86400000, lastSeenAt: Date.now() - 86400000, userAgent: "Safari, iPad", current: false }];
let creds = [{ id: "c1", name: "Monet", createdAt: Date.now() - 20 * 86400000, lastUsedAt: Date.now() - 3600_000 }];

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
const received = new Map<string, number>();
const detail = (it: ItemSummary): ItemDetail => ({ ...it, sha256: "0".repeat(64), mime: "image/jpeg", bytes: 3_800_000, origName: files[it.id % files.length], source: it.id % 3 ? "takeout" : "android", takenSrc: "exif", tzMin: 60, uploadedAt: it.takenAt + 3600_000,
  exif: { camera: "Pixel 4a", exposure: "1/640", fnumber: 1.7, iso: 60, focal: 4.4, lat: 47.5, lon: 11.1 }, place: { name: PLACES[it.id % PLACES.length], admin1: "Bayern", country: "Deutschland" },
  faces: [{ id: 103, x: .3, y: .3, w: .2, h: .25, personId: 3, name: "Oma" }, { id: 101, x: .6, y: .35, w: .15, h: .2, personId: 1, name: "Ben" }, { id: 107, x: .1, y: .4, w: .12, h: .15, personId: 7, name: null }],
  burstItems: it.burst ? Array.from({ length: it.burst.count - 1 }, (_, k) => ({ id: items[(it.id + k + 1) % items.length].id })) : [], labels: ["Schnee", "Berge", "Mütze", "Winter"].map((label, k) => ({ label, score: .9 - k * .1 })), ocr: null, backup: { original: true, secondCopyAt: Date.now() - 86400000 }, deletedAt: null });

Bun.serve({
  port: PORT, hostname: "127.0.0.1", idleTimeout: 30,
  async fetch(req) {
    const u = new URL(req.url), p = u.pathname, m = req.method;
    await Bun.sleep(Number(process.env.MOCK_DELAY ?? 25));
    if (p === "/healthz") return new Response("ok");
    if (p === "/api/auth/state") return json({ setupOpen: !loggedIn && process.env.MOCK_SETUP === "1", loggedIn, hasCredential: true });
    if (p.startsWith("/api/auth/") && m === "POST") {
      if (p.endsWith("/options")) return json({ challenge: "AAAA", rpId: "localhost", user: { id: "AAAA", name: "monet", displayName: "Monet" }, rp: { name: "Monet", id: "localhost" }, pubKeyCredParams: [{ type: "public-key", alg: -7 }], timeout: 60000, userVerification: "required", excludeCredentials: [] });
      loggedIn = true; return json({ ok: true });
    }
    if (p.startsWith("/vendor/ort/") || p.startsWith("/models/")) {
      const f = p.startsWith("/models/") ? join(import.meta.dir, "../models", p.slice(8)) : join(import.meta.dir, "../vendor/ort", p.slice(12));
      return existsSync(f) && !p.includes("..") ? new Response(Bun.file(f), { headers: { "content-type": f.endsWith(".mjs") ? "text/javascript" : f.endsWith(".wasm") ? "application/wasm" : "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" } }) : new Response("", { status: 404 });
    }
    // deep zoom like server/zoom.ts: the pyramid is cut with vips on first ask, into a temp folder
    let zm: RegExpExecArray | null;
    if ((zm = /^\/api\/items\/(\d+)\/zoom$/.exec(p))) {
      const n = Number(zm[1]), f = files[n % files.length], d = dims[n % files.length], out = join(ZOOM, String(n % files.length));
      if (!existsSync(out + ".dzi")) {
        await Bun.spawn(["vips", "autorot", join(DIR, f), out + ".v"]).exited;
        await Bun.spawn(["vips", "dzsave", out + ".v", out, "--layout", "dz", "--tile-size", "510", "--overlap", "1", "--suffix", ".webp[Q=85]"]).exited;
      }
      const x = await Bun.file(out + ".dzi").text().catch(() => "");
      const w = Number(/Width="(\d+)"/.exec(x)?.[1] ?? d.w), h = Number(/Height="(\d+)"/.exec(x)?.[1] ?? d.h);
      return json({ ready: !!x, w, h, tile: 510, overlap: 1, maxLevel: Math.ceil(Math.log2(Math.max(w, h))), hdr: process.env.MOCK_HDR === "1", mime: MIME[extname(f).toLowerCase()] ?? "image/jpeg", bytes: 3_800_000 });
    }
    if ((zm = /^\/media\/(\d+)\/z\/(\d+)\/(\d+)_(\d+)$/.exec(p))) {
      const t = join(ZOOM, `${Number(zm[1]) % files.length}_files`, zm[2], `${zm[3]}_${zm[4]}.webp`);
      return existsSync(t) ? new Response(Bun.file(t), { headers: { "content-type": "image/webp" } }) : new Response("", { status: 404 });
    }
    if (p.startsWith("/media/")) {
      const mm = /^\/media\/(\d+|face)\/?(\w+)?$/.exec(p); if (!mm) return new Response("", { status: 404 });
      const n = mm[1] === "face" ? Number(mm[2]) : Number(mm[1]); const f = files[n % files.length];
      return new Response(Bun.file(join(DIR, f)), { headers: { "cache-control": "private, max-age=31536000, immutable", "content-type": MIME[extname(f).toLowerCase()] ?? "image/jpeg" } });
    }
    if (p.startsWith("/api/")) {
      if (!loggedIn) return json({ error: "nicht angemeldet" }, 401);
      // a household of two: Ida (id 2, Ernst) sees the same photos from a later day on, so a switch shows other days
      // the map: every tenth photo at one of the mock places, scattered a little around it
      if (p === "/api/map") { const at = [[48.14, 11.58], [47.71, 11.76], [47.49, 11.1], [52.52, 13.4], [43.4, 11.2], [53.55, 9.99]], sub = items.filter((_, k) => k % 10 === 0);
        return json({ ids: sub.map(i => i.id), lat: sub.map(i => at[i.id % 6][0] + (rnd(i.id) - 0.5) * 0.6), lon: sub.map(i => at[i.id % 6][1] + (rnd(i.id + 1) - 0.5) * 0.9), color: sub.map(i => i.color) }); }
      if (p === "/api/household") return json({ me: 1, members: [{ id: 1, name: "Mia", theme: process.env.MOCK_THEME ?? "monet", count: items.length, cover: null, joined: true }, { id: 2, name: "Ida", theme: "ernst", count: items.length - 40, cover: null, joined: true }] });
      if (p === "/api/timeline") { const all = days().slice(req.headers.get("x-monet-of") === "2" ? 12 : 0); const at = Number(u.searchParams.get("cursor") ?? 0), lim = Number(u.searchParams.get("limit") ?? 20); return json({ days: all.slice(at, at + lim), next: at + lim < all.length ? String(at + lim) : null }); }
      if (p === "/api/band") return json(band());
      let r: RegExpExecArray | null;
      if ((r = /^\/api\/items\/(\d+)$/.exec(p))) {
        const it = byId.get(Number(r[1])); if (!it) return json({ error: "nicht gefunden" }, 404);
        if (m === "PATCH") { Object.assign(it, await req.json()); return json({ ok: true }); }
        if (m === "DELETE") { deleted.add(it.id); return json({ ok: true }); }
        return json(detail(it));
      }
      if (p === "/api/series") return json(series);
      if (p === "/api/people") return json({ named: people.filter(x => x.name && !x.hidden).map(({ id, name, count, face }) => ({ id, name, count, face })), unnamed: people.filter(x => !x.name && !x.hidden).map(x => ({ id: x.id, count: x.count, faces: [101, 102, 103, 104, 105, 106, 107, 108, 109, 110].map(k => k + x.id * 100).filter(k => !movedFaces.has(k)).slice(0, 6), last: { date: "2026-11-16", place: "Chiemsee" } })), suggestions: [{ named: 2, unnamed: 8, count: 12 }] });
      if ((r = /^\/api\/people\/(\d+)$/.exec(p)) && m === "POST") { const x = people.find(q => q.id === Number(r![1])); Object.assign(x ?? {}, await req.json()); return json({ ok: true }); }
      if ((r = /^\/api\/faces\/(\d+)$/.exec(p)) && m === "POST") { const f = Number(r[1]), b = await req.json(), from = people.find(q => q.id === Math.floor((f - 100) / 100)), to = people.find(q => q.id === b.personId); movedFaces.add(f); if (from) from.count--; if (to) to.count++; return json({ ok: true }); }
      if (p === "/api/people/merge") { const b = await req.json(); people = people.filter(x => x.id !== b.from); return json({ ok: true }); }
      if (p === "/api/search/parse") {
        const q = ((await req.json()).q as string).toLowerCase(), chips: any[] = [];
        if (/\boma\b/.test(q)) chips.push({ kind: "person", label: "Oma", value: "3" });
        const y = /\b(19|20)\d\d\b/.exec(q); if (y) chips.push({ kind: "date", label: y[0], value: "y:" + y[0] });
        const rest = q.replace(/\boma\b/, "").replace(/\b(19|20)\d\d\b/, "").trim(); if (rest) chips.push({ kind: "content", label: rest, value: rest });
        return json({ chips, rest });
      }
      if (p === "/api/search") { const b = await req.json(); const n = b.chips?.length ? 23 : 0; const list = pageOf(items).slice(30, 30 + n); return json({ total: n, items: b.sort === "date" ? [...list].sort((a, c) => c.takenAt - a.takenAt) : list, relaxed: n ? { label: "Im Schnee, ohne Oma", count: 112 } : null }); }
      if (p === "/api/places") return json(places);
      if (p === "/api/albums" && m === "POST") { const a = { id: albums.length + 1, name: (await req.json()).name, count: 0, cover: null as number | null }; albums.push(a as any); return json(a); }
      if (p === "/api/albums") return json(albums);
      if ((r = /^\/api\/albums\/(\d+)\/items$/.exec(p))) { const a = albums.find(x => x.id === Number(r![1])); const ids = (await req.json()).ids as number[]; if (a) a.count += ids.length; return json({ ok: true }); }
      if ((r = /^\/api\/albums\/(\d+)$/.exec(p)) && m === "DELETE") { const n = albums.length; albums = albums.filter(x => x.id !== Number(r![1])); return albums.length < n ? json({ ok: true }) : json({ error: "Das Album gibt es nicht." }, 404); }
      if ((r = /^\/api\/albums\/(\d+)$/.exec(p))) { const a = albums.find(x => x.id === Number(r![1])); return a ? json({ ...a, items: pageOf(items).slice(60, 60 + a.count % 80 + 12) }) : json({ error: "nicht gefunden" }, 404); }
      if (p === "/api/status") return json({ items: items.length - deleted.size, videos: items.filter(i => i.kind === "video").length, bytes: 412e9, stages: { thumbs: { done: items.length - 3, total: items.length }, clip: { done: items.length - 200, total: items.length }, faces: { done: items.length - 3, total: items.length }, ocr: { done: items.length - 3, total: items.length }, labels: { done: items.length - 200, total: items.length } }, devices: devices.length, lastUpload: Date.now() - 30 * 60_000 });
      if (p === "/api/devices/pair") return json({ code: "K7M2QX4P", expiresAt: Date.now() + 10 * 60_000 });
      if ((r = /^\/api\/devices\/(\d+)$/.exec(p)) && m === "DELETE") { devices = devices.filter(d => d.id !== Number(r![1])); return json({ ok: true }); }
      if (p === "/api/devices") return json(devices);
      if ((r = /^\/api\/sessions\/(\w+)$/.exec(p)) && m === "DELETE") { sessions = sessions.filter(d => d.id !== r![1]); return json({ ok: true }); }
      if (p === "/api/sessions") return json(sessions);
      if ((r = /^\/api\/credentials\/(\w+)$/.exec(p)) && m === "DELETE") { creds = creds.filter(d => d.id !== r![1]); return json({ ok: true }); }
      if (p === "/api/credentials") return json(creds);
      if (p === "/api/upload/check") return json({ missing: (await req.json()).hashes });
      if ((r = /^\/api\/upload\/(\w+)$/.exec(p)) && m === "PUT") {
        const off = Number(u.searchParams.get("offset")), total = Number(u.searchParams.get("total")), len = (await req.arrayBuffer()).byteLength, got = off + len;
        received.set(r[1], got);
        if (got >= total) return json({ received: got, item: items[0], duplicate: false });
        return json({ received: got });
      }
      if (p === "/api/index/pending") return json([]);
      return json({ error: "unbekannt" }, 404);
    }
    // the client: assets by path, everything else is the shell
    const file = join(DIST, p === "/" ? "index.html" : p);
    if (p !== "/" && existsSync(file) && !p.endsWith("/")) return new Response(Bun.file(file), { headers: { "content-type": MIME[extname(p)] ?? "application/octet-stream" } });
    return new Response(readFileSync(join(DIST, "index.html")), { headers: { "content-type": MIME[".html"] } });
  },
});
console.log(`monet mock on http://127.0.0.1:${PORT}, ${items.length} items, ${files.length} test photos`);
