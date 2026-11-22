<script lang="ts">
  // The Importieren button: files first, a whole folder as the second way.
  import { addFiles, up } from "../lib/upload.svelte";
  import Sheet from "./Sheet.svelte";
  import Icon from "./Icon.svelte";
  let { open = $bindable(false) }: { open: boolean } = $props();
  let files: HTMLInputElement | undefined = $state(), dir: HTMLInputElement | undefined = $state();
  let waiting = false;
  const take = (e: Event) => { waiting = false; const i = e.currentTarget as HTMLInputElement; addFiles([...(i.files ?? [])]); i.value = ""; open = false; };
  // the browser lists a big folder (and asks whether to upload thousands of files) before `change` fires: from the
  // moment the picker gives the window back, the upload card says it is reading; `cancel` takes that back
  const pick = (i?: HTMLInputElement) => { i?.click(); open = false; waiting = true; addEventListener("focus", () => { if (waiting) up.reading = true; }, { once: true }); };
  const drop = () => { waiting = false; up.reading = false; };
</script>
<input bind:this={files} type="file" multiple accept="image/*,video/*,.heic,.heif,.dng" hidden onchange={take} oncancel={drop} />
<input bind:this={dir} type="file" multiple hidden onchange={take} oncancel={drop} {...{ webkitdirectory: "" } as any} />
<Sheet bind:open label="Importieren">
  <h2>Importieren</h2>
  <p class="m">Fotos und Videos von diesem Gerät. Was schon da ist, wird übersprungen.</p>
  <button type="button" class="pri" onclick={() => pick(files)}><Icon name="laden" size={18} sw={1.9} />Fotos und Videos wählen</button>
  <button type="button" class="sec" onclick={() => pick(dir)}><Icon name="album" size={18} sw={1.9} />Ganzen Ordner wählen</button>
  <p class="m small">Auf dem Computer kannst du Dateien und Ordner auch einfach irgendwo ins Fenster ziehen.</p>
</Sheet>
<style>
  h2 { font-size: 28px; line-height: 1.05; }
  .m { color: var(--muted); font-size: 14px; } .small { font-size: 13px; }
  button { min-height: 48px; padding: 0 18px; border: 0; border-radius: 24px; display: inline-flex; align-items: center; justify-content: center; gap: 9px; font-weight: 650; }
  .pri { background: var(--ink); color: var(--on-ink); } .pri:hover { background: var(--water); }
  .sec { background: transparent; box-shadow: inset 0 0 0 1.5px var(--rule); } .sec:hover { background: var(--surface-2); }
</style>
