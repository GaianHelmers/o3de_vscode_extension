// Tests for the LuaLS stub generation pipeline (signature parsing + generator).
import * as assert from "assert";
import { mapAzTypeToLua, parseSignature } from "../lua/intellisense/signature";
import { generateStubs } from "../lua/intellisense/stubGenerator";
import { parseReflectionDump, ReflectionDump } from "../lua/intellisense/symbols";

suite("Lua IntelliSense — type mapping", () => {
  test("maps primitives to Lua types", () => {
    assert.strictEqual(mapAzTypeToLua("float"), "number");
    assert.strictEqual(mapAzTypeToLua("bool"), "boolean");
    assert.strictEqual(mapAzTypeToLua("AZStd::string"), "string");
    assert.strictEqual(mapAzTypeToLua("const char*"), "string");
    assert.strictEqual(mapAzTypeToLua("void"), "nil");
  });

  test("passes reflected class names through", () => {
    assert.strictEqual(mapAzTypeToLua("Vector3"), "Vector3");
    assert.strictEqual(mapAzTypeToLua("EntityId"), "EntityId");
  });

  test("maps containers", () => {
    assert.strictEqual(mapAzTypeToLua("AZStd::vector<float>"), "number[]");
    assert.strictEqual(mapAzTypeToLua("AZStd::vector<Vector3>"), "Vector3[]");
    assert.strictEqual(mapAzTypeToLua("AZStd::unordered_map<AZStd::string, int>"), "table<string, number>");
  });

  test("unknown junk degrades to any", () => {
    assert.strictEqual(mapAzTypeToLua(""), "any");
    assert.strictEqual(mapAzTypeToLua("<<<"), "any");
  });
});

suite("Lua IntelliSense — signature parsing", () => {
  test("parses return + typed args", () => {
    const sig = parseSignature("[=Vector3] Vector3 rhs");
    assert.strictEqual(sig.returnType, "Vector3");
    assert.deepStrictEqual(sig.params, [{ name: "rhs", luaType: "Vector3" }]);
  });

  test("parses multiple args", () => {
    const sig = parseSignature("float x, float y, float z");
    assert.strictEqual(sig.returnType, undefined);
    assert.deepStrictEqual(
      sig.params.map((p) => `${p.name}:${p.luaType}`),
      ["x:number", "y:number", "z:number"],
    );
  });

  test("void return yields no returnType", () => {
    const sig = parseSignature("[=void] float value");
    assert.strictEqual(sig.returnType, undefined);
  });

  test("empty info → no params", () => {
    const sig = parseSignature("");
    assert.deepStrictEqual(sig.params, []);
    assert.strictEqual(sig.variadic, false);
  });

  test("variadic", () => {
    const sig = parseSignature("...");
    assert.strictEqual(sig.variadic, true);
    assert.strictEqual(sig.params[0].name, "...");
  });

  test("type-only arg gets a synthetic name", () => {
    const sig = parseSignature("Vector3");
    assert.strictEqual(sig.params[0].name, "arg1");
    assert.strictEqual(sig.params[0].luaType, "Vector3");
  });

  test("template commas don't split args", () => {
    const sig = parseSignature("AZStd::vector<int, allocator> items");
    assert.strictEqual(sig.params.length, 1);
    assert.strictEqual(sig.params[0].name, "items");
    assert.strictEqual(sig.params[0].luaType, "number[]");
  });
});

// A compact but representative dump.
const DUMP: ReflectionDump = {
  version: 1,
  engine: "GS_Play_Engine",
  project: "DECOYPROGSGE",
  classes: [
    {
      name: "Vector3",
      typeId: "{8379EB7D-01FA-4538-B64B-A6543B4BE73D}",
      properties: [
        { name: "x", canRead: true, canWrite: true },
        { name: "y", canRead: true, canWrite: true },
      ],
      methods: [
        { name: "GetLength", debugArgumentInfo: "[=float] " },
        { name: "Add", debugArgumentInfo: "[=Vector3] Vector3 rhs" },
      ],
    },
  ],
  globalProperties: [{ name: "g_myConstant", canRead: true, canWrite: false }],
  globalFunctions: [{ name: "Print", debugArgumentInfo: "AZStd::string message" }],
  ebuses: [
    {
      name: "TransformBus",
      canBroadcast: true,
      canQueue: true,
      hasHandler: false,
      senders: [
        { name: "GetWorldTranslation", debugArgumentInfo: "[=Vector3] ", category: "Event" },
        { name: "SetWorldTranslation", debugArgumentInfo: "Vector3 translation", category: "Event" },
      ],
    },
    {
      name: "TickBus",
      canBroadcast: false,
      canQueue: false,
      hasHandler: true,
      senders: [{ name: "OnTick", debugArgumentInfo: "float deltaTime", category: "Notification" }],
    },
  ],
};

suite("Lua IntelliSense — stub generation", () => {
  const lua = generateStubs(DUMP);

  test("starts with ---@meta", () => {
    assert.ok(lua.startsWith("---@meta"), "meta header required for a definition file");
  });

  test("emits a class with fields and a callable constructor overload", () => {
    assert.match(lua, /---@class Vector3/);
    assert.match(lua, /---@field x any/);
    assert.match(lua, /---@overload fun\(\.\.\.\):Vector3/);
    assert.match(lua, /Vector3 = \{\}/);
  });

  test("emits colon methods with parsed params and returns", () => {
    assert.match(lua, /---@return Vector3\r?\nfunction Vector3:Add\(rhs\) end/);
    assert.match(lua, /---@param rhs Vector3/);
    assert.match(lua, /function Vector3:GetLength\(\) end/);
  });

  test("read-only property flagged", () => {
    assert.match(lua, /g_myConstant = nil/);
    assert.match(lua, /read-only/);
  });

  test("EBus Event senders take busId first and get Queue variants", () => {
    assert.match(lua, /TransformBus\.Event = \{\}/);
    assert.match(lua, /function TransformBus\.Event\.GetWorldTranslation\(busId\) end/);
    assert.match(lua, /function TransformBus\.Event\.SetWorldTranslation\(busId, translation\) end/);
    assert.match(lua, /TransformBus\.QueueEvent = \{\}/);
  });

  test("handler bus gets Connect/CreateHandler and lists notifications", () => {
    assert.match(lua, /function TickBus\.Connect\(handler, busId\) end/);
    assert.match(lua, /Notifications: OnTick/);
  });

  test("global function emitted", () => {
    assert.match(lua, /function Print\(message\) end/);
  });

  test("output round-trips through the dump parser", () => {
    const reparsed = parseReflectionDump(JSON.stringify(DUMP));
    assert.strictEqual(reparsed.classes.length, 1);
    assert.strictEqual(reparsed.ebuses.length, 2);
    assert.strictEqual(generateStubs(reparsed), lua);
  });
});
