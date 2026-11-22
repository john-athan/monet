<script lang="ts">
  // The text of one page laid over its picture (docs/together.md, "Text on the page"): every line as invisible SVG text
  // stretched to its box, so it can be selected and copied and the browser's own find sees it. Hits of the viewer's
  // search are painted as marks, the current one stronger. Lies over the page with the same proportions.
  type B = [number, number, number, number];
  let { doc, n, ratio, marks = [], focus = null }: { doc: number; n: number; ratio: number; marks?: B[][]; focus?: B[] | null } = $props();
  let lines = $state<[number, number, number, number, string][]>([]);
  const W = 1000, H = $derived(W / ratio);
  $effect(() => {
    const my = `${doc}/${n}`; lines = [];
    fetch(`/api/docs/${doc}/words/${n}`, { credentials: "same-origin" }).then(r => (r.ok ? r.json() : [])).then(l => { if (my === `${doc}/${n}`) lines = l; }).catch(() => {});
  });
</script>
<svg class="pt" viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-hidden={lines.length ? undefined : "true"}>
  {#each marks as m}{#each m as b}<rect class="mk" x={b[0] * W - 1} y={b[1] * H - 1} width={b[2] * W + 2} height={b[3] * H + 2} rx="2" />{/each}{/each}
  {#if focus}{#each focus as b}<rect class="mk on" x={b[0] * W - 2} y={b[1] * H - 2} width={b[2] * W + 4} height={b[3] * H + 4} rx="3" />{/each}{/if}
  {#each lines as l}
    <text x={l[0] * W} y={(l[1] + l[3] * 0.8) * H} font-size={l[3] * H} textLength={Math.max(1, l[2] * W)} lengthAdjust="spacingAndGlyphs">{l[4]}</text>
  {/each}
</svg>
<style>
  .pt { position: absolute; inset: 0; width: 100%; height: 100%; user-select: text; -webkit-user-select: text; cursor: text; }
  text { fill: transparent; font-family: Helvetica, Arial, sans-serif; white-space: pre; }
  text::selection { fill: transparent; background: rgb(46 108 196 / .35); }
  .mk { fill: rgb(255 214 0 / .38); mix-blend-mode: multiply; pointer-events: none; }
  .mk.on { fill: rgb(255 140 0 / .5); stroke: rgb(224 104 0); stroke-width: 2; }
</style>
