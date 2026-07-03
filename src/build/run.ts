// ============================================================================
//  Run — launch a built target and force-quit it (build_launch B.5).
//
//  The companion to Build: launches the selected run target (Editor or the
//  project's GameLauncher) detached, with the user's optional launch options,
//  and tracks it so Stop can force-quit the whole process tree. Editor is
//  probed project-build-first (run what you just built), then the engine bin
//  for SDK-engine projects. Windows-focused, mirroring Build/Configure.
// ============================================================================

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { log } from "../log";
import { BuildOptions, RunTarget } from "./buildOptions";
import { O3deProject } from "../o3de/identity";
import { resolveProjectEngine } from "../o3de/discovery";
import { resolveWorkspaceProject } from "./projectResolve";
import { runArgsFor, projectRuntimeExe, gameLauncherExeName } from "./runCommand";
import * as runManager from "./runManager";

// ---- Runtime-exe resolution (project build first, then SDK engine) ---------
function resolveEditorExe(project: O3deProject, config: string): string {
  const candidates = [projectRuntimeExe(project.path, config, "Editor.exe")];
  const engine = resolveProjectEngine(project);
  if (engine) {
    candidates.push(
      path.join(engine.path, "bin", "Windows", config, "Default", "Editor.exe"),
      path.join(engine.path, "bin", "Windows", config, "Editor.exe"),
    );
  }
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0];
}

function resolveRunnable(project: O3deProject, target: RunTarget, config: string): string {
  return target === "Editor"
    ? resolveEditorExe(project, config)
    : projectRuntimeExe(project.path, config, gameLauncherExeName(project.projectName));
}

// ---- Command: Run ----------------------------------------------------------
export async function runProject(options: BuildOptions): Promise<void> {
  if (process.platform !== "win32") {
    void vscode.window.showInformationMessage("O3DE: Run currently targets Windows.");
    return;
  }

  const project = await resolveWorkspaceProject("O3DE: Run");
  if (!project) {
    return;
  }

  // One tracked run per project — offer to restart if it's already up.
  if (runManager.isRunning(project.path)) {
    const choice = await vscode.window.showWarningMessage(
      `${runManager.runningLabel(project.path)} is already running for ${project.projectName}.`,
      "Restart",
      "Cancel",
    );
    if (choice !== "Restart") {
      return;
    }
    await runManager.stop(project.path);
  }

  const target = options.runTarget;
  const exe = resolveRunnable(project, target, options.config);
  if (!fs.existsSync(exe)) {
    const choice = await vscode.window.showErrorMessage(
      `O3DE: ${path.basename(exe)} not found for config "${options.config}". Build the ${target} target first.`,
      "Build",
      "Cancel",
    );
    if (choice === "Build") {
      await vscode.commands.executeCommand("o3de.build");
    }
    return;
  }

  const args = runArgsFor(target, project.path, options.launchArgs);
  const label = `${target} (${project.projectName})`;
  log().info(`Running ${label}: ${exe} ${args.join(" ")}`);

  const pid = runManager.launch(project.path, exe, args, project.path, label);
  if (pid > 0) {
    void vscode.window.showInformationMessage(
      `O3DE: launched ${target} (pid ${pid}). Use Stop to force-quit it and its child processes.`,
    );
  } else {
    void vscode.window.showErrorMessage(`O3DE: failed to launch ${target} (see the O3DE log).`);
  }
}

// ---- Command: Stop (force-quit) --------------------------------------------
export async function stopRun(): Promise<void> {
  const project = await resolveWorkspaceProject("O3DE: Stop");
  if (!project) {
    return;
  }

  // Tracked run → force-quit its whole tree (kills the parallel helpers too).
  if (await runManager.stop(project.path)) {
    void vscode.window.showInformationMessage(
      `O3DE: force-quit the running app for ${project.projectName}.`,
    );
    return;
  }

  // Nothing tracked — offer an orphan sweep by image name (covers apps we didn't launch).
  const choice = await vscode.window.showWarningMessage(
    `No O3DE app is tracked for ${project.projectName}. Force-quit any running ` +
      "Editor / GameLauncher / AssetProcessor / ScriptCanvas?",
    { modal: true },
    "Force-Quit All",
  );
  if (choice !== "Force-Quit All") {
    return;
  }
  const images = [
    "Editor.exe",
    gameLauncherExeName(project.projectName),
    "AssetProcessor.exe",
    "ScriptCanvasApplication.exe",
  ];
  for (const image of images) {
    await runManager.killByName(image);
  }
  void vscode.window.showInformationMessage("O3DE: swept O3DE runtime processes.");
}
