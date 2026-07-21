// ============================================================================
//  O3DE discovery — ties the manifest + identity files together.
//
//  Enumerates registered engines / projects / gems (from the manifest, reading
//  each marker file), classifies engines source-vs-prebuilt, and resolves the
//  engine a project targets. vscode-free; consumed by the setup wizard (A.2).
// ============================================================================

import * as path from "path";
import { readManifest } from "./manifest";
import {
  O3deEngine,
  O3deGem,
  O3deProject,
  readEngine,
  readGem,
  readProject,
} from "./identity";

// ---- Engines ---------------------------------------------------------------
export function discoverEngines(): O3deEngine[] {
  const manifest = readManifest();
  if (!manifest) {
    return [];
  }
  return manifest.engines
    .map((enginePath) => readEngine(enginePath))
    .filter((engine): engine is O3deEngine => engine !== undefined);
}

/** Engines that carry source (exclude prebuilt SDK engines — no "source vision"). */
export function discoverSourceEngines(): O3deEngine[] {
  return discoverEngines().filter((engine) => !engine.isSdkEngine);
}

// ---- Projects --------------------------------------------------------------
export function discoverProjects(): O3deProject[] {
  const manifest = readManifest();
  if (!manifest) {
    return [];
  }
  return manifest.projects
    .map((projectPath) => readProject(projectPath))
    .filter((project): project is O3deProject => project !== undefined);
}

// ---- Gems ------------------------------------------------------------------
export function discoverGems(): O3deGem[] {
  const manifest = readManifest();
  if (!manifest) {
    return [];
  }
  return manifest.gems
    .map((gemPath) => readGem(gemPath))
    .filter((gem): gem is O3deGem => gem !== undefined);
}

/**
 * The built-in gems of the registered engine(s): each engine.json lists its gem
 * dirs in `external_subdirectories` (relative to the engine root). These are NOT
 * in the user manifest, so they only surface here. There are ~100+ per engine.
 */
export function discoverEngineGems(): O3deGem[] {
  const gems: O3deGem[] = [];
  const seen = new Set<string>();
  for (const engine of discoverEngines()) {
    for (const sub of engine.externalSubdirectories) {
      const dir = path.isAbsolute(sub) ? sub : path.join(engine.path, sub);
      const key = path.resolve(dir);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const gem = readGem(dir);
      if (gem) {
        gems.push(gem);
      }
    }
  }
  return gems;
}

// ---- Project → engine resolution -------------------------------------------
/**
 * Resolve the engine a project targets: project.json `engine` (a NAME) →
 * manifest `engines_path` → the engine's marker file. Enables auto-suggesting
 * a project's engine source in the wizard.
 */
export function resolveProjectEngine(project: O3deProject): O3deEngine | undefined {
  if (!project.engine) {
    return undefined;
  }
  const manifest = readManifest();
  const enginePath = manifest?.enginesByName[project.engine];
  return enginePath ? readEngine(enginePath) : undefined;
}
