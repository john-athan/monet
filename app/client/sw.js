// Monet service worker.
//  - Hashed assets: cache-first (their names change with every build).
//  - The app shell: network-first, the last copy when offline, so the app opens without a connection.
//  - Thumbnails /media/:id/s and /m (and faces): cache-first with a cap, a picture never changes.
//  - Large copies (l) and originals (o) go straight to the network. The API is never cached here.
const V = "monet-__VERSION__";
const THUMBS = "monet-thumbs";
const ASSETS = __ASSETS__;
const MAX_THUMBS = 4000;

self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== THUMBS).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

let puts = 0;
async function keepThumb(req, res) {
  const c = await caches.open(THUMBS);
  await c.put(req, res);
  // now and then drop the oldest ones (keys come back in insertion order)
  if (++puts % 40 === 0) { const ks = await c.keys(); for (const k of ks.slice(0, Math.max(0, ks.length - MAX_THUMBS))) await c.delete(k); }
}

self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  if (e.request.headers.has("range")) return;
  if (u.pathname.startsWith("/assets/") || u.pathname === "/icon.svg") {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { if (res.ok) { const copy = res.clone(); caches.open(V).then(c => c.put(e.request, copy)); } return res; })));
    return;
  }
  if (/^\/media\/(\d+\/[sm]|face\/\d+)$/.test(u.pathname)) {
    e.respondWith(caches.open(THUMBS).then(async c => (await c.match(e.request)) || fetch(e.request).then(res => { if (res.ok) e.waitUntil(keepThumb(e.request, res.clone())); return res; })));
    return;
  }
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then(res => { if (res.ok) { const copy = res.clone(); caches.open(V).then(c => c.put("/", copy)); } return res; }).catch(() => caches.match("/")));
  }
});
