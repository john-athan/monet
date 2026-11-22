// The arithmetic of grouping faces, with no database: a centroid is the normalised sum of a person's face vectors, and a
// face joins the person whose centroid it matches best. Cosine thresholds are the ones documented for SFace.
import { dot, normalise } from "./util";

/** Same person. OpenCV documents 0.363 for SFace on its benchmark, but on the test photos drawn and generated faces
 *  reached 0.42 against each other while real same-person pairs scored 0.65 and 0.82; at 0.363 four unrelated
 *  faces chained into one group. 0.42 keeps the real pairs and stops the chain. Splitting is cheap to fix (the merge
 *  suggestion and "Auch X?"), a wrong merge is not. Measured 2026-11-21. */
export const SAME_PERSON = 0.42;
/** Faces below this detection quality (tiny, blurred, half hidden) are stored but not grouped: they carry too little
 *  identity to compare, and on the test photos they were the ones that matched anything. */
export const MIN_QUALITY = 0.5;
/** Faces the detector is unsure of (score below this) are mostly real people in profile, turned away or half hidden,
 *  but about one in four is no face at all: a plant, a statue, a car. Such a face may join a person who already exists,
 *  if it looks clearly like them (WEAK_JOIN), but it never starts a person of its own, so the non-faces, which only
 *  resemble each other, no longer form a group. Read off a contact sheet of all grouped faces under 0.90 on
 *  2026-11-22: at 0.60 to 0.70 one in three was no face, at 0.80 to 0.85 one in twenty. */
export const WEAK = 0.80;
export const WEAK_JOIN = 0.50;
/** An unnamed group this close to a named person is offered as a suggestion. Looser on purpose: it is only a hint. */
export const SUGGEST = 0.30;

export type Group = { id: number; sum: Float32Array; n: number };
export const centroid = (g: Group) => normalise(g.sum);

/** The group with the highest cosine to `vec`, if that cosine reaches `threshold`. */
export function bestMatch(vec: Float32Array, groups: Iterable<Group>, threshold = SAME_PERSON, exclude: Set<number> = new Set()): { id: number; cos: number } | null {
  let best: { id: number; cos: number } | null = null;
  for (const g of groups) {
    if (!g.n || exclude.has(g.id)) continue;
    const c = dot(vec, centroid(g));
    if (c >= threshold && (!best || c > best.cos)) best = { id: g.id, cos: c };
  }
  return best;
}
export function addTo(g: Group, vec: Float32Array) { for (let i = 0; i < vec.length; i++) g.sum[i] += vec[i]; g.n++; }
export function removeFrom(g: Group, vec: Float32Array) { for (let i = 0; i < vec.length; i++) g.sum[i] -= vec[i]; g.n--; }
export const cosine = (a: Float32Array, b: Float32Array) => dot(normalise(a), normalise(b));
