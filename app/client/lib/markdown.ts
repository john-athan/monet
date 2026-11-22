// A small, safe Markdown parser: text in, token tree out. It never produces HTML and never looks at what a tag, an
// attribute or a URL means: everything that is not markup stays text, so the viewer can render the tree as plain
// nodes (components/TextView.svelte) without {@html}. Supported: headings (# and underline), paragraphs, nested
// ordered and unordered lists, blockquotes, fenced code, horizontal rules, and inline strong, emphasis, code, links
// and images (both shown as text with their URL, never as live elements).

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "em"; c: Inline[] }
  | { t: "strong"; c: Inline[] }
  /** shown as its text followed by the URL; the viewer never makes it clickable */
  | { t: "link"; href: string; c: Inline[] }
  | { t: "br" };

export type Block =
  | { t: "h"; level: number; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "list"; ordered: boolean; start: number; items: Block[][] }
  | { t: "code"; lang: string; v: string }
  | { t: "quote"; c: Block[] }
  | { t: "hr" };

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>[ \t]?/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*)|[ \t]*)$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const indentOf = (s: string) => s.length - s.trimStart().length;
const blank = (s: string) => !s.trim();

export function parseMarkdown(src: string): Block[] {
  return blocks(src.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n"));
}

/** Does this line start something that ends a running paragraph? */
function interrupts(l: string): boolean {
  if (FENCE.test(l) || HEADING.test(l) || HR.test(l) || QUOTE.test(l)) return true;
  const m = ITEM.exec(l);
  // an ordered item only interrupts when it starts at 1 (a year at a line start is not a list)
  return !!m && !!m[3] && (/^[-*+]$/.test(m[2]) || /^1[.)]$/.test(m[2]));
}

function blocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (blank(l)) { i++; continue; }

    let m = FENCE.exec(l);
    if (m) {
      const fence = m[1], indent = indentOf(l), body: string[] = [];
      i++;
      // a closing fence is the same character, at least as long, and nothing else on the line
      while (i < lines.length && !(lines[i].trim().startsWith(fence[0]) && new RegExp(`^ {0,3}\\${fence[0]}{${fence.length},}[ \\t]*$`).test(lines[i]))) {
        body.push(lines[i].slice(Math.min(indent, indentOf(lines[i])))); i++;
      }
      i++; // the closing fence (or past the end)
      out.push({ t: "code", lang: m[2] ?? "", v: body.join("\n") });
      continue;
    }

    if ((m = HEADING.exec(l))) { out.push({ t: "h", level: m[1].length, c: inline(m[2] ?? "") }); i++; continue; }
    if (HR.test(l)) { out.push({ t: "hr" }); i++; continue; }

    if (QUOTE.test(l)) {
      const inner: string[] = [];
      while (i < lines.length && !blank(lines[i])) {
        if (QUOTE.test(lines[i])) inner.push(lines[i].replace(QUOTE, ""));
        else if (interrupts(lines[i])) break;
        else inner.push(lines[i]); // lazy continuation of the quoted paragraph
        i++;
      }
      out.push({ t: "quote", c: blocks(inner) });
      continue;
    }

    if ((m = ITEM.exec(l))) { const r = list(lines, i); out.push(r.block); i = r.next; continue; }

    // paragraph, or a setext heading when an underline follows its text
    const para: string[] = [l.trim()];
    i++;
    let setext = 0;
    while (i < lines.length && !blank(lines[i])) {
      const u = SETEXT.exec(lines[i]);
      if (u) { setext = u[1][0] === "=" ? 1 : 2; i++; break; }
      if (interrupts(lines[i])) break;
      para.push(lines[i].trim()); i++;
    }
    out.push(setext ? { t: "h", level: setext, c: inline(para.join(" ")) } : { t: "p", c: inline(para.join("\n")) });
  }
  return out;
}

function list(lines: string[], start: number): { block: Block; next: number } {
  const first = ITEM.exec(lines[start])!;
  const base = first[1].length, ordered = /\d/.test(first[2]);
  const items: Block[][] = [];
  let i = start;
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]);
    if (!m || m[1].length > base + 1 || m[1].length < base - 1 || /\d/.test(m[2]) !== ordered) break;
    const content = [m[3] ?? ""];
    const width = m[1].length + m[2].length + 1;
    i++;
    while (i < lines.length) {
      const n = lines[i];
      if (blank(n)) {
        // a blank line continues the item only when an indented line follows
        let j = i + 1;
        while (j < lines.length && blank(lines[j])) j++;
        if (j < lines.length && indentOf(lines[j]) >= width) { for (; i < j; i++) content.push(""); continue; }
        break;
      }
      if (indentOf(n) >= width) { content.push(n.slice(width)); i++; continue; }
      const im = ITEM.exec(n);
      if (im && im[1].length <= base + 1) break; // the next item (or a shallower one)
      if (indentOf(n) <= base && interrupts(n)) break;
      if (blank(content[content.length - 1])) break;
      content.push(n.trim()); i++; // lazy continuation
    }
    items.push(blocks(content));
    // skip blank lines between items, but only when another item follows
    let j = i;
    while (j < lines.length && blank(lines[j])) j++;
    if (j < lines.length && j > i) { const nm = ITEM.exec(lines[j]); if (nm && nm[1].length <= base + 1 && /\d/.test(nm[2]) === ordered) i = j; }
  }
  return { block: { t: "list", ordered, start: ordered ? parseInt(first[2], 10) : 1, items }, next: i };
}

// ---- inline

const ESCAPABLE = "\\`*_{}[]()#+-.!<>|~\"'&";

export function inline(s: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => { if (buf) { out.push({ t: "text", v: buf }); buf = ""; } };
  const alnum = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") {
      if (s[i + 1] === "\n") { flush(); out.push({ t: "br" }); i += 2; continue; }
      if (i + 1 < s.length && ESCAPABLE.includes(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
      buf += c; i++; continue;
    }
    if (c === "\n") {
      // two spaces before a line end is a hard break, else the line end is a space
      if (/ {2,}$/.test(buf)) { buf = buf.replace(/ +$/, ""); flush(); out.push({ t: "br" }); } else buf = buf.replace(/ +$/, "") + " ";
      i++; continue;
    }
    if (c === "`") {
      let n = 1; while (s[i + n] === "`") n++;
      const tick = "`".repeat(n);
      let j = i + n, end = -1;
      while (j < s.length) {
        const k = s.indexOf(tick, j);
        if (k < 0) break;
        if (s[k + n] !== "`" && s[k - 1] !== "`") { end = k; break; }
        j = k + 1;
      }
      if (end >= 0) {
        flush();
        let v = s.slice(i + n, end).replace(/\n/g, " ");
        if (v.length > 2 && v.startsWith(" ") && v.endsWith(" ") && v.trim()) v = v.slice(1, -1);
        out.push({ t: "code", v }); i = end + n; continue;
      }
      buf += tick; i += n; continue;
    }
    if (c === "*" || c === "_") {
      let n = 1; while (s[i + n] === c && n < 3) n++;
      const next = s[i + n], prev = s[i - 1];
      const canOpen = !!next && !/\s/.test(next) && (c === "*" || !alnum(prev));
      if (canOpen) {
        const end = closer(s, i + n, c, n, c === "_");
        if (end >= 0) {
          flush();
          const inner = inline(s.slice(i + n, end));
          out.push(n === 1 ? { t: "em", c: inner } : n === 2 ? { t: "strong", c: inner } : { t: "em", c: [{ t: "strong", c: inner }] });
          i = end + n; continue;
        }
      }
      buf += c.repeat(n); i += n; continue;
    }
    if (c === "[" || (c === "!" && s[i + 1] === "[")) {
      const image = c === "!", open = image ? i + 1 : i;
      const close = matching(s, open, "[", "]");
      if (close > 0 && s[close + 1] === "(") {
        const end = matching(s, close + 1, "(", ")");
        if (end > 0) {
          const href = s.slice(close + 2, end).trim().replace(/^<(.*)>$/, "$1").replace(/\s+["'(].*$/s, "");
          flush();
          out.push({ t: "link", href, c: inline(s.slice(open + 1, close)) });
          i = end + 1; continue;
        }
      }
      buf += c; i++; continue;
    }
    buf += c; i++;
  }
  flush();
  return out;
}

/** Index of the delimiter closing an emphasis that opened at `from`, or -1. */
function closer(s: string, from: number, ch: string, n: number, word: boolean): number {
  const mark = ch.repeat(n);
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") { j++; continue; }
    if (c === "`") { // a code span inside is skipped whole
      let k = 1; while (s[j + k] === "`") k++;
      const e = s.indexOf("`".repeat(k), j + k);
      if (e >= 0) j = e + k - 1; else j += k - 1;
      continue;
    }
    if (c !== ch) continue;
    let run = 1; while (s[j + run] === ch) run++;
    const before = s[j - 1];
    if (run >= n && before && !/\s/.test(before) && j > from && s.startsWith(mark, j) && !(word && /[\p{L}\p{N}]/u.test(s[j + n] ?? ""))) {
      // for a single mark inside a longer run, the closer is the first mark of a run of exactly n; skip longer runs
      if (run === n || (n === 1 && run === 3) || (n === 2 && run === 3)) return n === 1 && run === 3 ? j + 2 : n === 2 && run === 3 ? j + 1 : j;
    }
    j += run - 1;
  }
  return -1;
}

function matching(s: string, open: number, a: string, b: string): number {
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    if (s[j] === "\\") { j++; continue; }
    if (s[j] === a) depth++;
    else if (s[j] === b && --depth === 0) return j;
  }
  return -1;
}
