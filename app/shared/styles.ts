// The styles a library can wear, in one place. Everything that makes Monet, Ernst or Magritte look like itself is
// named here: the colours of the four lights, the type, and which technique paints each recurring element. The web
// client turns this into CSS at build time (tools/styles.ts); the Android and Mac apps get generated copies
// (android/.../ui/Styles.kt, mac/Sources/Panel/Styles.swift) and the marks as PNGs, so they follow without edits.
// Change a colour here, run `bun tools/styles.ts`, and every client has it. tests/styles.test.ts fails while a
// generated copy is stale.
//
// Tokens are CSS custom properties without the leading "--". `mittag` is the full set; the other lights list only
// what differs from it. "k-*" are the map's (Karte): water, three water strokes, land, two greens, ochre, lilac,
// surf, the halo behind labels and the rim round photo marks.
import type { Light, Theme } from "./types";

/** How a recurring element is painted. Clients switch on these, never on a style's name. */
export interface Technique {
  /** under titles and the current nav entry: Monet's two dabs, Ernst's pencil rubbing over wood, Magritte's strip of day sky */
  underline: "dabs" | "rubbing" | "sky";
  /** cards and fields: Monet's rounded pebbles, Ernst's square pasted-in engravings with a hairline, Magritte's framed pictures */
  card: "pebble" | "engraving" | "frame";
  /** the light indicator and the current month: a dot, Ernst's ring sun, Magritte's green apple */
  sun: "dot" | "ring" | "apple";
  /** the timeline band: dabs per month, a forest wall of trunks, clouds in a day sky */
  band: "dabs" | "forest" | "clouds";
  /** the map: dabbed sea and land, decalcomania rust land in a teal sea, a piece of day sky cut out of a night sea */
  map: "dabs" | "decalcomania" | "daysky";
}
export interface StyleDef {
  brand: string; painter: string; motif: string;
  /** the style's sign: an SVG in client/icons (served at /<file>), drawn by hand or by tools/mark-*.ts */
  mark: { file: string; alt: string };
  technique: Technique;
  /** native: font families to try in order on the Mac (Android draws with its serif) */
  type: { headings: "upright" | "italic"; tracking: number; native: string[] };
  light: { mittag: Record<string, string> } & Partial<Record<Exclude<Light, "mittag">, Record<string, string>>>;
}

export const LIGHTS: Light[] = ["morgen", "mittag", "abend", "nacht"];

export const STYLES: Record<Theme, StyleDef> = {
  monet: {
    brand: "Monet", painter: "Claude Monet", motif: "Licht auf Wasser, in Tupfern gemalt",
    mark: { file: "icon.svg", alt: "Monet-Zeichen: die japanische Brücke über dem Seerosenteich, in Tupfern gemalt" },
    technique: { underline: "dabs", card: "pebble", sun: "dot", band: "dabs", map: "dabs" },
    type: { headings: "upright", tracking: 0, native: ["Didot", "Bodoni 72"] },
    light: {
      mittag: {
        ground: "#EEF2EA", surface: "#FAFBF5", "surface-2": "#E0E8DA", "surface-3": "#CFDAC8", ink: "#22305E", muted: "#55617E", rule: "#D2DCCB", sun: "#EE7A2F", "sun-ink": "#A44A12", water: "#3D6FB0", "water-soft": "#D9E4F1", "on-ink": "#FAFBF5", glass: "rgb(250 251 245 / .86)", veil: "rgb(34 48 94 / .52)", deep: "#1A1E44", teich: "#2F7F86", esszimmer: "#E2AE1C", garten: "#4C8A52", atelier: "#C8707A", seerosen: "#7D6BB8", "ess-soft": "#F7E8B4", "ess-rule": "#E9D38A",
        "k-water": "#A9C4DC", "k-w1": "#7FA3CA", "k-w2": "#BFD6E8", "k-w3": "#8FB2BE", "k-land": "#EEEFDC", "k-g1": "#A3C58A", "k-g2": "#88B079", "k-oc": "#E3C27A", "k-li": "#B7A8D2", "k-surf": "#FBFCF4", "k-halo": "rgb(238 242 234 / .88)", "k-rim": "rgb(238 242 234 / .95)",
        shadow: "0 1px 2px rgb(34 48 94 / .1),0 14px 34px -14px rgb(34 48 94 / .3)", "font-display": "Didot,\"Bodoni 72\",\"Bodoni MT\",\"Iowan Old Style\",ui-serif,Georgia,serif", "font-body": "system-ui,-apple-system,\"Segoe UI\",Roboto,\"Helvetica Neue\",sans-serif", scheme: "light",
      },
      morgen: {
        ground: "#F5ECEB", surface: "#FCF8F6", "surface-2": "#ECDFE1", "surface-3": "#E0CDD1", ink: "#2E2B5C", muted: "#625C86", rule: "#E2D3D7", sun: "#E8743B", "sun-ink": "#A2461A", water: "#5A6FB8", "water-soft": "#E1E3F3", "on-ink": "#FCF8F6", glass: "rgb(252 248 246 / .86)", veil: "rgb(46 43 92 / .5)",
        "k-water": "#BCC3E2", "k-w1": "#9AA7D6", "k-w2": "#D3C4DE", "k-w3": "#A9C3DE", "k-land": "#F5EAE2", "k-g1": "#C2CC9A", "k-g2": "#AFBF8C", "k-oc": "#E6BE92", "k-li": "#CBA9CA", "k-surf": "#FFF8F4", "k-halo": "rgb(245 236 235 / .88)", "k-rim": "rgb(245 236 235 / .95)",
        shadow: "0 1px 2px rgb(46 43 92 / .1),0 14px 34px -14px rgb(46 43 92 / .3)",
      },
      abend: {
        ground: "#F6E4D5", surface: "#FDF4EC", "surface-2": "#EFD5C3", "surface-3": "#E5C2AC", ink: "#3B2553", muted: "#6C5470", rule: "#E8CDBA", sun: "#D9532A", "sun-ink": "#9E3513", water: "#5E58A8", "water-soft": "#E9DFF0", "on-ink": "#FDF4EC", glass: "rgb(253 244 236 / .86)", veil: "rgb(59 37 83 / .5)",
        "k-water": "#9C93C6", "k-w1": "#7F78B8", "k-w2": "#B787AE", "k-w3": "#CC9FA9", "k-land": "#F3DEC8", "k-g1": "#B9BF7E", "k-g2": "#9DAF76", "k-oc": "#DB9A5F", "k-li": "#A98BB0", "k-surf": "#FFEFE0", "k-halo": "rgb(246 228 213 / .88)", "k-rim": "rgb(246 228 213 / .95)",
        shadow: "0 1px 2px rgb(59 37 83 / .1),0 14px 34px -14px rgb(59 37 83 / .3)",
      },
      nacht: {
        ground: "#1C2049", surface: "#252A58", "surface-2": "#2F3569", "surface-3": "#3A417A", ink: "#F2EBE1", muted: "#B0ABCF", rule: "#363D72", sun: "#FF9A52", "sun-ink": "#FFB07A", water: "#9DB3EE", "water-soft": "#2E3A72", "on-ink": "#1C2049", glass: "rgb(37 42 88 / .86)", veil: "rgb(12 14 40 / .55)", deep: "#12153A", teich: "#6FC3C4", esszimmer: "#F5CF4E", garten: "#86C48A", atelier: "#F0A0A8", seerosen: "#B7A6EE", "ess-soft": "#3A3656", "ess-rule": "#5A5170",
        "k-water": "#172059", "k-w1": "#2A3E9A", "k-w2": "#141C52", "k-w3": "#3A56B0", "k-land": "#4A5497", "k-g1": "#5E9C8C", "k-g2": "#4E8A92", "k-oc": "#A8956F", "k-li": "#8470BC", "k-surf": "#7E96DE", "k-halo": "rgb(28 32 73 / .86)", "k-rim": "rgb(242 235 225 / .7)",
        shadow: "0 1px 2px rgb(8 10 30 / .4),0 18px 44px -18px rgb(8 10 30 / .8)", scheme: "dark",
      },
    },
  },
  ernst: {
    brand: "Ernst", painter: "Max Ernst", motif: "Wald, Ringsonne und Collage, in Frottage gerieben",
    mark: { file: "ernst.svg", alt: "Ernst-Zeichen: eine Ringsonne über einer Wand aus Bäumen, darin eine Taube" },
    technique: { underline: "rubbing", card: "engraving", sun: "ring", band: "forest", map: "decalcomania" },
    type: { headings: "upright", tracking: 0.02, native: ["Superclarendon", "Big Caslon", "Rockwell"] },
    light: {
      mittag: {
        ground: "#E6DFCB", surface: "#F3EEDF", "surface-2": "#DED6BF", "surface-3": "#D0C6AA", ink: "#1D2A24", muted: "#5A6150", rule: "#CFC6AC", sun: "#C98A1E", "sun-ink": "#7A4E0A", water: "#2F6F72", "water-soft": "#D5E1DA", "on-ink": "#F3EEDF", glass: "rgb(243 238 223 / .88)", veil: "rgb(29 42 36 / .55)", deep: "#141E1A", teich: "#2F6F72", esszimmer: "#B5852A", garten: "#4E6B2F", atelier: "#A8432A", seerosen: "#7D6BB8", "ess-soft": "#EFE1BC", "ess-rule": "#D9C188",
        "k-water": "#86AAA2", "k-w1": "#6F958D", "k-w2": "#A4C1B8", "k-w3": "#5D827A", "k-land": "#8E4F26", "k-g1": "#5F6F32", "k-g2": "#B57E38", "k-oc": "#4A2616", "k-li": "#D2AE62", "k-surf": "#2A1E14", "k-halo": "rgb(230 223 203 / .9)", "k-rim": "rgb(29 22 15 / .85)",
        wood: "#2B2117", scratch: "#D4B068", "paper-line": "rgb(29 42 36 / .5)",
        shadow: "0 1px 2px rgb(29 42 36 / .14),0 14px 34px -14px rgb(29 42 36 / .38)", "font-display": "Superclarendon,\"Big Caslon\",Rockwell,\"Iowan Old Style\",ui-serif,Georgia,serif", "font-body": "system-ui,-apple-system,\"Segoe UI\",Roboto,\"Helvetica Neue\",sans-serif", scheme: "light", grain: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='f'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.75 .018' numOctaves='3' seed='7'/%3E%3CfeColorMatrix values='0 0 0 0 .12 0 0 0 0 .14 0 0 0 0 .1 0 0 0 .075 -.01'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23f)'/%3E%3C/svg%3E\")",
      },
      morgen: {
        ground: "#E9E4D3", surface: "#F5F1E5", "surface-2": "#E0D9C3", "surface-3": "#D3CAAE", ink: "#1F2B26", muted: "#58604F", rule: "#D6CDB3", "water-soft": "#D7E3DC", "on-ink": "#F5F1E5", glass: "rgb(245 241 229 / .88)",
      },
      abend: {
        ground: "#E8D3BC", surface: "#F5E8D8", "surface-2": "#E3C9AD", "surface-3": "#D6B795", ink: "#2A1C14", muted: "#6A5446", rule: "#DDC3A6", sun: "#C4561E", "sun-ink": "#86350F", water: "#3E6A5E", "water-soft": "#E4DDCC", "on-ink": "#F5E8D8", glass: "rgb(245 232 216 / .88)", veil: "rgb(42 28 20 / .52)",
      },
      nacht: {
        ground: "#121B17", surface: "#1A2620", "surface-2": "#22312A", "surface-3": "#2C3D34", ink: "#EDE4CE", muted: "#A9AC95", rule: "#2A3A31", sun: "#E7B54A", "sun-ink": "#F2C871", water: "#86BFAE", "water-soft": "#213A33", "on-ink": "#121B17", glass: "rgb(26 38 32 / .88)", veil: "rgb(5 10 8 / .58)", deep: "#0B1210", teich: "#6FB5A8", esszimmer: "#E2B85A", garten: "#9BBE6A", atelier: "#E08560", seerosen: "#B7A6EE", "ess-soft": "#2C3628", "ess-rule": "#4A5A3E",
        "k-water": "#16302C", "k-w1": "#21423D", "k-w2": "#10241F", "k-w3": "#2C524B", "k-land": "#5A321A", "k-g1": "#4C5A26", "k-g2": "#93622A", "k-oc": "#2A160C", "k-li": "#B48C46", "k-surf": "#050403", "k-halo": "rgb(18 27 23 / .86)", "k-rim": "rgb(237 228 206 / .7)",
        wood: "#B39A6A", scratch: "#2A1E12", "paper-line": "rgb(237 228 206 / .35)",
        shadow: "0 1px 2px rgb(0 0 0 / .45),0 18px 44px -18px rgb(0 0 0 / .85)", scheme: "dark", grain: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='f'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.75 .018' numOctaves='3' seed='7'/%3E%3CfeColorMatrix values='0 0 0 0 .9 0 0 0 0 .85 0 0 0 0 .7 0 0 0 .06 -.01'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23f)'/%3E%3C/svg%3E\")",
      },
    },
  },
  magritte: {
    brand: "Magritte", painter: "René Magritte", motif: "Taghimmel, Melone und Apfel, nichts ist, was es scheint",
    mark: { file: "magritte.svg", alt: "Magritte-Zeichen: ein Mann mit Melone vor Meer und Himmel, vor seinem Gesicht schwebt ein grüner Apfel" },
    technique: { underline: "sky", card: "frame", sun: "apple", band: "clouds", map: "daysky" },
    type: { headings: "italic", tracking: 0, native: ["Hoefler Text", "Baskerville"] },
    light: {
      mittag: {
        ground: "#E3EDF5", surface: "#F8FBFD", "surface-2": "#D7E4EF", "surface-3": "#C4D5E4", ink: "#18202E", muted: "#4C596B", rule: "#C8D6E3", sun: "#4F8F2A", "sun-ink": "#2E5C12", water: "#3A74B0", "water-soft": "#D6E5F3", "on-ink": "#F8FBFD", glass: "rgb(248 251 253 / .86)", veil: "rgb(24 32 46 / .52)", deep: "#121822", teich: "#3A74B0", esszimmer: "#C49A22", garten: "#4F8F2A", atelier: "#B0352B", seerosen: "#7D6BB8", "ess-soft": "#F3E7BF", "ess-rule": "#DCC783",
        "k-water": "#1C2B44", "k-w1": "#3B557A", "k-w2": "#8CA6C4", "k-w3": "#2A3E5E", "k-land": "#86AED6", "k-g1": "#5E8FC4", "k-g2": "#CADCEA", "k-oc": "#FFFFFF", "k-li": "#AFC0D2", "k-surf": "#0F1726", "k-halo": "rgb(248 251 253 / .9)", "k-rim": "rgb(24 32 46 / .85)",
        "sky-top": "#5E8FC4", "sky-low": "#C2D7E8", cloud: "#FFFFFF", "cloud-shade": "#AFC0D2", "sky-band": "linear-gradient(to bottom,#6E9BCB,#CADCEA)", "sky-band-v": "linear-gradient(to right,#6E9BCB,#CADCEA)",
        shadow: "0 1px 2px rgb(24 32 46 / .1),0 14px 34px -14px rgb(24 32 46 / .32)", "font-display": "\"Hoefler Text\",Baskerville,\"Iowan Old Style\",ui-serif,Georgia,serif", "font-body": "system-ui,-apple-system,\"Segoe UI\",Roboto,\"Helvetica Neue\",sans-serif", scheme: "light", sky: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='900' height='560'%3E%3Cfilter id='b' x='-50%25' y='-50%25' width='200%25' height='200%25'%3E%3CfeGaussianBlur stdDeviation='16'/%3E%3C/filter%3E%3Cg fill='white' filter='url(%23b)'%3E%3Cellipse cx='170' cy='110' rx='120' ry='30'/%3E%3Cellipse cx='235' cy='90' rx='64' ry='38'/%3E%3Cellipse cx='120' cy='96' rx='46' ry='26'/%3E%3Cellipse cx='650' cy='310' rx='150' ry='32'/%3E%3Cellipse cx='575' cy='288' rx='70' ry='40'/%3E%3Cellipse cx='700' cy='290' rx='56' ry='30'/%3E%3Cellipse cx='330' cy='470' rx='110' ry='26'/%3E%3Cellipse cx='380' cy='455' rx='50' ry='28'/%3E%3C/g%3E%3C/svg%3E\")", "font-caption": "\"Snell Roundhand\",\"Savoye LET\",\"Apple Chancery\",cursive",
      },
      morgen: {
        ground: "#ECE8F1", surface: "#FBFAFC", "surface-2": "#E1DCE8", "surface-3": "#D2CBDB", ink: "#1F1D30", muted: "#57536A", rule: "#D9D3E1", "water-soft": "#E0E2F2", "on-ink": "#FBFAFC", glass: "rgb(251 250 252 / .86)",
      },
      abend: {
        ground: "#E9E2D8", surface: "#FAF6F0", "surface-2": "#E0D6C8", "surface-3": "#D2C5B3", ink: "#1E1B22", muted: "#5B5560", rule: "#DCD0C0", "water-soft": "#E3E2E6", "on-ink": "#FAF6F0", glass: "rgb(250 246 240 / .86)", veil: "rgb(30 27 34 / .52)",
      },
      nacht: {
        ground: "#0F151E", surface: "#17202C", "surface-2": "#1F2A38", "surface-3": "#283546", ink: "#EEF2F6", muted: "#A0ACBC", rule: "#243041", sun: "#F2C15B", "sun-ink": "#F7D38A", water: "#8CB8E3", "water-soft": "#1D3048", "on-ink": "#0F151E", glass: "rgb(23 32 44 / .88)", veil: "rgb(4 8 14 / .58)", deep: "#0A0F16", teich: "#8CB8E3", esszimmer: "#F2C15B", garten: "#8FC46A", atelier: "#E8776B", seerosen: "#B7A6EE", "ess-soft": "#2A2E2A", "ess-rule": "#4A4F3C",
        "k-water": "#0A0F18", "k-w1": "#2A3E5E", "k-w2": "#5E7898", "k-w3": "#1A2840", "k-land": "#22385A", "k-g1": "#172844", "k-g2": "#3A5578", "k-oc": "#C9D3DF", "k-li": "#5A6B82", "k-surf": "#E8EEF5", "k-halo": "rgb(15 21 30 / .86)", "k-rim": "rgb(238 242 246 / .7)",
        "sky-top": "#14213A", "sky-low": "#34507A", cloud: "#C9D3DF", "cloud-shade": "#55667E", "sky-band": "linear-gradient(to bottom,#14213A,#34507A)", "sky-band-v": "linear-gradient(to right,#14213A,#34507A)",
        shadow: "0 1px 2px rgb(0 0 0 / .45),0 18px 44px -18px rgb(0 0 0 / .85)", scheme: "dark", sky: "linear-gradient(to bottom,rgb(140 184 227 / .2),transparent 360px)",
      },
    },
  },
};

export const THEME_KEYS = Object.keys(STYLES) as Theme[];
/** The full token set of a style in a light. */
export const tokens = (t: Theme, l: Light): Record<string, string> => ({ ...STYLES[t].light.mittag, ...STYLES[t].light[l as Exclude<Light, "mittag">] });
