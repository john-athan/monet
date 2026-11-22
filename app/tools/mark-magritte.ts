// The Magritte mark, painted the way Magritte painted: smooth and exact, nothing in touches. A day sky with its still
// cumulus, the sea and the low stone wall behind, the man in the overcoat and bowler hat, and the green apple floating
// in front of his face with one eye looking over it (Le fils de l'homme). The detail sits in the modelling: lit and
// shaded cloud puffs, glints on the sea, the stones of the wall, the folds of the coat, the speckled skin of the apple.
// Same frame as client/icons/icon.svg: a 40 x 40 tile with rounded corners. Seeded, so every run paints the same.
//   bun tools/mark-magritte.ts         writes client/icons/magritte.svg
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { brush } from "./paint";

const { rnd, pick, r2, out, fill, line } = brush(1898); // the year Magritte was born
const ell = (cx: number, cy: number, rx: number, ry: number, c: string, o = 1) =>
  out.push(`<ellipse cx="${r2(cx)}" cy="${r2(cy)}" rx="${r2(rx)}" ry="${r2(ry)}" fill="${c}"${o < 1 ? ` fill-opacity="${r2(o)}"` : ""}/>`);
const group = (attrs: string, body: () => void) => { out.push(`<g ${attrs}>`); body(); out.push("</g>"); };

const defs = `<defs>
<clipPath id="t"><rect width="40" height="40" rx="9"/></clipPath>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4F82BC"/><stop offset=".55" stop-color="#86AED6"/><stop offset="1" stop-color="#CADCEA"/></linearGradient>
<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2C4A68"/><stop offset="1" stop-color="#4C6D8B"/></linearGradient>
<linearGradient id="coat" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1C1F23"/><stop offset=".38" stop-color="#3A3F46"/><stop offset=".62" stop-color="#30343A"/><stop offset="1" stop-color="#17191C"/></linearGradient>
<radialGradient id="skin" cx=".38" cy=".38" r=".75"><stop offset="0" stop-color="#E9C6A2"/><stop offset=".7" stop-color="#CFA07A"/><stop offset="1" stop-color="#A9775A"/></radialGradient>
<radialGradient id="hat" cx=".32" cy=".3" r=".85"><stop offset="0" stop-color="#4B5058"/><stop offset=".45" stop-color="#22252A"/><stop offset="1" stop-color="#0E0F11"/></radialGradient>
<radialGradient id="apple" cx=".36" cy=".34" r=".78"><stop offset="0" stop-color="#C9E27A"/><stop offset=".35" stop-color="#86B440"/><stop offset=".78" stop-color="#4F8A26"/><stop offset="1" stop-color="#2C5716"/></radialGradient>
<linearGradient id="leaf" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#2E6A22"/><stop offset="1" stop-color="#6FA43A"/></linearGradient>
<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation=".28"/></filter>
</defs>`;

// ---- the sky: Magritte's daylight blue, paling toward the horizon
fill("M0,0H40V27H0Z", "url(#sky)");

// ---- the clouds: still cumulus, each a flat grey-blue base, shaded puffs, white puffs over them, lit tops
const cloud = (cx: number, cy: number, w: number, h: number) => group(`filter="url(#soft)"`, () => {
  ell(cx, cy + h * 0.12, w * 0.5, h * 0.22, "#9FB3C9", 0.85);
  const puffs: [number, number, number][] = [];
  for (let i = 0; i < 13; i++) {
    const u = rnd() * 2 - 1, x = cx + u * w * 0.42, lift = 1 - Math.abs(u) * 0.75;
    puffs.push([x, cy - rnd() * h * 0.55 * lift, (0.18 + rnd() * 0.2) * h * (0.6 + lift * 0.6)]);
  }
  for (const [x, y, r] of puffs) ell(x + r * 0.15, y + r * 0.3, r * 1.05, r * 0.92, pick(["#B9C7D6", "#C6D2DE", "#AFBFD0"]));
  for (const [x, y, r] of puffs) ell(x - r * 0.08, y - r * 0.05, r * 0.9, r * 0.82, pick(["#F4F7FA", "#EEF2F7", "#FFFFFF"]));
  for (const [x, y, r] of puffs) if (rnd() < 0.7) ell(x - r * 0.25, y - r * 0.3, r * 0.45, r * 0.36, "#FFFFFF", 0.9);
});
cloud(8.5, 6.2, 12, 5.4);
cloud(33.5, 11.5, 11, 4.6);
cloud(4, 19.5, 8, 3.2);
cloud(31, 22.4, 10, 3);
// thin far streaks low in the sky
for (let i = 0; i < 6; i++) { const x = rnd() * 36, y = 23 + rnd() * 3; line(`M${r2(x)},${r2(y)}h${r2(2 + rnd() * 5)}`, "#E8EFF5", 0.3 + rnd() * 0.25, 0.55); }

// ---- the sea: a dark band to the horizon, with the light lying in fine glints on it
fill("M0,27H40V31H0Z", "url(#sea)");
line("M0,27.05H40", "#9DB6CC", 0.18, 0.8);
for (let i = 0; i < 34; i++) {
  const y = 27.4 + rnd() * 3.4, x = rnd() * 40, w = 0.4 + rnd() * (y - 26) * 0.6;
  line(`M${r2(x)},${r2(y)}h${r2(w)}`, pick(["#B9CDE0", "#8FAAC4", "#DCE7F1"]), 0.12 + rnd() * 0.12, 0.35 + rnd() * 0.45);
}

// ---- the wall: a coping of pale stone, then courses of blocks with mortar joints and the grain of the stone
fill("M0,30.6H40V40H0Z", "#A49D8E");
fill("M0,30.2H40V31.5H0Z", "#C4BDAD");
line("M0,31.5H40", "#7D776A", 0.22);
line("M0,30.25H40", "#DCD6C8", 0.16);
for (let y = 31.5, row = 0; y < 40; y += 2.3, row++) {
  for (let x = row % 2 ? -2 : -0.4; x < 40;) {
    const w = 3 + rnd() * 2.4;
    fill(`M${r2(x + 0.1)},${r2(y + 0.1)}h${r2(w - 0.2)}v2.1h${r2(-(w - 0.2))}Z`, pick(["#ABA494", "#9F988A", "#B3AC9C", "#A59E8F", "#988F80"]));
    line(`M${r2(x + 0.15)},${r2(y + 0.18)}h${r2(w - 0.3)}`, "#C9C2B2", 0.12, 0.7); // the lit upper edge
    line(`M${r2(x + w)},${r2(y)}v2.3`, "#6F695D", 0.16);
    x += w;
  }
  line(`M0,${r2(y + 2.3)}H40`, "#6F695D", 0.16);
}
for (let i = 0; i < 70; i++) ell(rnd() * 40, 30.4 + rnd() * 9.6, 0.05 + rnd() * 0.1, 0.04 + rnd() * 0.06, pick(["#857E70", "#C2BBAB", "#7A7366"]), 0.7);

// ---- the man: overcoat, white shirt, red tie, neck and face; the apple and the hat come after
fill("M18.6,23.5h2.8v4.6h-2.8Z", "#B98A68"); // neck
fill("M17.4,27L22.6,27L20,33.2Z", "#ECEAE3"); // shirt in the V of the coat
fill("M17.4,27L18.9,27.2L19.4,29.2Z", "#FFFFFF"); // collar points
fill("M22.6,27L21.1,27.2L20.6,29.2Z", "#FFFFFF");
fill("M19.45,27.35h1.1l-.2,1.1h-.7Z", "#8E2119"); // tie knot
fill("M19.7,28.4h.6l.5,4.2-.8.8-.8-.8Z", "#A62B21"); // tie blade
line("M20,28.6L20.2,32.6", "#C24A3C", 0.12, 0.7);
fill("M7.5,40.5L8.6,33.2Q9.4,29.6 13.6,28.4L17.3,26.9L20,33.4L22.7,26.9L26.4,28.4Q30.6,29.6 31.4,33.2L32.5,40.5Z", "url(#coat)");
// the lapels, folded back with a lit edge
fill("M17.3,26.9L20,33.4L17.6,31.6L16.2,28.2Z", "#2A2E33");
fill("M22.7,26.9L20,33.4L22.4,31.6L23.8,28.2Z", "#24272B");
line("M17.3,26.9L20,33.4", "#5A6069", 0.16);
line("M22.7,26.9L20,33.4", "#4B5058", 0.14);
line("M16.2,28.2L17.6,31.6L19.6,33", "#121416", 0.14);
line("M23.8,28.2L22.4,31.6L20.4,33", "#121416", 0.14);
// folds of the coat, buttons, the seam down the front
for (const [d, c] of [["M11.4,31.2Q10.8,35 11.6,40", "#4A5058"], ["M28.4,31.4Q29.1,35.4 28.5,40", "#121416"], ["M14.4,33.8Q14,37 14.6,40", "#454B52"], ["M25.6,34Q26,37 25.4,40", "#15171A"], ["M9.6,34.5Q9.2,37.6 9.8,40", "#2A2E33"], ["M30.4,34.6Q30.9,37.5 30.3,40", "#0E0F11"]] as const)
  line(d, c, 0.2, 0.8);
line("M20,33.4V40.5", "#111315", 0.18);
for (const y of [35.4, 38.4]) { ell(20.6, y, 0.42, 0.42, "#0D0E10"); ell(20.5, y - 0.1, 0.16, 0.12, "#4A4F57"); }
line("M9.2,32Q10.6,29.4 13.8,28.5", "#5C626B", 0.18, 0.7); // light on the left shoulder

// head: ears, face, a shadow of hair under the hat
ell(15.75, 20.6, 0.75, 1.35, "#C49473");
ell(24.25, 20.6, 0.75, 1.35, "#B48262");
line("M15.6,19.9q.35.6 0,1.4", "#9A6A4E", 0.12);
fill("M20,15.6C22.7,15.6 24.2,17.6 24.2,20.4C24.2,23.6 22.4,25.6 20,25.6C17.6,25.6 15.8,23.6 15.8,20.4C15.8,17.6 17.3,15.6 20,15.6Z", "url(#skin)");
fill("M15.9,16.6Q16.4,16 17.2,16L16.5,18.2Q16,17.6 15.9,16.6Z", "#2B2420");
fill("M24.1,16.6Q23.6,16 22.8,16L23.5,18.2Q24,17.6 24.1,16.6Z", "#2B2420");
// the left eye looking over the apple, with its brow
ell(17.75, 17.55, 0.6, 0.32, "#F3EEE6");
ell(17.85, 17.58, 0.24, 0.26, "#3B2A1E");
ell(17.8, 17.5, 0.07, 0.07, "#FFFFFF");
line("M17,16.95Q17.75,16.6 18.55,16.95", "#3A2C22", 0.2);
line("M17.15,17.3Q17.75,17.12 18.35,17.3", "#8A5E44", 0.1, 0.8);

// ---- the apple: modelled round, the shade turning on the right, speckled skin, a few streaks, a window highlight
const APPLE = "M20,18.7C21.6,17.5 24.7,17.8 24.4,21.8C24.2,24.7 22.3,26.4 20,26C17.7,26.4 15.8,24.7 15.6,21.8C15.3,17.8 18.4,17.5 20,18.7Z";
fill(APPLE, "url(#apple)");
for (let i = 0; i < 9; i++) {
  const x = 16.6 + rnd() * 6.8, y0 = 18.9 + rnd() * 1.5, y1 = 22.5 + rnd() * 3;
  line(`M${r2(x)},${r2(y0)}Q${r2(x + (x - 20) * 0.25)},${r2((y0 + y1) / 2)} ${r2(x + (x - 20) * 0.1)},${r2(y1)}`, pick(["#D9E68A", "#A9C95A", "#E2D36C"]), 0.12 + rnd() * 0.12, 0.35);
}
fill("M22.9,19Q24.9,21 23.8,24.1Q22.6,25.9 20.6,26.05Q23.5,24 22.9,19Z", "#244A12", 0.45); // the turning shade
for (let i = 0; i < 46; i++) {
  const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * 3.7, x = 20 + Math.cos(a) * rr, y = 22 + Math.sin(a) * rr * 0.95;
  ell(x, y, 0.06 + rnd() * 0.05, 0.05 + rnd() * 0.04, pick(["#E7F0A8", "#D2E28E", "#F2F4C2"]), 0.75);
}
ell(18.1, 20.2, 0.85, 0.55, "#F6FBE2", 0.55);
ell(17.9, 20.05, 0.35, 0.22, "#FFFFFF", 0.85);
line("M16.3,23.6Q17,25.2 18.6,25.8", "#A8CC66", 0.14, 0.6); // the sky reflected along the lower edge
// the stem dimple, the stem, a leaf with its veins
fill("M19.1,18.75Q20,19.4 20.9,18.75Q20,18.35 19.1,18.75Z", "#2E5717", 0.7);
line("M20,18.9Q20.05,17.6 20.6,16.85", "#4A3220", 0.34);
line("M20.05,18.4Q20.1,17.6 20.5,17", "#7A5638", 0.1);
fill("M20.4,17.4C21,16.1 22.9,15.6 24.2,16.3C23.4,17.6 21.7,18 20.4,17.4Z", "url(#leaf)");
line("M20.5,17.35Q22.3,16.6 24,16.35", "#B6D47A", 0.1, 0.9);
for (const [x, y] of [[21.4, 17.05], [22.3, 16.8], [23.1, 16.6]]) line(`M${x},${y}l.4-.45M${x},${y}l.35.45`, "#2B5A1C", 0.07, 0.8);

// ---- the bowler: rounded crown in black felt with its sheen, the ribbon, the brim curling up at the sides
fill("M15.1,15.7C15,11.3 16.9,9.2 20,9.2C23.1,9.2 25,11.3 24.9,15.7Z", "url(#hat)");
fill("M15.12,14.3Q20,14.85 24.88,14.3L24.9,15.7Q20,16.2 15.1,15.7Z", "#08090A"); // the ribbon
line("M15.2,14.35Q20,14.9 24.8,14.35", "#3C4048", 0.1, 0.8);
fill("M23.5,14.75l.9-.05.1,.9-.9.06Z", "#16181B"); // the bow on the ribbon
ell(17.6, 11.6, 0.9, 1.9, "#8C939D", 0.2);
ell(17.4, 11.2, 0.35, 0.9, "#C3C9D1", 0.22);
line("M16,13.4Q16.2,10.4 19.2,9.5", "#6B717A", 0.14, 0.5);
fill("M12.6,16.5Q12.7,15.15 14.6,15.2Q20,15.75 25.4,15.2Q27.3,15.15 27.4,16.5Q26.5,16.1 25.4,16.35Q20,17.25 14.6,16.35Q13.5,16.1 12.6,16.5Z", "#121315");
line("M12.8,16.2Q13.2,15.35 14.6,15.35Q20,15.9 25.4,15.35Q26.8,15.35 27.2,16.2", "#5E646D", 0.14, 0.75); // the lit rim
line("M14.6,16.38Q20,17.27 25.4,16.38", "#000000", 0.16, 0.6);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">${defs.replace(/\n/g, "")}<g clip-path="url(#t)" fill="none" stroke-linecap="round" stroke-linejoin="round">${out.join("")}</g></svg>\n`;
writeFileSync(join(import.meta.dir, "../client/icons/magritte.svg"), svg);
console.log(`client/icons/magritte.svg: ${out.length} touches, ${svg.length} bytes`);
