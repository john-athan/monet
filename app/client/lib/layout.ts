// Pure layout maths for the timeline, so the page can render only the days near the viewport and still know
// the exact height of everything above and below. Tested in tests/client-layout.test.ts.
import type { ItemSummary, TimelineDay } from "../../shared/types";

export const PHONE = { head: 44, gap: 2, cols: 3 };
export const WIDE = { head: 50, gap: 4, target: 200, after: 6 };

export interface Row { h: number; tiles: { i: number; w: number }[] }
const ar = (it: { w: number; h: number }) => Math.min(2.5, Math.max(0.45, it.w > 0 && it.h > 0 ? it.w / it.h : 1.5));

/** Justified rows: every row is as high as it needs to be to fill the width exactly; the last one only when it is
 *  at least 60% full (else it keeps the target height and a gap at the end, as a filler would). */
export function justify(items: { w: number; h: number }[], width: number, target = WIDE.target, gap = WIDE.gap): Row[] {
  const rows: Row[] = [];
  let cur: number[] = [], sum = 0;
  const close = (last: boolean) => {
    const g = gap * (cur.length - 1), fit = (width - g) / sum;
    const stretch = !last || sum * target + g >= width * 0.6;
    const h = stretch ? Math.min(fit, target * 1.8) : target;
    // a row that cannot fill the width at its max height stays left aligned
    rows.push({ h, tiles: cur.map(i => ({ i, w: ar(items[i]) * h })) });
    cur = []; sum = 0;
  };
  items.forEach((it, i) => {
    cur.push(i); sum += ar(it);
    if (sum * target + gap * (cur.length - 1) >= width) close(false);
  });
  if (cur.length) close(true);
  return rows;
}

export interface DayLayout { top: number; height: number; rows?: Row[]; cell?: number }
export interface Layout { days: DayLayout[]; total: number }

export function layoutDays(days: { items: { w: number; h: number }[] }[], width: number, wide: boolean): Layout {
  let top = 0;
  const out: DayLayout[] = days.map(d => {
    let height: number, rows: Row[] | undefined, cell: number | undefined;
    if (wide) {
      rows = justify(d.items, Math.max(120, width));
      height = WIDE.head + rows.reduce((s, r) => s + r.h, 0) + Math.max(0, rows.length - 1) * WIDE.gap + WIDE.after;
    } else {
      cell = (width - PHONE.gap * (PHONE.cols - 1)) / PHONE.cols;
      const n = Math.ceil(d.items.length / PHONE.cols);
      height = PHONE.head + n * cell + Math.max(0, n - 1) * PHONE.gap;
    }
    const l = { top, height, rows, cell };
    top += height;
    return l;
  });
  return { days: out, total: top };
}

/** Index of the day that holds y (the last one when y is below everything). */
export function dayAt(l: Layout, y: number): number {
  let lo = 0, hi = l.days.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (l.days[mid].top <= y) lo = mid; else hi = mid - 1; }
  return lo;
}
/** The days to render: those that touch [y0 - margin, y1 + margin]. */
export function visibleRange(l: Layout, y0: number, y1: number, margin: number): [number, number] {
  if (!l.days.length) return [0, 0];
  const a = dayAt(l, y0 - margin), b = dayAt(l, y1 + margin);
  return [a, b + 1];
}

export type DayItems = Pick<TimelineDay, "items">;
export const ids = (days: { items: ItemSummary[] }[]) => days.flatMap(d => d.items.map(i => i.id));
