// The API shapes of Monet. The server returns exactly these; the client imports them as types only.
// Contract: docs/spec.md. Where this file adds to the spec, docs/backend.md says so.
import type { AccountDevice } from "./accounts";

export type ItemKind = "photo" | "video";
export type TakenSrc = "exif" | "name" | "sidecar" | "mtime" | "upload";
export type Source = "web" | "android" | "mac" | "takeout";

export interface ItemSummary {
  id: number; kind: ItemKind; w: number; h: number;
  /** '#rrggbb', the mean colour of the picture, for the placeholder while the thumbnail loads */
  color: string;
  /** ms since epoch, UTC */
  takenAt: number;
  durationMs?: number;
  /** present on the shown (rank 1) item of a burst */
  burst?: { count: number };
  favorite: boolean;
  /** set when the photo belongs to another person than the library being looked at (a search over the household) */
  owner?: number;
}

export interface ItemDetail extends Omit<ItemSummary, "burst" | "owner"> {
  /** whose photo this is; only they can change it */
  owner: number;
  sha256: string; mime: string; bytes: number; origName: string | null; source: Source; takenSrc: TakenSrc;
  tzMin: number | null; uploadedAt: number;
  exif: { camera: string | null; exposure: string | null; fnumber: number | null; iso: number | null; focal: number | null; lat: number | null; lon: number | null };
  place: { name: string; admin1: string | null; country: string } | null;
  faces: { id: number; x: number; y: number; w: number; h: number; personId: number | null; name: string | null }[];
  /** every live item of the burst this one belongs to, best first (empty when it is in none) */
  burst: { id: number }[];
  labels: { label: string; score: number }[];
  ocr: string | null;
  backup: { original: true; secondCopyAt: number | null };
  deletedAt: number | null;
}

export interface TimelineDay {
  /** local calendar day, YYYY-MM-DD */
  date: string;
  /** "Heute", "Gestern", "Sonntag, 16. November", "Samstag, 14. Februar 2015" */
  title: string;
  place: string | null;
  /** the day's accent colour, 4.5:1 on #EEF2EA */
  sign: string;
  /** the same hue for the night theme, 4.5:1 on #1C2049 */
  signNight: string;
  items: ItemSummary[];
}
export interface Timeline { days: TimelineDay[]; next: string | null }
export interface Band { months: { ym: string; n: number; colors: string[] }[] }

export interface SeriesOut { key: string; title: string; subtitle: string; items: { id: number; year: number }[] }

export interface PeopleOut {
  named: { id: number; name: string; count: number; face: number | null }[];
  unnamed: { id: number; count: number; faces: number[]; last: { date: string; place: string | null } }[];
  suggestions: { named: number; unnamed: number; count: number }[];
}

export type ChipKind = "person" | "date" | "place" | "content" | "text";
/** value: person -> person id; place -> place id; content/text -> the words;
 *  date -> 'y:2019' | 'm:8' | 's:sommer|winter|fruehling|herbst' | 'r:12-20..12-26' (several date chips are ANDed) */
export interface Chip { kind: ChipKind; label: string; value: string }
export interface ParseOut { chips: Chip[]; rest: string }
/** everyone: search the whole household, not only the library being looked at */
export interface SearchIn { chips: Chip[]; vec?: string; sort?: "best" | "date"; limit?: number; offset?: number; everyone?: boolean }
export interface SearchOut { total: number; items: ItemSummary[]; relaxed: { label: string; count: number } | null; /** files whose title or text match the words (docs/files.md) */ docs: DocSummary[] }

/** What the image model recognised: one label, how many shown photos carry it, and the photo that carries it most clearly. */
export interface ThingOut { label: string; count: number; item: number }
export interface PlaceOut { id: number; name: string; country: string; count: number; item: number; lat: number; lon: number; colors: string[] }
/** Geotagged shown photos as parallel arrays. */
export interface MapOut { ids: number[]; lat: number[]; lon: number[]; color: string[] }
export interface AlbumOut { id: number; name: string; count: number; cover: number | null }
export interface AlbumDetail extends AlbumOut { items: ItemSummary[] }

export interface PendingItem { id: number; kind: ItemKind; needs: ("clip" | "faces" | "ocr")[] }
export interface IndexFace { x: number; y: number; w: number; h: number; landmarks: number[]; score: number; quality: number; vec: string }
export interface IndexIn { model: string; clip?: string; faces?: IndexFace[]; ocr?: string }

export interface Status {
  items: number; videos: number; bytes: number;
  stages: Record<"thumbs" | "clip" | "faces" | "ocr" | "labels", { done: number; total: number }>;
  devices: number; lastUpload: number | null;
  /** the style of this library (owner.theme): the Android and Mac apps wear it from shared/styles.ts */
  theme: Theme;
  /** originals the Mac confirmed as copied (POST /api/export/ack): how many, and when the last one was */
  secondCopy: { n: number; last: number | null };
  /** files in the library, and how many of them are still being rendered */
  docs: { n: number; pending: number };
}
export interface ExportRow { id: number; sha256: string; ext: string; bytes: number; takenAt: number }

/** a photo or video answers with item, a document with doc (docs/files.md) */
export type UploadDone = { item: ItemSummary; duplicate: boolean } | { doc: DocSummary; duplicate: boolean };
/** Accounts, passkeys, sessions and links are the accounts module's shapes (shared/accounts.ts); a device adds what Monet counts. */
export type DeviceOut = AccountDevice & { kind: "android" | "mac"; uploads: number; lastUpload: number | null };

/** The look of a library. Monet is the default; every person picks their own, and whoever looks at their photos sees it. */
export type Theme = "monet" | "ernst" | "magritte";
/** The four lights of the day the app is painted in; client/lib/light.ts picks one from the clock. */
export type Light = "morgen" | "mittag" | "abend" | "nacht";
/** joined: has a passkey (false while the invite is open) */
export interface Member { id: number; name: string; theme: Theme; count: number; cover: number | null; joined: boolean }
export interface HouseholdOut { me: number; members: Member[] }

/* ---------- files: documents, sheets, slides and the folders that hold everything (docs/files.md) ---------- */
/** doc: text documents and most PDFs; sheet: spreadsheets and CSV; slides: presentations and landscape PDFs;
 *  book: EPUB; audio: music and recordings; other: any other file, kept and offered for download (or read as text) */
export type DocKind = "doc" | "sheet" | "slides" | "book" | "audio" | "other";
/** pending: the original is stored, the pages are still being made; failed: only the original can be downloaded */
export type DocState = "pending" | "ok" | "failed";
export interface DocSummary {
  id: number; kind: DocKind;
  /** the file name without its extension; can be renamed */
  title: string;
  /** lower case extension of the original: 'docx', 'pdf', 'csv', 'key' ... */
  format: string;
  bytes: number;
  /** pages or slides (null until rendered, and for sheets) */
  pages: number | null;
  /** size of the first page or the cover, any unit; only the ratio counts (0 until rendered) */
  w: number; h: number;
  /** ms UTC: the file's own modification time as the client sent it, else the upload time */
  modifiedAt: number;
  state: DocState;
  folderId: number | null;
  /** set when the file belongs to another person than the library being looked at */
  owner?: number;
  /** book: the author; audio: the artist (from the file's own tags) */
  by?: string;
  /** audio only, from the tags */
  album?: string; track?: number; durationMs?: number;
  /** other only: the file reads as text, the viewer shows it as such */
  text?: boolean;
}
/** an EPUB: the reading order and the table of contents; href is a path inside the book, served at /media/doc/:id/book/<href> */
export interface BookOut { spine: { href: string; title: string | null }[]; toc: { title: string; href: string; depth: number }[] }
export interface DocDetail extends Omit<DocSummary, "owner"> {
  owner: number; sha256: string; mime: string; origName: string | null; uploadedAt: number;
  /** why rendering failed, in German, when state is 'failed' */
  error: string | null;
  /** the folders from the top down to the one holding the file (empty: at the top of the Ablage) */
  path: { id: number; name: string }[];
  /** sheets only: name, number of rows and columns of every sheet, in order */
  sheets: { name: string; rows: number; cols: number; truncated: boolean }[];
  deletedAt: number | null;
}
export interface DocList { docs: DocSummary[]; next: string | null }
/** a window of one sheet: rows[from .. from + rows.length), each row padded to the sheet's cols */
export interface SheetRows { from: number; rows: string[][] }
export interface FolderSummary { id: number; name: string; /** files and photos directly inside, plus subfolders */ count: number; /** up to 4 covers to paint the folder with */ peek: ({ doc: number } | { item: number })[] }
export interface FolderOut {
  /** null: the top of the Ablage */
  id: number | null; name: string;
  path: { id: number; name: string }[];
  folders: FolderSummary[];
  docs: DocSummary[];
  items: ItemSummary[];
}
export interface MoveIn { into: number | null; docs?: number[]; items?: number[]; folders?: number[] }
