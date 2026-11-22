<script lang="ts">
  // The frame around a page: on the desktop the header, band, sidebar and the floating bar; on the phone the tab bar.
  import type { Snippet } from "svelte";
  import { app, viewing, member, genitive } from "../lib/state.svelte";
  import { band } from "../lib/stores.svelte";
  import { themeOf } from "../lib/theme";
  import Link from "./Link.svelte";
  import { sectionOf } from "../lib/nav";
  import Header from "./Header.svelte";
  import Sidebar from "./Sidebar.svelte";
  import PhoneNav from "./PhoneNav.svelte";
  import Band from "./Band.svelte";
  import SelectBar from "./SelectBar.svelte";
  import ImportSheet from "./ImportSheet.svelte";
  import DropZone from "./DropZone.svelte";
  import UploadCard from "./UploadCard.svelte";
  let { children, chrome = true }: { children: Snippet; chrome?: boolean } = $props();
  let importing = $state(false);
  const guest = $derived(viewing() != null ? member(viewing()) : undefined);
</script>
{#snippet visit()}
  {#if guest}
    <p class="visit" role="status"><span>Du siehst <b>{genitive(guest.name)} Fotos</b> im Stil von {themeOf(guest.theme).painter}. Was du hier importierst, landet in {genitive(guest.name)} Fotos. Ändern kann sie nur {guest.name}.</span><Link href="/" raw class="home">Zu meinen Fotos</Link></p>
  {/if}
{/snippet}
{#if chrome && app.wide}
  <Header onimport={() => (importing = true)} />
  {#if band.jump}<Band vertical={false} />{/if}
  <div class="body">
    <div class="side" data-vt="side"><Sidebar /></div>
    <main>{@render visit()}{@render children()}</main>
  </div>
{:else if chrome}
  <main class="phone">{@render visit()}{@render children()}</main>
  <PhoneNav />
{:else}
  {@render children()}
{/if}
{#if app.wide}<DropZone />{/if}
<SelectBar />
<ImportSheet bind:open={importing} />
<UploadCard />
<style>
  .body { display: flex; align-items: flex-start; gap: 8px; padding: 6px 14px calc(120px + var(--player-h, 0px)); }
  .side { flex: 1 1 220px; max-width: 232px; min-width: 200px; }
  main { flex: 999 1 560px; min-width: 0; }
  main.phone { padding-bottom: calc(82px + env(safe-area-inset-bottom) + var(--player-h, 0px)); }
  .visit { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 14px; margin: 0 0 10px; padding: 8px 8px 8px 14px; border-radius: 14px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--rule); font-size: 13.5px; color: var(--muted); }
  .visit b { color: var(--ink); font-weight: 650; }
  .phone .visit { margin: 10px 14px 0; }
  .visit :global(.home) { min-height: 36px; display: inline-flex; align-items: center; padding: 0 14px; border-radius: 18px; background: var(--surface-2); color: var(--ink); font-weight: 650; }
  .visit :global(.home:hover) { background: var(--surface-3); }
</style>
