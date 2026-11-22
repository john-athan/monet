// The text pieces of a file that get a vector (docs/files.md, "Vectors"). Pure: the server plans them, the darkroom
// embeds exactly these strings in this order, and the server checks the count when the vectors come back.
// SigLIP 2 reads 64 tokens; 32 German words come to about that, so a piece is 32 words. The title is a piece of its own:
// it is often the best summary a file has.

export const CHUNK_WORDS = 32;
/** pieces from the start of the text, then pieces spread over the rest */
export const CHUNK_HEAD = 6;
export const CHUNK_SPREAD = 6;

/** The file name as words: "Lohnabrechnung-2024_06" -> "Lohnabrechnung 2024 06". */
export const titleWords = (t: string) => t.replace(/[_\-.+]+/g, " ").replace(/\s+/g, " ").trim();

/** At most 1 + CHUNK_HEAD + CHUNK_SPREAD pieces: the title, the first pieces of the text, then evenly spread ones. */
export function chunkText(title: string, text: string | null): string[] {
  const out: string[] = [];
  const t = titleWords(title);
  if (t) out.push(t);
  // only words with a letter in them: tables of numbers say nothing a vector could find
  const words = (text ?? "").slice(0, 200_000).split(/\s+/).filter(w => /\p{L}/u.test(w) && w.length < 40);
  const n = Math.ceil(words.length / CHUNK_WORDS);
  const piece = (k: number) => words.slice(k * CHUNK_WORDS, (k + 1) * CHUNK_WORDS).join(" ");
  const take = new Set<number>();
  for (let k = 0; k < Math.min(n, CHUNK_HEAD); k++) take.add(k);
  const rest = n - CHUNK_HEAD;
  if (rest > 0) for (let j = 0; j < Math.min(rest, CHUNK_SPREAD); j++) take.add(CHUNK_HEAD + Math.floor(((j + 0.5) * rest) / Math.min(rest, CHUNK_SPREAD)));
  for (const k of [...take].sort((a, b) => a - b)) { const p = piece(k); if (p.split(" ").length >= 4) out.push(p); }
  return out;
}
