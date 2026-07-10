// ============================================================================
//  Build — run `cmake --build` for the selected target(s) (build_launch B.3).
//
//  Replaces the user's build .bats natively:
//    MSVC env (vcvars64) → process-guard (locked gem DLLs) →
//    cmake --build build/<platform> --target <selected…> --config <config>
//  The target(s) and config come from BuildOptions (shown/edited in the O3DE tab).
//  Runs in a visible terminal (long + verbose, like the .bat) and requires the
//  project to be configured first (CMake refuses to build an unconfigured tree).
// ============================================================================

import * as vscode from "vscode";
import { log } from "../log";
import { freshTerminal } from "./terminals";
import { ensureVisualStudio } from "../env/visualStudioGuard";
import { captureMsvcEnvironmentDelta } from "../env/msvcEnvironment";
import { BuildOptions } from "./buildOptions";
import { resolveWorkspaceProject } from "./projectResolve";
import { projectBuildDir, formatCommand } from "./configureCommand";
import { buildBuildArgs, targetsLabel } from "./buildCommand";
import { isConfiguredFor, configureProject } from "./configure";
import { guardEditorProcesses } from "./processGuard";

// ---- Command ---------------------------------------------------------------
export async function buildProject(options: BuildOptions): Promise<void> {
  if (process.platform !== "win32") {
    void vscode.window.showInformationMessage("O3DE: Build currently targets Windows (MSVC).");
    return;
  }

  const project = await resolveWorkspaceProject("O3DE: Build");
  if (!project) {
    return;
  }

  const vs = await ensureVisualStudio({ interactive: false });
  if (!vs?.vcvars64Path) {
    log().error("Build aborted — no usable Visual Studio (vcvars64.bat).");
    void vscode.window.showErrorMessage("O3DE: Build needs Visual Studio (MSVC). See the O3DE log.");
    return;
  }

  // The tree must already be configured (with the selected generator) — CMake can't
  // build otherwise, and File API / targets come from that configure. Offer to run it.
  if (!isConfiguredFor(project, options.generator)) {
    const choice = await vscode.window.showWarningMessage(
      `${project.projectName} isn't configured for "${options.generator}". Configure first, ` +
        "then run Build again once it finishes.",
      "Configure Now",
      "Cancel",
    );
    if (choice === "Configure Now") {
      await configureProject(options);
    }
    return;
  }

  // Process-guard: a running Editor/ScriptCanvas locks gem DLLs → link fails mid-build.
  if (!(await guardEditorProcesses())) {
    log().info("Build cancelled by the process-guard.");
    return;
  }

  const buildDir = projectBuildDir(project.path);
  const command = formatCommand(
    buildBuildArgs({ buildDir, config: options.config, targets: options.targets, coreCount: options.coreCount }),
  );

  // MSVC environment (equivalent to `call vcvars64.bat`) applied to the terminal.
  let env: Record<string, string>;
  try {
    env = await captureMsvcEnvironmentDelta(vs.vcvars64Path);
  } catch (err) {
    const e = err as { message?: string };
    log().error(`Failed to establish MSVC environment: ${e.message ?? String(err)}`);
    void vscode.window.showErrorMessage(
      "O3DE: failed to establish the Visual Studio environment (see the O3DE log).",
    );
    return;
  }

  log().info(
    `Building ${project.projectName} — targets=[${targetsLabel(options.targets)}], config=${options.config}`,
  );
  log().info(`  ${command}`);
  const terminal = freshTerminal("O3DE Build", env);
  terminal.show();
  terminal.sendText(command);
}
