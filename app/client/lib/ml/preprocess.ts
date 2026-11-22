// Image preprocessing for the image tower (SigLIP 2), kept pure so it can be tested without a canvas.
// Read from the model's preprocessor_config.json: SigLIP resizes the whole picture to size x size without keeping the
// aspect ratio (no crop: every part of a panorama counts), CLIP-style configs resize the shortest side and center crop.
export type ImagePre = { size: number; crop: boolean; mean: number[]; std: number[]; rescale: number };

export function imageConfig(json: any): ImagePre {
  return {
    size: json.crop_size?.width ?? json.size?.width ?? json.size?.shortest_edge ?? 224,
    crop: json.do_center_crop === true,
    mean: json.image_mean, std: json.image_std,
    rescale: json.do_rescale === false ? 1 : json.rescale_factor ?? 1 / 255,
  };
}

/** Resize so the shortest side is `size`, then center crop: where the source goes on the size x size canvas. */
export function coverRect(w: number, h: number, size: number) {
  const dw = w <= h ? size : (w * size) / h, dh = h <= w ? size : (h * size) / w;
  return { dx: (size - dw) / 2, dy: (size - dh) / 2, dw, dh };
}

/** Where a w x h picture is drawn on the size x size canvas for this config. */
export function placeRect(w: number, h: number, cfg: ImagePre) {
  return cfg.crop ? coverRect(w, h, cfg.size) : { dx: 0, dy: 0, dw: cfg.size, dh: cfg.size };
}

/** RGBA bytes (size x size) -> NCHW float32, (v * rescale - mean) / std per channel. */
export function rgbaToNchw(rgba: Uint8ClampedArray | Uint8Array, size: number, cfg: Pick<ImagePre, "mean" | "std" | "rescale">): Float32Array {
  const n = size * size, out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[c * n + i] = (rgba[i * 4 + c] * cfg.rescale - cfg.mean[c]) / cfg.std[c];
  return out;
}
