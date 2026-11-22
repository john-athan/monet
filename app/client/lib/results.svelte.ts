// Photos that belong to a person, place or album, loaded when the page opens.
import type { AlbumDetail, Chip, ItemSummary, SearchOut } from "../../shared/types";
import { api, post } from "./api";
export async function byChip(chip: Chip): Promise<ItemSummary[]> { return (await post<SearchOut>("/api/search", { chips: [chip], sort: "date", limit: 1000 })).items; }
export const album = (id: number) => api<AlbumDetail>(`/api/albums/${id}`);
