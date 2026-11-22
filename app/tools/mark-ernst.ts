// The Ernst mark, painted the way Max Ernst painted his forests: a sky laid in by decalcomania (pressed-off blots with
// branching veins), the ring sun with its halo, and the forest wall scraped out of the wet paint (grattage): dark
// trunk columns, light scratches along them, the wood grain of the frottage across, a white dove caught inside.
// Same frame as client/icons/icon.svg: a 40 x 40 tile with rounded corners. Seeded, so every run paints the same.
//   bun tools/mark-ernst.ts            writes client/icons/ernst.svg
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { brush } from "./paint";

const { rnd, pick, r2, out, fill, line } = brush(1891); // the year Ernst was born
const poly = (pts: [number, number][]) => "M" + pts.map(([x, y]) => `${r2(x)},${r2(y)}`).join("L") + "Z";

// ---- the sky: deep teal above, the green of the decalcomania, an ochre glow behind the trees
fill("M0,0H40V40H0Z", "#2F5A5C");
fill("M0,7Q20,5 40,8V40H0Z", "#4F7D74");
fill("M0,14Q20,12 40,15V40H0Z", "#86A487");
fill("M0,19Q20,17.5 40,20V40H0Z", "#D2AE62");
// decalcomania: blots pressed off the glass, ragged and many-lobed, in the colours of the band they sit in
const SKY = [{ y: [0, 9], c: ["#244B4E", "#3D6B68", "#5C8A7E"] }, { y: [6, 16], c: ["#3D6B68", "#6E9680", "#9DB693"] }, { y: [13, 22], c: ["#9DB693", "#C9A65C", "#E2C57E", "#B88E45"] }];
for (const band of SKY) for (let i = 0; i < 26; i++) {
  const cx = rnd() * 44 - 2, cy = band.y[0] + rnd() * (band.y[1] - band.y[0]), r = 0.7 + rnd() * 2.1, n = 9 + Math.floor(rnd() * 6);
  const pts: [number, number][] = [];
  for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2, rr = r * (0.45 + rnd() * 0.75); pts.push([cx + Math.cos(a) * rr * 1.5, cy + Math.sin(a) * rr * 0.8]); }
  fill(poly(pts), pick(band.c), 0.55 + rnd() * 0.4);
}
// the veins the pressed paint leaves behind: short branching lines
for (let i = 0; i < 12; i++) {
  let x = rnd() * 40, y = 1 + rnd() * 18; const c = y < 9 ? "#1C3C3F" : y < 15 ? "#35605C" : "#9A7034";
  let d = `M${r2(x)},${r2(y)}`;
  for (let k = 0; k < 3; k++) { x += (rnd() - 0.5) * 2.4; y += (rnd() - 0.3) * 1.6; d += `L${r2(x)},${r2(y)}`; }
  line(d, c, 0.14 + rnd() * 0.12, 0.5);
}

// ---- the ring sun: a hoop of light with the sky showing through, a halo around it, painted not drawn
const SX = 26.6, SY = 10.2;
line(`M${SX - 7.6},${SY}a7.6,7.6 0 1,0 15.2,0a7.6,7.6 0 1,0 -15.2,0`, "#F4E3A6", 0.5, 0.45);
line(`M${SX - 5},${SY}a5,5 0 1,0 10,0a5,5 0 1,0 -10,0`, "#F2CC62", 2.5);
line(`M${SX - 6.25},${SY}a6.25,6.25 0 1,0 12.5,0a6.25,6.25 0 1,0 -12.5,0`, "#A8722A", 0.32, 0.8);
line(`M${SX - 3.75},${SY}a3.75,3.75 0 1,0 7.5,0a3.75,3.75 0 1,0 -7.5,0`, "#A8722A", 0.32, 0.8);
// the brush going round: short arcs in lighter and deeper yellow on the hoop
for (let i = 0; i < 18; i++) {
  const a = rnd() * Math.PI * 2, len = 0.35 + rnd() * 0.5, rr = 4.3 + rnd() * 1.4;
  const p = (t: number) => `${r2(SX + Math.cos(t) * rr)},${r2(SY + Math.sin(t) * rr)}`;
  line(`M${p(a)}A${r2(rr)},${r2(rr)} 0 0,1 ${p(a + len)}`, pick(["#FBE7A0", "#E0AE3E", "#F7D978", "#C98E2C"]), 0.3 + rnd() * 0.35);
}

// ---- the forest wall: behind everything the dark of the wood, then the trunks standing in front of it
fill("M0,40V24.5Q6,23.2 11,24.2T22,23.8T40,24.6V40Z", "#15110C");
type Trunk = { x: number; w: number; top: number; base: string };
const trunks: Trunk[] = [];
for (let x = -0.8; x < 40;) {
  const w = 1.8 + rnd() * 2.3;
  // most close ranks just below the sun; a few stand taller, like the boards of "La grande forêt"
  const tall = rnd() < 0.22, top = tall ? 14.5 + rnd() * 2.5 : 18 + rnd() * 3.5;
  trunks.push({ x, w, top, base: pick(["#2A2016", "#33261A", "#283022", "#3E2B1B", "#211A12", "#2E3626"]) });
  x += w - 0.25 + rnd() * 0.3; // they overlap: a wall, not a fence
}
for (const t of trunks) {
  const { x, w, top } = t;
  // the crown is frayed wood, torn rather than drawn: many small teeth along the top
  const teeth = 5 + Math.floor(rnd() * 4), crown: [number, number][] = [];
  for (let k = 0; k <= teeth; k++) crown.push([x + (w * k) / teeth, top + (k % 2 ? -0.2 - rnd() * 1.3 : 0.3 + rnd() * 0.8)]);
  fill(poly([[x, 41], ...crown, [x + w, 41]]), t.base);
  // grattage: the comb dragged down through the wet paint leaves fine light lines along the trunk
  const n = 9 + Math.floor(rnd() * 7);
  for (let k = 0; k < n; k++) {
    const lx = x + 0.2 + rnd() * (w - 0.4), y0 = top + 0.6 + rnd() * 4, y1 = y0 + 3 + rnd() * 16;
    const wob = (rnd() - 0.5) * 0.5;
    line(`M${r2(lx)},${r2(y0)}Q${r2(lx + wob)},${r2((y0 + y1) / 2)} ${r2(lx - wob * 0.4)},${r2(Math.min(y1, 40.5))}`,
      pick(["#9C6B35", "#C2924A", "#7A4222", "#6A7C48", "#A85C2E", "#D4B068", "#58683C"]), 0.09 + rnd() * 0.16, 0.4 + rnd() * 0.45);
  }
  // frottage: the grain of floorboards rubbed across, little rings and wavy marks
  for (let k = 0; k < 3; k++) {
    const gy = top + 3 + rnd() * (35 - top), gx = x + rnd() * w * 0.4, gw = w * (0.35 + rnd() * 0.5);
    line(`M${r2(gx)},${r2(gy)}q${r2(gw / 2)},${r2((rnd() - 0.5) * 0.8)} ${r2(gw)},0`, pick(["#0E0B07", "#5B3A1F"]), 0.12 + rnd() * 0.12, 0.7);
  }
  if (rnd() < 0.35 && x > 1 && x + w < 39) { const ex = x + w * (0.3 + rnd() * 0.4), ey = top + 5 + rnd() * 10; line(`M${r2(ex - 0.45)},${r2(ey)}a.45,.7 0 1,0 .9,0a.45,.7 0 1,0 -.9,0`, "#0E0B07", 0.14, 0.7); }
  // the shadow edge on the right that sets each trunk in front of the next
  line(`M${r2(x + w - 0.1)},${r2(top + 1)}L${r2(x + w - 0.1)},40.5`, "#0B0906", 0.24, 0.75);
}

// ---- the dove caught in the forest, the one light thing inside it: raised wing, small head, ochre beak
const D = (d: string) => d;
fill(D("M8.6,31.9L10.5,30.7Q12.6,29.5 15.2,29.8Q16,28.9 16.9,29.1Q17.6,29.4 17.35,30.05Q16.7,31.6 14.4,31.85Q11.9,32.05 10.5,31.35Z"), "#E9DFC4");
fill(D("M8.6,31.9L9.3,31.05L10.5,31.35Z"), "#CFC3A3");
fill(D("M11.9,30.2Q11.7,27.3 14.6,25.9Q14.9,27.9 13.7,29.95Z"), "#F7F1DF");
line(D("M12.5,29.6Q12.8,27.7 14.2,26.6"), "#CFC3A3", 0.15);
fill(D("M17.3,29.62L18.15,29.86L17.32,30.08Z"), "#C98A1E");
fill(D("M16.55,29.48a.2,.2 0 1,0 .01,0z"), "#15110C");

// ---- the ground: rust and earth, scraped flat
fill("M0,40V36.6Q10,35.8 20,36.4T40,36.2V40Z", "#3A1F12", 0.85);
for (let i = 0; i < 14; i++) {
  const x = rnd() * 40, y = 36.6 + rnd() * 3.2, w = 1.5 + rnd() * 4;
  line(`M${r2(x)},${r2(y)}l${r2(w)},${r2((rnd() - 0.5) * 0.5)}`, pick(["#8C4A24", "#B06A33", "#5A2E17"]), 0.25 + rnd() * 0.3, 0.8);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><clipPath id="t"><rect width="40" height="40" rx="9"/></clipPath><g clip-path="url(#t)" fill="none" stroke-linecap="round" stroke-linejoin="round">${out.join("")}</g></svg>\n`;
writeFileSync(join(import.meta.dir, "../client/icons/ernst.svg"), svg);
console.log(`client/icons/ernst.svg: ${out.length} touches, ${svg.length} bytes`);
