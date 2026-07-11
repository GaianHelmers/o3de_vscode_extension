// ============================================================================
//  Palette model — the data the webview renders, plus the member factories that
//  format each reflected symbol into a row. Shared by the flat view (built in the
//  provider) and the categorized tree (built in categoryTree.ts) so both paths
//  produce byte-identical rows — the only difference is how they're grouped.
// ============================================================================

import { MethodSymbol, PropertySymbol, EBusSymbol, EBusSender } from "../intellisense/symbols";
import { parseSignature } from "../intellisense/signature";

// ---- Row / node model handed to the webview --------------------------------

export type MemberKind = "method" | "property" | "event" | "function" | "variable";

export interface PaletteMember {
  label: string;
  detail: string; // signature / "read-only" / table name — the dim right-hand text
  tooltip: string;
  insert: string; // snippet inserted on click ($0 = cursor)
  kind: MemberKind;
}

export interface PaletteContainer {
  name: string;
  kind: "class" | "ebus";
  members: PaletteMember[];
}

/** A node in the categorized tree: a branch (folder / class / ebus) with
 *  children, or a leaf carrying a member. Only present when a category
 *  dictionary was found; otherwise the flat classes/ebuses/globals are used. */
export interface PaletteNode {
  label: string;
  kind: "folder" | "class" | "ebus" | MemberKind;
  children?: PaletteNode[]; // branch nodes
  member?: PaletteMember; // leaf nodes
}

export interface PaletteModel {
  hasDump: boolean;
  classes: PaletteContainer[];
  ebuses: PaletteContainer[];
  globals: PaletteMember[];
  tree?: PaletteNode[]; // categorized view (Node Palette layout); absent → flat view
}

// ---- Member factories (single source of row formatting) --------------------

export function methodMember(className: string, m: MethodSymbol): PaletteMember {
  const sig = signatureText(m.debugArgumentInfo);
  return {
    label: m.name,
    detail: sig,
    tooltip: `${className}:${m.name}${sig} — method`,
    insert: `${m.name}($0)`,
    kind: "method",
  };
}

export function propertyMember(className: string, p: PropertySymbol): PaletteMember {
  return {
    label: p.name,
    detail: p.canWrite ? "" : "read-only",
    tooltip: `${className}.${p.name} — property (${p.canRead ? "R" : "-"}${p.canWrite ? "W" : "-"})`,
    insert: p.name,
    kind: "property",
  };
}

export function senderMember(bus: EBusSymbol, s: EBusSender): PaletteMember {
  const sig = signatureText(s.debugArgumentInfo);
  const table = s.category === "Event" ? "Event" : s.category === "Broadcast" ? "Broadcast" : "Notification";
  const insert =
    s.category === "Notification"
      ? `${s.name}` // handler callback name
      : s.category === "Event"
        ? `${bus.name}.Event.${s.name}($0)`
        : `${bus.name}.Broadcast.${s.name}($0)`;
  return {
    label: s.name,
    detail: `${table}${sig}`,
    tooltip: `${bus.name}.${table}.${s.name}${sig} — ${table.toLowerCase()}`,
    insert,
    kind: s.category === "Notification" ? "event" : "method",
  };
}

export function globalFunctionMember(f: MethodSymbol): PaletteMember {
  const sig = signatureText(f.debugArgumentInfo);
  return { label: f.name, detail: sig, tooltip: `${f.name}${sig} — global function`, insert: `${f.name}($0)`, kind: "function" };
}

export function globalPropertyMember(p: PropertySymbol): PaletteMember {
  return { label: p.name, detail: p.canWrite ? "" : "read-only", tooltip: `${p.name} — global property`, insert: p.name, kind: "variable" };
}

// ---- Helpers ---------------------------------------------------------------

export function signatureText(debugArgumentInfo: string): string {
  const sig = parseSignature(debugArgumentInfo);
  const params = sig.params.map((p) => `${p.name}: ${p.luaType}`).join(", ");
  const ret = sig.returnType ? `: ${sig.returnType}` : "";
  return `(${params})${ret}`;
}
