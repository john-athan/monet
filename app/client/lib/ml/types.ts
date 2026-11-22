export type Face = { x: number; y: number; w: number; h: number; landmarks: number[]; score: number; quality: number; vec: Float32Array };
export type Analysis = { clip: Float32Array | null; faces: Face[] };
export type Backend = "auto" | "webgpu" | "wasm";
export type MlProgress = { file: string; loaded: number; total: number; done: boolean; cached: boolean };
export const CLIP_MODEL = "siglip2-b32-256";

// main thread -> worker
export type ToWorker =
  | { type: "init"; id: number; backend: Backend; base?: string }
  | { type: "image"; id: number; bitmap: ImageBitmap; clip: boolean; faces: boolean }
  | { type: "text"; id: number; text: string }
  | { type: "info"; id: number };
// worker -> main thread
export type FromWorker =
  | { type: "progress"; p: MlProgress }
  | { type: "result"; id: number; clip?: Float32Array | null; faces?: Face[]; vec?: Float32Array; info?: any; ms?: Record<string, number> }
  | { type: "error"; id: number; message: string };
