// ============================================================================
//  Consolidation (pure) — the "one source" data layer the user asked for.
//
//  Unions include paths + defines across ALL targets in a config into a single
//  browse-everything set (deduped, normalized, stable order). Coarser than
//  per-file, but it makes every AZ type / engine header resolve for completion
//  and navigation. Per-file precision is the later live provider.
// ============================================================================

import { IncludeEntry, TargetCompile } from "./fileApi";
import { normalizePath } from "./paths";

export interface ConsolidatedCompile {
  includes: IncludeEntry[]; // normalized paths, deduped, first-seen order
  defines: string[]; // deduped, first-seen order
  standard?: string; // first C++ standard seen
}

/** Union + dedupe the per-target compile data into one consolidated set. */
export function consolidateTargets(targets: TargetCompile[]): ConsolidatedCompile {
  const includes: IncludeEntry[] = [];
  const seenInclude = new Set<string>();
  const defines: string[] = [];
  const seenDefine = new Set<string>();
  let standard: string | undefined;

  for (const target of targets) {
    for (const inc of target.includes) {
      const normalized = normalizePath(inc.path);
      const key = normalized.toLowerCase();
      if (!seenInclude.has(key)) {
        seenInclude.add(key);
        includes.push({ path: normalized, isSystem: inc.isSystem });
      }
    }
    for (const def of target.defines) {
      if (!seenDefine.has(def)) {
        seenDefine.add(def);
        defines.push(def);
      }
    }
    if (!standard && target.standard) {
      standard = target.standard;
    }
  }
  return { includes, defines, standard };
}
