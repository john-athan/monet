// Turning a typed line into chips. Pure: no database, so the tests and the server share it.
import { MONTHS } from "./calc";
import { GERMAN_NAMES } from "./names";
import type { Chip, ParseOut } from "../shared/types";

export const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const MONTH_WORDS: Record<string, number> = {};
MONTHS.forEach((m, i) => { MONTH_WORDS[fold(m)] = i + 1; });
// the German names come from MONTHS above; these are the English ones that differ ("may" is also a month)
Object.assign(MONTH_WORDS, { maerz: 3, january: 1, february: 2, march: 3, may: 5, june: 6, july: 7, october: 10, december: 12 });
const SEASON_WORDS: Record<string, [string, string]> = {
  winter: ["winter", "Winter"], fruhling: ["fruehling", "Frühling"], fruehling: ["fruehling", "Frühling"], spring: ["fruehling", "Frühling"],
  sommer: ["sommer", "Sommer"], summer: ["sommer", "Sommer"], herbst: ["herbst", "Herbst"], autumn: ["herbst", "Herbst"],
};
export const SEASON_MONTHS: Record<string, number[]> = { winter: [12, 1, 2], fruehling: [3, 4, 5], sommer: [6, 7, 8], herbst: [9, 10, 11] };

export type ParseCtx = { people: { id: number; name: string }[]; places: { id: number; name: string }[] };
const PUNCT = /^[\s,;.!?]+|[\s,;.!?]+$/g;

/** Turns a line into chips. People (named ones only), places known in the library, years, months, seasons and
 *  "Weihnachten" become chips; what is left is one `content` chip, the words the client embeds for CLIP. */
export function parseQuery(q: string, ctx: ParseCtx): ParseOut {
  const toks = q.trim().split(/\s+/).filter(Boolean);
  const f = toks.map(t => fold(t.replace(PUNCT, "")));
  const used = new Array(toks.length).fill(false);
  const chips: Chip[] = [];
  const phrase = (words: string[]): number => {
    for (let i = 0; i + words.length <= f.length; i++)
      if (!used[i] && words.every((w, k) => !used[i + k] && f[i + k] === w)) return i;
    return -1;
  };
  const take = (i: number, n: number) => { for (let k = 0; k < n; k++) used[i + k] = true; };

  // 1. people: full name as a phrase, longest first; then one word of a longer name
  const named = ctx.people.filter(p => p.name).map(p => ({ ...p, words: fold(p.name).split(/\s+/).filter(Boolean) }));
  for (const p of [...named].sort((a, b) => b.words.length - a.words.length)) {
    const i = phrase(p.words);
    if (i >= 0) { take(i, p.words.length); chips.push({ kind: "person", label: p.name, value: String(p.id) }); }
  }
  // one word of a longer name ("Gerda" for "Tante Gerda") finds the person when no other named person has that word
  for (const p of named) {
    if (p.words.length < 2 || chips.some(c => c.kind === "person" && c.value === String(p.id))) continue;
    for (const w of p.words) {
      if (w.length < 3 || named.some(o => o !== p && o.words.includes(w))) continue;
      const i = phrase([w]);
      if (i >= 0) { take(i, 1); chips.push({ kind: "person", label: p.name, value: String(p.id) }); break; }
    }
  }
  // 2. places, also under their English name ("Munich" finds München)
  const alias = new Map(Object.entries(GERMAN_NAMES).map(([en, de]) => [fold(de), fold(en)]));
  for (const pl of [...ctx.places].sort((a, b) => b.name.length - a.name.length)) {
    const names = [fold(pl.name), alias.get(fold(pl.name))].filter(Boolean) as string[];
    for (const nm of names) {
      const i = phrase(nm.split(/\s+/));
      if (i >= 0) { take(i, nm.split(/\s+/).length); chips.push({ kind: "place", label: pl.name, value: String(pl.id) }); break; }
    }
  }
  // 3. dates
  for (let i = 0; i < f.length; i++) {
    if (used[i]) continue;
    const w = f[i];
    if (/^(19|20)\d{2}$/.test(w)) { take(i, 1); chips.push({ kind: "date", label: w, value: `y:${w}` }); }
    else if (w === "weihnachten" || w === "weihnacht" || w === "christmas") { take(i, 1); chips.push({ kind: "date", label: "Weihnachten", value: "r:12-20..12-26" }); }
    else if (SEASON_WORDS[w]) { take(i, 1); chips.push({ kind: "date", label: SEASON_WORDS[w][1], value: `s:${SEASON_WORDS[w][0]}` }); }
    else if (MONTH_WORDS[w]) { take(i, 1); chips.push({ kind: "date", label: MONTHS[MONTH_WORDS[w] - 1], value: `m:${MONTH_WORDS[w]}` }); }
  }
  const rest = toks.filter((_, i) => !used[i]).join(" ").replace(PUNCT, "");
  if (rest) chips.push({ kind: "content", label: rest, value: rest });
  return { chips, rest };
}
