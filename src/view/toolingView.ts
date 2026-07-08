// ============================================================================
//  O3DE Onboarding view — the collapsible tree at the bottom of the O3DE tab.
//
//    Onboarding/        (collapsed) — one-time startup; a red dot marks pending work
//      Prerequisites/     Visual Studio + Ninja (auto-detected)
//      Workspace/         Set Up O3DE Workspace… + Add Gems / Folders…
//
//  Build & Run, Utilities, and the Configuration list live in the Dashboard
//  webview (see dashboardView.ts). This file backs only the Onboarding tree.
//
//  Onboarding status is dynamic — the provider rebuilds its roots fresh so the
//  tree reflects the current completion.
// ============================================================================

import * as vscode from "vscode";
import { OnboardingStatus } from "./onboardingStatus";

// ---- Model -----------------------------------------------------------------
interface ActionNode {
  kind: "action";
  label: string;
  command: string;
  icon: string;
  tooltip?: string;
  description?: string; // dimmed text after the label (e.g. current selection / status)
  statusColor?: string; // ThemeColor id tinting the icon (e.g. "charts.green")
}

interface SectionNode {
  kind: "section";
  label: string;
  icon: string;
  description?: string; // dimmed status text after the label
  statusColor?: string; // ThemeColor id tinting the icon
  children: Node[]; // sections may nest sections
}

type Node = SectionNode | ActionNode;

// ---- Completion markers ----------------------------------------------------
// A green filled check when done, a red dot when there's still work to do.
const DONE_ICON = "pass-filled";
const DONE_COLOR = "charts.green";
const PENDING_ICON = "circle-filled";
const PENDING_COLOR = "charts.red";

function mark(done: boolean): { icon: string; statusColor: string } {
  return done
    ? { icon: DONE_ICON, statusColor: DONE_COLOR }
    : { icon: PENDING_ICON, statusColor: PENDING_COLOR };
}

// ---- Onboarding roots ------------------------------------------------------
export function onboardingRoots(status: OnboardingStatus): Node[] {
  return [
    {
      kind: "section",
      label: "Prerequisites",
      ...mark(status.prerequisitesComplete),
      description: status.prerequisitesComplete ? "Ready" : "Action needed",
      children: [
        {
          kind: "action",
          label: "Visual Studio",
          description: status.hasVisualStudio ? "ready" : "not found",
          statusColor: status.hasVisualStudio ? DONE_COLOR : PENDING_COLOR,
          command: "o3de.checkVisualStudio",
          icon: status.hasVisualStudio ? "verified" : "warning",
          tooltip: "Detect the Visual Studio (MSVC) toolchain",
        },
        {
          kind: "action",
          label: "Ninja",
          description: status.hasNinja ? "installed" : "not found",
          statusColor: status.hasNinja ? DONE_COLOR : PENDING_COLOR,
          command: "o3de.checkNinja",
          icon: status.hasNinja ? "verified" : "warning",
          tooltip: "Detect Ninja, or offer to install it",
        },
      ],
    },
    {
      kind: "section",
      label: "Workspace",
      ...mark(status.workspaceComplete),
      description: status.workspaceComplete ? "Configured" : "Action needed",
      children: [
        {
          kind: "action",
          label: "Set Up O3DE Workspace…",
          description: workspaceSummary(status),
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
  ];
}

/** One-line "project ✓ · engine ✗" summary for the Set Up row. */
function workspaceSummary(status: OnboardingStatus): string {
  const project = status.hasProject ? "project ✓" : "project ✗";
  const engine = status.hasEngineSource ? "engine ✓" : "engine ✗";
  return `${project} · ${engine}`;
}

// ---- Tree item construction ------------------------------------------------
function toTreeItem(node: Node): vscode.TreeItem {
  if (node.kind === "section") {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
    item.iconPath = themeIcon(node.icon, node.statusColor);
    if (node.description !== undefined) {
      item.description = node.description;
    }
    item.contextValue = "section";
    return item;
  }
  const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
  item.command = { command: node.command, title: node.label };
  item.iconPath = themeIcon(node.icon, node.statusColor);
  item.tooltip = node.tooltip ?? node.label;
  if (node.description !== undefined) {
    item.description = node.description;
  }
  item.contextValue = "action";
  return item;
}

function themeIcon(icon: string, statusColor?: string): vscode.ThemeIcon {
  return statusColor
    ? new vscode.ThemeIcon(icon, new vscode.ThemeColor(statusColor))
    : new vscode.ThemeIcon(icon);
}

// ---- Generic section-tree provider -----------------------------------------
//  Renders a flat list of top-level Nodes (the view's roots), refreshing when
//  the caller's source fires. One instance per view (Configuration / Onboarding).
export class SectionTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(
    private readonly roots: () => Node[],
    subscribe: (fire: () => void) => void,
  ) {
    subscribe(() => this.changed.fire());
  }

  getTreeItem(node: Node): vscode.TreeItem {
    return toTreeItem(node);
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      return this.roots();
    }
    return node.kind === "section" ? node.children : [];
  }
}
