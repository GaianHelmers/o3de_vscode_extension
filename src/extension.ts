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
import { DashboardViewProvider } from "./view/dashboardView";
import { OnboardingStatus } from "./view/onboardingStatus";
import { openEditorLog, openErrorLog } from "./build/o3deLogs";
import { runSetupWizard, addGemsToWorkspace } from "./workspace/setupWizard";
import { writeProjectConfig } from "./build/writeProjectConfig";
import { configureProject } from "./build/configure";
import { buildProject } from "./build/build";
import { selectTargets } from "./build/selectTargets";
import { runProject, stopRun } from "./build/run";
import { runInDebug } from "./build/runDebug";
import { RunState } from "./build/runState";
import { generateCppProperties, refreshCppPropertiesOnStartup } from "./intellisense/generate";
import { registerConfigurationProvider } from "./intellisense/provider";
import { registerLuaDebug, debugLuaFile } from "./lua/debug/debugAdapter";
import { registerLuaHandoff } from "./lua/handoff";
import { generateLuaIntelliSense, generateLuaStubsFromDump } from "./lua/intellisense/intelliSense";
import { launchClassWizard } from "./tools/classWizard";
import { LuaPaletteProvider, LUA_PALETTE_VIEW_ID, insertLuaSymbol } from "./lua/palette/luaPaletteProvider";
import { DependencyStatus } from "./deps/dependencyStatus";
import { O3deMcpServer } from "./mcp/server";
import {
  BuildOptions,
  GENERATORS,
  BUILD_CONFIGS,
  COMPILERS,
  RUN_TARGETS,
  Generator,
  BuildConfig,
  Compiler,
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

  // Exhaustive dependency model behind the guided Setup ramp (detectors + tracks
  // + intents + acquisition actions). Detect in the background on activation.
  const deps = new DependencyStatus(context.workspaceState);
  void deps.refresh();

  // Live run state (Editor / GameLauncher up?) — toggles the toolbar's single
  // Run slot between Play and Stop via the `o3de.appRunning` context key.
  const runState = new RunState();

  // LLM connections — a localhost MCP endpoint an assistant (e.g. Claude) uses to
  // trigger builds and read structured results. Off by default; the MCP SDK is
  // only loaded when started. Toggled from the Onboarding ▸ Optional section.
  const mcpServer = new O3deMcpServer(context, buildOptions);
  const reconcileMcp = async (): Promise<void> => {
    if (vscode.workspace.getConfiguration("o3de").get<boolean>("llm.enabled", false)) {
      await mcpServer.restart(); // idempotent start + picks up a changed port
    } else {
      await mcpServer.stop();
    }
    void deps.refresh(); // refresh the Optional row's dot/detail
  };
  if (vscode.workspace.getConfiguration("o3de").get<boolean>("llm.enabled", false)) {
    void mcpServer.start();
  }
  const mcpConfigListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("o3de.llm.enabled") || e.affectsConfiguration("o3de.llm.port")) {
      void reconcileMcp();
    }
  });

  // Commands: enable / disable the LLM endpoint + show the client connection info.
  const llmEnable = vscode.commands.registerCommand("o3de.llm.enable", async () => {
    await vscode.workspace.getConfiguration("o3de").update("llm.enabled", true, vscode.ConfigurationTarget.Global);
    void vscode.commands.executeCommand("o3de.llm.showConnectionInfo");
  });
  const llmDisable = vscode.commands.registerCommand("o3de.llm.disable", async () => {
    await vscode.workspace.getConfiguration("o3de").update("llm.enabled", false, vscode.ConfigurationTarget.Global);
  });
  const llmShowInfo = vscode.commands.registerCommand("o3de.llm.showConnectionInfo", async () => {
    if (!vscode.workspace.getConfiguration("o3de").get<boolean>("llm.enabled", false)) {
      void vscode.window.showInformationMessage(
        "O3DE: LLM connections are off. Enable them from Onboarding ▸ Optional (or “O3DE: Enable LLM Connections”).",
      );
      return;
    }
    const info = mcpServer.connectionInfo();
    log().info(`LLM (MCP) connection — add to your MCP client (e.g. .mcp.json):\n${info.mcpJson}`);
    log().show(true);
    const pick = await vscode.window.showInformationMessage(
      `O3DE LLM endpoint: ${info.url}`,
      "Copy .mcp.json",
      "Copy Token",
    );
    if (pick === "Copy .mcp.json") {
      await vscode.env.clipboard.writeText(info.mcpJson);
    } else if (pick === "Copy Token") {
      await vscode.env.clipboard.writeText(info.token);
    }
  });

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

  // Command: "O3DE: Run in Debug (C++)" — launch the selected target under cppvsdbg.
  const runDebug = vscode.commands.registerCommand("o3de.runDebug", () => {
    void runInDebug(buildOptions);
  });

  // Command: "O3DE: Stop" — force-quit the running app + its process tree (or sweep orphans).
  const stop = vscode.commands.registerCommand("o3de.stopRun", async () => {
    await stopRun();
    void runState.refresh(); // flip the toolbar back to Play immediately
  });

  // Command: "O3DE: Generate C++ IntelliSense" — File API reply → <project>/.vscode/c_cpp_properties.json.
  const classWizard = vscode.commands.registerCommand("o3de.classWizard", () => {
    void launchClassWizard();
  });

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
  const selectCompiler = vscode.commands.registerCommand("o3de.selectCompiler", async () => {
    const pick = await vscode.window.showQuickPick(COMPILERS, {
      title: "O3DE: Compiler",
      placeHolder: `Current: ${buildOptions.compiler} — switching may need a fresh Configure`,
    });
    if (pick) {
      await buildOptions.setCompiler(pick as Compiler);
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

  // O3DE activity-bar tab → the single "O3DE Development Tools" webview
  // (status + Build/Run + Utilities + collapsible Configuration + Onboarding).
  const dashboardView = vscode.window.registerWebviewViewProvider(
    DashboardViewProvider.viewType,
    new DashboardViewProvider(runState, onboarding, buildOptions, deps),
  );

  // Prerequisites are detected in the background so the tree paints markers
  // without spawning processes on every render; workspace changes re-render live.
  void onboarding.refresh();
  const foldersChanged = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    onboarding.notifyChanged();
    void deps.refresh(); // project/engine presence can change with the folders
  });

  // Begin watching run state so the Run/Stop toolbar toggle tracks the live app.
  runState.start();

  // Low-cost IntelliSense refresh on startup (setting-gated): re-emit c_cpp_properties.json from the
  // existing File API reply so it tracks the last configure — no cmake reconfigure.
  if (vscode.workspace.getConfiguration("o3de").get<boolean>("intellisense.autoRefreshOnStartup", true)) {
    void refreshCppPropertiesOnStartup(buildOptions);
  }

  // Live C++ IntelliSense: register with cpptools as a per-file configuration provider (reactive).
  void registerConfigurationProvider(context, buildOptions);

  // Lua: remote debugger (DAP) + Editor "Open Lua Editor" handoff (vscode:// URI).
  registerLuaDebug(context);
  registerLuaHandoff(context);
  const debugLua = vscode.commands.registerCommand("o3de.debugLuaFile", (uri?: vscode.Uri) => {
    void debugLuaFile(uri);
  });

  // Lua function palette — browsable Classes / EBuses / Globals tree (2nd O3DE view).
  const luaPalette = new LuaPaletteProvider();
  const luaPaletteView = vscode.window.registerTreeDataProvider(LUA_PALETTE_VIEW_ID, luaPalette);
  const luaPaletteRefresh = vscode.commands.registerCommand("o3de.luaPalette.refresh", () => luaPalette.refresh());
  const luaPaletteInsert = vscode.commands.registerCommand("o3de.luaPalette.insert", (text: string) =>
    insertLuaSymbol(text),
  );
  const applyPaletteFilter = (text: string): void => {
    luaPalette.setFilter(text);
    void vscode.commands.executeCommand("setContext", "o3de.luaPaletteFiltering", luaPalette.isFiltering);
  };
  const luaPaletteFilter = vscode.commands.registerCommand("o3de.luaPalette.filter", async () => {
    const text = await vscode.window.showInputBox({
      prompt: "Filter the Lua palette (class / method / EBus / global name)",
      placeHolder: "e.g. TransformBus, Vector3, GetWorld…",
      value: "",
    });
    if (text !== undefined) {
      applyPaletteFilter(text);
    }
  });
  const luaPaletteClearFilter = vscode.commands.registerCommand("o3de.luaPalette.clearFilter", () =>
    applyPaletteFilter(""),
  );

  // Lua IntelliSense: dump the reflected API (headless Editor) → LuaLS stubs.
  // Refresh the palette afterwards so it populates from the fresh dump.
  const genLuaIntelliSense = vscode.commands.registerCommand("o3de.generateLuaIntelliSense", async () => {
    await generateLuaIntelliSense(context, buildOptions);
    luaPalette.refresh();
    void deps.refresh(); // the reflection-dump check should now read green
  });
  const genLuaStubsFromDump = vscode.commands.registerCommand("o3de.generateLuaStubsFromDump", async () => {
    await generateLuaStubsFromDump();
    luaPalette.refresh();
    void deps.refresh();
  });

  context.subscriptions.push(
    buildOptions,
    onboarding,
    deps,
    runState,
    mcpServer,
    mcpConfigListener,
    llmEnable,
    llmDisable,
    llmShowInfo,
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
    runDebug,
    stop,
    genCpp,
    selectGenerator,
    selectConfig,
    selectCompiler,
    classWizard,
    selectTargetsCmd,
    selectRunTarget,
    setLaunchArgs,
    showEditorLog,
    showErrorLog,
    debugLua,
    genLuaIntelliSense,
    genLuaStubsFromDump,
    luaPaletteView,
    luaPaletteRefresh,
    luaPaletteInsert,
    luaPaletteFilter,
    luaPaletteClearFilter,
    dashboardView,
    statusItem,
  );
}

// ---- Deactivation ----------------------------------------------------------
export function deactivate(): void {
  // Disposables are cleaned up automatically via context.subscriptions.
}
