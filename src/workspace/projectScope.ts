// ============================================================================
//  Project scope — per-project opt-in gate for O3DE Tools.
//
//  The extension activates in EVERY window (onStartupFinished), so it must decide
//  per workspace whether to run its automatic machinery at all. A non-O3DE
//  workspace (e.g. web development) stays fully dormant. An O3DE workspace runs
//  only when the user has opted this project in via `o3de.enabled`, stored per
//  folder in <project>/.vscode/settings.json.
//
//  vscode-dependent, except `resolveEnableState` which is pure and unit-tested.
// ============================================================================

import * as vscode from "vscode";
import { readProject } from "../o3de/identity";
import { readEngine } from "../o3de/identity";

// ---- Three-state enable resolution (pure) ----------------------------------
// `o3de.enabled` defaults to false, so a plain get() cannot tell "never opted in"
// from "explicitly disabled". We inspect the explicit per-folder/workspace value:
//   undefined -> UNDECIDED (prompt), true -> ENABLED (run), false -> NEVER (dormant).
export type EnableState = "enabled" | "never" | "undecided";

export function resolveEnableState(explicit: boolean | undefined): EnableState {
  if (explicit === undefined) {
    return "undecided";
  }
  return explicit ? "enabled" : "never";
}

// ---- O3DE workspace detection ----------------------------------------------
/** An O3DE workspace has at least one folder that is a project or an engine. */
export function isO3deWorkspace(): boolean {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (readProject(folder.uri.fsPath) || readEngine(folder.uri.fsPath)) {
      return true;
    }
  }
  return false;
}

/** Workspace folders that are O3DE projects (have a project.json). */
export function o3deProjectFolders(): vscode.WorkspaceFolder[] {
  return (vscode.workspace.workspaceFolders ?? []).filter((folder) => readProject(folder.uri.fsPath));
}

/** The folder the opt-in applies to: the first project folder, else the first engine folder. */
export function primaryO3deFolder(): vscode.WorkspaceFolder | undefined {
  const projects = o3deProjectFolders();
  if (projects.length > 0) {
    return projects[0];
  }
  return (vscode.workspace.workspaceFolders ?? []).find((folder) => readEngine(folder.uri.fsPath));
}

// ---- Enable flag (read/write, folder-scoped) -------------------------------
/** The explicit `o3de.enabled` set for a folder (folder value, else workspace value). */
export function enableStateForFolder(folder: vscode.WorkspaceFolder): EnableState {
  const inspected = vscode.workspace.getConfiguration("o3de", folder.uri).inspect<boolean>("enabled");
  const explicit = inspected?.workspaceFolderValue ?? inspected?.workspaceValue;
  return resolveEnableState(explicit);
}

/** Is O3DE Tools enabled for this workspace? True when any O3DE folder is opted in. */
export function isWorkspaceEnabled(): boolean {
  const folder = primaryO3deFolder();
  return folder ? enableStateForFolder(folder) === "enabled" : false;
}

/** Persist the opt-in for a folder into its .vscode/settings.json. */
export async function setProjectEnabled(folder: vscode.WorkspaceFolder, enabled: boolean): Promise<void> {
  await vscode.workspace
    .getConfiguration("o3de", folder.uri)
    .update("enabled", enabled, vscode.ConfigurationTarget.WorkspaceFolder);
}
