// ============================================================================
//  Build command — pure helpers (vscode-free, unit-tested).
//
//  The shape of the `cmake --build` invocation and the small string helpers the
//  target picker + tooling view need. Kept free of vscode / I/O so it can be
//  exercised directly by unit tests. The command itself (terminal, MSVC
//  environment, process-guard) lives in build.ts; the picker in selectTargets.ts.
// ============================================================================

// ---- Build command line ----------------------------------------------------
export interface BuildInputs {
  buildDir: string; // <project>/build/<platform>
  config: string; // profile | debug | release
  targets: string[]; // CMake target names; empty = build everything (no --target)
}

/**
 * The argv for the O3DE build:
 *   cmake --build <buildDir> --target <T…> --config <config>
 * Mirrors the user's .bat (`--target Editor --config profile`). With no targets,
 * `--target` is omitted so CMake builds the default `all` target (build everything).
 */
export function buildBuildArgs(inputs: BuildInputs): string[] {
  const argv = ["cmake", "--build", inputs.buildDir];
  if (inputs.targets.length > 0) {
    argv.push("--target", ...inputs.targets);
  }
  argv.push("--config", inputs.config);
  return argv;
}

// ---- Curated targets -------------------------------------------------------
/** The two targets every O3DE project has, pinned to the top of the picker. */
export function curatedTargets(projectName: string): string[] {
  return ["Editor", `${projectName}.GameLauncher`];
}

// ---- Display ---------------------------------------------------------------
/** How the current target selection reads in the tree (empty = "All targets"). */
export function targetsLabel(targets: string[]): string {
  if (targets.length === 0) {
    return "All targets";
  }
  if (targets.length <= 3) {
    return targets.join(", ");
  }
  return `${targets.slice(0, 2).join(", ")} +${targets.length - 2} more`;
}

// ---- Free-text parsing -----------------------------------------------------
/** Split a user-typed custom-target string on commas / whitespace, dropping blanks. */
export function parseCustomTargets(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
