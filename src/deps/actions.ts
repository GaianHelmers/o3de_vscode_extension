// ============================================================================
//  Guided actions — the acquisition layer. Executes a dependency's GuidedAction:
//  the fastest, most-automated way to get/enable the missing piece.
// ============================================================================

import * as vscode from "vscode";
import { log } from "../log";
import { GuidedAction } from "./registry";
import { discoverEngines } from "../o3de/discovery";
import { readProject } from "../o3de/identity";
import * as fs from "fs";
import * as path from "path";

export async function runGuidedAction(action: GuidedAction): Promise<void> {
  log().info(`Guided action: ${action.kind} ${action.payload}`);
  switch (action.kind) {
    case "command":
      await vscode.commands.executeCommand(action.payload);
      break;
    case "url":
      await vscode.env.openExternal(vscode.Uri.parse(action.payload));
      break;
    case "extension":
      await installExtension(action.payload);
      break;
    case "winget":
      installPackage(action.payload);
      break;
    case "longpaths":
      enableLongPaths();
      break;
    case "enableGem":
      enableGem(action.payload);
      break;
  }
}

// ---- VS Code extension install (fully automated) ---------------------------

async function installExtension(id: string): Promise<void> {
  try {
    await vscode.commands.executeCommand("workbench.extensions.installExtension", id);
    void vscode.window.showInformationMessage(`Installing "${id}" — reload if prompted.`);
  } catch {
    await vscode.env.openExternal(vscode.Uri.parse(`https://marketplace.visualstudio.com/items?itemName=${id}`));
  }
}

// ---- Package install (winget on Windows, native pkg mgr note elsewhere) -----

function installPackage(id: string): void {
  if (process.platform === "win32") {
    runInTerminal("O3DE: Install", `winget install -e --id ${id} --accept-package-agreements --accept-source-agreements`);
  } else {
    void vscode.window.showInformationMessage(
      `Install "${id}" with your platform's package manager (e.g. apt/dnf/pacman), then re-check.`,
    );
  }
}

// ---- Enable Windows long paths (needs elevation) ---------------------------

function enableLongPaths(): void {
  if (process.platform !== "win32") {
    return;
  }
  const psCommand =
    "New-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem' " +
    "-Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force; " +
    "Write-Host 'Long paths enabled. A reboot may be required.'";
  // Self-elevating: launches an admin PowerShell to write the HKLM key.
  runInTerminal(
    "O3DE: Enable Long Paths",
    `Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-Command',"${psCommand}"`,
  );
}

// ---- Enable an O3DE gem on the active project (via the o3de CLI) ------------

function enableGem(gemName: string): void {
  const folder = (vscode.workspace.workspaceFolders ?? []).find((f) => readProject(f.uri.fsPath));
  const o3de = o3deCliPath();
  if (!folder || !o3de) {
    void vscode.window.showInformationMessage(
      `Enable the "${gemName}" gem on your project (Project Manager → Gems, or 'o3de enable-gem -gn ${gemName}'), then re-check.`,
    );
    return;
  }
  runInTerminal("O3DE: Enable Gem", `& "${o3de}" enable-gem -gn ${gemName} -pp "${folder.uri.fsPath}"`);
}

// Best-effort locate the o3de CLI (scripts/o3de.bat|sh) from a registered engine.
function o3deCliPath(): string | undefined {
  const script = process.platform === "win32" ? "o3de.bat" : "o3de.sh";
  const engines = discoverEngines();
  for (const engine of engines) {
    const candidate = path.join(engine.path, "scripts", script);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

// ---- helper ----------------------------------------------------------------

function runInTerminal(name: string, command: string): void {
  const term = vscode.window.createTerminal(name);
  term.show();
  term.sendText(command);
}
