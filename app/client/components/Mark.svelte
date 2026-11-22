<script lang="ts">
  // The sign of the style on screen: Monet's bridge over the lily pond, Ernst's ring sun over his forest wall,
  // Magritte's man in the bowler hat with the apple in front of his face. Which file is in shared/styles.ts.
  import type { Theme } from "../../shared/types";
  import { STYLES } from "../../shared/styles";
  import { theme as current } from "../lib/state.svelte";
  import { themeOf } from "../lib/theme";
  let { size = 32, theme }: { size?: number; theme?: Theme } = $props();
  const mark = $derived(STYLES[themeOf(theme ?? current()).key].mark);
</script>
<img src="/{mark.file}" width={size} height={size} alt={mark.alt} draggable="false">

<style>
  img { display: block; flex: none; }
</style>
