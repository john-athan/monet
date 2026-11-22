# vendor

Third-party code that is shipped as files, not as an npm dependency. Only onnxruntime-web lives here.

## ort/ : onnxruntime-web 1.31.1

- Source: the npm registry tarball `https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.31.1.tgz` (published 2026-10-26), files from `package/dist/`, unmodified.
- License: MIT, Copyright (c) Microsoft Corporation. The package.json of the tarball says `"license": "MIT"`; the tarball has no separate LICENSE file.
- Build used: `ort.webgpu.min.mjs`, the WebGPU build. It contains the wasm (CPU) execution provider as well, which is what Monet uses by default; WebGPU is opt-in.
- Served at `/vendor/ort/*`; the worker sets `ort.env.wasm.wasmPaths` to that directory.

| file | bytes | sha256 |
| --- | --- | --- |
| ort.webgpu.min.mjs | 70742 | 329cd956772397a1aedd668e911195d39afefb182f6fc14aafa4f08ac8d8f379 |
| ort-wasm-simd-threaded.asyncify.mjs | 53457 | 59cf781530e1a16df2a291d78798e3ec1152467edaec402d6f9599d85047c302 |
| ort-wasm-simd-threaded.asyncify.wasm | 28747738 | ca319e9539cd0f1e291cf56074760121eaf39650f5dbf84b6e52c07f4b2944ec |

Kept only what `ort.webgpu.min.mjs` loads (it names `ort-wasm-simd-threaded.asyncify.mjs`; the .wasm sits next to it).
The other dist files (ort.wasm, ort.all, jspi, webgl, node builds, source maps) are not vendored.

### Updating

```
curl -sO https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-<version>.tgz
tar xzf onnxruntime-web-<version>.tgz
cp package/dist/ort.webgpu.min.mjs package/dist/ort-wasm-simd-threaded.asyncify.* vendor/ort/
shasum -a 256 vendor/ort/*      # update the table above
```

Then re-run the verification in `docs/ml.md` (vectors must not move between versions without re-indexing).
