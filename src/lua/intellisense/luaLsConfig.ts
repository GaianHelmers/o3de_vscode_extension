// ============================================================================
//  LuaLS workspace wiring — write the generated stubs and point sumneko at them.
//
//  We orchestrate the existing Lua language server (sumneko.lua) rather than
//  reinventing it: write the reflected-API stub file, then merge the minimal
//  Lua.* settings into <project>/.vscode/settings.json (comment-preserving, never
//  clobbering the user's other settings) so completion lights up.
// ============================================================================

import * as fs from "fs/promises";
import * as path from "path";
import { applyEdits, modify, parse } from "jsonc-parser";
import { log } from "../../log";

const STUB_DIRNAME = "o3de-lua-stubs";
const STUB_FILENAME = "o3de_api.lua";

export interface LuaIntelliSenseResult {
  stubPath: string;
  settingsPath: string;
}

/** Write the stub file and merge LuaLS settings into the project's .vscode. */
export async function applyLuaIntelliSense(projectPath: string, luaText: string): Promise<LuaIntelliSenseResult> {
  const vscodeDir = path.join(projectPath, ".vscode");
  const stubDir = path.join(vscodeDir, STUB_DIRNAME);
  const stubPath = path.join(stubDir, STUB_FILENAME);
  const settingsPath = path.join(vscodeDir, "settings.json");

  await fs.mkdir(stubDir, { recursive: true });
  await fs.writeFile(stubPath, luaText, "utf8");
  log().info(`Wrote Lua API stubs to ${stubPath}`);

  await mergeLuaSettings(settingsPath, stubDir, Buffer.byteLength(luaText, "utf8"));
  log().info(`Configured LuaLS in ${settingsPath}`);

  return { stubPath, settingsPath };
}

// Merge our keys into settings.json without disturbing the rest. Library paths
// are workspace-relative (`${workspaceFolder}/…`) so the config is portable.
async function mergeLuaSettings(settingsPath: string, stubDir: string, stubBytes: number): Promise<void> {
  let text = "";
  try {
    text = await fs.readFile(settingsPath, "utf8");
  } catch {
    text = "{}";
  }
  if (text.trim() === "") {
    text = "{}";
  }

  const current = (parse(text) as Record<string, unknown>) ?? {};
  const projectRoot = path.dirname(path.dirname(stubDir)); // .../.vscode/o3de-lua-stubs → project
  const relStub = path.relative(projectRoot, stubDir).split(path.sep).join("/");
  const libEntry = `\${workspaceFolder}/${relStub}`;

  // Preserve any libraries the user already configured; add ours once.
  const existingLibrary = Array.isArray(current["Lua.workspace.library"])
    ? (current["Lua.workspace.library"] as unknown[]).map(String)
    : [];
  const library = existingLibrary.includes(libEntry) ? existingLibrary : [...existingLibrary, libEntry];

  // LuaLS SKIPS any file bigger than Lua.workspace.preloadFileSize (KB, default
  // 500). The reflected-API stub is far larger (megabytes), so with the default
  // it is silently never loaded and NONE of the O3DE symbols complete. Raise the
  // limit to comfortably cover the stub (never lowering a bigger user value).
  const neededKB = Math.ceil(stubBytes / 1024) + 2000; // stub + margin
  const existingPreload = typeof current["Lua.workspace.preloadFileSize"] === "number"
    ? (current["Lua.workspace.preloadFileSize"] as number)
    : 0;
  const preloadFileSize = Math.max(neededKB, existingPreload);

  // Nested JSON pointer paths so we don't clobber sibling settings. The [lua]
  // scope turns OFF word-based suggestions in .lua files, so completions come
  // only from the Lua language server — no C++ symbols (e.g. AZ_Printf) leaking
  // in from open engine source files.
  const edits: [string[], unknown][] = [
    [["Lua.runtime.version"], "Lua 5.4"],
    [["Lua.workspace.library"], library],
    [["Lua.workspace.checkThirdParty"], false],
    [["Lua.workspace.preloadFileSize"], preloadFileSize],
    // Accepting a function completion inserts the call with its parentheses and
    // argument placeholders (cursor lands inside), not just the bare name.
    [["Lua.completion.callSnippet"], "Replace"],
    [["[lua]", "editor.wordBasedSuggestions"], "off"],
  ];

  const formatting = { insertSpaces: true, tabSize: 2 };
  for (const [pointer, value] of edits) {
    text = applyEdits(text, modify(text, pointer, value, { formattingOptions: formatting }));
  }

  await fs.writeFile(settingsPath, text, "utf8");
}
