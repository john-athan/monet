// Which tile an arrow key goes to, from the tiles' rectangles (pure, so it can be tested).
export function neighbour(list: DOMRect[], at: number, key: string): number {
  const c = list[at]; if (!c) return -1;
  if (key === "ArrowLeft") return at - 1;
  if (key === "ArrowRight") return at + 1;
  const down = key === "ArrowDown", cx = c.left + c.width / 2;
  let best = -1, bestD = Infinity;
  list.forEach((r, i) => {
    if (i === at) return;
    const dy = down ? r.top - c.top : c.top - r.top;
    if (dy < c.height * 0.5) return; // not in a row below / above
    const d = dy * 4 + Math.abs(r.left + r.width / 2 - cx); // the nearest row first, then the nearest column
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

