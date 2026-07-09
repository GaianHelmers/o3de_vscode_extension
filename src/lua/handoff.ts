// ============================================================================
//  Editor handoff — make VS Code the target of O3DE's "Open Lua Editor".
//
//  Two uninvasive, file/registry-based hooks (no engine changes):
//    - Settings Registry key /O3DE/Lua/Debugger/Uri makes the Editor's Tools ▸
//      Lua Editor action and the Script component's Edit button dispatch to a
//      vscode:// URI (with projectPath / enginePath / files[]) instead of
//      spawning LuaIDE.exe. We register a UriHandler to receive it.
//    - We write that key as a .setreg into the project so the redirect is
//      picked up on the Editor's next launch.
//
//  Engine truth: Code/Editor/CryEdit.cpp OpenLUAEditor / OpenExternalLuaDebugger,
//  key at CryEdit.h:327.
// ============================================================================

import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { log } from "../log";
import { detectProjectRoot } from "./projectPaths";
import { LUA_DEBUG_TYPE } from "./debug/debugAdapter";
import { openDefaultLuaScript, newLuaScript } from "./newScript";
import { LUA_PALETTE_VIEW_ID } from "./palette/luaPaletteProvider";

const LUA_DEBUGGER_URI_KEY = "/O3DE/Lua/Debugger/Uri";

// ---- URI handler (Editor → VS Code) ----------------------------------------

class LuaEditorUriHandler implements vscode.UriHandler {
  async handleUri(uri: vscode.Uri): Promise<void> {
    // Expected: <scheme>://<publisher>.<ext>/lua?projectPath=..&enginePath=..&files[]=..
    const params = new URLSearchParams(uri.query);
    const projectPath = params.get("projectPath") ?? undefined;
    // Editor passes repeated files[]=; be tolerant of files= too.
    const files = [...params.getAll("files[]"), ...params.getAll("files")].filter((f) => f.length > 0);

    log().show(true); // make it obvious the handoff fired
    log().info(`Lua handoff: O3DE requested the Lua editor — ${files.length} file(s), project=${projectPath ?? "?"}`);

    // Case 1: the Editor gave us specific script(s) — open them.
    let firstDoc: vscode.TextDocument | undefined;
    for (const file of files) {
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        await vscode.window.showTextDocument(doc, { preview: false });
        firstDoc = firstDoc ?? doc;
      } catch (err) {
        log().error(`Lua handoff: failed to open ${file}: ${(err as Error).message}`);
      }
    }

    // Pop open the function palette alongside the script (like LuaIDE's reference panel).
    void vscode.commands.executeCommand(`${LUA_PALETTE_VIEW_ID}.focus`);

    if (firstDoc) {
      const choice = await vscode.window.showInformationMessage(
        `O3DE opened ${path.basename(firstDoc.uri.fsPath)} in VS Code.`,
        "Debug",
        "Just Edit",
      );
      if (choice === "Debug" && projectPath) {
        await vscode.debug.startDebugging(vscode.workspace.getWorkspaceFolder(firstDoc.uri), {
          type: LUA_DEBUG_TYPE,
          request: "attach",
          name: "O3DE: Debug Lua",
          projectPath,
        });
      }
      return;
    }

    // Case 2: no file (e.g. empty Script component, or Tools ▸ Lua Editor) — stage
    // a fresh, unsaved Lua buffer with the default template. The user saves (and
    // picks a location) when ready; we never write a file to a predetermined place.
    await openDefaultLuaScript();
    void vscode.window.setStatusBarMessage("O3DE: new Lua script — save when ready to choose its location.", 6000);
  }
}

// ---- Register command (write the .setreg) ----------------------------------

async function registerAsLuaEditor(extensionId: string): Promise<void> {
  const projectRoot = detectProjectRoot();
  if (!projectRoot) {
    void vscode.window.showErrorMessage(
      "O3DE: could not find a project.json. Open your O3DE project folder first.",
    );
    return;
  }

  const scope = await vscode.window.showQuickPick(
    [
      { label: "This project (per-user)", detail: `${projectRoot}\\user\\Registry — not committed`, dir: path.join(projectRoot, "user", "Registry") },
      { label: "This project (shared)", detail: `${projectRoot}\\Registry — committed for the team`, dir: path.join(projectRoot, "Registry") },
    ],
    { title: "Register VS Code as O3DE's Lua editor", placeHolder: "Where should the setting be written?" },
  );
  if (!scope) {
    return;
  }

  // Use the running app's scheme (vscode / vscode-insiders / cursor …).
  const uri = `${vscode.env.uriScheme}://${extensionId}/lua`;
  const content = JSON.stringify(
    { O3DE: { Lua: { Debugger: { Uri: uri } } } },
    null,
    4,
  );
  const filePath = path.join(scope.dir, "vscode_lua_editor.setreg");

  try {
    await fs.mkdir(scope.dir, { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
    log().info(`Lua handoff: wrote ${LUA_DEBUGGER_URI_KEY} = ${uri} to ${filePath}`);
    void vscode.window.showInformationMessage(
      `VS Code registered as O3DE's Lua editor. Restart the O3DE Editor for it to take effect.`,
    );
  } catch (err) {
    void vscode.window.showErrorMessage(`Failed to write ${filePath}: ${(err as Error).message}`);
  }
}

// ---- Public wiring ---------------------------------------------------------

export function registerLuaHandoff(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerUriHandler(new LuaEditorUriHandler()),
    vscode.commands.registerCommand("o3de.registerAsLuaEditor", () =>
      registerAsLuaEditor(context.extension.id),
    ),
    vscode.commands.registerCommand("o3de.newLuaScript", () => newLuaScript()),
  );
}
