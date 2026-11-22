// The rooms of Giverny: each section has its colour. Dinge got the violet of the water lilies at dusk.
export const SECTIONS = [
  { key: "fotos", path: "/", label: "Fotos", room: "--teich" },
  { key: "personen", path: "/personen", label: "Personen", room: "--esszimmer" },
  { key: "dinge", path: "/dinge", label: "Dinge", room: "--seerosen" },
  { key: "orte", path: "/orte", label: "Orte", room: "--garten" },
  { key: "alben", path: "/alben", label: "Alben", room: "--atelier" },
] as const;
export type SectionKey = (typeof SECTIONS)[number]["key"];
export function sectionOf(path: string): SectionKey {
  if (path.startsWith("/personen")) return "personen";
  if (path.startsWith("/dinge")) return "dinge";
  if (path.startsWith("/orte")) return "orte";
  if (path.startsWith("/alben") || path.startsWith("/serie")) return "alben";
  return "fotos";
}
