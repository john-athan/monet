<script lang="ts">
  import { app, go, light, local, viewing, theme, house, loadHousehold, rememberTheme, setupLink } from "./lib/state.svelte";
  import { loadLists, loadStatus, resetLibrary } from "./lib/stores.svelte";
  import { themeOf } from "./lib/theme";
  import { startDarkroom } from "./lib/ml-api";
  import { transition, sunOrigin } from "./lib/motion";
  import Shell from "./components/Shell.svelte";
  import Toast from "./components/Toast.svelte";
  import Welcome from "./pages/Welcome.svelte";
  import Fotos from "./pages/Fotos.svelte";
  import Suche from "./pages/Suche.svelte";
  import Foto from "./pages/Foto.svelte";
  import Personen from "./pages/Personen.svelte";
  import Person from "./pages/Person.svelte";
  import Orte from "./pages/Orte.svelte";
  import Dinge from "./pages/Dinge.svelte";
  import Ort from "./pages/Ort.svelte";
  import Alben from "./pages/Alben.svelte";
  import Album from "./pages/Album.svelte";
  import Serie from "./pages/Serie.svelte";
  import Geraete from "./pages/Geraete.svelte";
  import Haushalt from "./pages/Haushalt.svelte";

  const route = $derived.by(() => {
    const p = local();
    let m: RegExpExecArray | null;
    if (p === "/setup") return { name: "setup" };
    if (p === "/login") return { name: "login" };
    if (p === "/suche") return { name: "suche" };
    if ((m = /^\/foto\/(\d+)$/.exec(p))) return { name: "foto", id: Number(m[1]) };
    if (p === "/personen") return { name: "personen" };
    if ((m = /^\/personen\/(\d+)$/.exec(p))) return { name: "person", id: Number(m[1]) };
    if (p === "/dinge") return { name: "dinge" };
    if (p === "/orte") return { name: "orte" };
    if ((m = /^\/orte\/(\d+)$/.exec(p))) return { name: "ort", id: Number(m[1]) };
    if (p === "/alben") return { name: "alben" };
    if ((m = /^\/alben\/(\d+)$/.exec(p))) return { name: "album", id: Number(m[1]) };
    if ((m = /^\/serie\/([^/]+)$/.exec(p))) return { name: "serie", key: decodeURIComponent(m[1]) };
    if (p === "/geraete") return { name: "geraete" };
    if (p === "/haushalt") return { name: "haushalt" };
    return { name: "fotos" };
  });
  const TITLES: Record<string, string> = { setup: "Einrichten", login: "Anmelden", fotos: "Fotos", suche: "Suche", foto: "Foto", personen: "Personen", person: "Person", dinge: "Dinge", orte: "Orte", ort: "Ort", alben: "Alben", album: "Album", serie: "Serie", geraete: "Geräte und Sicherung", haushalt: "Haushalt" };
  $effect(() => { document.title = `${TITLES[route.name]} · ${themeOf(theme()).brand}`; });
  // a change of light washes over the page from where the sun stands, like the next canvas of a series
  let lit = "";
  $effect(() => {
    const l = light(), root = document.documentElement;
    if (l === lit) return;
    const first = !lit; lit = l;
    if (first) root.dataset.light = l; else transition("light", () => { root.dataset.light = l; }, { origin: sunOrigin(l) });
  });

  // the style of the library on screen. Moving into another library, the page change already washes it in (lib/state);
  // a style changed in place (on the Haushalt page) washes over the page like a change of light
  let styled = "", styledAt = "";
  $effect(() => {
    const t = theme(), root = document.documentElement, path = app.path;
    if (t === styled) { styledAt = path; return; }
    const inPlace = !!styled && path === styledAt;
    styled = t; styledAt = path;
    if (inPlace) transition("light", () => { root.dataset.theme = t; }); else root.dataset.theme = t;
  });
  // your own style is remembered on this device, so the next start does not flash the default
  $effect(() => { const me = house.members.find(m => m.id === house.me); if (me) rememberTheme(me.theme); });
  // another library: what the pages keep between visits (timeline, band, lists, people) belongs to the one before.
  // $effect.pre: the reset has to happen before {#key viewing()} below mounts the new page, or that page finds the
  // old library's data marked as loaded, loads nothing, and then the reset empties it.
  let lib: number | null | undefined;
  $effect.pre(() => {
    const v = viewing();
    if (lib === undefined) { lib = v; return; }
    if (v === lib) return;
    lib = v; resetLibrary();
    if (app.loggedIn) loadLists();
  });

  // signed out: only /setup and /login exist; signed in: they lead home
  $effect(() => {
    if (!app.ready || app.indexer) return;
    if (!app.loggedIn && route.name !== "setup" && route.name !== "login") go("/login", true);
    if (app.loggedIn && (route.name === "login" || (route.name === "setup" && !setupLink))) go("/", true);
  });
  // after login: lists for the sidebar, the status, and the darkroom on screens wide enough to be a desk
  $effect(() => {
    if (!app.loggedIn) return;
    loadHousehold(); loadLists(); loadStatus();
    const t = setInterval(() => { if (!document.hidden) loadStatus(); }, 30_000);
    return () => clearInterval(t);
  });
  let dark = false;
  $effect(() => { if (app.loggedIn && app.wide && !dark) { dark = true; startDarkroom(); } });
  $effect(() => { if (app.indexer && !dark) { dark = true; startDarkroom({ alwaysOn: true }); } });
  const bare = $derived(route.name === "foto" || route.name === "geraete" || route.name === "haushalt");
</script>

{#if !app.ready}
  <p class="boot" role="status">Monet</p>
{:else if app.indexer}
  <p class="boot" role="status">Monet analysiert im Hintergrund.</p>
{:else if !app.loggedIn || (route.name === "setup" && setupLink)}
  <Welcome mode={route.name === "setup" ? "setup" : "login"} />
{:else}
  <Shell chrome={!bare}>
    <!-- another library: every page starts fresh with that library's data -->
    {#key viewing()}
    {#if route.name === "fotos"}<Fotos />
    {:else if route.name === "suche"}<Suche />
    {:else if route.name === "foto"}{#key route.id}<Foto id={route.id!} />{/key}
    {:else if route.name === "personen"}<Personen />
    {:else if route.name === "person"}<Person id={route.id!} />
    {:else if route.name === "dinge"}<Dinge />
    {:else if route.name === "orte"}<Orte />
    {:else if route.name === "ort"}<Ort id={route.id!} />
    {:else if route.name === "alben"}<Alben />
    {:else if route.name === "album"}<Album id={route.id!} />
    {:else if route.name === "serie"}<Serie key={route.key!} />
    {:else if route.name === "geraete"}<Geraete />
    {:else if route.name === "haushalt"}<Haushalt />{/if}
    {/key}
  </Shell>
{/if}
<Toast />
<style>
  .boot { min-height: 100dvh; display: grid; place-items: center; font-family: var(--font-display); font-size: 40px; color: var(--muted); }
</style>
