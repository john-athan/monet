import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GemmaBpe } from "../client/lib/ml/bpe";

// A tiny tokenizer.json in the shape of google/siglip2-*: ids 0..3 special, single characters, byte tokens, merges.
const V = ["<pad>", "<eos>", "<bos>", "<unk>", "▁", "h", "u", "n", "d", "s", "c", "e", "hu", "hun", "hund", "▁s", "▁sc", "<0xC3>", "<0xA9>", "ee", "ss"];
const tiny = new GemmaBpe({
  added_tokens: [{ id: 0, content: "<pad>" }, { id: 1, content: "<eos>" }, { id: 2, content: "<bos>" }, { id: 3, content: "<unk>" }],
  model: { type: "BPE", unk_token: "<unk>", byte_fallback: true, vocab: Object.fromEntries(V.map((s, i) => [s, i])),
    merges: [["h", "u"], ["hu", "n"], ["hun", "d"], ["▁", "s"], ["▁s", "c"], ["e", "e"], "s s"] },
}, 8);

describe("Gemma BPE (synthetic tokenizer.json)", () => {
  test("merges by rank, <eos>, then <pad> to exactly maxLen", () => {
    expect(tiny.encode("hund")).toEqual([14, 1, 0, 0, 0, 0, 0, 0]);
  });
  test("a space becomes ▁ and merges with what follows", () => {
    expect(tiny.tokens("hund sc")).toEqual([14, 16]);
  });
  test("a character outside the vocabulary falls back to its UTF-8 bytes", () => {
    expect(tiny.tokens("é")).toEqual([17, 18]);
  });
  test("no byte token for it: one <unk>, consecutive unknowns fused", () => {
    expect(tiny.tokens("xyz")).toEqual([3]);
    expect(tiny.tokens("xhx")).toEqual([3, 5, 3]);
  });
  test("the same pair merges at every place, left to right; the old 'a b' merge format works", () => {
    expect(tiny.tokens("eeee")).toEqual([19, 19]);
    expect(tiny.tokens("sss")).toEqual([20, 9]);
  });
  test("added tokens are kept whole and not run through BPE", () => {
    expect(tiny.tokens("hu<eos>hu")).toEqual([12, 1, 12]);
  });
  test("truncation keeps <eos> last", () => {
    expect(tiny.encode("hundhundhundhundhundhundhundhund")).toEqual([14, 14, 14, 14, 14, 14, 14, 1]);
  });
  test("empty text is <eos> and padding", () => {
    expect(tiny.encode("")).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
  });
});

// Reference ids from Hugging Face `tokenizers` on the same file (google/siglip2 via onnx-community, revision pinned in
// tools/fetch-models.ts). 671 strings (the label vocabulary, test queries, emoji, CJK, truncation) were compared on
// 2026-11-21 and all matched; these are a few of them.
const file = join(import.meta.dir, "..", "models", "siglip-tokenizer.json");
describe.skipIf(!existsSync(file))("Gemma BPE (real tokenizer.json, needs tools/fetch-models.ts)", () => {
  const tok = existsSync(file) ? new GemmaBpe(readFileSync(file, "utf8")) : (null as never);
  const ids = (s: string) => tok.tokens(s);
  test("special ids", () => { expect([tok.pad, tok.eos, tok.unk]).toEqual([0, 1, 3]); });
  test("German, lowercased", () => {
    expect(ids("hund im schnee")).toEqual([91738, 1485, 208309]);
    expect(ids("konservendose mit miesmuscheln")).toEqual([66024, 857, 615, 2642, 2218, 44524, 7967, 112580]);
    expect(ids("3.5 kg äpfel für 2,99 €")).toEqual([235304, 235265, 235308, 8904, 15341, 209106, 2943, 235248, 235284, 235269, 235315, 235315, 8296]);
  });
  test("a label prompt", () => { expect(ids("a photo of black and white photo")).toEqual([235250, 2686, 576, 2656, 578, 2674, 2686]); });
  test("emoji and an added token in the text", () => {
    expect(ids("🐶 hund 🎄")).toEqual([241878, 52096, 235248, 240773]);
    expect(ids("<eos> mitten drin")).toEqual([1, 110876, 104132]);
  });
  test("encode is 64 ids", () => { expect(tok.encode("hund").length).toBe(64); });
});
