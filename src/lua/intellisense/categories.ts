// ============================================================================
//  Symbol category dictionary — the engine-side join file for the Lua palette.
//
//  Produced by the O3DE ScriptCanvasEditor gem's LuaSymbolCategoryReporter
//  (dump_lua_symbol_categories.py) as `<project>/lua_symbol_categories.json`.
//  It carries the FINAL, already-resolved Script Canvas category PATH for each
//  reflected symbol (translation override → Category attribute → default bucket).
//
//  The extension does NO resolution: it looks each scraped symbol up by identity
//  and nests it under the path verbatim. A miss (or an absent file / pre-change
//  engine) → the symbol stays uncategorized and falls back to the flat tree.
//
//  Contract: .serena/memories/RemoteTools/category_dictionary_contract (engine repo).
//    classes          → join by typeId (normalize brace/case both sides)
//    globalMethods    → join by name
//    globalProperties → join by name
//    ebuses           → join by name (senderCategory for Event/Broadcast,
//                                     handlerCategory for Notification)
// ============================================================================

import * as fs from "fs";
import * as path from "path";

export const CATEGORIES_FILENAME = "lua_symbol_categories.json";

// ---- Model -----------------------------------------------------------------

export interface SymbolCategories {
  classes: Map<string, string>; // normalized typeId → category path
  globalMethods: Map<string, string>; // name → category path
  globalProperties: Map<string, string>; // name → category path
  ebusSenders: Map<string, string>; // ebus name → sender (Event/Broadcast) path
  ebusHandlers: Map<string, string>; // ebus name → handler (Notification) path
  counts: { classes: number; globalMethods: number; globalProperties: number; ebuses: number };
}

/** A typeId compared join-safe: braces stripped, lowercased. `{AB-…}` == `ab-…`. */
export function normalizeTypeId(id: string): string {
  return id.replace(/[{}]/g, "").trim().toLowerCase();
}

/** True when the dictionary carries no usable category — treat as "no categories". */
export function isEmptyCategories(cats: SymbolCategories | undefined): boolean {
  if (!cats) {
    return true;
  }
  return (
    cats.classes.size === 0 &&
    cats.globalMethods.size === 0 &&
    cats.globalProperties.size === 0 &&
    cats.ebusSenders.size === 0 &&
    cats.ebusHandlers.size === 0
  );
}

// ---- Parse -----------------------------------------------------------------

/** Parse the dictionary JSON. Throws with a clear message on malformed JSON. */
export function parseSymbolCategories(json: string): SymbolCategories {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new Error(`Category dictionary is not valid JSON: ${(err as Error).message}`);
  }
  const obj = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  const cats: SymbolCategories = {
    classes: new Map(),
    globalMethods: new Map(),
    globalProperties: new Map(),
    ebusSenders: new Map(),
    ebusHandlers: new Map(),
    counts: { classes: 0, globalMethods: 0, globalProperties: 0, ebuses: 0 },
  };

  // classes: [{ typeId, name, category }] — keyed by normalized typeId.
  for (const row of asArray(obj.classes)) {
    const typeId = str(row.typeId);
    const category = str(row.category).trim();
    if (typeId && category) {
      cats.classes.set(normalizeTypeId(typeId), category);
    }
  }
  cats.counts.classes = asArray(obj.classes).length;

  // globalMethods / globalProperties: [{ name, category }] — keyed by name.
  for (const row of asArray(obj.globalMethods)) {
    fill(cats.globalMethods, str(row.name), str(row.category));
  }
  cats.counts.globalMethods = asArray(obj.globalMethods).length;

  for (const row of asArray(obj.globalProperties)) {
    fill(cats.globalProperties, str(row.name), str(row.category));
  }
  cats.counts.globalProperties = asArray(obj.globalProperties).length;

  // ebuses: [{ name, senderCategory, handlerCategory }] — split into two maps.
  for (const row of asArray(obj.ebuses)) {
    const name = str(row.name);
    fill(cats.ebusSenders, name, str(row.senderCategory));
    fill(cats.ebusHandlers, name, str(row.handlerCategory));
  }
  cats.counts.ebuses = asArray(obj.ebuses).length;

  return cats;
}

/** Load `<projectRoot>/lua_symbol_categories.json` (contract location), then the
 *  `user/` sibling as a fallback. Returns undefined when absent or unreadable. */
export function loadSymbolCategories(projectRoot: string): SymbolCategories | undefined {
  for (const candidate of [
    path.join(projectRoot, CATEGORIES_FILENAME),
    path.join(projectRoot, "user", CATEGORIES_FILENAME),
  ]) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    try {
      return parseSymbolCategories(fs.readFileSync(candidate, "utf8"));
    } catch {
      return undefined; // malformed — degrade to the flat tree
    }
  }
  return undefined;
}

// ---- Helpers ---------------------------------------------------------------

function fill(map: Map<string, string>, name: string, category: string): void {
  const trimmed = category.trim();
  if (name && trimmed) {
    map.set(name, trimmed);
  }
}

function asArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v.filter((e) => typeof e === "object" && e !== null) as Record<string, unknown>[]) : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
