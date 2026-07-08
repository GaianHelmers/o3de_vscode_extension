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
import { SectionTreeProvider, onboardingRoots } from "./view/toolingView";
import { DashboardViewProvider } from "./view/dashboardView";
import { OnboardingStatus } from "./view/onboardingStatus";
import { openEditorLog, openErrorLog } from "./build/o3deLogs";
import { runSetupWizard, addGemsToWorkspace } from "./workspace/setupWizard";
import { writeProjectConfig } from "./build/writeProjectConfig";
import { configureProject } from "./build/configure";
import { buildProject } from "./build/build";
import { selectTargets } from "./build/selectTargets";
import { runProject, stopRun } from "./build/run";
import { RunState } from "./build/runState";
import { generateCppProperties, refreshCppPropertiesOnStartup } from "./intellisense/generate";
import { registerConfigurationProvider } from "./intellisense/provider";
import {
  BuildOptions,
  GENERATORS,
  BUILD_CONFIGS,
  RUN_TARGETS,
  Generator,
  BuildConfig,
  RunTarget,
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

  // Onboarding completion model (prerequisites + workspace) — drives the
  // green/red markers and auto-collapse on the Onboarding section.
  const onboarding = new OnboardingStatus(context.workspaceState);

  // Live run state (Editor / GameLauncher up?) — toggles the toolbar's single
  // Run slot between Play and Stop via the `o3de.appRunning` context key.
  const runState = new RunState();

  // Command: "O3DE: Hello World".
  const helloWorld = vscode.commands.registerCommand("o3de.helloWorld", () => {
    log().info("Hello World command invoked.");
    vscode.window.showInformationMessage("Hello from O3DE Development Tools!");
  });

  // Command: "O3DE: Show Log" — reveal this channel any time.
  const showLog = vscode.commands.registerCommand("o3de.showLog", () => {
    log().show();
  });

  // Commands: open the O3DE project's runtime logs (Editor.log / Error.log).
  const showEditorLog = vscode.commands.registerCommand("o3de.showEditorLog", () => {
    void openEditorLog();
  });
  const showErrorLog = vscode.commands.registerCommand("o3de.showErrorLog", () => {
    void openErrorLog();
  });

  // Command: "O3DE: Check Visual Studio" — re-run detection interactively.
  const checkVs = vscode.commands.registerCommand("o3de.checkVisualStudio", async () => {
    await ensureVisualStudio({ interactive: true });
    void onboarding.refresh();
  });

  // Command: "O3DE: Open Developer Terminal" — a terminal with the MSVC env ready.
  const openTerm = vscode.commands.registerCommand("o3de.openDeveloperTerminal", () => {
    void openDeveloperTerminal();
  });

  // Command: "O3DE: Check Ninja" — detect Ninja, offer to install it if missing.
  const checkNinja = vscode.commands.registerCommand("o3de.checkNinja", async () => {
    await ensureNinja({ interactive: true });
    void onboarding.refresh();
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

  // Command: "O3DE: Run" — launch the selected run target (detached, tracked for force-quit).
  const run = vscode.commands.registerCommand("o3de.run", async () => {
    await runProject(buildOptions);
    void runState.refresh(); // flip the toolbar to Stop immediately
  });

  // Command: "O3DE: Stop" — force-quit the running app + its process tree (or sweep orphans).
  const stop = vscode.commands.registerCommand("o3de.stopRun", async () => {
    await stopRun();
    void runState.refresh(); // flip the toolbar back to Play immediately
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

  // Commands: choose what Run launches + the launch options (shown in the tab, persisted).
  const selectRunTarget = vscode.commands.registerCommand("o3de.selectRunTarget", async () => {
    const pick = await vscode.window.showQuickPick(RUN_TARGETS, {
      title: "O3DE: Run Target",
      placeHolder: `Current: ${buildOptions.runTarget}`,
    });
    if (pick) {
      await buildOptions.setRunTarget(pick as RunTarget);
    }
  });
  const setLaunchArgs = vscode.commands.registerCommand("o3de.setLaunchArgs", async () => {
    const value = await vscode.window.showInputBox({
      title: "O3DE: Launch Options",
      prompt: "Extra command-line args passed when running (blank to clear)",
      placeHolder: "+LoadLevel DefaultLevel +r_displayInfo 1",
      value: buildOptions.launchArgs,
    });
    if (value !== undefined) {
      await buildOptions.setLaunchArgs(value.trim());
    }
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

  // O3DE activity-bar tab → Dashboard (webview: status + Build/Run + Utilities + Configuration).
  const dashboardView = vscode.window.registerWebviewViewProvider(
    DashboardViewProvider.viewType,
    new DashboardViewProvider(runState, onboarding, buildOptions),
  );

  // O3DE activity-bar tab → Onboarding tree (collapsible, below the Dashboard).
  const onboardingView = vscode.window.createTreeView("o3de.onboarding", {
    treeDataProvider: new SectionTreeProvider(
      () => onboardingRoots(onboarding),
      (fire) => onboarding.onDidChange(fire),
    ),
  });

  // Badge the Onboarding view with the count of outstanding steps (the full
  // message + lights live in the Dashboard). Clears when complete.
  const updateOnboardingBadge = (): void => {
    const pending = onboarding.pendingCount;
    onboardingView.badge = pending
      ? { value: pending, tooltip: `${pending} onboarding step(s) remaining` }
      : undefined;
  };
  onboarding.onDidChange(updateOnboardingBadge);
  updateOnboardingBadge();

  // Prerequisites are detected in the background so the tree paints markers
  // without spawning processes on every render; workspace changes re-render live.
  void onboarding.refresh();
  const foldersChanged = vscode.workspace.onDidChangeWorkspaceFolders(() => onboarding.notifyChanged());

  // Begin watching run state so the Run/Stop toolbar toggle tracks the live app.
  runState.start();

  // Low-cost IntelliSense refresh on startup (setting-gated): re-emit c_cpp_properties.json from the
  // existing File API reply so it tracks the last configure — no cmake reconfigure.
  if (vscode.workspace.getConfiguration("o3de").get<boolean>("intellisense.autoRefreshOnStartup", true)) {
    void refreshCppPropertiesOnStartup(buildOptions);
  }

  // Live C++ IntelliSense: register with cpptools as a per-file configuration provider (reactive).
  void registerConfigurationProvider(context, buildOptions);

  context.subscriptions.push(
    buildOptions,
    onboarding,
    runState,
    foldersChanged,
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
    run,
    stop,
    genCpp,
    selectGenerator,
    selectConfig,
    selectTargetsCmd,
    selectRunTarget,
    setLaunchArgs,
    showEditorLog,
    showErrorLog,
    dashboardView,
    onboardingView,
    statusItem,
  );
}

// ---- Deactivation ----------------------------------------------------------
export function deactivate(): void {
  // Disposables are cleaned up automatically via context.subscriptions.
}
