# Monet: the contract every part builds against

Monet replaces Google Photos for a household: everyone has their own library and sees everyone else's (every
row carries `owner_id`). Beside the photos it keeps documents, sheets and slides for viewing and organising, all in
one tree of folders, the Ablage: `app/docs/files.md` is that part of the contract. Live at https://monet.kaleve.dev on a small server (2 vCPU, 4 GB RAM, shared with other services, which always win). The UI design is the canvas in `design/project/*.dc.html`;
`design/project/Main.dc.html` holds the tokens. UI language is German, du-form.

## Repository

```
app/        Bun server + Svelte PWA (the peppermint pattern, see ~/sideprojects/peppermint/app)
  server/   HTTP, auth, ingest, search, people, series
  client/   Svelte 5 PWA; client/lib/ml/ is the in-browser ML (worker)
  shared/   types shared by both (shared/types.ts is the API shape); shared/styles.ts is every style (Monet, Ernst,
            Magritte): tokens per light, type, the technique for each recurring element, the mark
  tools/    CLIs: fetch-models.ts, import-takeout.ts; invite, reset-passkeys and members are subcommands of the binary
  tests/    bun test; tests/deps.test.ts allows only `svelte`
  deploy/   deploy.sh, nginx.sh, monet.service
  vendor/   vendored third-party files (onnxruntime-web dist), pinned with sha256 in vendor/README.md
mac/        Swift menu bar agent (SwiftPM, Makefile, like ~/sideprojects/sesam)
android/    Kotlin + Compose uploader (Gradle wrapper, like ~/sideprojects/nonius)
design/     the design canvas
```

The native apps are thin: backup of new photos and folders, a status screen, nothing of the gallery. They wear the
library's style (`theme` in `/api/status`) from copies generated out of shared/styles.ts (`bun tools/styles.ts`
writes android/.../ui/Styles.kt, mac/Sources/Panel/Styles.swift and the marks as PNGs; tests/styles.test.ts fails
while a copy is stale). Native code switches on a technique (underline, card, sun), never on a style's name.

Rules for everyone: no new packages (app: only `svelte`; Swift: Apple frameworks only; Android: AndroidX and
Kotlin stdlib only). Never commit, push or branch: the lead commits. No U+2012 to U+2015 dashes anywhere (a hook
rejects them). German strings follow the design canvas wording exactly where a string exists there.

## Server runtime

- Bun, `Bun.serve`, `bun:sqlite` (WAL), compiled to one binary like peppermint (`bun build --compile`).
- Env: `PORT` (4320), `HOST`, `MONET_ORIGIN` (https://monet.kaleve.dev), `MONET_DB`, `MONET_DATA`
  (thumbs, chunks, faces), `MONET_ORIGINALS` (may later be a Storage Box mount), `MONET_MODELS`,
  `MONET_DIST`, `MONET_SETUP_TOKEN`, `MONET_GEONAMES` (path to cities15000.txt).
- System tools on the server (installed by deploy.sh via apt): `vipsthumbnail`, `vips`, `vipsheader`
  (libvips 8.16, HEIF works), `ffmpeg`/`ffprobe` for video. Called with `Bun.spawn`, one ingest at a time.
- Memory budget: MemoryMax 400M in the unit, OOMScoreAdjust 600, CPU/IO weight 20, like peppermint.

## Storage

- Original: `$MONET_ORIGINALS/<yyyy>/<mm>/<sha256>.<ext>` (taken date; unknown date: upload date). Never
  modified, never overwritten. Delete is a soft delete (`deleted_at`), purged after 30 days.
- Derived: `$MONET_DATA/t/<sha[0:2]>/<sha>-<size>.webp`, sizes: `s` 256 px square crop (grids of faces,
  series, small thumbs), `m` 720 px longest side (timeline), `l` 2048 px longest side (viewer; also the
  viewable form of HEIC). Videos: the same three from a frame at 1 s; `o` serves the original with Range.
- Upload chunks: `$MONET_DATA/up/<sha256>.part`. A part untouched for 24 hours is removed (at start and every 6
  hours); its client starts that file over.

## Data model (SQLite, migrations appended to a list in server/db.ts)

```
owner(id, name, theme, role 'admin'|'member', created_at)
auth_passkey, auth_session, auth_device, auth_pairing, auth_link: the accounts module's tables (app/docs/accounts.md),
  account_id = owner.id; a device's kind is 'android'|'mac'
item(id INTEGER PK, owner_id, sha256 UNIQUE(owner_id, sha256), kind 'photo'|'video', mime, ext, bytes, width, height,
     taken_at INTEGER ms UTC, tz_min INTEGER, taken_src 'exif'|'name'|'sidecar'|'mtime'|'upload',
     lat, lon, place_id, camera, exposure, fnumber, iso, focal, duration_ms, orig_name, source 'web'|'android'|'mac'|'takeout',
     device_id, uploaded_at, color TEXT '#rrggbb', colors TEXT JSON ['#..' x3], favorite, deleted_at,
     burst_id, burst_rank, ocr_text, thumbs_ok, clip_ok, faces_ok, ocr_ok, labels_ok)
clip(item_id PK, model TEXT, vec BLOB float32[768] L2-normalised)  (the name is historical: SigLIP 2 vectors)
face(id, item_id, x, y, w, h (0..1), landmarks TEXT JSON 10 numbers (0..1), score, quality, vec BLOB float32[128] L2-normalised, person_id)
person(id, owner_id, name NULL (unnamed cluster), cover_face_id, hidden, created_at)
place(id PK geonameid, name, admin1, country, lat, lon)
label_vocab(model, label, lang, vec BLOB)   -- posted once by a client
item_label(item_id, label, score)           -- top 5 labels with score >= threshold
album(id, owner_id, name, cover_item_id, created_at) ; album_item(album_id, item_id, added_at)
item_fts  FTS5(ocr_text, labels, place, people, orig_name)  -- rebuilt for an item when any of these change
```

## Ingest (server, after an upload completes)

1. Verify sha256 of the assembled file; move it into place (rename, same filesystem if possible).
2. `vipsheader -a` (photos) or `ffprobe -print_format json -show_format -show_streams` (videos): width,
   height, EXIF DateTimeOriginal + OffsetTimeOriginal, GPS, Make/Model, ExposureTime, FNumber, ISO, focal
   length. Fallbacks for the date in this order: EXIF, a date in the file name (`IMG_20190806_180121`,
   `20201101_133230`, `Screenshot_20200107-220711`, `IMG-20191128-WA0000`, `PXL_20150214_102000`),
   sidecar, file mtime sent by the client, upload time. Record which in `taken_src`.
3. Thumbnails s, m, l with `vipsthumbnail` (photos honour EXIF orientation: libvips autorotates).
4. Colours: a 16x16 thumbnail as PPM, k-means k=3 in Bun, `color` = mean, `colors` = the three centres.
5. Place: nearest GeoNames city (cities15000) within 30 km, in memory.
6. Burst: same owner, same camera, taken within 2 s of the previous item: same `burst_id`. Rank by file
   bytes descending (a sharper JPEG is larger); rank 1 is shown, the rest collapse into it.
7. Mark thumbs_ok. ML fields stay pending until an indexer posts them.

## In-browser ML (client/lib/ml, runs in a Web Worker; the same code runs in the Mac agent's WKWebView)

- Runtime: onnxruntime-web, vendored in app/vendor/ort (wasm + webgpu builds, pinned version, sha256 in
  vendor/README.md). wasm with up to 8 threads; WebGPU only on request (app/docs/ml.md, Decision 2).
- Models are served by Monet itself from `$MONET_MODELS` at `/models/<file>` (immutable cache); the
  browser never contacts Hugging Face. `tools/fetch-models.ts` downloads pinned files with sha256 checks:
  - Image: SigLIP 2 B/32 at 256 px, `onnx-community/siglip2-base-patch32-256-ONNX` `onnx/vision_model_fp16.onnx`
    (+ `preprocessor_config.json`): whole picture resized to 256x256 (no crop), mean/std 0.5, output
    pooler_output 768, L2-normalise. Model id `siglip2-b32-256`. Chosen over CLIP B/32 on 2026-11-21 (app/docs/ml.md).
  - Text (same model, so the same space; German works directly): `onnx/text_model_fp16.onnx` and `tokenizer.json`.
    Pipeline: lowercase -> Gemma BPE written by hand -> `<eos>` -> pad to 64 -> pooler_output 768 -> L2-normalise.
  - Items whose vector came from an older model are queued again at server start; search, labels and stacks only
    read vectors of the current model.
  - Faces: `opencv/face_detection_yunet` `face_detection_yunet_2023mar.onnx` (boxes + 5 landmarks) and
    `opencv/face_recognition_sface` `face_recognition_sface_2021dec.onnx` (112x112 aligned by a similarity
    transform from the 5 landmarks to the standard ArcFace template, 128-d, L2-normalise). Same person:
    cosine >= 0.42 (OpenCV documents 0.363; raised after the test photos, see app/server/cluster.ts).
- Worker API (postMessage): `{type:'image', id, bitmap}` -> `{clip, faces:[{x,y,w,h,landmarks,score,quality,vec}]}`;
  `{type:'text', text}` -> `{vec}`. Vectors travel as Float32Array; to the server as base64 little-endian.
- The Dunkelkammer loop (client/lib/ml/darkroom.ts): while the app is open and the tab is visible (or always
  inside the Mac agent), fetch `/api/index/pending`, load `/media/<id>/l`, run, POST results. One at a time.
  On first run it embeds the label vocabulary (shared/labels.ts, ~300 German labels) and posts it.

## Auth (secure by construction)

- The fleet's accounts module (`app/server/accounts`, owned by oss-kit) decides who is asking. Its contract is
  `app/docs/accounts.md`: passkeys only (WebAuthn by hand, UV and resident keys required, ES256 and RS256),
  one-time links in the URL fragment for everything without a passkey (setup, join, recover, add), two roles
  (admin and member, always at least one admin), sessions in `__Host-monet` (SameSite=Strict, 30 days after
  last use, 180 at most, listed and revocable), same-origin on every state-changing request, rate limits.
- Monet's part (`app/server/auth.ts`): the household is the group; an invite carries the new person's style;
  someone with photos, albums or named people is never deleted, only their access is taken away.
- Devices (Mac, Android): a pairing code from the Geräte page becomes a device token. Scopes: Android
  `upload,index`, the Mac also `export`. No delete, no people edits, no account changes. The Mac agent's
  WebView gets a device session via `POST /api/devices/session` (bearer -> cookie with kind 'device').
- On the server: `monet-invite <name> [--admin] [--theme ernst]`, `monet-reset-passkeys [name]`, `monet-members` (wrappers deploy.sh installs around the binary's subcommands).
- Headers: strict CSP (`default-src 'self'; img-src 'self' blob: data:; script-src 'self' 'wasm-unsafe-eval';
  worker-src 'self' blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'`),
  `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, HSTS. No public media URL exists.
- Network: nginx accepts only Cloudflare's edge addresses for this name (peppermint's cloudflare-only.conf),
  TLS ends at nginx, the app listens on 127.0.0.1 only.

## HTTP API (JSON; all require a session or device token unless marked public)

```
GET  /healthz                                   public
/api/auth/*, /api/account*, /api/passkeys*, /api/sessions*, /api/members*, /api/devices*: the accounts module,
     see app/docs/accounts.md (GET /api/auth/state: device true is a device session; the client then runs only the
     darkroom. GET /api/devices adds {uploads, lastUpload} per device. POST /api/members takes {name, theme})

POST /api/upload/check {hashes:[sha256]} -> {missing:[sha256]}
     (both: a browser sending X-Monet-Of uploads into that person's library; adding is the only write there)
PUT  /api/upload/:sha256?offset=&total=&name=&mtime=&source=   body = bytes, chunk <= 32 MiB
     -> {received} ; on the final chunk -> {item: ItemSummary, duplicate: bool}
POST /api/items/:id/sidecar {takenAt?, lat?, lon?, albums?}  (Takeout import)

GET  /api/timeline?cursor=&limit=  -> {days:[{date, title, place, sign, items:[ItemSummary]}], next}
GET  /api/band -> {months:[{ym:'2019-12', n, colors:['#..' x3]}]}
GET  /api/items/:id -> ItemDetail ; PATCH /api/items/:id {favorite} ; DELETE /api/items/:id
GET  /media/:id/:size(s|m|l|o)  (devices: s,m with scope index or upload; l with index; o with export) (ETag = sha256-size, Cache-Control private, max-age=31536000, immutable)
GET  /media/face/:faceId        (square crop with margin, 256 px, from the l thumbnail)
GET  /api/series -> [{key, title, subtitle, items:[{id, year}]}]
GET  /api/people -> {named:[{id,name,count,face}], unnamed:[{id,count,faces:[faceId x6],last:{date,place}}],
                     suggestions:[{named, unnamed, count}]}
POST /api/people/:id {name?, hidden?} ; POST /api/people/merge {from, into} ; POST /api/faces/:id {personId|null}
POST /api/search/parse {q} -> {chips:[{kind:'person'|'date'|'place'|'content'|'text', label, value}], rest}
POST /api/search {chips, vec? base64, sort:'best'|'date'} -> {total, items:[ItemSummary], relaxed:{label,count}|null}
GET  /api/places -> [{id,name,country,count,item}] ; GET /api/albums ; POST /api/albums {name}
GET  /api/things -> [{label,count,item}]  (labels of the shown photos, most common first; item: the best share; page /dinge)
POST /api/albums/:id/items {ids} ; DELETE /api/albums/:id/items {ids}
GET  /api/index/pending?limit=&needs=clip,faces|ocr -> [{id, kind, needs:['clip','faces','ocr']}]  (needs: only work the caller can do)
POST /api/index/:id {model, clip?, faces?, ocr?}   model 'siglip2-b32-256'; an ocr-only post may use model 'vision-ocr'
GET  /api/index/vocab?model= -> {have: bool}  (scope index) ; POST /api/index/vocab {model, labels:[{label, lang, vec}]}
GET  /api/status -> {items, videos, bytes, stages:{thumbs,clip,faces,ocr,labels}: {done,total}, devices, lastUpload}
GET  /api/export/list?after=  (for the Mac's second copy) -> [{id, sha256, ext, bytes, takenAt}]
POST /api/export/ack {ids:[...]}  (device or session) sets item.second_copy_at = now for those ids; read back by
     ItemDetail.backup.secondCopyAt and /api/status secondCopy {n, last}
```

`ItemSummary = {id, kind, w, h, color, takenAt, durationMs?, burst?:{count}, favorite}`.
`ItemDetail` adds: exif fields, place {name, admin1, country}, faces [{id, x,y,w,h, personId, name}],
burst [{id}], labels, ocr, source, origName, bytes, backup {original: true, secondCopyAt}.

Search semantics: `parse` turns names of people (case-insensitive, also unnamed never), years, months, seasons
(Winter, Frühling, Sommer, Herbst; German and English), `Weihnachten`, and place names known in the library into
chips; the rest becomes a `content` chip. `search` filters by person/date/place chips and ranks by the CLIP cosine
of `vec` (computed client-side from the content chip) blended with FTS5 bm25 over OCR text, labels and file names.
`relaxed` re-runs without the most restrictive person chip and reports its count ("Im Schnee, ohne Oma").

Series: per place and season, items in at least 3 distinct years form a series; title "<Ort> im <Jahreszeit>",
one representative item per year (highest colour saturation in its burst, simple and deterministic).
