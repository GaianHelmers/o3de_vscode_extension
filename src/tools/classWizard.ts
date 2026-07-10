// ============================================================================
//  Class Creation Wizard — launch O3DE's standalone PySide6 class-scaffolding
//  tool (engine Tools/ClassCreationWizard/ClassWizard.py) from inside VS Code.
//
//  It runs through the engine's bundled Python (python/python.cmd) and needs
//  --engine-path (the engine hosting the wizard) + --project-path (where to
//  scaffold). We locate the wizard across the open workspace folders and every
//  registered engine, then spawn it detached with a clean environment.
// ============================================================================

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { log } from "../log";
import { discoverEngines } from "../o3de/discovery";
import { detectProjectRoot } from "../lua/projectPaths";
import { cleanChildEnv } from "../build/runManager";

const WIZARD_REL = path.join("Tools", "ClassCreationWizard", "ClassWizard.py");

interface WizardLocation {
  script: string; // …/Tools/ClassCreationWizard/ClassWizard.py
  engineRoot: string; // the engine that hosts it (→ --engine-path)
  python: string; // engine bundled python launcher
}

function pythonLauncher(engineRoot: string): string | undefined {
  const name = process.platform === "win32" ? "python.cmd" : "python.sh";
  const candidate = path.join(engineRoot, "python", name);
  return fs.existsSync(candidate) ? candidate : undefined;
}

// Search open workspace folders + registered engines for the wizard script.
function locateWizard(): WizardLocation | undefined {
  const roots = new Set<string>();
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    roots.add(f.uri.fsPath);
  }
  for (const e of discoverEngines()) {
    roots.add(e.path);
  }

  for (const root of roots) {
    const script = path.join(root, WIZARD_REL);
    if (!fs.existsSync(script)) {
      continue;
    }
    // Prefer this engine's Python; fall back to any registered engine's Python.
    const python =
      pythonLauncher(root) ?? discoverEngines().map((e) => pythonLauncher(e.path)).find(Boolean);
    if (python) {
      return { script, engineRoot: root, python };
    }
  }
  return undefined;
}

export async function launchClassWizard(): Promise<void> {
  const wizard = locateWizard();
  if (!wizard) {
    void vscode.window.showErrorMessage(
      "O3DE: Class Creation Wizard not found. It ships with the engine source at " +
        "Tools/ClassCreationWizard — add that engine to your workspace, or ensure the engine's Python is set up.",
    );
    return;
  }

  const projectPath = detectProjectRoot();
  if (!projectPath) {
    void vscode.window.showErrorMessage("O3DE: open an O3DE project first — the Class Wizard scaffolds into a project.");
    return;
  }

  const args = [
    wizard.script,
    "--engine-path",
    wizard.engineRoot,
    "--project-path",
    projectPath,
  ];
  log().info(`Launching Class Wizard: ${wizard.python} ${args.join(" ")}`);

  const child = spawn(wizard.python, args, {
    cwd: path.dirname(wizard.script),
    detached: true,
    stdio: "ignore",
    env: cleanChildEnv(), // keep VS Code env vars out of the GUI tool
  });
  child.on("error", (err) => {
    log().error(`Class Wizard failed to launch: ${String(err)}`);
    void vscode.window.showErrorMessage(`O3DE: failed to launch the Class Wizard — ${err.message}`);
  });
  child.unref();
}
