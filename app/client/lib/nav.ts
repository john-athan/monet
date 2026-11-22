// The rooms of Giverny: each section has its colour. Dinge got the violet of the water lilies at dusk.
export const SECTIONS = [
  { key: "fotos", path: "/", label: "Fotos", room: "--teich" },
  { key: "personen", path: "/personen", label: "Personen", room: "--esszimmer" },
  { key: "dinge", path: "/dinge", label: "Dinge", room: "--seerosen" },
  { key: "orte", path: "/orte", label: "Orte", room: "--garten" },
  { key: "alben", path: "/alben", label: "Alben", room: "--atelier" },
] as const;
/** The files beside the photos: one tree (Ablage) and three lists, each with its room and icon. */
export const FILES = [
  { key: "ablage", path: "/ablage", label: "Ablage", room: "--water", icon: "ablage" },
  { key: "dokumente", path: "/dokumente", label: "Dokumente", room: "--esszimmer", icon: "dokumente" },
  { key: "tabellen", path: "/tabellen", label: "Tabellen", room: "--garten", icon: "tabellen" },
  { key: "praesentationen", path: "/praesentationen", label: "Präsentationen", room: "--seerosen", icon: "praesentationen" },
] as const;
export type FileKey = (typeof FILES)[number]["key"];
export type SectionKey = (typeof SECTIONS)[number]["key"] | "ablage";
/** Which of the four file pages a path is (the Ablage owns its folders), null for anything else. */
export function fileOf(path: string): FileKey | null {
  return FILES.find(f => path === f.path || (f.key === "ablage" && path.startsWith("/ablage/")))?.key ?? null;
}
export function sectionOf(path: string): SectionKey {
  if (path.startsWith("/personen")) return "personen";
  if (path.startsWith("/dinge")) return "dinge";
  if (path.startsWith("/orte")) return "orte";
  if (path.startsWith("/alben") || path.startsWith("/serie")) return "alben";
  if (/^\/(ablage|dokumente|tabellen|praesentationen|datei)(\/|$)/.test(path)) return "ablage";
  return "fotos";
}
