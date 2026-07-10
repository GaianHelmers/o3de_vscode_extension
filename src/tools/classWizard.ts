// ============================================================================
//  Class Creation Wizard — launch O3DE's standalone PySide6 class-scaffolding
//  tool (engine Tools/ClassCreationWizard/ClassWizard.py) from inside VS Code.
//
//  It runs through the engine's bundled Python (python/python.cmd) and needs
//  --engine-path (the engine hosting the wizard) + --project-path (where to
//  scaffold). We resolve the project's TARGET engine (project.json `engine` →
//  manifest), then run that engine's wizard — the one it's registered against,
//  not whatever copy happens to be open in the workspace.
// ============================================================================

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { log } from "../log";
import { resolveProjectEngine } from "../o3de/discovery";
import { readProject } from "../o3de/identity";
import { detectProjectRoot } from "../lua/projectPaths";
import { freshTerminal } from "../build/terminals";
import { formatCommand } from "../build/configureCommand";

const WIZARD_REL = path.join("Tools", "ClassCreationWizard", "ClassWizard.py");

function pythonLauncher(engineRoot: string): string | undefined {
  const name = process.platform === "win32" ? "python.cmd" : "python.sh";
  const candidate = path.join(engineRoot, "python", name);
  return fs.existsSync(candidate) ? candidate : undefined;
}

export async function launchClassWizard(): Promise<void> {
  const projectPath = detectProjectRoot();
  if (!projectPath) {
    void vscode.window.showErrorMessage("O3DE: open an O3DE project first — the Class Wizard scaffolds into a project.");
    return;
  }

  // Resolve the engine THIS project targets (project.json `engine` → manifest),
  // and run that engine's wizard — the one it's registered against.
  const project = readProject(projectPath);
  const engine = project ? resolveProjectEngine(project) : undefined;
  if (!engine) {
    void vscode.window.showErrorMessage(
      "O3DE: could not resolve the project's engine. Ensure project.json's \"engine\" names a registered engine " +
        "(o3de register --this-engine).",
    );
    return;
  }

  const script = path.join(engine.path, WIZARD_REL);
  const python = pythonLauncher(engine.path);
  if (!fs.existsSync(script) || !python) {
    void vscode.window.showErrorMessage(
      `O3DE: Class Creation Wizard not available in the project's engine (${engine.engineName} at ${engine.path}). ` +
        "Expected Tools/ClassCreationWizard/ClassWizard.py and a set-up python/ (run get_python).",
    );
    return;
  }

  // Run it in a VS Code integrated terminal — same as Build/Configure — so its
  // bootstrap output is visible in a tab and no stray cmd.exe window pops up.
  // Pin cmd.exe on Windows: python.cmd is a batch file and the default terminal
  // may be PowerShell, which needs `&` to run a quoted path; cmd runs it directly.
  const command = formatCommand([python, script, "--engine-path", engine.path, "--project-path", projectPath]);
  const shellPath = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : undefined;
  log().info(`Launching Class Wizard (${engine.engineName}): ${command}`);

  const terminal = freshTerminal("O3DE Class Wizard", undefined, shellPath);
  terminal.show();
  terminal.sendText(command);
}
