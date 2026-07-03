// ============================================================================
//  Path remap (pure) — resolve includes to the workspace, not the build engine.
//
//  The File API roots engine includes at the BUILD engine (often a prebuilt SDK,
//  e.g. GS_Play_Engine). The user keeps a SOURCE engine in the workspace for
//  reading/editing; F12 must land there. So we rewrite the build-engine prefix
//  to the workspace source-engine reference, and relativize any other in-workspace
//  path to its `${workspaceFolder:…}` variable. Paths outside the workspace
//  (3rd-party packages) stay absolute. The engine layouts match (the vast
//  majority of source is identical), so the remapped sub-paths resolve.
// ============================================================================

import { IncludeEntry } from "./fileApi";
import { isUnderRoot, normalizePath, replaceRoot } from "./paths";

/** A prefix rewrite: any path under `fromRoot` becomes `toRef` + the remaining tail. */
export interface RootMapping {
  fromRoot: string; // absolute build-engine / workspace-folder path
  toRef: string; // e.g. "${workspaceFolder}" or "${workspaceFolder:Engine (source): o3de_sourcedev}"
  // Engine redirect only: verify the tail exists under this absolute base (the source engine)
  // before remapping. If it doesn't (e.g. a build-only generated dir like Azcg output), keep the
  // original absolute build path so those headers still resolve. `exists` is injected (fs at runtime).
  verifyBase?: string;
  exists?: (absPath: string) => boolean;
}

/** Rewrite one path through the first (longest-root) matching mapping; else normalized as-is. */
export function remapPath(p: string, mappings: RootMapping[]): string {
  const sorted = [...mappings].sort(
    (a, b) => normalizePath(b.fromRoot).length - normalizePath(a.fromRoot).length,
  );
  for (const mapping of sorted) {
    if (isUnderRoot(p, mapping.fromRoot)) {
      if (mapping.verifyBase && mapping.exists) {
        const inSource = replaceRoot(p, mapping.fromRoot, mapping.verifyBase);
        if (!mapping.exists(inSource)) {
          return normalizePath(p); // build-only (generated) → keep the build-engine path
        }
      }
      return replaceRoot(p, mapping.fromRoot, mapping.toRef);
    }
  }
  return normalizePath(p);
}

/** Remap a list of includes, preserving the system flag. */
export function remapIncludes(includes: IncludeEntry[], mappings: RootMapping[]): IncludeEntry[] {
  return includes.map((inc) => ({ path: remapPath(inc.path, mappings), isSystem: inc.isSystem }));
}
