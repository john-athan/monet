// The styles a library can wear. Everything about a style lives in shared/styles.ts; this file gives the client its
// list. Monet is the default and the name of the app; another style also gives the header its name.
import type { Theme } from "../../shared/types";
import { STYLES, THEME_KEYS, tokens, type Technique } from "../../shared/styles";

/** The daylight colours a preview shows inside any other style */
const SWATCH = ["ground", "surface", "ink", "muted", "rule", "sun", "water", "teich", "esszimmer", "garten", "atelier", "font-display"];

/** `swatch`: the daylight colours of the style, set inline on a preview so it shows that style inside any other */
export const THEMES: { key: Theme; brand: string; painter: string; motif: string; swatch: string }[] = THEME_KEYS.map(key => {
  const s = STYLES[key], t = tokens(key, "mittag");
  return { key, brand: s.brand, painter: s.painter, motif: s.motif, swatch: SWATCH.map(k => `--${k}:${t[k]}`).join(";") };
});
export const themeOf = (k: Theme | string | null | undefined) => THEMES.find(t => t.key === k) ?? THEMES[0];
/** How the style paints a recurring element: components switch on this, not on the style's name */
export const technique = (k: Theme | string | null | undefined): Technique => STYLES[themeOf(k).key].technique;
