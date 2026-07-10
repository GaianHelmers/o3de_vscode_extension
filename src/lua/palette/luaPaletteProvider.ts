// ============================================================================
//  Lua Function Palette — a browsable tree of the reflected O3DE API.
//
//  The VS Code equivalent of the built-in Lua IDE's "Class Reference" panel:
//  a searchable Classes / EBuses / Globals tree, fed by the same reflection dump
//  that drives IntelliSense (user/lua_symbols.json). Clicking a symbol inserts a
//  call snippet into the active Lua editor.
//
//  Lives as a second view under the O3DE activity-bar container, alongside the
//  Dashboard. Refreshes after a dump is generated; can be revealed on handoff.
// ============================================================================

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { detectProjectRoot } from "../projectPaths";
import { parseReflectionDump, ReflectionDump } from "../intellisense/symbols";
import { parseSignature } from "../intellisense/signature";

// ---- Tree node model -------------------------------------------------------

type Node =
  | { kind: "message"; label: string; command?: vscode.Command }
  | { kind: "category"; label: string; category: "classes" | "ebuses" | "globals" }
  | { kind: "class"; name: string }
  | { kind: "ebus"; name: string }
  | { kind: "member"; label: string; detail: string; tooltip: string; insert: string; icon: string };

export const LUA_PALETTE_VIEW_ID = "o3de.luaPalette";

export class LuaPaletteProvider implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  private dump: ReflectionDump | undefined;
  private dumpPath: string | undefined;

  constructor() {
    this.load();
  }

  private filter = "";

  refresh(): void {
    this.load();
    this.changed.fire();
  }

  /** Filter the tree to entries whose name matches (case-insensitive). Empty clears it. */
  setFilter(text: string): void {
    this.filter = text.trim().toLowerCase();
    this.changed.fire();
  }

  get isFiltering(): boolean {
    return this.filter !== "";
  }

  private matches(name: string): boolean {
    return this.filter === "" || name.toLowerCase().includes(this.filter);
  }

  // When a filter is active, auto-expand containers so matches are visible without clicking.
  private collapseState(): vscode.TreeItemCollapsibleState {
    return this.isFiltering
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed;
  }

  // Load user/lua_symbols.json from the detected project, if present.
  private load(): void {
    this.dump = undefined;
    const projectRoot = detectProjectRoot();
    if (!projectRoot) {
      return;
    }
    const dumpPath = path.join(projectRoot, "user", "lua_symbols.json");
    this.dumpPath = dumpPath;
    if (!fs.existsSync(dumpPath)) {
      return;
    }
    try {
      this.dump = parseReflectionDump(fs.readFileSync(dumpPath, "utf8"));
    } catch {
      this.dump = undefined;
    }
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case "message": {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.command = node.command;
        item.iconPath = new vscode.ThemeIcon("info");
        return item;
      }
      case "category": {
        const item = new vscode.TreeItem(node.label, this.collapseState());
        item.iconPath = new vscode.ThemeIcon("symbol-namespace");
        item.contextValue = "o3deLuaCategory";
        return item;
      }
      case "class": {
        const item = new vscode.TreeItem(node.name, this.collapseState());
        item.iconPath = new vscode.ThemeIcon("symbol-class");
        return item;
      }
      case "ebus": {
        const item = new vscode.TreeItem(node.name, this.collapseState());
        item.iconPath = new vscode.ThemeIcon("symbol-event");
        return item;
      }
      case "member": {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.description = node.detail;
        item.tooltip = new vscode.MarkdownString(node.tooltip);
        item.iconPath = new vscode.ThemeIcon(node.icon);
        item.command = {
          command: "o3de.luaPalette.insert",
          title: "Insert",
          arguments: [node.insert],
        };
        return item;
      }
    }
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      return this.roots();
    }
    if (node.kind === "category") {
      return node.category === "classes"
        ? this.classNodes()
        : node.category === "ebuses"
          ? this.ebusNodes()
          : this.globalNodes();
    }
    if (node.kind === "class") {
      return this.classMembers(node.name);
    }
    if (node.kind === "ebus") {
      return this.ebusMembers(node.name);
    }
    return [];
  }

  // ---- Level builders ------------------------------------------------------

  private roots(): Node[] {
    if (!this.dump) {
      return [
        {
          kind: "message",
          label: "No reflected API yet — click to generate",
          command: { command: "o3de.generateLuaIntelliSense", title: "Generate Lua IntelliSense" },
        },
      ];
    }
    // Counts reflect the active filter; when filtering, hide categories with no hits.
    const classCount = this.classNodes().length;
    const ebusCount = this.ebusNodes().length;
    const globalCount = this.globalNodes().length;

    const cats: Node[] = [
      { kind: "category", label: `Classes (${classCount})`, category: "classes" },
      { kind: "category", label: `EBuses (${ebusCount})`, category: "ebuses" },
      { kind: "category", label: `Globals (${globalCount})`, category: "globals" },
    ];
    if (!this.isFiltering) {
      return cats;
    }
    const counts = [classCount, ebusCount, globalCount];
    const shown = cats.filter((_, i) => counts[i] > 0);
    if (shown.length === 0) {
      return [
        {
          kind: "message",
          label: `No API symbols match "${this.filter}"`,
          command: { command: "o3de.luaPalette.clearFilter", title: "Clear Filter" },
        },
      ];
    }
    return shown;
  }

  private classNodes(): Node[] {
    const classes = (this.dump?.classes ?? []).filter(
      (c) => this.matches(c.name) || c.methods.some((m) => this.matches(m.name)) || c.properties.some((p) => this.matches(p.name)),
    );
    return sortByName(classes).map((c) => ({ kind: "class", name: c.name }));
  }

  private ebusNodes(): Node[] {
    const buses = (this.dump?.ebuses ?? []).filter(
      (b) => this.matches(b.name) || b.senders.some((s) => this.matches(s.name)),
    );
    return sortByName(buses).map((b) => ({ kind: "ebus", name: b.name }));
  }

  private classMembers(className: string): Node[] {
    const cls = this.dump?.classes.find((c) => c.name === className);
    if (!cls) {
      return [];
    }
    // If the class itself matched, show all members; otherwise only matching ones.
    const keep = (name: string): boolean => this.matches(className) || this.matches(name);
    const methods = sortByName(cls.methods.filter((m) => keep(m.name))).map<Node>((m) => {
      const sig = signatureText(m.debugArgumentInfo);
      return {
        kind: "member",
        label: m.name,
        detail: sig,
        tooltip: `**${className}:${m.name}**${sig}\n\n_method_`,
        insert: `${m.name}($0)`,
        icon: "symbol-method",
      };
    });
    const properties = sortByName(cls.properties.filter((p) => keep(p.name))).map<Node>((p) => ({
      kind: "member",
      label: p.name,
      detail: p.canWrite ? "" : "read-only",
      tooltip: `**${className}.${p.name}**\n\n_property (${p.canRead ? "R" : "-"}${p.canWrite ? "W" : "-"})_`,
      insert: p.name,
      icon: "symbol-field",
    }));
    return [...methods, ...properties];
  }

  private ebusMembers(busName: string): Node[] {
    const bus = this.dump?.ebuses.find((b) => b.name === busName);
    if (!bus) {
      return [];
    }
    const keep = (name: string): boolean => this.matches(busName) || this.matches(name);
    return sortByName(bus.senders.filter((s) => keep(s.name))).map<Node>((s) => {
      const sig = signatureText(s.debugArgumentInfo);
      const table = s.category === "Event" ? "Event" : s.category === "Broadcast" ? "Broadcast" : "Notification";
      const insert =
        s.category === "Notification"
          ? `${s.name}` // handler callback name
          : s.category === "Event"
            ? `${busName}.Event.${s.name}($0)`
            : `${busName}.Broadcast.${s.name}($0)`;
      return {
        kind: "member",
        label: s.name,
        detail: `${table}${sig}`,
        tooltip: `**${busName}.${table}.${s.name}**${sig}\n\n_${table.toLowerCase()}_`,
        insert,
        icon: s.category === "Notification" ? "symbol-event" : "symbol-method",
      };
    });
  }

  private globalNodes(): Node[] {
    const fns = sortByName((this.dump?.globalFunctions ?? []).filter((f) => this.matches(f.name))).map<Node>((f) => {
      const sig = signatureText(f.debugArgumentInfo);
      return {
        kind: "member",
        label: f.name,
        detail: sig,
        tooltip: `**${f.name}**${sig}\n\n_global function_`,
        insert: `${f.name}($0)`,
        icon: "symbol-function",
      };
    });
    const props = sortByName((this.dump?.globalProperties ?? []).filter((p) => this.matches(p.name))).map<Node>((p) => ({
      kind: "member",
      label: p.name,
      detail: p.canWrite ? "" : "read-only",
      tooltip: `**${p.name}**\n\n_global property_`,
      insert: p.name,
      icon: "symbol-variable",
    }));
    return [...fns, ...props];
  }
}

// ---- Insert command --------------------------------------------------------

/** Insert a palette symbol as a snippet at the cursor (or copy it if no editor). */
export async function insertLuaSymbol(insertText: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.languageId === "lua") {
    await editor.insertSnippet(new vscode.SnippetString(insertText));
    return;
  }
  await vscode.env.clipboard.writeText(insertText.replace("$0", ""));
  void vscode.window.showInformationMessage(`Copied "${insertText.replace("$0", "")}" to the clipboard.`);
}

// ---- Helpers ---------------------------------------------------------------

function signatureText(debugArgumentInfo: string): string {
  const sig = parseSignature(debugArgumentInfo);
  const params = sig.params.map((p) => `${p.name}: ${p.luaType}`).join(", ");
  const ret = sig.returnType ? `: ${sig.returnType}` : "";
  return `(${params})${ret}`;
}

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}
