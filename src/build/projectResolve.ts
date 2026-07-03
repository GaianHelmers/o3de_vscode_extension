// ============================================================================
//  Project resolution — pick the O3DE project a build command acts on.
//
//  Shared by the build commands (Configure / Build / Write Config): resolve the
//  project from the open workspace folders, prompting only when several exist.
// ============================================================================

import * as vscode from "vscode";
import { readProject, O3deProject } from "../o3de/identity";

/** Resolve the O3DE project from the open workspace; prompt if there are several. */
export async function resolveWorkspaceProject(title: string): Promise<O3deProject | undefined> {
  const found: O3deProject[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const proj = readProject(folder.uri.fsPath);
    if (proj) {
      found.push(proj);
    }
  }
  if (found.length === 0) {
    void vscode.window.showErrorMessage(
      "No O3DE project in this workspace. Open a project folder, or run “O3DE: Set Up Workspace…” first.",
    );
    return undefined;
  }
  if (found.length === 1) {
    return found[0];
  }
  const pick = await vscode.window.showQuickPick(
    found.map((proj) => ({ label: proj.projectName, description: proj.path, project: proj })),
    { title, placeHolder: "Which project?" },
  );
  return pick?.project;
}
