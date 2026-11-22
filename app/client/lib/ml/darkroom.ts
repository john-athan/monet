// The Dunkelkammer: the indexing loop. While the app is open and the tab visible (or always, in the Mac agent):
// fetch /api/index/pending, load /media/<id>/l, run the models, POST the vectors. One item at a time.
// On first run it also embeds the label vocabulary and posts it.
import { ml, encodeVec, CLIP_MODEL } from "./index";
import { LABELS, labelPrompt } from "../../../shared/labels";

export type DarkroomState = "idle" | "loading" | "running" | "paused" | "waiting" | "error" | "stopped";
export type DarkroomStatus = { state: DarkroomState; done: number; pending: number; current: number | null; error?: string; retryInMs?: number };

export type DarkroomGlobal = { busy: boolean; label: string; progress: number; pending: number; items: { id: number; done: boolean }[] };
const WORDS = ["null", "ein", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf"];
const num = (n: number) => (n <= 12 ? WORDS[n] : String(n));

const BATCH = 20;
const POLL_MS = 30_000;   // when nothing is pending, look again after this long (or when kick() is called)
const BACKOFF_MIN = 2_000, BACKOFF_MAX = 300_000;
const MAX_ITEM_FAILURES = 3;

type Pending = { id: number; kind: string; needs: string[] };
/** a file's plan (docs/together.md): pictures to embed with the image tower, text pieces with the text tower, in order */
type DocPending = { id: number; kind: string; images: string[]; texts: string[] };

export class Darkroom {
  private s: DarkroomStatus = { state: "stopped", done: 0, pending: 0, current: null };
  private subs = new Set<(s: DarkroomStatus) => void>();
  private running = false;
  private wake: (() => void) | null = null;
  private failures = new Map<number, number>();
  private skipped = new Set<number>();
  private batch: { id: number; done: boolean }[] = [];
  private files = false;
  private batchTotal = 0;
  alwaysOn = false;

  constructor(private api = "") {
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => this.wake?.());
    // the Mac agent loads /geraete?darkroom=always in a hidden WebView: never pause there
    if (typeof location !== "undefined" && new URLSearchParams(location.search).get("darkroom") === "always") this.alwaysOn = true;
    if (typeof window !== "undefined") (window as any).monetDarkroom = { status: this.global() };
  }

  /** What the Mac agent reads from window.monetDarkroom.status. */
  private global(): DarkroomGlobal {
    const st = this.s, n = this.batch.filter(b => !b.done).length;
    const busy = st.state === "running" || st.state === "loading";
    const label = st.state === "running" ? `Analysiert ${num(Math.max(n, 1))} ${this.files ? (n === 1 ? "Datei" : "Dateien") : n === 1 ? "Foto" : "Fotos"}`
      : st.state === "loading" ? "Bereitet die Suche vor" : st.state === "paused" ? "Pausiert"
      : st.state === "error" ? "Fehler, neuer Versuch folgt" : st.state === "stopped" ? "Angehalten" : "Alles analysiert";
    return { busy, label, progress: this.batchTotal ? (this.batchTotal - n) / this.batchTotal : busy ? 0 : 1, pending: st.pending, items: this.batch.slice(0, 3).map(b => ({ ...b })) };
  }

  /** Svelte store contract: `$darkroom.status` works with `darkroom.status` as a store. */
  readonly status = { subscribe: (fn: (s: DarkroomStatus) => void) => { this.subs.add(fn); fn(this.s); return () => { this.subs.delete(fn); }; } };
  get value() { return this.s; }
  private set(p: Partial<DarkroomStatus>) {
    this.s = { ...this.s, ...p };
    if (typeof window !== "undefined") (window as any).monetDarkroom = { status: this.global() };
    for (const f of this.subs) f(this.s);
  }

  start(opts: { alwaysOn?: boolean } = {}) {
    if (opts.alwaysOn !== undefined) this.alwaysOn = opts.alwaysOn;
    if (this.running) return;
    this.running = true;
    void this.loop();
  }
  stop() { this.running = false; this.set({ state: "stopped", current: null }); this.wake?.(); }
  /** New uploads arrived: look for work now instead of at the next poll. */
  kick() { this.wake?.(); }
  setAlwaysOn(v: boolean) { this.alwaysOn = v; this.wake?.(); }

  private sleep(ms: number) {
    return new Promise<void>(r => { const fin = () => { clearTimeout(t); this.wake = null; r(); }; const t = setTimeout(fin, ms); this.wake = fin; });
  }
  private get hidden() { return !this.alwaysOn && typeof document !== "undefined" && document.visibilityState === "hidden"; }

  private async json(path: string, init?: RequestInit) {
    const r = await fetch(this.api + path, { credentials: "same-origin", ...init });
    if (!r.ok) throw Object.assign(new Error(`${init?.method ?? "GET"} ${path}: HTTP ${r.status}`), { status: r.status });
    return r.json();
  }

  private async loop() {
    let backoff = 0;
    while (this.running) {
      try {
        if (this.hidden) { this.set({ state: "paused", current: null }); await this.sleep(60_000); continue; }
        await this.ensureVocab();
        const list: Pending[] = (await this.json(`/api/index/pending?limit=${BATCH}&needs=clip,faces`)).filter((p: Pending) => !this.skipped.has(p.id) && p.needs.some(n => n === "clip" || n === "faces"));
        // photos first; when none wait, the files (their ids live in another table, so they are kept apart)
        if (!list.length && await this.filesOnce()) { backoff = 0; continue; }
        this.files = false;
        this.batch = list.map(p => ({ id: p.id, done: false })); this.batchTotal = list.length;
        this.set({ pending: list.length, state: list.length ? "running" : "waiting", error: undefined, retryInMs: undefined });
        if (!list.length) { this.set({ current: null }); await this.sleep(POLL_MS); continue; }
        for (let i = 0; i < list.length && this.running; i++) {
          if (this.hidden) break;
          const p = list[i];
          this.set({ current: p.id, pending: list.length - i });
          try { await this.one(p); this.batch[i].done = true; this.set({ done: this.s.done + 1 }); backoff = 0; }
          catch (e: any) {
            if (e.status === 401 || e.status === 403) throw e;
            const n = (this.failures.get(p.id) ?? 0) + 1;
            this.failures.set(p.id, n);
            if (n >= MAX_ITEM_FAILURES || e.status === 404) { this.skipped.add(p.id); this.batch[i].done = true; } // gone, undecodable or poisonous: not this session
            else throw e;
          }
        }
        this.batch = []; this.batchTotal = 0;
        this.set({ current: null });
      } catch (e: any) {
        backoff = Math.min(BACKOFF_MAX, Math.max(BACKOFF_MIN, backoff * 2));
        this.set({ state: "error", error: String(e?.message ?? e), retryInMs: backoff, current: null });
        await this.sleep(backoff);
      }
    }
  }

  private async one(p: Pending) {
    const r = await fetch(`${this.api}/media/${p.id}/l`, { credentials: "same-origin" });
    if (!r.ok) throw Object.assign(new Error(`media/${p.id}/l: HTTP ${r.status}`), { status: r.status });
    const bitmap = await createImageBitmap(await r.blob());
    const wantClip = p.needs.includes("clip"), wantFaces = p.needs.includes("faces");
    const a = await ml.analyse(bitmap, { clip: wantClip, faces: wantFaces });
    const body: any = { model: CLIP_MODEL };
    if (wantClip && a.clip) body.clip = encodeVec(a.clip);
    if (wantFaces) body.faces = a.faces.map(f => ({ x: f.x, y: f.y, w: f.w, h: f.h, landmarks: f.landmarks, score: f.score, quality: f.quality, vec: encodeVec(f.vec) }));
    await this.json(`/api/index/${p.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }

  private skippedDocs = new Set<number>();
  /** One batch of files. false: none was waiting. */
  private async filesOnce(): Promise<boolean> {
    const list: DocPending[] = (await this.json(`/api/index/docs/pending?limit=${BATCH}`)).filter((d: DocPending) => !this.skippedDocs.has(d.id));
    if (!list.length) return false;
    this.files = true;
    this.batch = list.map(d => ({ id: d.id, done: false })); this.batchTotal = list.length;
    this.set({ pending: list.length, state: "running", error: undefined, retryInMs: undefined });
    for (let i = 0; i < list.length && this.running && !this.hidden; i++) {
      this.set({ current: null, pending: list.length - i });
      try { await this.oneDoc(list[i]); this.set({ done: this.s.done + 1 }); }
      catch (e: any) {
        if (e.status === 401 || e.status === 403) throw e;
        // 409: the file changed while it was embedded (a transcript came in); the next batch brings the new plan
        if (e.status !== 409) this.skippedDocs.add(list[i].id);
      }
      this.batch[i].done = true;
    }
    this.batch = []; this.batchTotal = 0; this.files = false;
    return true;
  }
  private async oneDoc(d: DocPending) {
    const images: string[] = [], texts: string[] = [];
    for (const url of d.images) {
      const r = await fetch(this.api + url, { credentials: "same-origin" });
      if (!r.ok) throw Object.assign(new Error(`${url}: HTTP ${r.status}`), { status: r.status });
      const a = await ml.analyse(await createImageBitmap(await r.blob()), { clip: true, faces: false });
      images.push(encodeVec(a.clip!));
    }
    for (const t of d.texts) texts.push(encodeVec(await ml.embedText(t)));
    await this.json(`/api/index/doc/${d.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: CLIP_MODEL, images, texts }) });
  }

  private vocabDone = false;
  /** Embed every label with the text model and post the vocabulary, once per server (the server says if it has it). */
  private async ensureVocab() {
    if (this.vocabDone) return;
    const have = await this.json(`/api/index/vocab?model=${CLIP_MODEL}`);
    if (!have.have) {
      this.set({ state: "loading", current: null });
      const labels: { label: string; lang: string; vec: string }[] = [];
      for (const l of LABELS) labels.push({ label: l.de, lang: "de", vec: encodeVec(await ml.embedText(labelPrompt(l))) });
      await this.json("/api/index/vocab", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: CLIP_MODEL, labels }) });
    }
    this.vocabDone = true;
  }
}

export const darkroom = new Darkroom();
