// ============================================================================
//  esbuild bundler for the extension.
//  - Bundles src/extension.ts -> dist/extension.js as CommonJS for Node.
//  - `vscode` is marked external (provided by the VS Code runtime).
//  - --watch for incremental rebuilds, --production for a minified bundle.
// ============================================================================

const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

// ---- Problem-matcher plugin: prints build boundaries + errors -------------
/** @type {import('esbuild').Plugin} */
const problemMatcherPlugin = {
  name: "problem-matcher",
  setup(build) {
    build.onStart(() => console.log("[esbuild] build started"));
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}`);
        }
      }
      console.log("[esbuild] build finished");
    });
  },
};

// ---- Build / watch entry point --------------------------------------------
async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    outfile: "dist/extension.js",
    external: ["vscode"],
    // Prefer ESM entry points so deps like jsonc-parser bundle fully
    // (their CJS/UMD builds can leave dangling internal requires).
    mainFields: ["module", "main"],
    sourcemap: !production,
    minify: production,
    sourcesContent: false,
    logLevel: "silent",
    plugins: [problemMatcherPlugin],
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
