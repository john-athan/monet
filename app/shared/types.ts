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
export interface SearchOut { total: number; items: ItemSummary[]; relaxed: { label: string; count: number } | null }

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
}
export interface ExportRow { id: number; sha256: string; ext: string; bytes: number; takenAt: number }

export interface UploadDone { item: ItemSummary; duplicate: boolean }
/** Accounts, passkeys, sessions and links are the accounts module's shapes (shared/accounts.ts); a device adds what Monet counts. */
export type DeviceOut = AccountDevice & { kind: "android" | "mac"; uploads: number; lastUpload: number | null };

/** The look of a library. Monet is the default; every person picks their own, and whoever looks at their photos sees it. */
export type Theme = "monet" | "ernst" | "magritte";
/** The four lights of the day the app is painted in; client/lib/light.ts picks one from the clock. */
export type Light = "morgen" | "mittag" | "abend" | "nacht";
/** joined: has a passkey (false while the invite is open) */
export interface Member { id: number; name: string; theme: Theme; count: number; cover: number | null; joined: boolean }
export interface HouseholdOut { me: number; members: Member[] }
