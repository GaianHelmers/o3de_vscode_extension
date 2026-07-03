// ============================================================================
//  Workspace-folder helpers — resolve `${workspaceFolder:…}` references.
//
//  Shared by the IntelliSense remap and the launch.json generator so both refer
//  to the same folders the same way. The `${workspaceFolder:<name>}` form is
//  confirmed working in the user's real multi-root configs.
// ============================================================================

import * as vscode from "vscode";
import { normalizePath } from "../intellisense/paths";

export interface FolderRef {
  path: string;
  name: string;
  ref: string; // "${workspaceFolder:<name>}"
}

/** `${workspaceFolder}` for the project folder itself, else `${workspaceFolder:<name>}`. */
export function folderRef(folderPath: string, folderName: string, projectPath: string): string {
  return normalizePath(folderPath) === normalizePath(projectPath)
    ? "${workspaceFolder}"
    : `\${workspaceFolder:${folderName}}`;
}

/** The workspace's source-engine folder ("Engine (source): …") — the F12 / natvis target. */
export function sourceEngineFolder(): FolderRef | undefined {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (folder.name.startsWith("Engine (source):")) {
      return { path: folder.uri.fsPath, name: folder.name, ref: `\${workspaceFolder:${folder.name}}` };
    }
  }
  return undefined;
}

/** The workspace folder whose root contains `absPath`, if any (build-engine → folder ref). */
export function workspaceFolderForPath(absPath: string): FolderRef | undefined {
  const target = normalizePath(absPath).toLowerCase();
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const root = normalizePath(folder.uri.fsPath).replace(/\/+$/, "").toLowerCase();
    if (target === root || target.startsWith(`${root}/`)) {
      return { path: folder.uri.fsPath, name: folder.name, ref: `\${workspaceFolder:${folder.name}}` };
    }
  }
  return undefined;
}
