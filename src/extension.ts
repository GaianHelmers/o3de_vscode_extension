// ============================================================================
//  O3DE Development Tools — extension entry point.
//
//  This is the minimal skeleton. Real feature areas (env bootstrap, build/
//  launch, C++/Lua IntelliSense, reflection bridge, codegen) are layered in
//  under src/ per the staged plan.
//
//  All reporting goes through the dedicated Output channel in log.ts — never
//  console.log — so the test window has a clean, self-contained log.
// ============================================================================

import * as vscode from "vscode";
import { initLog, log } from "./log";
import { ensureVisualStudio } from "./env/visualStudioGuard";
import { openDeveloperTerminal } from "./env/developerTerminal";
import { ensureNinja } from "./build/ninjaGuard";
import { ToolingViewProvider } from "./view/toolingView";
import { runSetupWizard, addGemsToWorkspace } from "./workspace/setupWizard";
import { writeProjectConfig } from "./build/writeProjectConfig";
import { configureProject } from "./build/configure";
import { buildProject } from "./build/build";
import { selectTargets } from "./build/selectTargets";
import { generateCppProperties, refreshCppPropertiesOnStartup } from "./intellisense/generate";
import {
  BuildOptions,
  GENERATORS,
  BUILD_CONFIGS,
  Generator,
  BuildConfig,
} from "./build/buildOptions";

// ---- Activation ------------------------------------------------------------
export function activate(context: vscode.ExtensionContext): void {
  initLog(context);
  log().info("O3DE Development Tools activated.");
  log().show(true); // reveal our Output channel (dev convenience; keeps focus)

  // Verify the Windows build toolchain (Visual Studio / MSVC) is present.
  // Non-interactive: log results, and only alert the user if something is wrong.
  void ensureVisualStudio({ interactive: false });

  // Selectable build attributes (generator / config), shown in the O3DE tab.
  const buildOptions = new BuildOptions(context.workspaceState);

  // Command: "O3DE: Hello World".
  const helloWorld = vscode.commands.registerCommand("o3de.helloWorld", () => {
    log().info("Hello World command invoked.");
    vscode.window.showInformationMessage("Hello from O3DE Development Tools!");
  });

  // Command: "O3DE: Show Log" — reveal this channel any time.
  const showLog = vscode.commands.registerCommand("o3de.showLog", () => {
    log().show();
  });

  // Command: "O3DE: Check Visual Studio" — re-run detection interactively.
  const checkVs = vscode.commands.registerCommand("o3de.checkVisualStudio", () => {
    void ensureVisualStudio({ interactive: true });
  });

  // Command: "O3DE: Open Developer Terminal" — a terminal with the MSVC env ready.
  const openTerm = vscode.commands.registerCommand("o3de.openDeveloperTerminal", () => {
    void openDeveloperTerminal();
  });

  // Command: "O3DE: Check Ninja" — detect Ninja, offer to install it if missing.
  const checkNinja = vscode.commands.registerCommand("o3de.checkNinja", () => {
    void ensureNinja({ interactive: true });
  });

  // Command: "O3DE: Set Up Workspace…" — project + engine source → .code-workspace + .vscode config.
  const setupWorkspace = vscode.commands.registerCommand("o3de.setupWorkspace", () => {
    void runSetupWizard(buildOptions);
  });

  // Command: "O3DE: Add Gems / Folders…" — add gem(s)/folders to the workspace (second pass).
  const addGems = vscode.commands.registerCommand("o3de.addGems", () => {
    void addGemsToWorkspace();
  });

  // Command: "O3DE: Write Project Config" — generate/merge <project>/.vscode/settings.json.
  const writeConfig = vscode.commands.registerCommand("o3de.writeProjectConfig", () => {
    void writeProjectConfig(buildOptions);
  });

  // Command: "O3DE: Configure Project" — run the CMake configure (build/<platform>) in an MSVC terminal.
  const configure = vscode.commands.registerCommand("o3de.configureProject", () => {
    void configureProject(buildOptions);
  });

  // Command: "O3DE: Build" — cmake --build for the selected target(s) + config (MSVC env + process-guard).
  const build = vscode.commands.registerCommand("o3de.build", () => {
    void buildProject(buildOptions);
  });

  // Command: "O3DE: Generate C++ IntelliSense" — File API reply → <project>/.vscode/c_cpp_properties.json.
  const genCpp = vscode.commands.registerCommand("o3de.generateCppProperties", () => {
    void generateCppProperties(buildOptions);
  });

  // Commands: choose the CMake generator / build config (shown in the tab, persisted).
  const selectGenerator = vscode.commands.registerCommand("o3de.selectGenerator", async () => {
    const pick = await vscode.window.showQuickPick(GENERATORS, {
      title: "O3DE: CMake Generator",
      placeHolder: `Current: ${buildOptions.generator}`,
    });
    if (pick) {
      await buildOptions.setGenerator(pick as Generator);
    }
  });
  const selectConfig = vscode.commands.registerCommand("o3de.selectConfig", async () => {
    const pick = await vscode.window.showQuickPick(BUILD_CONFIGS, {
      title: "O3DE: Build Configuration",
      placeHolder: `Current: ${buildOptions.config}`,
    });
    if (pick) {
      await buildOptions.setConfig(pick as BuildConfig);
    }
  });

  // Command: choose the CMake build target(s) — multi-select, File-API-sourced (shown in the tab, persisted).
  const selectTargetsCmd = vscode.commands.registerCommand("o3de.selectTargets", () => {
    void selectTargets(buildOptions);
  });

  // Status-bar button — persistent, clickable proof the extension is alive.
  const statusItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  statusItem.text = "$(rocket) O3DE";
  statusItem.tooltip = "O3DE Development Tools — click to run Hello World";
  statusItem.command = "o3de.helloWorld";
  statusItem.show();

  // O3DE activity-bar tab → "Tooling" view.
  const toolingView = vscode.window.registerTreeDataProvider(
    "o3de.tooling",
    new ToolingViewProvider(buildOptions),
  );

  // Low-cost IntelliSense refresh on startup (setting-gated): re-emit c_cpp_properties.json from the
  // existing File API reply so it tracks the last configure — no cmake reconfigure.
  if (vscode.workspace.getConfiguration("o3de").get<boolean>("intellisense.autoRefreshOnStartup", true)) {
    void refreshCppPropertiesOnStartup(buildOptions);
  }

  context.subscriptions.push(
    buildOptions,
    helloWorld,
    showLog,
    checkVs,
    openTerm,
    checkNinja,
    setupWorkspace,
    addGems,
    writeConfig,
    configure,
    build,
    genCpp,
    selectGenerator,
    selectConfig,
    selectTargetsCmd,
    toolingView,
    statusItem,
  );
}

// ---- Deactivation ----------------------------------------------------------
export function deactivate(): void {
  // Disposables are cleaned up automatically via context.subscriptions.
}
