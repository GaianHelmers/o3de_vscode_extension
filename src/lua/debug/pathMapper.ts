// ============================================================================
//  Path mapping: VS Code file paths ⇆ O3DE Lua module ("debug name") strings.
//
//  O3DE compiles a script's chunk name as  "@" + lowercase(scan-folder-relative
//  source path, forward slashes)  (LuaBuilderWorker.cpp). Breakpoints are matched
//  by substring on that name, so sending the source ".lua" form matches whether
//  the running chunk is source or ".luac".
//
//  We treat the project root as the scan folder — correct for project-local
//  scripts (the common case). Scripts served from gems use different scan folders
//  and are out of scope for this pass.
// ============================================================================

import * as path from "path";

/** Absolute VS Code file → "@scripts/foo.lua" module string. */
export function moduleFromLocal(absPath: string, projectRoot: string): string {
  const rel = path.relative(projectRoot, absPath);
  const posix = rel.split(path.sep).join("/").toLowerCase();
  return `@${posix}`;
}

/** "@scripts/foo.luac" (or .lua) module string → absolute VS Code file path. */
export function localFromModule(module: string, projectRoot: string): string {
  let rel = module.startsWith("@") ? module.slice(1) : module;
  if (rel.endsWith(".luac")) {
    rel = rel.slice(0, -1); // .luac → .lua
  }
  return path.join(projectRoot, rel);
}

/** Comparison key: strip "@", lowercase, normalize .luac → .lua. */
export function moduleKey(module: string): string {
  let m = module.toLowerCase();
  if (m.startsWith("@")) {
    m = m.slice(1);
  }
  if (m.endsWith(".luac")) {
    m = m.slice(0, -1);
  }
  return m;
}
