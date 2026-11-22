# In-browser ML

Code: `client/lib/ml/` (worker.ts, index.ts, darkroom.ts, and the pure parts bpe.ts, preprocess.ts, faces.ts, vec.ts, models.ts). Vocabulary: `shared/labels.ts`. Models: `tools/fetch-models.ts` into `models/` (git-ignored, served at `/models/*`). Runtime: `vendor/ort/` (served at `/vendor/ort/*`, see `vendor/README.md`).

## Models

| role | file in models/ | source (pinned revision, sha256 in tools/fetch-models.ts) | size | licence |
| --- | --- | --- | --- | --- |
| image (SigLIP 2) | siglip-vision.onnx, siglip-preprocessor.json | onnx-community/siglip2-base-patch32-256-ONNX, onnx/vision_model_fp16.onnx | 189.2 MB | Apache-2.0 (google/siglip2-base-patch32-256) |
| text (SigLIP 2) | siglip-text.onnx, siglip-tokenizer.json | same repo, onnx/text_model_fp16.onnx, tokenizer.json | 564.9 MB + 34.4 MB | Apache-2.0 |
| face detect | yunet.onnx | opencv/face_detection_yunet, face_detection_yunet_2023mar.onnx | 0.23 MB | MIT (README) |
| face embed | sface.onnx | opencv/face_recognition_sface, face_recognition_sface_2021dec.onnx | 38.7 MB | Apache-2.0 (README) |
| text detect (server) | ocr-det.onnx | SWHL/RapidOCR, PP-OCRv4/ch_PP-OCRv4_det_infer.onnx | 4.7 MB | Apache-2.0 |
| text read (server) | ocr-rec.onnx, ocr-dict.txt | monkt/paddleocr-onnx, languages/latin/rec.onnx and dict.txt (PP-OCRv5 Latin mobile) | 7.9 MB | Apache-2.0 |

Total 827.5 MB (6 files); before SigLIP 2 (CLIP B/32 and the multilingual CLIP text model) it was 266.0 MB. Licences were read from the cards and READMEs: nothing differs from the spec. Two remarks: the two OpenCV repos carry the licence only in the README text and a LICENSE file, not in the Hugging Face metadata field; and a model licence does not cover the terms of the datasets the weights were trained on (SFace especially), which matters only if Monet is ever offered to others.

`manifest.json` (written by the fetch tool) lists every file with bytes and sha256 and names the four models. The worker fetches `/models/<file>?v=<sha12>`, checks size and sha256, and keeps the bytes in Cache Storage (`monet-models-v1`): measured 401 ms for the first load of the 89 MB image model from localhost, 49 ms from the cache.

## Pipelines

- Image: canvas draw of the whole picture squashed to 256x256 (SigLIP resizes without keeping the aspect ratio and without a crop; high quality smoothing), rescale 1/255, mean/std 0.5 from preprocessor_config.json, NCHW float32. Output `pooler_output`, 768 floats (the projection head is inside the export), L2-normalised. Transparent pixels are composited on white.
- Text: the query is lowercased (SigLIP 2 was trained on lowercased text; tokenizer.json does not do it), then Gemma BPE written by hand from tokenizer.json (`bpe.ts`: added tokens kept whole, space to `▁`, byte fallback, merges by rank), `<eos>` appended, padded with `<pad>` to exactly 64 ids (the model pools the last position, so the padding is part of the meaning). Input `input_ids` only. Output `pooler_output`, 768 floats, L2-normalised. 671 strings (labels, queries, emoji, CJK, truncation) give the same ids as Hugging Face `tokenizers`.
- Faces: YuNet 2023mar is fixed 1x3x640x640 (BGR, 0..255), so the image is letterboxed at the top-left. Outputs cls/obj/bbox/kps at strides 8/16/32, decoded as OpenCV does (score = sqrt(cls*obj), NMS 0.3, threshold 0.6), faces under 24 px are dropped, boxes and landmarks are mapped back and normalised to 0..1. SFace: Umeyama similarity (closed form in 2D) from the 5 landmarks to the ArcFace template, bilinear warp to 112x112, input `data` as RGB 0..255 NCHW (OpenCV's blobFromImage with swapRB), output `fc1` 128 floats, L2-normalised. quality = score * min(1, shortSidePx / 112).
- Wire format: base64 of little-endian float32 (`encodeVec`).

## Text in photos (server)

The server reads text itself; the Mac may still post Apple Vision text for a photo the server has not read yet. Code: `server/ocr.ts` (pure: detector input, DB boxes, recogniser input, CTC decode, reading order), `server/ocr-worker.ts` (models), `server/ocr-queue.ts` (batches). After thumbnails, and at start, photos with `ocr_ok = 0` go in batches of 25 to `monet ocr-worker`, a child process that loads onnxruntime-web from `dist/vendor/ort` (wasm, one thread) and exits after the batch. The detector sees the large thumbnail at 960 px on the long side; boxes are axis-aligned; each box is read from the large thumbnail at 48 px high. A line is kept at a mean confidence of 0.5 and at least 3 letters or digits.

Measured on the server (2 vCPU, 4 GB RAM) on 2026-11-21 (25 photos): 22 s for the batch, so about 0.9 s per photo with start-up; peak 610 MB for the worker, so `MemoryMax` is 1200M. On the Mac 0.43 s per photo. PP-OCRv4 mobile detection found a car park sign ("109", "TERMINAI" for TERMINAL) that PP-OCRv3 mobile missed; the v5 detector is only offered as the 88 MB server model.

## Decisions

1. Model: SigLIP 2 B/32 at 256 px (`siglip2-b32-256`), chosen on 2026-11-21 over CLIP B/32 with the multilingual CLIP text model and over SigLIP 2 B/16 at 224 and 256 px. On 134 test photos with 45 hand-judged German queries (retrieval of the right photos among all 134; native onnxruntime, text towers int8): CLIP MRR 0.72 (R@1 0.60, R@5 0.84); SigLIP 2 B/32-256 MRR 0.96 (0.93, 1.00); B/16-224 0.95; B/16-256 0.96. B/16 costs 3 to 4 times the compute for no gain on this set, so B/32. Biggest gains: "Konservendose mit Miesmuscheln" rank 109 to 1, "Kanone" 38 to 1, "Lutscher" 33 to 1, "Terrarium" 13 to 1. With the fp16 text tower that ships (Decision 2) it is MRR 0.93 natively and 0.969 (R@1 0.96, R@5 1.00) in the built worker in headless Chrome; on 45 queries that difference is noise, the gap to CLIP is not.
2. Precision: both towers are the fp16 exports. On wasm they give the same vectors as native fp32 (cosine 0.99999 image, 1.0000 text). The int8 image export of the repo is broken (cosine to fp32 down to 0.61, MRR 0.73); 4-bit (q4) loses quality (MRR 0.90 to 0.95) and is not faster on wasm. The int8 text export is fine in native onnxruntime (cosine >= 0.976) but not in onnxruntime-web wasm: cosine down to 0.72, MRR 0.75. So the text model is 565 MB instead of 283 MB; most of it is the 256k-token embedding table. Backend "auto" is wasm for every model; WebGPU stays opt-in (`ml.ready("webgpu")`): the fp16 files compute wrong vectors on WebGPU (cosine 0.48), only the fp32 image file agrees there (cosine 1.0 to wasm, 15 ms per image), at 378 MB.
3. Threads: wasm uses up to 8 threads when `crossOriginIsolated`; otherwise 1. 8 instead of 4 takes SigLIP 2 B/32 from 70 to 44 ms per image. See timings.
4. Labels: the embedded text is `a photo of <English twin>`, the German word is what is stored and shown. With CLIP that ranked the right label far higher than the German word (MRR 0.43 against 0.22 on 54 judged pairs). With SigLIP 2 German, English and both are about even (each misses 3 or 4 of 35 judged photos), so the prompt stayed. A label is kept at a softmax share of at least 15 % at temperature 111.8 (SigLIP's exp(logit_scale)); SigLIP's own sigmoid scores are useless for single words (median best label 0.01). Search keeps a photo at cosine >= 0.085 and z >= 1.5 over the library; stacks join at cosine >= 0.90. The calibration of all three is in the comments in `server/search.ts` and `server/stack.ts`.
5. Sessions are created lazily and released after 2 minutes without a request; one request at a time.
6. Transparent PNGs are flattened on white before the image model and the face models. Before this, drawings on transparent background were read as black blobs.
7. Darkroom: `ocr`-only items are skipped (the browser does no OCR, the server does, see Text in photos); an item that fails 3 times or returns 404 is skipped for the session; errors back off 2 s doubling up to 5 min; nothing pending means a look every 30 s or on `kick()`.

## Measurements (headless Chrome, macOS arm64, M4 Pro, ort 1.31.1, COOP/COEP set)

Image tower per image, median of 8 real photos, 2026-11-21:

| model | wasm 1 thread | wasm 4 threads | wasm 8 threads | WebGPU |
| --- | --- | --- | --- | --- |
| CLIP B/32 int8 (before) | 208 ms | 57 ms | 55 ms | 94 ms, vectors differ |
| SigLIP 2 B/32-256 fp16 (now) | 256 ms | 70 ms | 44 ms | fp16 wrong; fp32 file 15 ms |
| SigLIP 2 B/16-224 fp16 | 789 ms | 201 ms | 109 ms | fp16 wrong; fp32 file 22 ms |

Text tower per query: SigLIP 2 fp16 38 ms at 8 threads (CLIP multilingual: 4 to 6 ms). In the built worker over 134 photos: 42 ms per image, 38 ms per query; the first query after load takes 2.7 s (565 MB model and the 34 MB tokenizer.json), the first image 0.8 s.

Faces, per image of the older test set (32 files, longest side 2048): detect 12 ms and SFace 25 ms per face at 4 threads.

## Verification results

Retrieval: see Decisions 1 and 4. The benchmark (134 photos, 45 judged German queries, 10 queries with nothing to find) was run from a scratch directory and is not kept in the repo.

Faces (28 files with 24 faces found): the detections on the poster (3 children), the Nuffins box (3), dallemini (2 men), the red-cap newspaper photo (1 each), the meme (1), a street scene (2 small people) are right when drawn on the image. A candy face on a lollipop and a reflection in a monitor are found too. Missed: the sideways newspaper face, and one badly warped newspaper portrait.
Same person: the two red-cap newspaper photos score 0.718 (above 0.363). All 276 face pairs: 4 are at or above 0.363: poster child 2 vs 3 (0.795), the red-cap pair (0.718, same person), the Nuffins box faces 1 vs 3 (0.428, the same photographed face is pasted three times), two street-scene people (0.383, unverified). Highest cross-person pair below the threshold: 0.356. The test set has only this one real same-person pair, so variants were added: a mirrored, a half-size and a darkened copy of the same photo give 0.65 (mirrored, one face), 0.97 and 0.95; the 3 Nuffins faces give 0.81 to 0.93 mirrored and 0.88 to 0.98 for the others. Feeding BGR to SFace gave 0.699 for the same-person pair and a false 0.397 match between a drawing and a face, so RGB stays.

## What does not work, or is not verified

- Rotated faces (sideways photo) are not detected; YuNet is upright only. Small faces in big crowd shots (under roughly 20 px at 640 px detector width, about 60 px in a 2048 px photo) are missed.
- WebGPU: the fp16 SigLIP files compute wrong vectors there; only fp32 files agree with wasm, which would double the image download. Measured only on an Apple GPU.
- Threads need COOP `same-origin` and COEP `require-corp` (or credentialless) on the document and worker; without them the wasm runs on one thread at 3.5 times the cost.
- HEIC cannot be decoded in Chrome; the server's /media/:id/l webp makes that moot.
- Only one genuine same-person pair exists in the test set, so the 0.363 threshold is checked on that plus synthetic variants, not on a population.
- The darkroom ran end to end only against a fake of the index endpoints (backoff after a 500, vocab bootstrap, ocr-only skip), not against the real server.
- No TypeScript type check was run (no compiler may be added); Bun bundled and ran everything.
- Memory use of the quantized text model and of the image model together was not measured.
