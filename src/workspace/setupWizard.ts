// ============================================================================
//  O3DE Workspace Setup (A.2 / A.3).
//
//  PASS 1 — "Set Up O3DE Workspace…": Project + Engine source(s). Writes the
//  thin .code-workspace AND <project>/.vscode/settings.json (a "set up"
//  produces a configured workspace). No gems here — keeps the core flow simple.
//
//  PASS 2 — "Add Gems / Folders…": add gem(s) / custom folders to the existing
//  .code-workspace. Custom folders use an EXPLICIT add-another prompt (no
//  silent re-looping).
// ============================================================================

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { log } from "../log";
import {
  discoverProjects,
  discoverGems,
  discoverEngineGems,
  discoverSourceEngines,
  discoverEngines,
} from "../o3de/discovery";
import { readProject, O3deProject } from "../o3de/identity";
import {
  buildWorkspaceFileContent,
  defaultWorkspaceFilePath,
  NamedPath,
} from "./workspaceFile";
import { writeProjectSettings } from "../build/writeProjectConfig";
import { BuildOptions } from "../build/buildOptions";

// ---- Project selection (flexible) ------------------------------------------
async function pickProject(): Promise<O3deProject | undefined> {
  const candidates = new Map<string, O3deProject>();
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const proj = readProject(folder.uri.fsPath);
    if (proj) {
      candidates.set(proj.path, proj);
    }
  }
  for (const proj of discoverProjects()) {
    candidates.set(proj.path, proj);
  }

  interface Item extends vscode.QuickPickItem {
    project?: O3deProject;
    browse?: boolean;
  }
  const items: Item[] = [...candidates.values()].map((proj) => ({
    label: proj.projectName,
    description: proj.path,
    project: proj,
  }));
  items.push({ label: "$(folder-opened) Browse for a project folder…", browse: true });

  const choice = await vscode.window.showQuickPick(items, {
    title: "O3DE Workspace Setup — 1/2: Project",
    placeHolder: "Select the O3DE project (folder with project.json)",
  });
  if (!choice) {
    return undefined;
  }
  if (choice.project) {
    return choice.project;
  }
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: "Select project folder",
  });
  if (!picked || picked.length === 0) {
    return undefined;
  }
  const proj = readProject(picked[0].fsPath);
  if (!proj) {
    void vscode.window.showErrorMessage("That folder has no project.json — it is not an O3DE project.");
    return undefined;
  }
  return proj;
}

// ---- Engine source selection (multi + browse) ------------------------------
async function pickEngineSources(): Promise<NamedPath[]> {
  interface Item extends vscode.QuickPickItem {
    value?: NamedPath;
    browse?: boolean;
  }
  const items: Item[] = discoverSourceEngines().map((engine) => ({
    label: engine.engineName,
    description: engine.path,
    detail: engine.displayVersion ?? engine.version,
    value: { name: engine.engineName, path: engine.path },
  }));
  items.push({ label: "$(folder-opened) Browse for engine source folder(s)…", browse: true });

  const chosen = await vscode.window.showQuickPick(items, {
    title: "O3DE Workspace Setup — 2/2: Engine source (optional, multiple)",
    placeHolder: "Source engine(s) for C++/CMake reference — Esc / none for Lua-only",
    canPickMany: true,
  });
  if (!chosen) {
    return [];
  }
  const result: NamedPath[] = [];
  for (const item of chosen) {
    if (item.value) {
      result.push(item.value);
    }
  }
  if (chosen.some((item) => item.browse)) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: true,
      openLabel: "Add engine source folder(s)",
    });
    for (const uri of picked ?? []) {
      result.push({ name: path.basename(uri.fsPath), path: uri.fsPath });
    }
  }
  return result;
}

// ---- Write the .code-workspace ---------------------------------------------
async function writeWorkspaceFile(
  project: O3deProject,
  supporting: NamedPath[],
): Promise<string | undefined> {
  const content = buildWorkspaceFileContent(
    { projectName: project.projectName, path: project.path },
    supporting,
  );
  const filePath = defaultWorkspaceFilePath(project);
  if (fs.existsSync(filePath)) {
    const overwrite = await vscode.window.showWarningMessage(
      `${path.basename(filePath)} already exists. Overwrite it?`,
      "Overwrite",
      "Cancel",
    );
    if (overwrite !== "Overwrite") {
      return undefined;
    }
  }
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(content, null, 2)}\n`, "utf8");
  } catch (err) {
    log().error(`Failed to write ${filePath}: ${String(err)}`);
    void vscode.window.showErrorMessage("O3DE: failed to write the workspace file (see the O3DE log).");
    return undefined;
  }
  log().info(`Wrote workspace: ${filePath} (${content.folders.length} folders)`);
  for (const folder of content.folders) {
    log().info(`   • ${folder.name} → ${folder.path}`);
  }
  return filePath;
}

// ---- PASS 1: Set Up O3DE Workspace (project + source + config) -------------
export async function runSetupWizard(buildOptions: BuildOptions): Promise<void> {
  const project = await pickProject();
  if (!project) {
    log().info("Workspace setup cancelled.");
    return;
  }
  const engineSources = await pickEngineSources();
  const supporting: NamedPath[] = engineSources.map((engine) => ({
    name: `Engine (source): ${engine.name}`,
    path: engine.path,
  }));

  const wsPath = await writeWorkspaceFile(project, supporting);
  if (!wsPath) {
    return;
  }
  const settingsPath = await writeProjectSettings(project, buildOptions);

  const open = await vscode.window.showInformationMessage(
    `O3DE workspace ready for ${project.projectName} — project + ${engineSources.length} engine ` +
      `source(s)${settingsPath ? " + .vscode/settings.json" : ""}. Open it now?`,
    "Open Workspace",
    "Not now",
  );
  if (open === "Open Workspace") {
    await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(wsPath), {
      forceNewWindow: false,
    });
  }
}

// ---- PASS 2: Add Gems / Folders to an existing workspace -------------------
// Explicit custom-folder flow: pick a folder + name, then explicitly choose to
// add another or finish (no silent re-looping).
async function addCustomFolders(): Promise<NamedPath[]> {
  const result: NamedPath[] = [];
  for (;;) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: "Select folder",
      title: "Custom folder — pick a directory",
    });
    if (!picked || picked.length === 0) {
      break;
    }
    const folderPath = picked[0].fsPath;
    const name = await vscode.window.showInputBox({
      title: "Workspace folder name",
      prompt: "Display name for this folder (e.g. Gems)",
      value: path.basename(folderPath),
    });
    if (name === undefined) {
      break;
    }
    result.push({ name: name.trim() || path.basename(folderPath), path: folderPath });

    const more = await vscode.window.showQuickPick(["Done", "Add another folder"], {
      title: "Custom folders",
      placeHolder: `Added "${name}". Add another folder, or Done?`,
    });
    if (more !== "Add another folder") {
      break;
    }
  }
  return result;
}

// A gem is "built-in" when it lives inside a registered engine's directory
// (e.g. <engine>/Gems/…). Those are hidden by default — there are hundreds — and
// revealed with the "Show built-in gems" toggle.
function isBuiltInGemPath(gemPath: string, enginePrefixes: string[]): boolean {
  const resolved = path.resolve(gemPath) + path.sep;
  return enginePrefixes.some((prefix) => resolved.startsWith(prefix));
}

async function pickGemsAndFolders(): Promise<NamedPath[]> {
  const enginePrefixes = discoverEngines().map((e) => path.resolve(e.path) + path.sep);
  // ALL gems — project-independent. A gem needn't be enabled on any project to
  // be added to the workspace for reference/navigation. User-registered gems
  // (o3de manifest) plus the engine's built-in gems (engine.json), deduped by
  // path so a gem registered both ways appears once. Built-ins are hidden until
  // the "Show built-in gems" toggle since there are hundreds.
  const seenGemPaths = new Set<string>();
  const allGems = [...discoverGems(), ...discoverEngineGems()]
    .filter((gem) => gem.type === undefined || gem.type === "Code" || gem.type === "Tool")
    .filter((gem) => {
      const key = path.resolve(gem.path);
      if (seenGemPaths.has(key)) {
        return false;
      }
      seenGemPaths.add(key);
      return true;
    })
    .map((gem) => ({ name: gem.gemName, path: gem.path, builtIn: isBuiltInGemPath(gem.path, enginePrefixes) }));

  interface Item extends vscode.QuickPickItem {
    value?: NamedPath;
    addCustom?: boolean;
    toggle?: boolean;
  }

  // Loop so the "Show built-in gems" toggle can re-open the picker with a wider
  // list while preserving the current selections.
  let showBuiltIn = false;
  const chosenPaths = new Set<string>();
  let addCustom = false;

  for (;;) {
    const visibleGems = allGems.filter((gem) => showBuiltIn || !gem.builtIn);
    const items: Item[] = [
      {
        label: showBuiltIn ? "$(eye-closed) Hide built-in gems" : "$(eye) Show built-in gems",
        detail: showBuiltIn
          ? "Currently listing the engine's built-in gems too"
          : "Also list the engine's built-in gems (there are many)",
        toggle: true,
      },
      ...visibleGems.map<Item>((gem) => ({
        label: gem.name,
        description: gem.builtIn ? `${gem.path}  ·  built-in` : gem.path,
        value: { name: gem.name, path: gem.path },
        picked: chosenPaths.has(gem.path),
      })),
      {
        label: "$(add) Add a custom folder…",
        detail: "Point at any directory (e.g. a gems parent) and name it",
        addCustom: true,
        picked: addCustom,
      },
    ];

    const chosen = await vscode.window.showQuickPick(items, {
      title: "Add Gems / Folders",
      placeHolder: "Select gem(s), toggle built-ins, and/or add a custom folder — Esc to cancel",
      canPickMany: true,
    });
    if (!chosen) {
      return []; // cancelled
    }

    // Remember the current selections so a toggle re-open doesn't lose them.
    chosenPaths.clear();
    for (const item of chosen) {
      if (item.value) {
        chosenPaths.add(item.value.path);
      }
    }
    addCustom = chosen.some((item) => item.addCustom);

    if (chosen.some((item) => item.toggle)) {
      showBuiltIn = !showBuiltIn;
      continue; // re-open with the new visibility
    }
    break; // a normal accept — proceed with the selection
  }

  const result: NamedPath[] = [];
  for (const gem of allGems) {
    if (chosenPaths.has(gem.path)) {
      result.push({ name: `Gem: ${gem.name}`, path: gem.path });
    }
  }
  if (addCustom) {
    result.push(...(await addCustomFolders()));
  }
  return result;
}

// Add the picked gem(s)/folder(s) to the LIVE workspace via VS Code's native
// folder API -- exactly what File > "Add Folder to Workspace" does. This is a
// pure workspace mutation: VS Code appends the roots and persists them itself
// (preserving order, settings, and comments in the .code-workspace). We do NOT
// touch <project>/.vscode config or CMake -- adding a gem for reference must not
// reconfigure the project (issue #22).
export async function addGemsToWorkspace(): Promise<void> {
  const additions = await pickGemsAndFolders();
  if (additions.length === 0) {
    log().info("Add Gems / Folders: nothing selected.");
    return;
  }

  const present = new Set(
    (vscode.workspace.workspaceFolders ?? []).map((folder) => path.resolve(folder.uri.fsPath)),
  );
  const fresh = additions.filter((addition) => !present.has(path.resolve(addition.path)));
  if (fresh.length === 0) {
    void vscode.window.showInformationMessage("O3DE: those folder(s) are already in the workspace.");
    return;
  }

  // Append at the end (native add-folder semantics); VS Code persists the change.
  const start = vscode.workspace.workspaceFolders?.length ?? 0;
  const ok = vscode.workspace.updateWorkspaceFolders(
    start,
    0,
    ...fresh.map((addition) => ({ uri: vscode.Uri.file(addition.path), name: addition.name })),
  );
  if (!ok) {
    log().error(`updateWorkspaceFolders rejected ${fresh.length} folder(s).`);
    void vscode.window.showErrorMessage("O3DE: could not add the folder(s) to the workspace.");
    return;
  }
  log().info(`Added ${fresh.length} folder(s) to the workspace.`);
  for (const addition of fresh) {
    log().info(`   • ${addition.name} → ${addition.path}`);
  }
}
