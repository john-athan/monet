# Everything together

Photos, videos, files and recordings are one library, not four. This part of the contract says how: one timeline,
one search, stacks of near-identical files, transcripts, labels, links to people and places, and moments. Everything
in `docs/spec.md` and `docs/files.md` applies unchanged. The schema is the migration after the files one in
`server/db.ts`; the shapes are in `shared/types.ts` (section "everything together").

## Dates

A file has its own date (`doc.taken_at`, `taken_src`, `day`), set after it is rendered (`server/docdate.ts`, `dateDoc`
in `server/together.ts`). The first of these that is there and plausible (after 1990, not in the future) wins:

| Source | Where it comes from |
|---|---|
| `meta` | a PDF original's CreationDate (`pdfinfo -isodates`), Office `dcterms:created`, ODF `meta:creation-date`, an audio file's `creation_time` (or `date`, but not for music with an album tag) |
| `name` | a date in the file name, the photo rules (`dateFromName`) |
| `text` | the first date in the first 4000 characters of the text (12.03.2021, 12. März 2021, 2021-03-12, March 12, 2021); documents, slides and other files only |
| `mtime` | the mtime the client sent, when it differs from the upload time |
| `upload` | the upload time |

A converted PDF has no `meta` date: its CreationDate is the conversion. Books never take one.

## Timeline

`GET /api/timeline` returns files on their `day` in `TimelineDay.docs` (one per stack, its top), after the photos of
that day; days with only files are days too. `files=0` leaves them out; favourites and albums never have them. The
band counts them. The client lays a file out as a tile in the same rows (a page upright, slides lying, books 2:3,
records square) and opens it in the file viewer.

## Stacks

Files that are versions or siblings of each other and were made in the same few days are one stack
(`doc.stack_id`, `stack_rank`; rank 1 is the newest and is shown). Two files stack when all of these hold:

| Rule | Why |
|---|---|
| same kind (doc, sheet, slides, other) | a letter and its spreadsheet are not versions |
| at most 3 days apart, the stack spans at most 14 | "the same timeframe": monthly statements stay apart |
| the same stem, or 60 % of their words shared | a stem drops words with digits ("#"), "v2", copy numbers and version words (final, neu, Kopie, Entwurf) |

Stacks are computed again for the whole library after every render (2 s later) and at start. `POST
/api/docs/:id/unstack` takes a file out for good (`unstacked`). `GET /api/docs/:id/stack` lists the stack top first.
Lists (Dokumente, Tabellen, Präsentationen) and the timeline show the top with its count; the Ablage and search show
every file.

A click on a pile fans it out in place: the URL gains `?stapel=<id>` (a new history entry), the files fly from the
pile to their places and the rest moves aside. Back, Escape or the fold button on the top file folds them onto it
again. With reduced motion it simply changes.

## Vectors and search

The darkroom embeds files after photos (`GET /api/index/docs/pending`, `POST /api/index/doc/:id`). The server plans
what (`server/docvec.ts`): the cover and pages 2 and 3 (`t` thumbnails) of documents and slides, the cover of books
and records that have one, with the image tower; the title and up to 12 pieces of 32 words of the text and transcript
(`server/chunks.ts`: 6 from the start, 6 spread over the rest) with the text tower. The post must have exactly as many
vectors as the plan (409 otherwise: the file changed, the darkroom asks again). In memory they are int8, one scale
per row.

SigLIP's text tower ranks text against text poorly: every piece lands at 0.78 ± 0.04 and form-like pieces win every
query. Text vectors are therefore centred (on the library's mean piece; queries on the mean label prompt) and a piece
counts at a centred cosine of 0.2 and 3 standard deviations. Page vectors follow the photo rule (0.085, z 1.5).
Calibrated on 2026-11-22 with 90 real files and 30 German queries.

`POST /api/search` returns up to 60 files, fused by reciprocal rank (k 60) from three lists: FTS over title, text,
labels, transcript and the names a file mentions; FTS over the labels the query stands for (query expansion: the
query's best label takes at least 50 % of the softmax over the vocabulary, then every label with 10 %, at most
three; "house" finds "Haus"); and the vectors. Person and place chips match files that name them, date chips the
file's day. Without words or a vector the chips alone list files, newest first.

## Text on the page

Every document and presentation keeps where its text stands (`server/doctext.ts`, `doc.words_ok`): after the render,
`pdftotext -bbox-layout` gives every line and word with its box, stored as `<sha>-w.ndjson` (one JSON line per page,
boxes as fractions of the page). A file with fewer than 20 letters per page is a scan: the OCR queue reads its first
30 pages (the 1600 px page pictures, after the photos, one file at a time), its lines become the text layer and,
when the file had no text, its text; then it is dated (a scan takes the date written on it before its own
CreationDate, which is the day it was scanned), linked and embedded again.

- `GET /api/docs/:id/words/:n`: the lines of page n. The viewer lays them over the page picture as invisible SVG
  text stretched to each line's box, so text can be selected and copied and the browser's own find sees the pages
  that are loaded.
- `GET /api/docs/:id/find?q=`: where a text stands, at most 500 hits: `{page, boxes}` for documents and
  presentations, `{sheet, row, col}` for sheets (the first 200 000 rows of each). Case, accents and ß do not matter,
  a hit may span words and lines.
- The viewer's own search (the Suchen button, Cmd/Ctrl+F on pages, slides and sheets) asks the server, marks every
  hit and goes from one to the next (Enter, Shift+Enter). Text files search their own text in the page.
- `/datei/<id>?finde=<words>`: a mention ("Erwähnt in" on a person's or place's page, with their name) and a search
  hit (with the words searched, else the person or place) open the file at the first hit, with the search open.
  Without a hit the file opens as always: the jump only happens where the words really stand. A recording marks
  the transcript segments that hold the words.

## Labels

A file gets the labels its pages show, as a photo would (softmax share 15 %, at most three), without the ones every
page of text gets (Dokument, Text, Buchseite, Screenshot, Formular, Tabelle, Brief, Zeitung, Buch). They are in its
search row and on Dinge: `ThingOut.docs` counts files, a label only files carry gets a card with a file's cover.

## Transcripts

The Mac transcribes on the device with Apple's SpeechAnalyzer (German): videos and recordings of its owner, not
music (an album tag) and nothing over three hours. `GET /api/index/speech/pending` → `[{ref, id, durationMs, ext}]`;
the Mac fetches `/media/:id/o` or `/media/doc/:id/play` (devices with scope index may read their own files' `c`, `t`
and `play`) and posts `POST /api/index/speech/(item|doc)/:id {model, lang, segments: [{s, e, t}]}` (ms), or
`{failed: true}` when the file cannot be transcribed. A transcript goes into the search rows (a video's beside its OCR
text), a recording's vectors are made again, and the viewers show it in segments that play from their time.

## Links

A file links to the named people of its owner (three letters or more) and the places where the owner has photos
(four letters or more, not a German noun that is also a town: Essen, Halle, Hof) that its title, text or transcript
name as whole words (`doc_link`). Again after every render and transcript, and every six hours for all files.
`GET /api/links?person=<id>` or `?place=<id>` lists them; the person's and the place's pages show them as "Erwähnt in".

## Moments

`GET /api/moments`, `GET /api/moments/<start day>` (`server/moments.ts`), computed on request:

- **Away**: home is the place photographed on the most days. A day is away when its main place is more than 50 km
  from home. Away days at most 2 days apart are one moment, with at least 12 photos. Title: its main place, or the
  two main places ("Lissabon und Porto") when the second has 30 % of the first's photos.
- **At home**: a day with at least 30 photos that one of the event labels (Geburtstag, Hochzeit, Taufe, Weihnachten,
  Silvester, Ostern, Karneval, Halloween, Party, Konzert, Festival, Abschlussfeier, Grillen) covers for 20 %. Title: the
  label, with the year for Weihnachten and Silvester.
- **Its files**: those made during it, and those up to 60 days before or 14 after that name one of its places.

The client lists them on `/momente` (by year), shows one on `/moment/<day>` (files first, then the photos), the five
newest in the sidebar, and a strip of them above the phone's timeline.
