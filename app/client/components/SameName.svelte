<script lang="ts" module>
  type P = { id: number; name: string };
  /** The named people other than `self` who carry `name`, ignoring case and spaces around it. */
  export const namesakes = <T extends P>(named: T[], name: string, self: number): T[] => {
    const k = name.trim().toLocaleLowerCase("de");
    return k ? named.filter(n => n.id !== self && n.name.trim().toLocaleLowerCase("de") === k) : [];
  };
</script>
<script lang="ts">
  // Asked when a person gets a name another person already has: most often the same person, found twice by the face
  // grouping. Each match can take the photos (a merge); "jemand anderes" names a second person of that name.
  import { count } from "../lib/format";
  type Named = { id: number; name: string; count: number; face: number | null };
  let { name, matches, busy = false, onmerge, onnew }: { name: string; matches: Named[]; busy?: boolean; onmerge: (into: Named) => void; onnew: () => void } = $props();
  // the name as the existing person spells it, not as just typed ("nora" finds Nora)
  const shown = $derived(matches[0]?.name ?? name);
</script>

<section class="same" aria-label="Derselbe {shown}?">
  <p><b>Derselbe {shown}?</b> <span class="m">{matches.length === 1 ? `Es gibt schon ${shown}.` : `Es gibt schon ${matches.length} Personen mit diesem Namen.`}</span></p>
  <div class="row">
    {#each matches as n (n.id)}
      <button type="button" class="pick" disabled={busy} onclick={() => onmerge(n)}>
        {#if n.face}<img src="/media/face/{n.face}" alt="" width="40" height="40" />{:else}<span class="ph"></span>{/if}
        <span>{matches.length === 1 ? "Ja, zusammenführen" : count(n.count, "Foto", "Fotos")}</span>
      </button>
    {/each}
    <button type="button" class="no" disabled={busy} onclick={onnew}>Nein, jemand anderes</button>
  </div>
</section>

<style>
  .same { display: flex; flex-direction: column; gap: 10px; padding: 12px; border-radius: 16px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--rule); }
  p { font-size: 14px; line-height: 1.3; } b { font-weight: 650; } .m { color: var(--muted); }
  .row { display: flex; flex-wrap: wrap; gap: 8px; }
  button { min-height: 44px; border: 0; border-radius: 22px; font-size: 14px; font-weight: 650; display: flex; align-items: center; gap: 8px; }
  .pick { padding: 0 16px 0 4px; background: var(--surface-2); } .pick:hover:not(:disabled) { background: var(--surface-3); }
  .pick img, .ph { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; background: var(--surface-3); }
  .no { padding: 0 12px; background: transparent; color: var(--muted); }
  button:disabled { opacity: .5; }
</style>
