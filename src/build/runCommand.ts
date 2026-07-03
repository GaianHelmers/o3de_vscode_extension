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

// ---- Runtime-exe paths -----------------------------------------------------
/** A built runtime exe in the project tree: <project>/build/<platform>/bin/<config>/<exe>. */
export function projectRuntimeExe(projectPath: string, config: string, exeName: string): string {
  return path.join(projectPath, "build", platformBuildDir(), "bin", config, exeName);
}

/** O3DE launcher naming: <Project>.GameLauncher.exe (matches the user's build output). */
export function gameLauncherExeName(projectName: string): string {
  return `${projectName}.GameLauncher.exe`;
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
