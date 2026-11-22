# Monet backend

The server of Monet, a self-hosted photo library for one owner. The contract is `docs/spec.md`; this file says how the code is cut, which rules every change follows, and where the code reads the spec in a particular way. The shapes of the API are in `shared/types.ts`.

## Shape

One Bun process, one SQLite file (WAL), system tools for pixels. Bun built-ins and `node:*` only: no npm package on the server. Compiled to one binary (`bun build --compile`) for Linux.

| Module | Owns |
|---|---|
| `server/main.ts` | routes, scope checks, same-origin check, security headers, static client, `/media`, `/models`, the accounts commands, boot |
| `server/db.ts` | schema, the `MIGRATIONS` list (append only), `meta` key/value |
| `server/auth.ts` | the accounts module (`server/accounts`, owned by oss-kit, `docs/accounts.md`) configured for Monet: device kinds and scopes, the style an invite carries, what counts as data |
| `server/upload.ts` | chunked resumable upload, `/api/upload/check` |
| `server/ingest.ts` | the queue, sniffing, date chain, thumbnails, colours, bursts, sidecar, startup sweep |
| `server/exif.ts` | `vipsheader -a` text, ffprobe JSON, dates in file names (pure) |
| `server/calc.ts` | day titles, accent colours, k-means, PPM reader (pure) |
| `server/places.ts`, `names.ts` | GeoNames grid index, German names (names.ts has no imports) |
| `server/library.ts` | timeline, band, detail, favourites, trash and purge, series, places, albums |
| `server/people.ts`, `cluster.ts` | faces, incremental clustering, people list, merge, crops (cluster.ts is pure) |
| `server/search.ts`, `parse.ts` | image vector matrix, labels, search and relaxed search (parse.ts is pure) |
| `server/fts.ts` | the one FTS5 row of an item |
| `server/docsniff.ts` | which format a file is (magic bytes, zip directory, audio and EPUB, the text rule; the rest is `other`), zip entry reader, text decoding, streaming CSV, the sheet grid caps and cover SVG (pure) |
| `server/epub.ts` | EPUB: container, OPF, spine, nav or NCX table of contents, author, cover, search text (pure, reads a `DocSource`) |
| `server/docs.ts` | files: the row of an upload, the render queue (soffice from `MONET_SOFFICE`, vips, pdftotext, ffprobe, ffmpeg), pages on demand, sheets as NDJSON with an index, books and their entries, audio tags and covers, text, list, search, rename, soft delete, purge |
| `server/folders.ts` | the Ablage: folder CRUD, `FolderOut`, move, `ensurePath` for uploads with `folder=` and `in=` |
| `server/status.ts` | `/api/status`, export list and acknowledgement |
| `tools/upload-dir.ts`, `import-takeout.ts`, `upload-lib.ts` | CLIs that speak the upload protocol |

**Data flow rules.**
- Modules call downward: `main` to `library`/`people`/`search`/`upload`/`status` to `ingest`/`fts`/`places` to `db`/`util`. Only `main.ts` knows about HTTP routes; `upload.ts` is the one other module that handles a `Request`, because it streams the body.
- Everything that decides "who is asking" is `accounts.principal` (as `auth.principalFor`); the module's own routes run first in `handle`. A route then calls `browser(p)` (a browser session only) or `scope(p, name)`. A device never reaches a read model.
- Pure code (`calc`, `exif`, `parse`, `cluster`, `names`) imports no database, so the tests run it directly.
- Every query is scoped by `owner_id`. Ids in a URL are checked against it.
- System tools run through `util.run` with a timeout and `VIPS_CONCURRENCY=1`. Only one ingest runs at a time (`ingest.enqueue`).

## Upload and ingest

`PUT /api/upload/<sha256>?offset&total&name&mtime&source` appends to `$MONET_DATA/up/<sha>.part`. An offset that differs from the size of the part is a 409 `{received}`; that is the whole resume protocol. Nothing is refused by its type: photos and videos are sniffed by their magic bytes and keep their pipeline, everything else becomes a file (`docs/files.md`); only an empty file is a 400. The last chunk triggers the SHA-256 check (a mismatch deletes the part: 422), then ingest, and the response is the finished `ItemSummary`.

Ingest order: dedupe, probe (`vipsheader -a` or `ffprobe`), choose the date (EXIF, file name, mtime, upload time), move the original to `yyyy/mm/<sha>.<ext>` (path stored in `item.orig_path`, because a sidecar can change `taken_at` later), insert the row with `thumbs_ok = 0`, then thumbnails (m, then s cut from m, then l), colours (k-means k=3 on a 16 px PPM), place, burst, FTS, `thumbs_ok = 1`. If the second half fails the row stays and the startup sweep runs it again.

Decisions:
- A date with no zone is read as Europe/Berlin and `tz_min` stays NULL; the timeline groups by `item.day`, a column derived from `taken_at` and `tz_min`. Pixel names (`PXL_`) are UTC. A name with a date but no time (`IMG-20191128-WA0000`) counts from noon, so no zone can move it to another day.
- A soft-deleted item still counts as known in `/api/upload/check` and as a duplicate on upload, so the next sync does not bring a deleted photo back.
- A device token cannot claim another source: its `source` is its kind (`android`, `mac`), except `takeout` for the importer.
- Bursts: same owner, same camera (not NULL), photos, within 2 s of a neighbour; chains merge. Rank by bytes, deleted members do not count.
- The sidecar follows the date order of the spec: it fills the date only when the file had no EXIF and no date in its name, and a place only when the file had no GPS.

## Files

Documents, spreadsheets, presentations, books, audio and any other file (view and organise only) and the one tree of folders beside the photos: `docs/files.md` is the contract, `server/docs.ts` and `server/folders.ts` implement it. Uploads use the same chunked route; the last chunk classifies the whole file (a text name wins over picture-like bytes; audio is looked at before the video rule, which takes every ftyp) and answers `{doc}` instead of `{item}`. Rendering shares `ingest.enqueue` with the photo pipeline, so only one heavy job runs at a time.

## Auth

The accounts module (`docs/accounts.md`) holds passkeys, links, roles, sessions, pairing and rate limits; its own test is `tests/accounts.test.ts`, and `server-auth` and `server-household` test it mounted here. A database from before the module moves its `credential`, `session`, `device`, `pairing` and `invite` rows into the `auth_*` tables on the first start (`server/db.ts`), keeping device ids (`item.device_id` points at them) and turning an open `reset-passkeys` token into a recovery link. The first owner becomes admin.

Scopes: `upload` (check, PUT, sidecar of its own items), `index` (pending, post, vocab, the `l` picture), `export` (the Mac only: `/api/export/list`, the original). Thumbnails `s` and `m` are open to `index` or `upload`. `/api/status` and `/api/export/ack` are open to any principal. Everything else needs a browser session.

Same-origin: every POST/PUT/PATCH/DELETE needs `Origin == MONET_ORIGIN` or `Sec-Fetch-Site: same-origin`; Bearer requests and `/api/devices/claim` are exempt (no cookie to forge). Rate limits in memory: 10 per minute per address for the login and registration endpoints, 5 for claim; the address is `X-Forwarded-For`, which nginx overwrites from `CF-Connecting-IP`.

## People, search, labels

Faces come from `POST /api/index/:id`. A face joins the person whose centroid (normalised sum of that person's vectors, kept in memory, rebuilt at boot) has the highest cosine at or above 0.42 (calibrated on the test photos, see `cluster.ts`); otherwise it starts an unnamed person. Two faces of one photo never join the same person, and faces with quality below 0.5 are stored but not grouped. The spec says "with at least 2 faces"; read literally a person could never grow past one face, so every person with at least one face can attract, and the "at least 2" applies to what the people page shows as unnamed. Suggestions: an unnamed group whose centroid is at least 0.30 from a named person's. Faces of an item are stored once (a second post is ignored).

Search keeps a `Float32Array` of all image vectors (SigLIP 2, 768 floats) per owner. `parse` makes chips: people (named only; a full name, or one word of a longer name when no other person has it), places known in the library (also by English name), years, months, seasons, Weihnachten (Dec 20 to 26); the rest is the `content` chip. Chip values: person id, place id, `y:2019`, `m:8`, `s:sommer`, `r:12-20..12-26`; several date chips are ANDed. `search` filters by chips in SQL, then ranks by cosine plus 0.25 times a normalised bm25 over OCR text, labels, place, people and file name. A hit is kept when its cosine is at least 0.085 and at least 1.5 standard deviations above the library mean for that query, or when FTS matches (calibrated on the test photos, see the comment in `search.ts`). `relaxed` drops the person chip with the fewest photos.

Labels: the vocabulary is posted once per model. For each image vector the label cosines go through a softmax at SigLIP's temperature (111.8); a label is stored when it takes at least 15 % of the probability, at most 3 per photo. SigLIP's own sigmoid does not work for single words (median best label 0.01). Calibrated on 134 test photos on 2026-11-21; the constants are at the top of `search.ts`.

Model ids: `siglip2-b32-256` for clip vectors (the field keeps its old name). At start the server queues every item whose vector came from another model (`requeueOtherModels`); until it is analysed again, it is missing from search, labels and stacks. A post with only `ocr` may name the model `vision-ocr` (Apple Vision on the Mac).

## Headers and static files

Every response carries the spec's CSP (plus `base-uri 'none'; form-action 'self'`), `Referrer-Policy: no-referrer`, `nosniff`, HSTS, `Cross-Origin-Resource-Policy: same-origin`, and `Cross-Origin-Opener-Policy: same-origin` with `Cross-Origin-Embedder-Policy: require-corp` (cross-origin isolation, so onnxruntime-web gets wasm threads). `/vendor/ort/*` is served from `MONET_DIST/vendor/ort` (wasm `application/wasm`, mjs `text/javascript`, immutable). `/models/*` needs a session, is immutable, and ignores the `?v=` query.

## Additions to the spec

| Addition | Why |
|---|---|
| `item.day`, `item.orig_path`, `item.second_copy_at`, `meta` table | derived grouping key, stable path, backup state, reset token |
| `GET /api/timeline?favorite=1&album=<id>` | favourites and album pages without a new endpoint |
| `GET /api/trash`, `POST /api/items/:id/restore` | the soft delete needs a way back |
| `GET /api/albums/:id`, `DELETE /api/albums/:id` | an album page |
| `POST /api/export/ack {ids}` | the Mac confirms a second copy; read back in `ItemDetail.backup.secondCopyAt` and `/api/status.secondCopy {n,last}` |
| `/api/index/:id` accepts `vision-ocr` for OCR-only posts | the Mac's OCR does not come from the image model |
| `/media/:id/s|m` for devices with `index` or `upload` | thumbnails for the Mac panel and the Android queue |
| scope `export` for Mac devices | the Mac needs originals; Android must not get them |
| `timeline limit` counts days; `next` is the last day returned | grouping by day needs a day cursor |

## Deploy

`deploy/deploy.sh` builds, compiles, installs `libvips-tools ffmpeg unzip rsync` if missing, downloads GeoNames once, rsyncs `app/models` when it exists, installs `/usr/local/bin/monet-reset-passkeys`, `monet-invite` and `monet-members`, writes `/etc/monet.env` on the first run and prints the setup link. `deploy/nginx.sh` adds the SNI entry. Service user `monet` (static, so recovery does not leave root-owned database files). Env: `PORT=4320`, `HOST=127.0.0.1`, `MONET_ORIGIN`, `MONET_DB=/var/lib/monet/monet.db`, `MONET_DATA=/var/lib/monet/data`, `MONET_ORIGINALS=/var/lib/monet/originals`, `MONET_MODELS=/var/lib/monet/models`, `MONET_GEONAMES=/var/lib/monet/geonames/cities15000.txt`, `MONET_DIST=/usr/local/lib/monet/dist`, `MONET_SETUP_TOKEN` (from `/etc/monet.env`). nginx listens on `127.0.0.1:8446` behind the SNI switch.

## Tests

`bun test tests/server-*.test.ts`. `server-unit` (pure logic), `server-db` (bursts and clustering, in memory), `server-auth` (software authenticator, scopes, rate limits), `server-upload` (real server, real libvips), `server-e2e` (the sample folder through `tools/upload-dir.ts`; skipped without the folder or libvips).
