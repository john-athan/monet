// Monet's build: tools/build-app.ts does the shared work (oss-kit's bun-app template); this file is what is Monet's own.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { buildApp, mime } from "./tools/build-app";
import { styleCss } from "./tools/styles";
import { STYLES, THEME_KEYS } from "./shared/styles";

const root = import.meta.dir;
// the marks of the other styles, painted the same way (tools/mark-ernst.ts, tools/mark-magritte.ts); shared/styles.ts names them
const MARKS = THEME_KEYS.map(t => STYLES[t].mark.file).filter(f => f !== "icon.svg");

await buildApp({
  root,
  // the ML worker is its own bundle (client/lib/ml/worker.ts); its name carries its hash and the page learns it as __ML_WORKER__
  async prepare({ out, dev }) {
    if (!existsSync(join(root, "client/lib/ml/worker.ts"))) return {};
    const w = await Bun.build({ entrypoints: [join(root, "client/lib/ml/worker.ts")], outdir: join(out, "assets"), naming: "ml-worker-[hash].[ext]", minify: !dev, sourcemap: "none", target: "browser", format: "esm" });
    if (!w.success) { console.error(w.logs); process.exit(1); }
    return { __ML_WORKER__: JSON.stringify(`/assets/${readdirSync(join(out, "assets")).find(f => f.startsWith("ml-worker-") && f.endsWith(".js"))}`) };
  },
  // the style tokens come first, generated from shared/styles.ts (the same source the Android and Mac apps are made from)
  css: () => styleCss() + readFileSync(join(root, "client/app.css"), "utf8"),
  // the mark: the Japanese bridge over the lily pond, painted in touches; Mark.svelte shows this same file
  icon: readFileSync(join(root, "client/icons/icon.svg"), "utf8"),
  marks: MARKS,
  manifest: icons => ({
    name: "Monet", short_name: "Monet", start_url: "/", id: "/", scope: "/", display: "standalone", lang: "de",
    background_color: "#EEF2EA", theme_color: "#EEF2EA", description: "Ein Fotoalbum, wie ein Maler es bauen würde.", categories: ["photo"],
    icons,
    shortcuts: [{ name: "Suche", url: "/suche" }, { name: "Personen", url: "/personen" }],
  }),
  after({ out, files, compress }) {
    // onnxruntime-web, unchanged: the worker imports it from /vendor/ort/
    if (existsSync(join(root, "vendor/ort"))) {
      mkdirSync(join(out, "vendor/ort"), { recursive: true });
      for (const f of readdirSync(join(root, "vendor/ort"))) { copyFileSync(join(root, "vendor/ort", f), join(out, "vendor/ort", f)); files[`vendor/ort/${f}`] = mime(f); }
    }
    // the land for Die Karte (Natural Earth, public domain), unchanged, served at /geo/ with its br and gz variants
    if (existsSync(join(root, "vendor/geo"))) {
      mkdirSync(join(out, "geo"), { recursive: true });
      for (const f of readdirSync(join(root, "vendor/geo"))) {
        if (f.endsWith(".md")) continue;
        writeFileSync(join(out, "geo", f), readFileSync(join(root, "vendor/geo", f))); files[`geo/${f}`] = mime(f);
        compress(`geo/${f}`);
      }
    }
  },
});
