// ============================================================================
//  O3DE project-root discovery for Lua tooling.
//
//  A Lua script's breakpoint module path is relative to its project (scan folder)
//  root, so the debugger needs to know which project a file belongs to. We find
//  it by walking up from the file to the nearest project.json, falling back to a
//  workspace folder that contains one.
// ============================================================================

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

/** Walk up from a file/dir to the nearest directory containing project.json. */
export function findProjectRoot(startPath: string): string | undefined {
  let dir = fs.existsSync(startPath) && fs.statSync(startPath).isDirectory() ? startPath : path.dirname(startPath);
  while (true) {
    // O3DE keeps a shadow "user/project.json" inside the project; that folder is
    // not the real project root — skip it and keep walking up to the true one.
    const base = path.basename(dir).toLowerCase();
    const isShadow = base === "user" || base === "cache" || base === "build";
    if (!isShadow && fs.existsSync(path.join(dir, "project.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/** Best-effort project root: from the active editor, else any workspace folder. */
export function detectProjectRoot(): string | undefined {
  const active = vscode.window.activeTextEditor?.document.uri.fsPath;
  if (active) {
    const fromFile = findProjectRoot(active);
    if (fromFile) {
      return fromFile;
    }
  }
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const fromFolder = findProjectRoot(folder.uri.fsPath);
    if (fromFolder) {
      return fromFolder;
    }
  }
  return undefined;
}
