// The one place the client touches the in-browser ML (client/lib/ml). The darkroom's own states are mapped to the
// words the UI uses: running is "working", waiting and stopped are "idle".
import { readable } from "svelte/store";
import { ml } from "./ml/index";
import { darkroom, type DarkroomStatus } from "./ml/darkroom";

export { ml };
export type Darkroom = { state: "idle" | "loading" | "working" | "paused" | "error"; done: number; pending: number; current?: number; files: boolean };
export const startDarkroom = (opts: { alwaysOn?: boolean } = {}) => darkroom.start(opts);
const map = (s: DarkroomStatus): Darkroom => ({ state: s.state === "running" ? "working" : s.state === "waiting" || s.state === "stopped" ? "idle" : s.state, done: s.done, pending: s.pending, current: s.current ?? undefined, files: !!s.files });
export const darkroomStatus = readable<Darkroom>(map(darkroom.value), set => darkroom.status.subscribe(s => set(map(s))));
