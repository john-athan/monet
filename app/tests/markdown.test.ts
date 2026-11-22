import { test, expect } from "bun:test";
import { parseMarkdown, inline, type Block, type Inline } from "../client/lib/markdown";

const text = (n: Inline[]): string => n.map(x => x.t === "text" || x.t === "code" ? x.v : x.t === "br" ? "\n" : text(x.c)).join("");

test("headings, paragraphs and rules", () => {
  const b = parseMarkdown("# Titel\n\nErster Satz\nzweite Zeile.\n\n### Drei ###\n\n---\n\nUnter\n===\n");
  expect(b.map(x => x.t)).toEqual(["h", "p", "h", "hr", "h"]);
  expect((b[0] as any).level).toBe(1);
  expect(text((b[1] as any).c)).toBe("Erster Satz zweite Zeile.");
  expect(text((b[2] as any).c)).toBe("Drei");
  expect((b[4] as any).level).toBe(1);
});

test("nested emphasis", () => {
  expect(inline("**fett mit *kursiv* darin**")).toEqual([{ t: "strong", c: [{ t: "text", v: "fett mit " }, { t: "em", c: [{ t: "text", v: "kursiv" }] }, { t: "text", v: " darin" }] }]);
  expect(inline("***beides***")).toEqual([{ t: "em", c: [{ t: "strong", c: [{ t: "text", v: "beides" }] }] }]);
  expect(inline("_kursiv_ und snake_case_name")).toEqual([{ t: "em", c: [{ t: "text", v: "kursiv" }] }, { t: "text", v: " und snake_case_name" }]);
  // an unmatched mark stays a character
  expect(text(inline("2 * 3 = 6"))).toBe("2 * 3 = 6");
});

test("inline code, escapes and links", () => {
  expect(inline("`a *b* c`")).toEqual([{ t: "code", v: "a *b* c" }]);
  expect(text(inline("\\*kein\\*"))).toBe("*kein*");
  const l = inline("[Monet](https://monet.kaleve.dev \"Titel\")")[0] as any;
  expect(l.t).toBe("link"); expect(l.href).toBe("https://monet.kaleve.dev"); expect(text(l.c)).toBe("Monet");
});

test("lists nest and keep their numbering", () => {
  const b = parseMarkdown("- eins\n- zwei\n  - innen a\n  - innen b\n- drei\n\n3. dritte\n4. vierte");
  const ul = b[0] as Extract<Block, { t: "list" }>;
  expect(ul.ordered).toBe(false);
  expect(ul.items.length).toBe(3);
  const inner = ul.items[1].find(x => x.t === "list") as Extract<Block, { t: "list" }>;
  expect(inner.items.length).toBe(2);
  const ol = b[1] as Extract<Block, { t: "list" }>;
  expect(ol.ordered).toBe(true); expect(ol.start).toBe(3); expect(ol.items.length).toBe(2);
});

test("code fences keep their content verbatim", () => {
  const src = "```ts\nconst a = *b* ** c;\n# not a heading\n- not a list\n<b>x</b>\n\n  indented\n```\nnach dem Block";
  const b = parseMarkdown(src);
  expect(b[0]).toEqual({ t: "code", lang: "ts", v: "const a = *b* ** c;\n# not a heading\n- not a list\n<b>x</b>\n\n  indented" });
  expect(b[1].t).toBe("p");
  // an unclosed fence runs to the end
  expect((parseMarkdown("~~~\nnoch offen\n# x") [0] as any).v).toBe("noch offen\n# x");
  // a shorter fence inside does not close a longer one
  expect((parseMarkdown("````\n```\ninnen\n```\n````")[0] as any).v).toBe("```\ninnen\n```");
});

test("blockquotes hold blocks", () => {
  const b = parseMarkdown("> Zitat **fett**\n> weiter\n>\n> - Punkt");
  expect(b.length).toBe(1);
  const q = b[0] as Extract<Block, { t: "quote" }>;
  expect(q.c.map(x => x.t)).toEqual(["p", "list"]);
});

test("HTML in the source stays literal text", () => {
  const src = "<script>alert(1)</script>\n\n<img src=x onerror=alert(1)> und [x](javascript:alert(1)) <b>fett</b>";
  const b = parseMarkdown(src);
  expect(b.map(x => x.t)).toEqual(["p", "p"]);
  expect(text((b[0] as any).c)).toBe("<script>alert(1)</script>");
  const p = b[1] as Extract<Block, { t: "p" }>;
  expect(text(p.c)).toContain("<img src=x onerror=alert(1)>");
  expect(text(p.c)).toContain("<b>fett</b>");
  // the link is a node with its URL as data; the viewer shows it as text, never as an anchor
  const link = p.c.find(x => x.t === "link") as any;
  expect(link.href).toBe("javascript:alert(1)");
  // no node type can carry markup
  const kinds = new Set(JSON.stringify(b).match(/"t":"(\w+)"/g));
  expect([...kinds].every(k => ["\"t\":\"p\"", "\"t\":\"text\"", "\"t\":\"link\""].includes(k))).toBe(true);
});

test("empty and odd input does not throw", () => {
  expect(parseMarkdown("")).toEqual([]);
  expect(parseMarkdown("\n\n  \n")).toEqual([]);
  expect(() => parseMarkdown("[[[ ((( ** __ ``` > - 1. \\")).not.toThrow();
  expect(() => parseMarkdown("a".repeat(100000) + "*".repeat(5000))).not.toThrow();
});
