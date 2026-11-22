<script lang="ts">
  // /setup and /login: one button each. A link (/setup#token) first says whose passkey it makes and what happens to
  // the old ones; errors in plain German.
  import type { AccountLinkPreview } from "../../shared/accounts";
  import { app, go, member } from "../lib/state.svelte";
  import { deviceLabel, login, passkeyMessage, passkeysSupported, previewLink, register, takeLinkToken } from "../lib/passkeys";
  import Mark from "../components/Mark.svelte";
  let { mode }: { mode: "setup" | "login" } = $props();
  let busy = $state(false), error = $state(""), link = $state<AccountLinkPreview | null>(null), gone = $state("");
  // the token lives in the fragment, which no server and no log ever sees; take it and clear the address bar
  const token = mode === "setup" ? takeLinkToken() : "";
  if (token) previewLink(token).then(l => (link = l), e => (gone = e.message));
  async function enter() { await login(); app.loggedIn = true; app.setupOpen = false; go("/", true); }
  // a link opened where someone is signed in: the new passkey signs this browser in as the person it was made for
  const switching = app.loggedIn;
  const signedIn = $derived(member(null)?.name ?? "jemand anderes");
  const forOther = $derived(switching && !!link?.name && link.name !== member(null)?.name);
  const lead = $derived(!link ? "" : link.purpose === "setup" ? "Lege den ersten Passkey an. Damit verwaltest du dieses Monet und lädst die anderen ein."
    : link.purpose === "join" ? `Willkommen, ${link.name}. Lege deinen Passkey an. Er bleibt auf diesem Gerät und wandert mit deinem Passwortmanager.`
    : link.purpose === "recover" ? `Ein neuer Passkey für ${link.name}. Er ersetzt alle bisherigen und meldet jeden Browser ab, in dem ${link.name} angemeldet war.`
    : `Ein weiterer Passkey für ${link.name}, für dieses Gerät. Die bisherigen bleiben.`);
  async function run() {
    busy = true; error = "";
    try {
      if (mode === "setup") { await register(deviceLabel(), token); location.replace("/"); }
      else await enter();
    } catch (e: any) { error = passkeyMessage(e, "de"); busy = false; }
  }
  $effect(() => { document.title = mode === "setup" ? "Einrichten · Monet" : "Anmelden · Monet"; });
</script>
<div class="stage">
  <Mark size={96} />
  <h1>Monet</h1>
  <p class="lead">Ein Fotoalbum, wie ein Maler es bauen würde.</p>
  {#if !passkeysSupported()}
    <p class="m">Dieser Browser kann keine Passkeys. Öffne Monet in einem aktuellen Safari, Chrome oder Firefox.</p>
  {:else if mode === "setup" && !token}
    <p class="m">Zum Einrichten brauchst du einen Link: den, den der Server beim ersten Start ausgibt, oder einen aus dem Haushalt. Öffne ihn noch einmal vollständig, mit allem hinter dem #.</p>
  {:else if mode === "setup" && gone}
    <p class="m">{gone}</p>
    {#if !app.loggedIn}<button type="button" class="quiet" onclick={() => go("/login", true)}>Mit Passkey anmelden</button>{/if}
  {:else if mode === "setup" && link}
    <p class="m">{lead}</p>
    {#if forOther}<p class="m">In diesem Browser ist gerade {signedIn} angemeldet. Mit dem neuen Passkey gehört er danach {link.name}.</p>{/if}
    <button type="button" disabled={busy} onclick={run}>Passkey anlegen</button>
  {:else if mode === "setup"}
    <p class="m" role="status">Einen Moment.</p>
  {:else}
    <button type="button" disabled={busy} onclick={run}>Mit Passkey anmelden</button>
  {/if}
  <p class="err" role="alert">{error}</p>
</div>
<style>
  .stage { min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 32px 24px; text-align: center; }
  h1 { font-size: 72px; line-height: .9; }
  .lead { font-size: 17px; max-width: 24em; } .m { color: var(--muted); max-width: 26em; }
  button { min-height: 52px; padding: 0 28px; border: 0; border-radius: 26px; background: var(--ink); color: var(--on-ink); font-weight: 650; font-size: 16px; }
  button:hover:not(:disabled) { background: var(--water); } button:disabled { opacity: .5; }
  button.quiet { background: transparent; color: var(--ink); box-shadow: inset 0 0 0 1.5px var(--rule); }
  button.quiet:hover { background: var(--surface-2); }
  .err { min-height: 1.5em; color: var(--sun-ink); font-weight: 600; max-width: 28em; }
</style>
