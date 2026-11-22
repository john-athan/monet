<script lang="ts">
  // An in-app link: a plain <a> that navigates without a reload and leaves Cmd/Ctrl/Shift-click to the browser.
  import type { Snippet } from "svelte";
  import type { HTMLAnchorAttributes } from "svelte/elements";
  import { go, within } from "../lib/state.svelte";
  // a path is read inside the library on screen (/bei/<id>/...); `raw` means it is complete as it is
  let { href, raw = false, children, ...rest }: HTMLAnchorAttributes & { href: string; raw?: boolean; children?: Snippet } = $props();
  const to = $derived(raw ? href : within(href));
  function click(e: MouseEvent) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault(); go(to, false, undefined, true);
  }
</script>
<a href={to} {...rest} onclick={click}>{@render children?.()}</a>
