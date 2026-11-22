// One search: parse the text into chips, embed the picture words in the browser, ask the server.
import type { Chip, ParseOut, SearchOut } from "../../shared/types";
import { post } from "./api";
import { ml } from "./ml-api";

export const b64 = (v: Float32Array) => { const u = new Uint8Array(v.buffer, v.byteOffset, v.byteLength); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

// The vector of a word never changes, so each word is embedded once per page load. A failure is forgotten so the next
// search tries again.
const vecs = new Map<string, Promise<string>>();
/** The picture words as a search vector. The first call loads the text model (565 MB), which can take a while. */
export function embed(text: string): Promise<string> {
  let p = vecs.get(text);
  if (!p) { p = ml.embedText(text).then(b64); vecs.set(text, p); p.catch(() => vecs.delete(text)); }
  return p;
}

/** Searches with the given chips; `vec` is the embedded content chip, if there is one yet. */
export const searchChips = (chips: Chip[], sort: "best" | "date", limit = 120, everyone = false, vec?: string, offset = 0, days = false) =>
  post<SearchOut>("/api/search", { chips, vec, sort, limit, everyone, offset, days });
export const parseText = (q: string, everyone = false) => post<ParseOut>("/api/search/parse", { q, everyone });
