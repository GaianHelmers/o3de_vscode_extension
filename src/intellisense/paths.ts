// ============================================================================
//  Path helpers for the IntelliSense data layer (pure, vscode-free).
//
//  CMake File API paths are absolute, mixed-separator, and full of `.`/`..`
//  segments (e.g. `…/AzCore/.`, `…/AzGameFramework/..`). We normalize to clean
//  forward-slash paths, then do case-insensitive root matching (Windows) for the
//  engine/workspace remap.
// ============================================================================

import * as path from "path";

/** Forward-slash, `.`/`..`-collapsed form of a path. */
export function normalizePath(p: string): string {
  return path.posix.normalize(p.replace(/\\/g, "/"));
}

/** True if `p` is `root` or lives under it (segment-aware, case-insensitive). */
export function isUnderRoot(p: string, root: string): boolean {
  const a = normalizePath(p).toLowerCase();
  const b = normalizePath(root).replace(/\/+$/, "").toLowerCase();
  return a === b || a.startsWith(`${b}/`);
}

/** Replace the `root` prefix of `p` with `ref`, preserving the trailing segments. */
export function replaceRoot(p: string, root: string, ref: string): string {
  const np = normalizePath(p);
  const nroot = normalizePath(root).replace(/\/+$/, "");
  return `${ref}${np.slice(nroot.length)}`;
}

/** Dedupe strings, keeping first occurrence order. */
export function uniqueStable(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}
