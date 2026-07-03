// ============================================================================
//  O3DE Tooling view — the tree shown in the O3DE activity-bar tab.
//
//  Structure:
//    Workspace/        Set Up O3DE Workspace…
//    Build Options/    Generator / Config / Targets: <value>   (click → dropdown/picker)
//    Build/            Build   Write Project Config…   Configure Project   Generate C++ IntelliSense
//    Run/              Run   Stop   Run Target: <value>   Launch Options: <value>
//    Prerequisites/    Check Visual Studio   Check Ninja
//    Open Developer Terminal   Show Log      (standalone)
//
//  Build Options are dynamic — they show the current selection (from BuildOptions)
//  and the tree refreshes when a selection changes.
// ============================================================================

import * as vscode from "vscode";
import { BuildOptions } from "../build/buildOptions";
import { targetsLabel } from "../build/buildCommand";
import { runSummary, launchArgsLabel } from "../build/runCommand";

// ---- Model -----------------------------------------------------------------
interface ActionNode {
  kind: "action";
  label: string;
  command: string;
  icon: string;
  tooltip?: string;
  description?: string; // dimmed text after the label (e.g. current selection)
}

interface SectionNode {
  kind: "section";
  label: string;
  icon: string;
  children: ActionNode[];
}

type Node = SectionNode | ActionNode;

// ---- Tree definition (built fresh so Build Options reflect current values) --
function buildTree(options: BuildOptions): Node[] {
  return [
    {
      kind: "section",
      label: "Workspace",
      icon: "root-folder",
      children: [
        {
          kind: "action",
          label: "Set Up O3DE Workspace…",
          command: "o3de.setupWorkspace",
          icon: "gear",
          tooltip: "Project + engine source → .code-workspace + .vscode/settings.json",
        },
        {
          kind: "action",
          label: "Add Gems / Folders…",
          command: "o3de.addGems",
          icon: "add",
          tooltip: "Add gem(s) or custom folders to the existing workspace",
        },
      ],
    },
    {
      kind: "section",
      label: "Build Options",
      icon: "settings",
      children: [
        {
          kind: "action",
          label: "Generator",
          description: options.generator,
          command: "o3de.selectGenerator",
          icon: "server-process",
          tooltip: "Choose the CMake generator (Ninja Multi-Config or Visual Studio)",
        },
        {
          kind: "action",
          label: "Config",
          description: options.config,
          command: "o3de.selectConfig",
          icon: "symbol-enum",
          tooltip: "Choose the build configuration (profile / debug / release)",
        },
        {
          kind: "action",
          label: "Targets",
          description: targetsLabel(options.targets),
          command: "o3de.selectTargets",
          icon: "list-tree",
          tooltip:
            "Choose which CMake target(s) Build compiles (Editor, GameLauncher, a feature…). Select none = build everything.",
        },
      ],
    },
    {
      kind: "section",
      label: "Build",
      icon: "gear",
      children: [
        {
          kind: "action",
          label: "Build",
          description: `${targetsLabel(options.targets)} · ${options.config}`,
          command: "o3de.build",
          icon: "run-all",
          tooltip:
            "Build the selected target(s) with the current config — MSVC env + process-guard (mirrors your build .bat)",
        },
        {
          kind: "action",
          label: "Write Project Config (.vscode)",
          command: "o3de.writeProjectConfig",
          icon: "settings-gear",
          tooltip: "Materialize .vscode: settings.json + launch.json (Editor/GameLauncher/Attach/ClassWizard) + O3DE snippets",
        },
        {
          kind: "action",
          label: "Configure Project",
          command: "o3de.configureProject",
          icon: "sync",
          tooltip: "Run the CMake configure (build/<platform>) in an MSVC terminal — creates the build tree + File API",
        },
        {
          kind: "action",
          label: "Generate C++ IntelliSense",
          command: "o3de.generateCppProperties",
          icon: "symbol-namespace",
          tooltip: "Parse the CMake File API → c_cpp_properties.json (engine paths resolve to the workspace source engine)",
        },
      ],
    },
    {
      kind: "section",
      label: "Run",
      icon: "play-circle",
      children: [
        {
          kind: "action",
          label: "Run",
          description: runSummary(options.runTarget, options.launchArgs),
          command: "o3de.run",
          icon: "play",
          tooltip: "Launch the selected run target (detached). Use Stop to force-quit it and its child processes.",
        },
        {
          kind: "action",
          label: "Stop",
          description: "force-quit",
          command: "o3de.stopRun",
          icon: "debug-stop",
          tooltip: "Force-quit the running app and its whole process tree (Editor + AssetProcessor etc.)",
        },
        {
          kind: "action",
          label: "Run Target",
          description: options.runTarget,
          command: "o3de.selectRunTarget",
          icon: "vm",
          tooltip: "Choose what Run launches: Editor or the project's GameLauncher",
        },
        {
          kind: "action",
          label: "Launch Options",
          description: launchArgsLabel(options.launchArgs),
          command: "o3de.setLaunchArgs",
          icon: "symbol-parameter",
          tooltip: "Extra command-line args passed when running (e.g. +LoadLevel DefaultLevel +r_displayInfo 1)",
        },
      ],
    },
    {
      kind: "section",
      label: "Prerequisites",
      icon: "checklist",
      children: [
        {
          kind: "action",
          label: "Check Visual Studio",
          command: "o3de.checkVisualStudio",
          icon: "verified",
          tooltip: "Detect the Visual Studio (MSVC) toolchain",
        },
        {
          kind: "action",
          label: "Check Ninja",
          command: "o3de.checkNinja",
          icon: "tools",
          tooltip: "Detect Ninja, or offer to install it",
        },
      ],
    },
    {
      kind: "action",
      label: "Open Developer Terminal",
      command: "o3de.openDeveloperTerminal",
      icon: "terminal",
      tooltip: "Open a terminal with the MSVC environment established",
    },
    {
      kind: "action",
      label: "Show Log",
      command: "o3de.showLog",
      icon: "output",
      tooltip: "Reveal the O3DE Development Tools output channel",
    },
  ];
}

// ---- Tree item construction ------------------------------------------------
function toTreeItem(node: Node): vscode.TreeItem {
  if (node.kind === "section") {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
    item.iconPath = new vscode.ThemeIcon(node.icon);
    item.contextValue = "section";
    return item;
  }
  const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
  item.command = { command: node.command, title: node.label };
  item.iconPath = new vscode.ThemeIcon(node.icon);
  item.tooltip = node.tooltip ?? node.label;
  if (node.description !== undefined) {
    item.description = node.description;
  }
  item.contextValue = "action";
  return item;
}

// ---- Provider (refreshes when a build option changes) ----------------------
export class ToolingViewProvider implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly options: BuildOptions) {
    options.onDidChange(() => this.changed.fire());
  }

  getTreeItem(node: Node): vscode.TreeItem {
    return toTreeItem(node);
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      return buildTree(this.options);
    }
    return node.kind === "section" ? node.children : [];
  }
}
