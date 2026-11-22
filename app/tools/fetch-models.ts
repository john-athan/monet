// Downloads the pinned ML model files from Hugging Face into app/models/ (git-ignored) and writes manifest.json.
// Usage: bun tools/fetch-models.ts [dir]      (default: app/models, or $MONET_MODELS)
// Idempotent: a file whose size and sha256 already match is skipped. A sha256 of "" means "not pinned yet":
// the file is downloaded and the hash printed, to be pasted into this list.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type F = { name: string; repo: string; rev: string; path: string; sha256: string };
const R = {
  siglip: ["onnx-community/siglip2-base-patch32-256-ONNX", "7efccb86b5b6601bfe9e14326e1c11b40b68d44c"],
  yunet: ["opencv/face_detection_yunet", "3cc26e7f1014a5ee5d74a42acee58bafc9d0a310"],
  sface: ["opencv/face_recognition_sface", "3d7082438a6e4551e840c9b2bb60b71e8da4b524"],
  rapidocr: ["SWHL/RapidOCR", "1cfba2e90fc938db55889873735088de210cc173"],
  paddle: ["monkt/paddleocr-onnx", "7b02d0a30a07ba2b92ad1ff5a8941ae2c633de65"],
} as const;
const f = (name: string, r: keyof typeof R, path: string, sha256 = ""): F => ({ name, repo: R[r][0], rev: R[r][1], path, sha256 });

export const FILES: F[] = [
  // SigLIP 2 B/32 at 256 px, image and text in one space (docs/ml.md, Decisions). The image tower is the fp16 export:
  // on wasm its vectors match fp32 to cosine 0.99999, while the int8 export of this repo is broken (cosine down to 0.61).
  // The text tower is the fp16 export too, although it is 565 MB: the int8 export (283 MB) is fine in native
  // onnxruntime (cosine >= 0.976) but computes different vectors in onnxruntime-web's wasm (cosine down to 0.72,
  // retrieval MRR 0.75 instead of 0.93), measured in headless Chrome on 2026-11-21.
  f("siglip-vision.onnx", "siglip", "onnx/vision_model_fp16.onnx", "44fcd984cf4ac4baba5b4776192c0b141a120c6981df49732c681d4fe8ddc718"),
  f("siglip-preprocessor.json", "siglip", "preprocessor_config.json", "d14ba2ee3fd816f3de8abaddc31953565128eaf37c73ad4bed32101a98465aff"),
  f("siglip-text.onnx", "siglip", "onnx/text_model_fp16.onnx", "3f8149272095410332433ca84f2c99611ed4679429eff43fbf3983ea15664ef3"),
  f("siglip-tokenizer.json", "siglip", "tokenizer.json", "cb9140fae3ac5122c972d37adf83e1248471a38147ad76f8215c8872c6fd8322"),
  f("yunet.onnx", "yunet", "face_detection_yunet_2023mar.onnx", "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"),
  f("sface.onnx", "sface", "face_recognition_sface_2021dec.onnx", "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"),
  // Text in photos, run on the server (server/ocr-worker.ts). Detection: PP-OCRv4 mobile; it read signs in photos
  // that PP-OCRv3 mobile missed, and the v5 detector is the 88 MB server model. Recognition: PP-OCRv5 Latin mobile
  // (German umlauts and ß included), its dictionary has 502 lines, the model 504 classes (blank and space added).
  f("ocr-det.onnx", "rapidocr", "PP-OCRv4/ch_PP-OCRv4_det_infer.onnx", "d2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9"),
  f("ocr-rec.onnx", "paddle", "languages/latin/rec.onnx", "614ffc2d6d3902d360fad7f1b0dd455ee45e877069d14c4e51a99dc4ef144409"),
  f("ocr-dict.txt", "paddle", "languages/latin/dict.txt", "3c0a8a79b612653c25f765271714f71281e4e955962c153e272b7b8c1d2b13ff"),
];
// the names the worker looks up in manifest.models
export const MODELS = { image: "siglip-vision.onnx", text: "siglip-text.onnx", faceDetect: "yunet.onnx", faceEmbed: "sface.onnx" };

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const dir = process.argv[2] ?? process.env.MONET_MODELS ?? join(import.meta.dir, "..", "models");
mkdirSync(dir, { recursive: true });

const out: { path: string; bytes: number; sha256: string }[] = [];
let bad = 0;
for (const m of FILES) {
  const dest = join(dir, m.name);
  let buf: Uint8Array | null = null;
  if (existsSync(dest)) {
    buf = new Uint8Array(readFileSync(dest));
    if (m.sha256 && sha(buf) !== m.sha256) { console.log(`${m.name}: on disk but sha256 differs, downloading again`); buf = null; }
  }
  if (!buf) {
    const url = `https://huggingface.co/${m.repo}/resolve/${m.rev}/${m.path}`;
    process.stdout.write(`${m.name}: downloading ${url}\n`);
    const r = await fetch(url, { redirect: "follow" });
    if (!r.ok) { console.error(`  HTTP ${r.status}`); bad++; continue; }
    buf = new Uint8Array(await r.arrayBuffer());
    const h = sha(buf);
    if (m.sha256 && h !== m.sha256) { console.error(`  sha256 mismatch: got ${h}, pinned ${m.sha256}`); bad++; continue; }
    writeFileSync(dest + ".tmp", buf); renameSync(dest + ".tmp", dest);
  }
  const h = sha(buf);
  if (!m.sha256) console.log(`  PIN ${m.name}: "${h}"`);
  else console.log(`${m.name}: ok (${buf.length} bytes)`);
  out.push({ path: m.name, bytes: buf.length, sha256: h });
}
if (bad) { console.error(`${bad} file(s) failed`); process.exit(1); }
writeFileSync(join(dir, "manifest.json"), JSON.stringify({ files: out, models: MODELS }, null, 1) + "\n");
console.log(`manifest.json written, ${out.length} files, ${(out.reduce((a, x) => a + x.bytes, 0) / 1e6).toFixed(1)} MB`);
