// The keyboard in one place. Pages mark what can be focused with `data-item`.
//   Arrows   move between photos in a grid (left/right: neighbours, up/down: the tile above or below)
//   Enter    opens the focused photo (it is a link); Space toggles it while photos are picked
//   Escape   leaves a text field, ends a selection, goes back from a photo or a sub page
import { app, go, local, sel, selectEnd } from "./state.svelte";
import { neighbour } from "./neighbour";

const typing = (t: Element | null) => !!t?.closest("input, textarea, select, [contenteditable]");
const modal = () => !!document.querySelector("[aria-modal='true']");
const visible = (el: HTMLElement) => el.offsetParent !== null || getComputedStyle(el).position === "fixed";
const items = () => [...document.querySelectorAll<HTMLElement>("main [data-item], [data-grid] [data-item]")].filter(visible);
const smooth = () => !matchMedia("(prefers-reduced-motion: reduce)").matches;

export function installKeys() {
  addEventListener("keydown", e => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    const t = document.activeElement ?? document.body;
    if (e.key === "Escape") {
      if (modal()) return;
      if (typing(t)) { (t as HTMLElement).blur(); return; }
      if (sel.on) { selectEnd(); e.preventDefault(); return; }
      if (/^\/(foto|serie|geraete|personen\/|orte\/|alben\/)/.test(local())) { e.preventDefault(); history.length > 1 ? history.back() : go("/"); }
      return;
    }
    if (typing(t) || modal() || e.shiftKey) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    if (t.closest("[role='slider'], [role='group'], nav, input, textarea")) return;
    const list = items(); if (!list.length) return;
    const at = list.findIndex(el => el === t || el.contains(t));
    const next = at < 0 ? 0 : neighbour(list.map(l => l.getBoundingClientRect()), at, e.key);
    if (next < 0 || next >= list.length) return;
    e.preventDefault();
    list[next].focus({ preventScroll: true });
    list[next].scrollIntoView({ block: "nearest", behavior: smooth() ? "smooth" : "auto" });
  });
}
