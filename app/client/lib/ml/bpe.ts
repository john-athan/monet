// The SigLIP 2 text tokenizer (Gemma's): byte-level-fallback BPE read from Hugging Face's tokenizer.json, written by
// hand like the image preprocessing so the worker needs no tokenizer library. What it does, in the order the
// tokenizer.json of google/siglip2-* asks for:
//   1. added tokens ("<eos>", "<pad>", "<unused0>", ...) are cut out of the text first and kept whole;
//   2. the normalizer turns every space into "▁" (so the Split pre-tokenizer on " " has nothing left to split);
//   3. BPE: the text starts as single characters; a character missing from the vocabulary becomes its UTF-8 bytes
//      as "<0xNN>" tokens (byte fallback); then the adjacent pair with the lowest merge rank is merged until none is left;
//   4. "<eos>" is appended, the result truncated to maxLen and padded with "<pad>" to exactly maxLen.
// Lowercasing is the caller's job: SigLIP 2 was trained on lowercased text (tokenizer_config do_lower_case) but the
// tokenizer.json does not do it. Without it retrieval drops from MRR 0.96 to 0.31 (docs/ml.md).

type TokenizerJson = {
  added_tokens: { id: number; content: string }[];
  model: { type: string; vocab: Record<string, number>; merges: ([string, string] | string)[]; unk_token?: string; byte_fallback?: boolean };
};

const SPACE = "▁"; // ▁

export class GemmaBpe {
  private vocab: Map<string, number>;
  private merges = new Map<number, number>(); // (idA * STRIDE + idB) -> rank
  private stride: number;
  private added: { content: string; id: number }[];
  private addedFirst = new Set<string>();
  readonly pad: number; readonly eos: number; readonly unk: number;

  constructor(json: TokenizerJson | string, readonly maxLen = 64) {
    const t: TokenizerJson = typeof json === "string" ? JSON.parse(json) : json;
    if (t.model.type !== "BPE") throw new Error(`tokenizer: expected BPE, got ${t.model.type}`);
    this.vocab = new Map(Object.entries(t.model.vocab));
    this.stride = 2 ** Math.ceil(Math.log2(Math.max(2, this.vocab.size + 1)));
    t.model.merges.forEach((m, rank) => {
      const [a, b] = typeof m === "string" ? splitMerge(m) : m;
      const ia = this.vocab.get(a), ib = this.vocab.get(b);
      if (ia == null || ib == null) return;
      const key = ia * this.stride + ib;
      if (!this.merges.has(key)) this.merges.set(key, rank);
    });
    // longest first, so "<start_of_turn>" wins over a shorter token that is its prefix
    this.added = t.added_tokens.map(a => ({ content: a.content, id: a.id })).filter(a => a.content).sort((x, y) => y.content.length - x.content.length);
    for (const a of this.added) this.addedFirst.add(a.content[0]);
    const id = (s: string) => { const v = this.vocab.get(s) ?? t.added_tokens.find(a => a.content === s)?.id; if (v == null) throw new Error(`tokenizer: no ${s}`); return v; };
    this.pad = id("<pad>"); this.eos = id("<eos>"); this.unk = id(t.model.unk_token ?? "<unk>");
  }

  /** Token ids without <eos> or padding. */
  tokens(text: string): number[] {
    const out: number[] = [];
    let i = 0, start = 0;
    const flush = (end: number) => { if (end > start) out.push(...this.bpe(text.slice(start, end).replaceAll(" ", SPACE))); };
    while (i < text.length) {
      // added tokens are not normalized: they match the raw text ("<eos>", "\n\n", ...)
      const hit = this.addedFirst.has(text[i]) ? this.added.find(a => text.startsWith(a.content, i)) : undefined;
      if (hit) { flush(i); out.push(hit.id); i += hit.content.length; start = i; } else i++;
    }
    flush(text.length);
    return out;
  }

  /** Exactly maxLen ids: tokens, <eos>, then <pad>. Truncation keeps the <eos>. */
  encode(text: string): number[] {
    const ids = this.tokens(text).slice(0, this.maxLen - 1);
    ids.push(this.eos);
    while (ids.length < this.maxLen) ids.push(this.pad);
    return ids;
  }

  private bpe(word: string): number[] {
    // symbols as ids; a symbol from byte fallback may not merge (no merge lists byte tokens), which is what HF does too
    let syms: number[] = [];
    for (const ch of word) {
      const v = this.vocab.get(ch);
      if (v != null) { syms.push(v); continue; }
      let ok = true; const bytes: number[] = [];
      for (const b of new TextEncoder().encode(ch)) {
        const bv = this.vocab.get(`<0x${b.toString(16).toUpperCase().padStart(2, "0")}>`);
        if (bv == null) { ok = false; break; }
        bytes.push(bv);
      }
      // fuse_unk: consecutive unknowns become one <unk>
      if (ok) syms.push(...bytes); else if (syms[syms.length - 1] !== this.unk) syms.push(this.unk);
    }
    for (;;) {
      let best = -1, bestRank = Infinity;
      for (let k = 0; k < syms.length - 1; k++) {
        const r = this.merges.get(syms[k] * this.stride + syms[k + 1]);
        if (r != null && r < bestRank) { bestRank = r; best = k; }
      }
      if (best < 0) return syms;
      const merged = this.vocab.get(this.str(syms[best]) + this.str(syms[best + 1]));
      if (merged == null) return syms; // a merge whose result is not in the vocabulary: cannot happen in a valid file
      // merge every occurrence of this pair left to right, as HF does for one rank
      const a = syms[best], b = syms[best + 1], next: number[] = [];
      for (let k = 0; k < syms.length; k++) {
        if (k < syms.length - 1 && syms[k] === a && syms[k + 1] === b) { next.push(merged); k++; } else next.push(syms[k]);
      }
      syms = next;
    }
  }

  private rev: string[] | null = null;
  private str(id: number): string {
    if (!this.rev) { this.rev = []; for (const [s, i] of this.vocab) this.rev[i] = s; }
    return this.rev[id];
  }
}

/** Old merges format "a b"; tokens never contain a plain space (spaces are ▁). */
function splitMerge(m: string): [string, string] {
  const i = m.indexOf(" ", 1);
  return [m.slice(0, i), m.slice(i + 1)];
}
