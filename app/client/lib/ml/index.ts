// Main-thread API of the in-browser ML. One shared worker, created on first use.
//   ml.embedImage(bitmap)      -> Float32Array(768), L2-normalised (the bitmap is transferred and closed)
//   ml.embedText(text)         -> Float32Array(768), same space (German or English)
//   ml.analyse(bitmap, opts?)  -> { clip, faces }
//   ml.ready()                 -> resolves when the runtime is up (models load on first use of each)
//   ml.onProgress(fn)          -> model download progress; returns an unsubscribe function
// The worker file is built by app/build.ts to the URL in __ML_WORKER__ (default /assets/ml-worker.js).
import type { Analysis, Backend, FromWorker, MlProgress, ToWorker } from "./types";
export type { Analysis, Face, MlProgress, Backend } from "./types";
export { CLIP_MODEL } from "./types";
export { encodeVec, decodeVec, dot } from "./vec";

declare const __ML_WORKER__: string | undefined;

type Pending = { resolve: (m: Extract<FromWorker, { type: "result" }>) => void; reject: (e: Error) => void };

class Ml {
  private w: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(p: MlProgress) => void>();
  private up: Promise<any> | null = null;
  backend: Backend = "auto";
  /** timings (ms) of the most recent call, per stage */
  lastMs: Record<string, number> = {};

  private worker(): Worker {
    if (this.w) return this.w;
    const url = typeof __ML_WORKER__ !== "undefined" ? __ML_WORKER__ : "/assets/ml-worker.js";
    const w = new Worker(url, { type: "module", name: "monet-ml" });
    w.onmessage = ({ data }: MessageEvent<FromWorker>) => {
      if (data.type === "progress") { for (const l of this.listeners) l(data.p); return; }
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      if (data.type === "error") p.reject(new Error(data.message)); else p.resolve(data);
    };
    w.onerror = e => { const err = new Error(e.message || "ml worker crashed"); for (const p of this.pending.values()) p.reject(err); this.pending.clear(); this.w = null; this.up = null; };
    return (this.w = w);
  }

  private call(m: Omit<ToWorker, "id">, transfer: Transferable[] = []) {
    const id = ++this.seq;
    return new Promise<Extract<FromWorker, { type: "result" }>>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker().postMessage({ ...m, id }, transfer);
    });
  }

  /** Choose the execution provider before the first call ("auto" = WebGPU where it pays off, else wasm). */
  async ready(backend: Backend = this.backend): Promise<{ webgpu: boolean; isolated: boolean; threads: number; ort: string }> {
    this.backend = backend;
    return (this.up ??= this.call({ type: "init", backend }).then(r => r.info));
  }

  onProgress(fn: (p: MlProgress) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  async embedImage(bitmap: ImageBitmap): Promise<Float32Array> {
    return (await this.analyse(bitmap, { faces: false })).clip!;
  }

  async embedText(text: string): Promise<Float32Array> {
    await this.ready();
    const r = await this.call({ type: "text", text });
    this.lastMs = r.ms ?? {};
    return r.vec!;
  }

  /** The bitmap is transferred to the worker and closed there; pass `keep: true` to analyse a copy instead. */
  async analyse(bitmap: ImageBitmap, o: { clip?: boolean; faces?: boolean; keep?: boolean } = {}): Promise<Analysis> {
    await this.ready();
    const bm = o.keep ? await createImageBitmap(bitmap) : bitmap;
    const r = await this.call({ type: "image", bitmap: bm, clip: o.clip ?? true, faces: o.faces ?? true }, [bm]);
    this.lastMs = r.ms ?? {};
    return { clip: r.clip ?? null, faces: r.faces ?? [] };
  }

  async info() { await this.ready(); return (await this.call({ type: "info" })).info; }
}

export const ml = new Ml();
