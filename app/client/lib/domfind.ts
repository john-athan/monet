// Find in the text of a DOM subtree (the text view, docs/together.md): case, accents and ß do not matter, like the
// server's find. Returns the hits as Ranges; marks them with the CSS Custom Highlight API where the browser has it.
const fold1 = (c: string) => (c === "ß" ? "ss" : c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
const fold = (s: string) => [...s].map(fold1).join("").replace(/\s+/g, " ").trim();

export function findInDom(root: Element, q: string, max = 500): Range[] {
  const needle = fold(q);
  if (!needle) return [];
  // the text, folded, with the node and offset every folded character came from
  const at: [Text, number][] = [];
  let s = "", space = false;
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
    const t = n.data;
    for (let i = 0; i < t.length; i++) {
      const f = fold1(t[i]);
      if (/\s/.test(f)) { if (!space) { s += " "; at.push([n, i]); space = true; } continue; }
      space = false;
      for (const ch of f) { s += ch; at.push([n, i]); }
    }
  }
  const out: Range[] = [];
  for (let i = s.indexOf(needle); i >= 0 && out.length < max; i = s.indexOf(needle, i + 1)) {
    const a = at[i], b = at[i + needle.length - 1];
    const r = document.createRange();
    r.setStart(a[0], a[1]); r.setEnd(b[0], b[1] + 1);
    out.push(r);
  }
  return out;
}
const can = () => typeof CSS !== "undefined" && "highlights" in CSS && typeof (globalThis as any).Highlight === "function";
/** Marks all hits and the current one (styles: ::highlight(monet-find) and ::highlight(monet-find-on) in app.css). */
export function markRanges(all: Range[], current: Range | null) {
  if (!can()) return;
  const H = (globalThis as any).Highlight, hl = (CSS as any).highlights;
  hl.set("monet-find", new H(...all));
  if (current) hl.set("monet-find-on", new H(current)); else hl.delete("monet-find-on");
}
export const clearMarks = () => { if (can()) { (CSS as any).highlights.delete("monet-find"); (CSS as any).highlights.delete("monet-find-on"); } };
