<script lang="ts" module>
  /** The server's three copies: s is a 256 px square crop, m 720 px on the long side, l 2048 px. */
  export const M = 720, L = 2048, S = 256;
  /** The width of a copy of a w x h picture whose long side is `long`. */
  const wid = (w: number, h: number, long: number) => Math.max(1, Math.round(long * Math.min(1, w / h)));
  export function srcsetFor(id: number, w: number, h: number, square: boolean): string {
    // a square slot is filled by the short side, so the copies are measured by it
    const m = square ? Math.round(M * Math.min(w, h) / Math.max(w, h)) : wid(w, h, M), l = square ? Math.round(L * Math.min(w, h) / Math.max(w, h)) : wid(w, h, L);
    return `/media/${id}/s ${S}w, /media/${id}/m ${Math.max(m, S + 1)}w, /media/${id}/l ${Math.max(l, m + 1)}w`;
  }
</script>
<script lang="ts">
  import { settle } from "../lib/motion";
  // A photo from the server: width and height in the markup (no layout shift), lazy, the colour of the picture behind it.
  let { id, w, h, color = "var(--surface-2)", alt = "", sizes = "100vw", square = false, eager = false, fit = "cover", cls = "" }: {
    id: number; w: number; h: number; color?: string; alt?: string; sizes?: string; square?: boolean; eager?: boolean; fit?: "cover" | "contain"; cls?: string;
  } = $props();
  const wd = $derived(w > 0 ? w : 4), ht = $derived(h > 0 ? h : 3);
</script>
<img {@attach settle} class={cls} src="/media/{id}/m" srcset={srcsetFor(id, wd, ht, square)} {sizes} width={wd} height={ht} {alt} loading={eager ? "eager" : "lazy"} decoding="async" draggable="false" style="background:{color};object-fit:{fit}" />
<style>
  img { display: block; width: 100%; height: 100%; }
</style>
