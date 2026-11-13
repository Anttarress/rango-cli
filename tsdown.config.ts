import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/bin/rango.ts"],
  outDir: "dist",
  format: "esm",
  target: "node20",
  platform: "node",
  clean: true,
  sourcemap: false,
  dts: false,
  // One self-contained file: commander is bundled, Node builtins stay external.
  outExtensions: () => ({ js: ".js" }),
  outputOptions: {
    banner: "#!/usr/bin/env node",
  },
});
