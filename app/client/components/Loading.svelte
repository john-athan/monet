<script lang="ts">
  let { text = "Einen Moment" }: { text?: string } = $props();
</script>
<p class="loading" role="status"><span class="d" aria-hidden="true"></span>{text}</p>
<style>
  .loading { display: flex; align-items: center; gap: 10px; padding: 28px 18px; color: var(--muted); font-size: 14px; }
  .d { width: 22px; height: 8px; border-radius: 999px; background: var(--teich); opacity: .6; transform: rotate(-4deg); }
</style>
