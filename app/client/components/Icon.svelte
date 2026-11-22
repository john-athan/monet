<script lang="ts" module>
  // Icons from the design canvas, same drawing, same stroke caps. Each style draws its own set over this one:
  // Ernst cuts them like a woodblock (straight cuts, square ends, his ring sun in the lens), Magritte draws them
  // thin and exact, with a bowler hat, an apple and a cloud where they fit. A name a style does not draw falls back here.
  const P: Record<string, string> = {
    fotos: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
    personen: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M15.5 4.8a3.4 3.4 0 0 1 0 6.4M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/>',
    dinge: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.2 6.2a1.4 1.4 0 0 1-2 0z"/><circle cx="8" cy="8" r="1.6"/>',
    orte: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
    alben: '<rect x="3.5" y="7" width="17" height="13" rx="2"/><path d="M6.5 4h11"/><path d="M3.5 16l4.5-4 4 3.5 3-2.5 5.5 4.5"/>',
    suche: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20.5 20.5"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    chevron: '<path d="M9 5l7 7-7 7"/>',
    original: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect x="8.5" y="8.5" width="7" height="7" rx="1"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.6 4.5 4.5 0 0 0 7 18.5z"/><path d="M12 15v-5M9.5 12.5 12 10l2.5 2.5"/>',
    teilen: '<path d="M12 15V3.5M7.5 8L12 3.5 16.5 8"/><path d="M5 12v7.5h14V12"/>',
    herz: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
    mehr: '<circle cx="5.5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    papierkorb: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
    laden: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19.5h14"/>',
    album: '<rect x="3.5" y="7" width="17" height="13" rx="2"/><path d="M12 10.5v6M9 13.5h6"/>',
    play: '<path d="M7 4.5l13 7.5-13 7.5z" fill="currentColor" stroke="none"/>',
    folge: '<rect x="7" y="7" width="13" height="13" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>',
    kalender: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    bild: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M4 18l5-4.5 3.5 3 3-2.5 4.5 4"/>',
    telefon: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    laptop: '<rect x="4.5" y="5" width="15" height="10.5" rx="1.5"/><path d="M2.5 19h19"/>',
    tablet: '<rect x="4.5" y="3" width="15" height="18" rx="2"/><path d="M11 18h2"/>',
    pfeil: '<path d="M3 9h26M23 4l6 5-6 5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    hoch: '<path d="M12 19.5V5M6 11l6-6 6 6"/>',
    ort: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
    // a palette with three dabs in the colours of the rooms
    stil: '<path d="M12 3.5c-5 0-8.5 3.6-8.5 8.2 0 4.5 3.6 8.3 8 8.3 1.3 0 2-.8 2-1.8 0-1.3-1.1-1.7-1.1-2.9 0-1 .8-1.6 1.9-1.6h2.3c2.3 0 3.9-1.7 3.9-4.1 0-3.4-3.6-6.1-8.5-6.1z"/><circle cx="7.8" cy="11.4" r="1.35" fill="var(--teich)" stroke="none"/><circle cx="10.2" cy="7.4" r="1.35" fill="var(--esszimmer)" stroke="none"/><circle cx="14.8" cy="7.6" r="1.35" fill="var(--atelier)" stroke="none"/>',
  };
  const GEAR = "M10.17 5.66L10.64 3.1L13.36 3.1L13.83 5.66L15.19 6.22L17.33 4.75L19.25 6.67L17.78 8.81L18.34 10.17L20.9 10.64L20.9 13.36L18.34 13.83L17.78 15.19L19.25 17.33L17.33 19.25L15.19 17.78L13.83 18.34L13.36 20.9L10.64 20.9L10.17 18.34L8.81 17.78L6.67 19.25L4.75 17.33L6.22 15.19L5.66 13.83L3.1 13.36L3.1 10.64L5.66 10.17L6.22 8.81L4.75 6.67L6.67 4.75L8.81 6.22z";
  const ERNST: Record<string, string> = {
    fotos: '<path d="M3.5 4l7-.5.5 7-7 .5zM13.5 3.5l7 .5-.5 7-7-.5zM4 13.5l7 .5-.5 7-7-.5zM13 14l7-.5.5 7-7 .5z"/>',
    personen: '<path d="M9 3.8l3.2 2.6-1 3.9H6.8l-1-3.9z"/><path d="M2.8 20.5l2.4-5.5h7.6l2.4 5.5"/><path d="M15.2 4.4l3.3 2.2-1.2 3.6M17.5 14.6l2.6 1.4 1.3 4.5"/>',
    dinge: '<path d="M3.5 3.5h8.5l8.5 8.5-8.5 8.5-8.5-8.5z"/><path d="M7 7h2.2v2.2H7z"/>',
    orte: '<path d="M12 21.5L5.5 11 7 5.2l5-2.7 5 2.7 1.5 5.8z"/><path d="M12 7.4l2.3 2.6-2.3 2.6-2.3-2.6z"/>',
    ort: '<path d="M12 21.5L5.5 11 7 5.2l5-2.7 5 2.7 1.5 5.8z"/><path d="M12 7.4l2.3 2.6-2.3 2.6-2.3-2.6z"/>',
    alben: '<path d="M3.5 7.5l17-.5.5 13-17 .5z"/><path d="M6.5 4.3l11.5-.4"/><path d="M4.5 17.5l2.5-5 2 3 2.8-6 2.7 5.2 1.8-2.2 3.2 5"/>',
    suche: '<circle cx="10.5" cy="10.5" r="6.5"/><circle cx="10.5" cy="10.5" r="2.8"/><path d="M15.5 15.5l5 5"/>',
    back: '<path d="M15 4.5L7.5 12l7.5 7.5"/>',
    chevron: '<path d="M9 4.5l7.5 7.5L9 19.5"/>',
    cloud: '<path d="M4.5 18.5h15l1.3-3.6-2.1-3.4-3-.6-2-3.7-4.2.4-2.1 3.7-3 1z"/><path d="M12 15.5v-5M9.6 12.6L12 10.2l2.4 2.4"/>',
    herz: '<path d="M12 20L4 11.5l.5-4.6 4-2L12 8l3.5-3.1 4 2 .5 4.6z"/>',
    mehr: '<path d="M4 10.5h3v3H4zM10.5 10.5h3v3h-3zM17 10.5h3v3h-3z" fill="currentColor" stroke="none"/>',
    check: '<path d="M4.5 12.5l5 4.5 10-10"/>',
    papierkorb: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/><path d="M10.3 10.5v6M13.7 10.5v6"/>',
    album: '<path d="M3.5 7.5l17-.5.5 13-17 .5z"/><path d="M12 10.5v6.5M8.8 13.8h6.5"/>',
    kalender: '<path d="M3.5 5h17v15.5h-17zM3.5 10h17M8 3v4M16 3v4"/>',
    bild: '<path d="M3.5 4.5l17-.3.3 15.3-17 .3z"/><path d="M9 8.2l1.8 1.8L9 11.8 7.2 10z"/><path d="M4.5 18l3.5-5 2.5 3 3-5 2.5 4 3-2"/>',
    telefon: '<path d="M7 2.5h10v19H7z"/><path d="M11 18.5h2"/>',
    laptop: '<path d="M4.5 5h15v10.5h-15zM2.5 19h19"/>',
    tablet: '<path d="M4.5 3h15v18h-15z"/><path d="M11 18h2"/>',
    folge: '<path d="M7 7h13v13H7z"/><path d="M4 16V4h12"/>',
    original: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><path d="M8.5 8.5h7v7h-7z"/>',
    // a cog cut from wood, with the ring sun as its hub
    stil: '<path d="' + GEAR + '"/><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  };
  const MAGRITTE: Record<string, string> = {
    fotos: '<rect x="3.5" y="3.5" width="7" height="7" rx=".6"/><rect x="13.5" y="3.5" width="7" height="7" rx=".6"/><rect x="3.5" y="13.5" width="7" height="7" rx=".6"/><rect x="13.5" y="13.5" width="7" height="7" rx=".6"/>',
    // two figures, the front one in a bowler hat
    personen: '<circle cx="9" cy="10.4" r="3"/><path d="M5.2 7.2h7.6M6.6 7.2c0-2.5 1-3.7 2.4-3.7s2.4 1.2 2.4 3.7"/><path d="M3 20.5c.8-3.4 3.2-5.2 6-5.2s5.2 1.8 6 5.2"/><path d="M15.6 7a3 3 0 0 1 0 6M17 15c1.8.7 2.9 2.4 3.4 5.5"/>',
    // the apple of Le fils de l'homme
    dinge: '<path d="M12 8.6c-1.6-1.3-5.6-1.6-6.6 2.4-.9 3.9 1.6 9.1 4.1 9.1 1 0 1.4-.5 2.5-.5s1.5.5 2.5.5c2.5 0 5-5.2 4.1-9.1-1-4-5-3.7-6.6-2.4z"/><path d="M12 8.6c0-2 .7-3.6 2-4.6"/><path d="M12.9 6.3c1.5-1.7 3.5-1.8 4.6-1-1.2 1.5-3 1.9-4.6 1z"/>',
    orte: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><path d="M9.6 11.4h4.9a1.5 1.5 0 0 0-.3-3 2 2 0 0 0-3.8.3 1.4 1.4 0 0 0-.8 2.7z"/>',
    ort: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><path d="M9.6 11.4h4.9a1.5 1.5 0 0 0-.3-3 2 2 0 0 0-3.8.3 1.4 1.4 0 0 0-.8 2.7z"/>',
    // a canvas on an easel showing the sky behind it, as in La condition humaine
    alben: '<rect x="4" y="3.5" width="16" height="12" rx=".5"/><path d="M8 20.5l2-5M16 20.5l-2-5M12 15.5v5"/><path d="M8.6 11.2h6.6a1.8 1.8 0 0 0-.4-3.6 2.5 2.5 0 0 0-4.7.4 1.7 1.7 0 0 0-1.5 3.2z"/>',
    suche: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20.5 20.5"/><path d="M8 12.2h5.2a1.4 1.4 0 0 0-.3-2.8 2 2 0 0 0-3.8.4A1.3 1.3 0 0 0 8 12.2z"/>',
    cloud: '<path d="M6.5 18.5h11.2a3.6 3.6 0 0 0 .4-7.2 5.6 5.6 0 0 0-10.8-1 4.1 4.1 0 0 0-.8 8.2z"/><path d="M12 15.5v-5M9.6 12.6L12 10.2l2.4 2.4"/>',
    mehr: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
    bild: '<rect x="3.5" y="4.5" width="17" height="15" rx=".5"/><path d="M7 13.5h7.4a2 2 0 0 0-.5-4 2.8 2.8 0 0 0-5.3.5A1.8 1.8 0 0 0 7 13.5z"/>',
    album: '<rect x="3.5" y="7" width="17" height="13" rx=".5"/><path d="M12 10.5v6M9 13.5h6"/>',
    // a cog whose hub is the green apple
    stil: '<path d="' + GEAR + '"/><circle cx="12" cy="12" r="2.6" fill="var(--garten)" stroke="none"/>',
  };
  const SETS: Record<string, { p: Record<string, string>; cap: string; join: string; k: number }> = {
    monet: { p: P, cap: "round", join: "round", k: 1 },
    ernst: { p: ERNST, cap: "square", join: "miter", k: 1.12 },
    magritte: { p: MAGRITTE, cap: "round", join: "round", k: .8 },
  };
</script>
<script lang="ts">
  import type { Theme } from "../../shared/types";
  import { theme as current } from "../lib/state.svelte";
  let { name, size = 24, sw = 1.8, theme }: { name: keyof typeof P | string; size?: number; sw?: number; theme?: Theme } = $props();
  const set = $derived(SETS[theme ?? current()] ?? SETS.monet);
  const own = $derived(name in set.p);
</script>
<svg width={size} height={size} viewBox={name === "pfeil" ? "0 0 34 18" : "0 0 24 24"} fill="none" stroke="currentColor" stroke-width={sw * set.k} stroke-linecap={set.cap} stroke-linejoin={own || set.join !== "miter" ? set.join : "round"} stroke-miterlimit="8" aria-hidden="true">{@html set.p[name] ?? P[name] ?? ""}</svg>
