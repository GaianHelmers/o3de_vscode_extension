// ============================================================================
//  Build-engine root detection (vscode-free).
//
//  The engine a project builds against — the root the File API's engine include
//  paths sit under, and the prefix we remap to the workspace source engine.
//  Shared by the c_cpp_properties emitter and the live configuration provider.
// ============================================================================

import { O3deProject } from "../o3de/identity";
import { resolveProjectEngine, discoverEngines } from "../o3de/discovery";
import { isUnderRoot, normalizePath } from "./paths";

/** project.json `engine` (via manifest), else the registered engine the includes sit under. */
export function detectBuildEngineRoot(project: O3deProject, includePaths: string[]): string | undefined {
  const engine = resolveProjectEngine(project);
  if (engine) {
    return normalizePath(engine.path);
  }
  for (const candidate of discoverEngines()) {
    if (includePaths.some((p) => isUnderRoot(p, candidate.path))) {
      return normalizePath(candidate.path);
    }
  }
  return undefined;
}
