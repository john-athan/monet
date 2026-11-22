<script lang="ts">
  // The people already named, as small chips with their face: a face that belongs to one of them goes there in one tap.
  type Named = { id: number; name: string; face: number | null };
  let { named, busy = false, onpick }: { named: Named[]; busy?: boolean; onpick: (n: Named) => void } = $props();
</script>

<div class="known">{#each named as n (n.id)}<button type="button" disabled={busy} onclick={() => onpick(n)}>{#if n.face}<img src="/media/face/{n.face}" alt="" width="28" height="28" />{/if}{n.name}</button>{/each}</div>

<style>
  .known { display: flex; flex-wrap: wrap; gap: 6px; }
  button { height: 40px; padding: 0 12px 0 6px; display: inline-flex; align-items: center; gap: 7px; border: 0; border-radius: 20px; background: var(--surface-2); font-weight: 600; font-size: 14px; }
  button:hover:not(:disabled) { background: var(--surface-3); } button:disabled { opacity: .5; }
  img { border-radius: 50%; object-fit: cover; }
</style>
