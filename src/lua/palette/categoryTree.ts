// ============================================================================
//  Categorized palette tree — joins the reflected symbol set with the engine's
//  category dictionary into the Script Canvas Node Palette layout (pure; no VS
//  Code dependency, so unit-testable).
//
//  Only used when a dictionary (lua_symbol_categories.json) is present; without
//  it the provider keeps the classic flat Classes / EBuses / Globals view.
//
//  Join rules (per the engine contract, category_dictionary_contract):
//   - class  → join by typeId; the path's LAST segment IS the class, its members
//              nest directly under it (don't re-append the class name).
//   - global → join by name; the path is a folder, the symbol is a leaf under it.
//   - ebus   → join by name; Notification senders use handlerCategory, Event /
//              Broadcast senders use senderCategory; senders are leaves there.
//   - any miss → a sensible default bucket, so no symbol disappears.
// ============================================================================

import { ReflectionDump, ClassSymbol } from "../intellisense/symbols";
import { SymbolCategories, normalizeTypeId } from "../intellisense/categories";
import {
  PaletteNode,
  PaletteMember,
  methodMember,
  propertyMember,
  senderMember,
  globalFunctionMember,
  globalPropertyMember,
} from "./paletteModel";

// Default buckets for symbols the dictionary doesn't cover.
const BUCKET_CLASSES = "Classes";
const BUCKET_EBUSES = "EBuses";
const BUCKET_GLOBAL_METHODS = "Global Methods";
const BUCKET_GLOBAL_CONSTANTS = "Global Constants";
const BUCKET_EVENT_HANDLERS = "Event Handlers";

// ============================================================================
//  Public entry
// ============================================================================

export function buildCategoryTree(dump: ReflectionDump, cats: SymbolCategories): PaletteNode[] {
  const roots: PaletteNode[] = [];
  const folders = new Map<string, PaletteNode>(); // full path → branch node (dedup)

  placeClasses(dump, cats, roots, folders);
  placeGlobals(dump, cats, roots, folders);
  placeEBuses(dump, cats, roots, folders);

  sortNodes(roots);
  return roots;
}

// ============================================================================
//  Placement
// ============================================================================

// Classes — the category path's last segment IS the class; members nest under it.
function placeClasses(
  dump: ReflectionDump,
  cats: SymbolCategories,
  roots: PaletteNode[],
  folders: Map<string, PaletteNode>,
): void {
  for (const c of dump.classes) {
    const category = cats.classes.get(normalizeTypeId(c.typeId));
    const segments = category ? splitPath(category) : [BUCKET_CLASSES, c.name];
    const parent = ensurePath(roots, folders, segments.slice(0, -1));
    const classNode = ensureClass(parent, folders, segments, c);
    for (const m of classMembers(c)) {
      classNode.children!.push(m);
    }
  }
}

// Global methods / properties — a leaf appended under the category folder.
function placeGlobals(
  dump: ReflectionDump,
  cats: SymbolCategories,
  roots: PaletteNode[],
  folders: Map<string, PaletteNode>,
): void {
  for (const f of dump.globalFunctions) {
    const category = cats.globalMethods.get(f.name);
    const folder = ensurePath(roots, folders, category ? splitPath(category) : [BUCKET_GLOBAL_METHODS]);
    folder.children!.push(leaf(globalFunctionMember(f)));
  }
  for (const p of dump.globalProperties) {
    const category = cats.globalProperties.get(p.name);
    const folder = ensurePath(roots, folders, category ? splitPath(category) : [BUCKET_GLOBAL_CONSTANTS]);
    folder.children!.push(leaf(globalPropertyMember(p)));
  }
}

// EBus senders — Notification → handlerCategory, Event/Broadcast → senderCategory.
function placeEBuses(
  dump: ReflectionDump,
  cats: SymbolCategories,
  roots: PaletteNode[],
  folders: Map<string, PaletteNode>,
): void {
  for (const b of dump.ebuses) {
    for (const s of b.senders) {
      const isHandler = s.category === "Notification";
      const category = isHandler ? cats.ebusHandlers.get(b.name) : cats.ebusSenders.get(b.name);
      const fallback = isHandler ? [BUCKET_EVENT_HANDLERS, b.name] : [BUCKET_EBUSES, b.name];
      const folder = ensurePath(roots, folders, category ? splitPath(category) : fallback);
      folder.children!.push(leaf(senderMember(b, s)));
    }
  }
}

// ============================================================================
//  Tree construction
// ============================================================================

// Walk/create folder nodes for `segments`, returning the terminal folder.
function ensurePath(roots: PaletteNode[], folders: Map<string, PaletteNode>, segments: string[]): PaletteNode {
  let siblings = roots;
  let prefix = "";
  let node: PaletteNode | undefined;
  for (const seg of segments) {
    prefix = prefix ? `${prefix}/${seg}` : seg;
    node = folders.get(prefix);
    if (!node) {
      node = { label: seg, kind: "folder", children: [] };
      folders.set(prefix, node);
      siblings.push(node);
    }
    siblings = node.children!;
  }
  // segments empty only for a root-level class (category is a single segment) —
  // hand back a holder whose children array IS the roots list.
  return node ?? { label: "", kind: "folder", children: roots };
}

// Create (or reuse) the class node at the end of `segments`. Registered in the
// folder map so anything nesting deeper reuses it instead of duplicating.
function ensureClass(
  parent: PaletteNode,
  folders: Map<string, PaletteNode>,
  segments: string[],
  c: ClassSymbol,
): PaletteNode {
  const fullPath = segments.join("/");
  const existing = folders.get(fullPath);
  if (existing) {
    return existing;
  }
  const node: PaletteNode = { label: segments[segments.length - 1] ?? c.name, kind: "class", children: [] };
  folders.set(fullPath, node);
  parent.children!.push(node);
  return node;
}

function classMembers(c: ClassSymbol): PaletteNode[] {
  const methods = c.methods.map((m) => leaf(methodMember(c.name, m)));
  const properties = c.properties.map((p) => leaf(propertyMember(c.name, p)));
  return [...methods, ...properties];
}

function leaf(member: PaletteMember): PaletteNode {
  return { label: member.label, kind: member.kind, member };
}

// ============================================================================
//  Sorting — branches (folder/class/ebus) first, then members; each alphabetical
// ============================================================================

function sortNodes(nodes: PaletteNode[]): void {
  nodes.sort(compareNodes);
  for (const n of nodes) {
    if (n.children && n.children.length > 0) {
      sortNodes(n.children);
    }
  }
}

function compareNodes(a: PaletteNode, b: PaletteNode): number {
  const aBranch = a.children !== undefined;
  const bBranch = b.children !== undefined;
  if (aBranch !== bBranch) {
    return aBranch ? -1 : 1;
  }
  return a.label.localeCompare(b.label);
}

function splitPath(category: string): string[] {
  return category
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
