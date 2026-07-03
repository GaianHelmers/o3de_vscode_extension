// ============================================================================
//  .code-workspace content builder (pure).
//
//  Assembles the THIN multi-root workspace: the PROJECT folder first, then any
//  supporting folders (engine source(s), gems, and user-chosen CUSTOM folders)
//  in the order the wizard supplies them. Names are decided by the caller so
//  custom folders keep the user's own label (e.g. "Gems"). Real config lives in
//  <project>/.vscode/ (slice A.3) — this file just lists folders.
// ============================================================================

import * as path from "path";

export interface FolderRef {
  name: string;
  path: string;
}

export interface CodeWorkspace {
  folders: FolderRef[];
  settings: Record<string, unknown>;
}

export interface NamedPath {
  name: string;
  path: string;
}

// ---- Ordering: Project → gems/custom → Engine source ----------------------
function folderRank(name: string): number {
  if (name.startsWith("Project:")) {
    return 0;
  }
  if (name.startsWith("Engine (source):")) {
    return 2;
  }
  return 1; // gems + custom folders sit between the project and the engine source
}

/** Stable-order folders: project first, engine source(s) last, everything else between. */
export function orderWorkspaceFolders<T extends { name: string }>(folders: T[]): T[] {
  return folders
    .map((folder, index) => ({ folder, index }))
    .sort((a, b) => folderRank(a.folder.name) - folderRank(b.folder.name) || a.index - b.index)
    .map((entry) => entry.folder);
}

// ---- Build ----------------------------------------------------------------
/** Project + supporting folders, ordered Project → gems/custom → Engine source. */
export function buildWorkspaceFileContent(
  project: { projectName: string; path: string },
  supportingFolders: NamedPath[],
): CodeWorkspace {
  const folders: FolderRef[] = orderWorkspaceFolders([
    { name: `Project: ${project.projectName}`, path: project.path },
    ...supportingFolders.map((folder) => ({ name: folder.name, path: folder.path })),
  ]);
  // Config anchors in <project>/.vscode/ (A.3); keep the workspace file thin.
  return { folders, settings: {} };
}

/** Default workspace-file location: <project>/.vscode/<projectName>.code-workspace
 *  (kept in .vscode/ alongside the config, for VS-Code-centric editing). Folder
 *  entries use absolute paths, so the file's location doesn't affect resolution. */
export function defaultWorkspaceFilePath(project: { projectName: string; path: string }): string {
  return path.join(project.path, ".vscode", `${project.projectName}.code-workspace`);
}
