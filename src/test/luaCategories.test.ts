// Tests for the Lua palette category bridge: the dictionary loader (categories.ts)
// and the scrape↔dictionary join that builds the nested tree (categoryTree.ts).
import * as assert from "assert";
import { normalizeTypeId, parseSymbolCategories, isEmptyCategories } from "../lua/intellisense/categories";
import { buildCategoryTree } from "../lua/palette/categoryTree";
import { PaletteNode } from "../lua/palette/paletteModel";
import { ReflectionDump } from "../lua/intellisense/symbols";

// ---- Fixtures --------------------------------------------------------------

const DUMP: ReflectionDump = {
  version: 1,
  classes: [
    {
      name: "Vector3",
      typeId: "{AAAAAAAA-1111-2222-3333-444444444444}",
      methods: [{ name: "Dot", debugArgumentInfo: "" }],
      properties: [{ name: "x", canRead: true, canWrite: true }],
    },
    { name: "Uncat", typeId: "{BBBBBBBB-0000-0000-0000-000000000000}", methods: [], properties: [] },
  ],
  globalFunctions: [
    { name: "GetTime", debugArgumentInfo: "" },
    { name: "OrphanFn", debugArgumentInfo: "" },
  ],
  globalProperties: [{ name: "g_max", canRead: true, canWrite: false }],
  ebuses: [
    {
      name: "TransformBus",
      canBroadcast: true,
      canQueue: false,
      hasHandler: true,
      senders: [
        { name: "GetWorldTM", debugArgumentInfo: "", category: "Event" },
        { name: "OnParentChanged", debugArgumentInfo: "", category: "Notification" },
      ],
    },
  ],
};

// Note: the class typeId here is lowercase + brace-less to prove normalization on join.
const CATEGORIES_JSON = JSON.stringify({
  classes: [{ typeId: "aaaaaaaa-1111-2222-3333-444444444444", name: "Vector3", category: "Math/Vector3" }],
  globalMethods: [{ name: "GetTime", category: "Utilities/Time" }],
  globalProperties: [{ name: "g_max", category: "Global Constants" }],
  ebuses: [
    {
      name: "TransformBus",
      senderCategory: "Gameplay/Transform/Transform",
      handlerCategory: "Event Handlers/TransformNotificationBus",
    },
  ],
});

// ---- Tree navigation helpers -----------------------------------------------

function child(nodes: PaletteNode[] | undefined, label: string): PaletteNode | undefined {
  return (nodes ?? []).find((n) => n.label === label);
}
function at(roots: PaletteNode[], segments: string[]): PaletteNode | undefined {
  let cur: PaletteNode | undefined = { label: "", kind: "folder", children: roots };
  for (const s of segments) {
    cur = child(cur?.children, s);
    if (!cur) {
      return undefined;
    }
  }
  return cur;
}

// ============================================================================
//  categories.ts — loader / parser
// ============================================================================

suite("lua categories — dictionary parse", () => {
  test("normalizeTypeId strips braces and lowercases", () => {
    assert.strictEqual(normalizeTypeId("{ABCD-EF}"), "abcd-ef");
    assert.strictEqual(normalizeTypeId("abcd-ef"), "abcd-ef");
    assert.strictEqual(normalizeTypeId("  {AbCd}  "), "abcd");
  });

  test("parse builds the five join maps and counts", () => {
    const cats = parseSymbolCategories(CATEGORIES_JSON);
    assert.strictEqual(cats.classes.get("aaaaaaaa-1111-2222-3333-444444444444"), "Math/Vector3");
    assert.strictEqual(cats.globalMethods.get("GetTime"), "Utilities/Time");
    assert.strictEqual(cats.globalProperties.get("g_max"), "Global Constants");
    assert.strictEqual(cats.ebusSenders.get("TransformBus"), "Gameplay/Transform/Transform");
    assert.strictEqual(cats.ebusHandlers.get("TransformBus"), "Event Handlers/TransformNotificationBus");
    assert.deepStrictEqual(cats.counts, { classes: 1, globalMethods: 1, globalProperties: 1, ebuses: 1 });
  });

  test("rows with an empty category are skipped; empty dict reads as empty", () => {
    const cats = parseSymbolCategories(
      JSON.stringify({ classes: [{ typeId: "{X}", name: "X", category: "" }], globalMethods: [], globalProperties: [], ebuses: [] }),
    );
    assert.strictEqual(cats.classes.size, 0);
    assert.strictEqual(isEmptyCategories(cats), true);
    assert.strictEqual(isEmptyCategories(undefined), true);
    assert.strictEqual(isEmptyCategories(parseSymbolCategories(CATEGORIES_JSON)), false);
  });

  test("malformed JSON throws a clear error", () => {
    assert.throws(() => parseSymbolCategories("{ not json"), /not valid JSON/);
  });
});

// ============================================================================
//  categoryTree.ts — the scrape ↔ dictionary join
// ============================================================================

suite("lua categories — nested tree join", () => {
  const roots = buildCategoryTree(DUMP, parseSymbolCategories(CATEGORIES_JSON));

  test("class joins by (normalized) typeId; its members nest directly under it — no double leaf", () => {
    const vector3 = at(roots, ["Math", "Vector3"]);
    assert.ok(vector3, "Vector3 sits at Math/Vector3");
    assert.strictEqual(vector3!.kind, "class");
    assert.ok(child(vector3!.children, "Dot"), "method Dot under Vector3");
    assert.ok(child(vector3!.children, "x"), "property x under Vector3");
    // The class name is the last path segment — it must NOT be appended again.
    assert.strictEqual(at(roots, ["Math", "Vector3", "Vector3"]), undefined);
  });

  test("an unlisted class falls into the default Classes bucket", () => {
    assert.ok(at(roots, ["Classes", "Uncat"]), "Uncat under Classes");
  });

  test("global method/property join by name; misses hit their default buckets", () => {
    assert.ok(child(at(roots, ["Utilities", "Time"])?.children, "GetTime"), "GetTime under Utilities/Time");
    assert.ok(child(at(roots, ["Global Methods"])?.children, "OrphanFn"), "unlisted global fn → Global Methods");
    assert.ok(child(at(roots, ["Global Constants"])?.children, "g_max"), "g_max → Global Constants");
  });

  test("ebus senders split: Event → senderCategory, Notification → handlerCategory", () => {
    assert.ok(
      child(at(roots, ["Gameplay", "Transform", "Transform"])?.children, "GetWorldTM"),
      "Event sender under senderCategory",
    );
    assert.ok(
      child(at(roots, ["Event Handlers", "TransformNotificationBus"])?.children, "OnParentChanged"),
      "Notification handler under handlerCategory",
    );
  });

  test("no dictionary is signalled by isEmptyCategories → provider keeps the flat view", () => {
    // buildCategoryTree is only called with a non-empty dict; the guard lives in the provider.
    assert.strictEqual(isEmptyCategories(undefined), true);
  });
});
