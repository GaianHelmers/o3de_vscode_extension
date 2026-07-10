// ============================================================================
//  SVG assets — load inline icon markup from media/icons/*.svg.
//
//  Webview buttons tint their icons via `stroke="currentColor"`/`fill="current
//  Color"`, which only works when the SVG is inlined into the DOM (an <img>/
//  background can't inherit the theme colour). So we keep the icons as real .svg
//  files but read their markup and splice it into the webview HTML.
// ============================================================================

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

/** Read media/icons/<name>.svg and return its markup (empty string if missing). */
export function loadIcon(extensionUri: vscode.Uri, name: string): string {
  try {
    return fs.readFileSync(path.join(extensionUri.fsPath, "media", "icons", `${name}.svg`), "utf8").trim();
  } catch {
    return "";
  }
}
