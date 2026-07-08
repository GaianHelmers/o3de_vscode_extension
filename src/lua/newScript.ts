// ============================================================================
//  New Lua script — create a boilerplate O3DE component script.
//
//  Mirrors the "Lua Component Script" template the O3DE Asset Browser offers
//  (LuaEditorSystemComponent.cpp): a table with Properties + OnActivate /
//  OnDeactivate, returned at the end.
// ============================================================================

import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { log } from "../log";
import { detectProjectRoot } from "./projectPaths";

function boilerplate(scriptName: string): string {
  return `local ${scriptName} = {
    Properties = {
        -- Add reflected properties here, e.g.:
        -- Speed = { default = 1.0, description = "Movement speed" },
    },
}

function ${scriptName}:OnActivate()
end

function ${scriptName}:OnDeactivate()
end

return ${scriptName}
`;
}

/** Prompt for a name/location, write the boilerplate, and open it. */
export async function createNewLuaScript(defaultDir?: string): Promise<vscode.Uri | undefined> {
  const projectRoot = detectProjectRoot();
  const baseDir =
    defaultDir ??
    (projectRoot ? path.join(projectRoot, "Scripts") : undefined) ??
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  if (!baseDir) {
    void vscode.window.showErrorMessage("O3DE: open a project folder before creating a Lua script.");
    return undefined;
  }

  const name = await vscode.window.showInputBox({
    title: "New O3DE Lua Script",
    prompt: `Script name (created in ${baseDir})`,
    placeHolder: "MyScript",
    validateInput: (v) => (/^[A-Za-z_]\w*$/.test(v) ? undefined : "Use a valid identifier (letters, digits, underscore)."),
  });
  if (!name) {
    return undefined;
  }

  const filePath = path.join(baseDir, `${name}.lua`);
  try {
    await fs.mkdir(baseDir, { recursive: true });
    try {
      await fs.access(filePath); // exists → just open it
    } catch {
      await fs.writeFile(filePath, boilerplate(name), "utf8");
      log().info(`Created Lua script ${filePath}`);
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await vscode.window.showTextDocument(doc, { preview: false });
    return doc.uri;
  } catch (err) {
    void vscode.window.showErrorMessage(`Failed to create ${filePath}: ${(err as Error).message}`);
    return undefined;
  }
}
