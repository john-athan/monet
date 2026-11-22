# Files: documents, sheets, slides and the Ablage

Monet keeps more than photos: documents, spreadsheets and presentations in the common formats, for viewing and
organising, nothing is edited in the browser. Everything lives in one tree of folders, the **Ablage** (German Google
Drive calls its root "Meine Ablage"). Photos keep their feed exactly as it is; files get three views of their own
(Dokumente, Tabellen, Präsentationen) and a viewer. The shapes are in `shared/types.ts` (section "files"), the schema
is the last migration in `server/db.ts`. Everything in `docs/spec.md` (owner scoping, household reading, soft delete,
same-origin, no new packages, no long dashes, German du-form) applies unchanged.

## Formats

| Kind | Formats (extension of the original) | How it is shown |
|---|---|---|
| `doc` | pdf (portrait), docx, doc, odt, rtf, pages, txt, md, tex | pages as images, top to bottom; txt, md and tex also as their own text |
| `sheet` | xlsx, xlsm, xls, ods, numbers, csv, tsv | a grid of cell values, one tab per sheet |
| `slides` | pptx, ppt, odp, key, pdf whose first page is landscape | one slide large, all slides as a strip |
| `book` | epub | the book's own pages, chapter by chapter, with its table of contents |
| `audio` | mp3, m4a, m4b, aac, ogg, oga, opus, flac, wav | a player; the track keeps playing while you browse |
| `other` | everything else that is not a photo or a video | text files (no NUL, valid UTF-8) as text, the rest as a download |

A PDF is `slides` when its first page is wider than tall, else `doc`.

**Sniffing** (`server/docsniff.ts`, pure, imports no database): the bytes decide the family, the name only picks
within it. Photos and videos are sniffed first and keep their pipeline. Whatever is neither a photo, a video nor
one of the formats above is stored as `other` (no 415 any more), with `is_text` set when the first 64 KiB hold no
NUL and decode as UTF-8; its format is the lower case extension of the name (`bin` without one).

- EPUB: zip with an entry `mimetype` whose stored content is `application/epub+zip` (also accepted: a zip with
  `META-INF/container.xml` and a name ending in .epub).
- Audio: `ID3`, or an MPEG frame sync (0xFFE. in the first two bytes) with an .mp3 name; `fLaC`; `OggS` (ogg, oga,
  opus by name, default ogg); `RIFF....WAVE`; `ftyp` with brand `M4A `, `M4B ` or `M4P ` (checked before the video
  rule, which takes every other ftyp).

- `%PDF-` -> pdf. `{\rtf` -> rtf.
- `PK\x03\x04` (zip): read the central directory at the end of the file. `word/` -> docx, `xl/` -> xlsx/xlsm (by
  name, default xlsx), `ppt/` -> pptx, an entry `mimetype` whose stored content starts with
  `application/vnd.oasis.opendocument.text|spreadsheet|presentation` -> odt/ods/odp, `Index/Document.iwa` or
  `index.xml` -> key/pages/numbers by the name's extension (refused without one of those three). Any other zip: refused.
- `D0 CF 11 E0 A1 B1 1A E1` (OLE): doc, xls or ppt by the name's extension; other names refused.
- Text: no NUL byte in the first 64 KiB and the name ends in txt, md, markdown, tex, csv or tsv. Decoded as UTF-8
  (BOM stripped); if that is not valid UTF-8, as windows-1252.

At the first chunk only the head is known: `putChunk` accepts a doc candidate (`%PDF`, `{\rtf`, `PK`, OLE, or
text by name with no NUL in the head) and decides finally in `finish`, where the whole file is there.

## Storage

- Original: `$MONET_ORIGINALS/docs/<yyyy>/<mm>/<sha256>.<format>` (month of the upload). Never modified.
- Derived, under `$MONET_DATA/d/<sha[0:2]>/<sha>`:
  - `<sha>.pdf`: the PDF every non-PDF document and presentation is converted to (a PDF original is used as it is)
  - `<sha>-c.webp`: the cover, 480 px wide (sheets: a grid of the first cells drawn as SVG and rendered by libvips)
  - `<sha>-p<n>.webp`: page n (1-based) 1600 px wide, `<sha>-t<n>.webp` 320 px wide; made when first asked for
  - `<sha>-s<i>.json`: sheet i (0-based) as JSON `string[][]`, every row padded to the sheet's column count
- Delete is a soft delete (`deleted_at`), purged after 30 days with its derived files, like items.

## Rendering (server/docs.ts)

The upload answers as soon as the original is stored and the row is in (`state = 'pending'`). Rendering runs
afterwards in its own queue, one file at a time and never at the same time as a photo ingest is waiting
(it uses `ingest.enqueue`), so the photo pipeline keeps its pace. The startup sweep renders rows still `pending`.

1. Office formats and text (everything but pdf, csv, tsv): `soffice --headless --norestore
   -env:UserInstallation=file://$MONET_DATA/lo --convert-to pdf --outdir <work dir> <sha>.<format>`, timeout 180 s.
   Sheets are not converted to PDF.
2. Sheets (xlsx, xlsm, xls, ods, numbers): `soffice ... --convert-to 'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1'`
   writes one CSV per sheet ("Writing sheet <name> -> <path>" on stdout gives names and order). csv and tsv are parsed
   in Bun directly (delimiter: tab for tsv, else the most frequent of `,` `;` tab in the first line). At most 100 000
   rows and 200 columns per sheet are kept (`truncated` says when more were there); trailing empty rows and columns
   are dropped.
3. `pages` from `vipsheader -f n-pages`, `width`/`height` of page 1 from `vipsheader` (sheets: w 4, h 3).
4. Cover with `vipsthumbnail '<pdf>[page=0]' -s 480x` (sheets: the SVG grid).
5. Text for search: `pdftotext -l 200 -enc UTF-8 <pdf> -` (sheets: the cells joined by spaces; text files: their
   text), at most 512 KiB, into `doc.text` and `doc_fts(title, text)`.
6. `state = 'ok'`. Any step failing: `state = 'failed'`, `error` a German sentence ("Diese Datei konnte nicht
   aufbereitet werden."), the original stays downloadable. The kind of a PDF is fixed after step 3.

Sheets are stored as NDJSON, one row per line, `<sha>-s<i>.ndjson`, with `<sha>-s<i>.idx`: the byte offset of
every 256th row as little-endian float64. A window is read from disk by seeking, never by parsing the whole sheet,
so caps are 1 000 000 rows and 200 columns per sheet. Sheets made before this (`-s<i>.json`) are rendered again at
start.

soffice is `$MONET_SOFFICE` (default `soffice`). On kaleve-home that is a LibreOffice 26.8 unpacked for Monet alone
under `/opt/monet-libreoffice` (deploy/setup.sh, pinned by sha256): the distribution's 24.2 reads no current Numbers
file, and the laptop's desktop LibreOffice stays as it is.

**Books** (EPUB): `META-INF/container.xml` names the OPF; its spine is the reading order, the table of contents
comes from the EPUB 3 nav document or else the NCX. Stored as JSON in `doc.book`. `pages` = spine length; `by` =
dc:creator; cover = the manifest item with `properties="cover-image"` or `<meta name="cover">`, 480 px wide (none:
no cover, the client draws the title). Text for search: the spine's documents with tags stripped, 512 KiB at most.
`GET /media/doc/:id/book/<path>` serves one entry of the zip, read and inflated on request (`Bun.inflateSync` for
deflate), with the type by extension. HTML and XHTML entries go out with
`content-security-policy: default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'`
and a small style injected before `</head>` (readable width, `color-scheme: light dark`, images max-width 100 %).
The client shows them in an `<iframe sandbox="allow-same-origin">`: no script ever runs, same origin so the session
cookie and the images load. A path that is not an entry, or that climbs out with `..`, is a 404.

**Audio**: `ffprobe` gives duration and tags (title, artist, album, track); the title tag replaces the file name when
present. Embedded cover art (`ffmpeg -an -c:v copy`, then vipsthumbnail) becomes the cover. Text for search: the
tags. `GET /media/doc/:id/play` serves the original inline with its audio type and Range.

**Other**: nothing is rendered; `state` is `ok` at once. Text files get their text for search (512 KiB) and
`/media/doc/:id/text`.

Pages `p<n>`/`t<n>` are rendered on request (`vipsthumbnail '<pdf>[page=n-1]' -s 1600x`), one at a time per file,
then cached. A request for a page that does not exist is a 404.

## Folders

`folder(id, owner_id, parent_id, name)`; names are unique among siblings (a clash on create, rename or move is 409
"Hier gibt es schon einen Ordner mit diesem Namen."). Names: trimmed, 1 to 120 characters, no `/`. A folder can be
deleted only when it is empty (409 otherwise). Moving a folder into itself or a descendant is 400. Photos
(`item.folder_id`) and files (`doc.folder_id`) live in at most one folder each; `null` is the top of the Ablage.
Photos are in the Ablage only when they were put into a folder (by an upload of a folder or by moving them):
the photo feed and everything else about photos ignore folders.

Uploading a folder keeps its structure: the client sends the file's directory relative to what was dropped
(`webkitRelativePath` without the file name) as `folder=`, and the folder it was dropped on as `in=` (absent: the top).
The server creates missing folders on the way. A file that is already in the library (same sha256) keeps its row; it
is moved into that folder only if it had none.

## HTTP API (session; reads take X-Monet-Of like the rest, writes are the owner's)

```
PUT  /api/upload/:sha256?...&folder=Uni/Seminar&in=12   documents go through the same upload; the last chunk answers
     {doc: DocSummary, duplicate} instead of {item, duplicate}. /api/upload/check counts documents too.
GET  /api/docs?kind=doc|sheet|slides&q=&cursor=&limit=  -> DocList   newest modifiedAt first; q: FTS over title and text
GET  /api/docs/:id                -> DocDetail
PATCH /api/docs/:id {title?}      ; DELETE /api/docs/:id ; POST /api/docs/:id/restore
GET  /api/docs/:id/sheet/:i?from=&n=   -> SheetRows (n at most 1000)
GET  /media/doc/:id/c             cover webp      (404 while pending; the client shows the format's sign)
GET  /media/doc/:id/p/:n  /t/:n   page webp, 1600 / 320 px wide
GET  /media/doc/:id/o             the original, Content-Disposition: attachment with the original name
GET  /media/doc/:id/text          txt, md, tex, csv, tsv and `other` files with is_text: the decoded text, text/plain; charset=utf-8
GET  /api/docs/:id/book           -> BookOut (books)
GET  /media/doc/:id/book/<path>   one entry of an EPUB (see Books)
GET  /media/doc/:id/play          audio inline, with Range
GET  /api/folders/:id             -> FolderOut  (0: the top of the Ablage)
POST /api/folders {name, parentId: number|null} -> FolderSummary
PATCH /api/folders/:id {name?}    ; DELETE /api/folders/:id
POST /api/move MoveIn             moves photos, files and folders of your own library into a folder (null: the top)
POST /api/search                  SearchOut gains `docs: DocSummary[]` (at most 12, FTS over title and text of the
                                  content and text chips); empty when the search has no words
GET  /api/status                  gains `docs: {n, pending}`
```

## Client

- Routes: `/ablage` and `/ablage/<id>`, `/dokumente`, `/tabellen`, `/praesentationen`, `/buecher`, `/audio`,
  `/datei/<id>`, all inside
  `/bei/<id>/...` as usual. Section key `ablage` for all of them.
- Desktop sidebar: under the photo sections a heading "Dateien" with Ablage, Dokumente, Tabellen, Präsentationen,
  Bücher, Audio. `other` files have no list of their own: they live in the Ablage and turn up in search.
  Phone: one more tab "Ablage"; its pages start with a row of four pills (Ordner, Dokumente, Tabellen,
  Präsentationen).
- Lists (Dokumente, Tabellen, Präsentationen): covers in a grid grouped by month of `modifiedAt` ("November 2026"),
  a search field filtering by `q`. The Ablage: path as breadcrumb, folders first, then files, then photos as tiles.
  Select to move or delete; "Neuer Ordner"; rename a folder in place.
- Viewer `/datei/<id>`: doc pages stacked (lazy, the box sized from w/h before the image arrives); slides one large
  with a strip of `t` thumbnails, arrow keys and swipe; sheets a grid with column letters and row numbers, sheet
  tabs, rows fetched in windows as you scroll; txt and md as text (md: headings, lists, emphasis, code, links shown
  as text: escape first, never `{@html}` on file content). Header: title, Herunterladen, In Ordner verschieben,
  Löschen, details (format, size, date, folder). Pending: "Wird aufbereitet" and a poll every 3 s.
- Books: covers on a shelf (Bücher, grouped by author); the reader shows one spine document at a time in the
  sandboxed iframe, a table of contents to jump, previous and next chapter, the place kept in the URL hash.
- Audio: a list grouped by album (artist and album as heading, tracks in track order, duration); a click plays the
  track in a player bar at the bottom of the app that stays while you move between pages and plays the rest of the
  album after it. `/datei/<id>` for audio: cover, tags and the same player.
- Other: the viewer says "Diese Datei kann Monet nicht anzeigen." with Herunterladen; text files as plain text.
- Import accepts every file that is not hidden (`.` names, `__MACOSX`, `~$` lock files); a dropped folder keeps its
  structure.
