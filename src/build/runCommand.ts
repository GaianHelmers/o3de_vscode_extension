// ============================================================================
//  Run command — pure helpers (vscode-free, unit-tested).
//
//  Resolves the argv + runtime-exe paths for launching a built target and the
//  small display strings the Run section shows. The launch itself (detached
//  spawn, PID tracking, force-quit) lives in runManager.ts; the command flow
//  (project resolve, disk probe, prompts) in run.ts.
// ============================================================================

import * as path from "path";
import { platformBuildDir } from "./configureCommand";
import type { RunTarget } from "./buildOptions";
import type { O3deEngine } from "../o3de/identity";

// ---- Runtime-exe paths -----------------------------------------------------
/** A built runtime exe in the project tree: <project>/build/<platform>/bin/<config>/<exe>. */
export function projectRuntimeExe(projectPath: string, config: string, exeName: string): string {
  return path.join(projectPath, "build", platformBuildDir(), "bin", config, exeName);
}

/** O3DE launcher naming: <Project>.GameLauncher.exe (matches the user's build output). */
export function gameLauncherExeName(projectName: string): string {
  return `${projectName}.GameLauncher.exe`;
}

/**
 * Editor.exe candidate paths in priority order, keyed off the project's engine —
 * the single source of truth shared by Run (run.ts) and launch.json (launchGenerate.ts).
 *   - SDK (prebuilt) engine → the engine's own prebuilt Editor (Default/ then flat bin).
 *     The project build dir only holds copied DLLs + custom gems; its Editor.exe is a
 *     stale stub and must NOT be run (running it exits code 1).
 *   - source / custom / unresolved engine → the project's own built Editor.
 * Pure: the caller resolves the engine, then picks the first candidate that exists.
 * NOTE: engine bin is capital-"Windows" on disk; the project build dir is lowercase
 * (platformBuildDir) — do not "unify" the casing.
 */
export function editorExeCandidates(
  engine: O3deEngine | undefined,
  projectPath: string,
  config: string,
): string[] {
  if (engine?.isSdkEngine) {
    const engineBin = path.join(engine.path, "bin", "Windows", config);
    return [path.join(engineBin, "Default", "Editor.exe"), path.join(engineBin, "Editor.exe")];
  }
  return [projectRuntimeExe(projectPath, config, "Editor.exe")];
}

// ---- Launch args -----------------------------------------------------------
/** Split a launch-options string into argv, honoring double-quoted tokens. */
export function parseLaunchArgs(text: string): string[] {
  const out: string[] = [];
  const token = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(text)) !== null) {
    out.push(match[1] !== undefined ? match[1] : match[2]);
  }
  return out;
}

/**
 * Full argv for a run: the target's base args + the user's launch options.
 *   Editor       → ["--project-path", <project>] + <launchArgs>
 *   GameLauncher → <launchArgs>   (e.g. +LoadLevel DefaultLevel +r_displayInfo 1)
 */
export function runArgsFor(target: RunTarget, projectPath: string, launchArgs: string): string[] {
  const base = target === "Editor" ? ["--project-path", projectPath] : [];
  return [...base, ...parseLaunchArgs(launchArgs)];
}

// ---- Display ---------------------------------------------------------------
/** How the Run action reads in the tree: "Editor" or "GameLauncher · +LoadLevel …". */
export function runSummary(target: RunTarget, launchArgs: string): string {
  const args = launchArgs.trim();
  return args ? `${target} · ${args}` : target;
}

/** The Launch Options row's dimmed value ("(none)" when unset). */
export function launchArgsLabel(launchArgs: string): string {
  const args = launchArgs.trim();
  return args.length > 0 ? args : "(none)";
}
