// Tests for the O3DE remote-tools protocol codec (crc32, ObjectStream, packets).
import * as assert from "assert";
import { crc32 } from "../lua/proto/crc32";
import { encodeObjectStream } from "../lua/proto/objectStream";
import {
  MessageReassembler,
  PacketFramer,
  PacketType,
  parseRemoteToolsConnect,
  parseRemoteToolsMessage,
  writeRemoteToolsMessageBody,
  writeTcpHeader,
} from "../lua/proto/packets";
import {
  ACK,
  CMD,
  MSG,
  asAck,
  asBreakpointAck,
  asCallstack,
  asGetValueResult,
  asRegisteredClasses,
  asRegisteredEBuses,
  asRegisteredGlobals,
  asStringList,
  encodeBreakpointRequest,
  encodeScriptDebugRequest,
  encodeSetValue,
  parseMessage,
} from "../lua/proto/messages";
import { bytesToUuid, uuidToBytes } from "../lua/proto/uuid";

suite("Lua protocol — CRC32", () => {
  test("matches known AZ::Crc32 values (lowercased input)", () => {
    // Verified against the engine and the reference extraction notes.
    assert.strictEqual(crc32("LuaRemoteTools") >>> 0, 0x3a1e3b6a);
    assert.strictEqual(crc32("AttachDebugger") >>> 0, 0x6590ff36);
    assert.strictEqual(crc32("BreakpointHit") >>> 0, 0xf1a38e0b);
  });

  test("is case-insensitive (AZ lowercases)", () => {
    assert.strictEqual(crc32("Foo"), crc32("foo"));
    assert.strictEqual(crc32("FOO"), crc32("foo"));
  });
});

suite("Lua protocol — Uuid", () => {
  test("round-trips string ⇆ 16 bytes in canonical order", () => {
    const u = "{2137E01A-F2AE-4137-A17E-6B82F3B7E4DE}";
    const bytes = uuidToBytes(u);
    assert.strictEqual(bytes[0], 0x21);
    assert.strictEqual(bytes[15], 0xde);
    assert.strictEqual(bytesToUuid(bytes), u);
  });
});

suite("Lua protocol — ObjectStream round-trip", () => {
  test("ScriptDebugRequest encodes and decodes", () => {
    const bytes = encodeScriptDebugRequest(CMD.AttachDebugger, "Default");
    const { uuid, obj } = parseMessage(bytes);
    assert.strictEqual(uuid, MSG.ScriptDebugRequest);
    assert.strictEqual(Number(obj.request), CMD.AttachDebugger);
    assert.strictEqual(obj.context, "Default");
  });

  test("ScriptDebugBreakpointRequest carries the line (base fields flattened)", () => {
    const bytes = encodeBreakpointRequest(CMD.AddBreakpoint, "@scripts/foo.lua", 18);
    const { uuid, obj } = parseMessage(bytes);
    assert.strictEqual(uuid, MSG.ScriptDebugBreakpointRequest);
    assert.strictEqual(obj.context, "@scripts/foo.lua");
    assert.strictEqual(Number(obj.request), CMD.AddBreakpoint);
    assert.strictEqual(Number(obj.line), 18);
  });

  test("Ack result parses request + ackCode", () => {
    // Build an ack the way the agent would, then read it back.
    const encoded = encodeObjectStream(MSG.ScriptDebugAck, {
      MsgId: BigInt(crc32("ScriptDebugger")),
      request: CMD.AttachDebugger,
      ackCode: ACK.Ack,
    });
    const { uuid, obj } = parseMessage(encoded);
    assert.strictEqual(uuid, MSG.ScriptDebugAck);
    const ack = asAck(obj);
    assert.strictEqual(ack.request, CMD.AttachDebugger);
    assert.strictEqual(ack.ackCode, ACK.Ack);
  });

  test("BreakpointHit ack parses module + line", () => {
    const encoded = encodeObjectStream(MSG.ScriptDebugAckBreakpoint, {
      MsgId: BigInt(crc32("ScriptDebugger")),
      id: ACK.BreakpointHit,
      moduleName: "@scripts/foo.luac",
      line: 42,
    });
    const bp = asBreakpointAck(parseMessage(encoded).obj);
    assert.strictEqual(bp.id, ACK.BreakpointHit);
    assert.strictEqual(bp.moduleName, "@scripts/foo.luac");
    assert.strictEqual(bp.line, 42);
  });

  test("EnumContexts result decodes a string vector", () => {
    const encoded = encodeObjectStream(MSG.ScriptDebugEnumContextsResult, {
      MsgId: BigInt(crc32("ScriptDebugger")),
      names: ["Default", "Cry"],
    });
    assert.deepStrictEqual(asStringList(parseMessage(encoded).obj), ["Default", "Cry"]);
  });

  test("Callstack result decodes newline-joined text", () => {
    const cs = "[C] @scripts/foo.lua (12) : OnActivate()\n[Lua] @scripts/foo.lua (3) : ?()";
    const encoded = encodeObjectStream(MSG.ScriptDebugCallStackResult, {
      MsgId: BigInt(crc32("ScriptDebugger")),
      callstack: cs,
    });
    assert.strictEqual(asCallstack(parseMessage(encoded).obj), cs);
  });

  test("GetValue result decodes a nested DebugValue tree", () => {
    const encoded = encodeObjectStream(MSG.ScriptDebugGetValueResult, {
      MsgId: BigInt(crc32("ScriptDebugger")),
      value: {
        name: "self",
        value: "{...}",
        type: 5, // table
        flags: 1, // read-only
        elements: [
          { name: "health", value: "100.000000", type: 3, flags: 2, elements: [] },
          { name: "name", value: "Player", type: 4, flags: 2, elements: [] },
        ],
      },
    });
    const dv = asGetValueResult(parseMessage(encoded).obj);
    assert.strictEqual(dv.name, "self");
    assert.strictEqual(dv.type, 5);
    assert.strictEqual(dv.elements.length, 2);
    assert.strictEqual(dv.elements[0].name, "health");
    assert.strictEqual(dv.elements[1].value, "Player");
  });

  test("RegisteredClasses result decodes (incl. Uuid typeId) — the live IntelliSense source", () => {
    const typeId = "{8379EB7D-01FA-4538-B64B-A6543B4BE73D}";
    const encoded = encodeObjectStream(MSG.ScriptDebugRegisteredClassesResult, {
      MsgId: BigInt(crc32("ScriptDebugger")),
      classes: [
        {
          name: "Vector3",
          type: typeId,
          methods: [{ name: "GetLength", info: "[=float] " }],
          properties: [{ name: "x", isRead: true, isWrite: true }],
        },
      ],
    });
    const classes = asRegisteredClasses(parseMessage(encoded).obj);
    assert.strictEqual(classes.length, 1);
    assert.strictEqual(classes[0].name, "Vector3");
    assert.strictEqual(classes[0].typeId, typeId); // Uuid leaf survived the round-trip
    assert.strictEqual(classes[0].methods[0].name, "GetLength");
    assert.strictEqual(classes[0].properties[0].isWrite, true);
  });

  test("RegisteredEBuses result decodes senders + flags", () => {
    const encoded = encodeObjectStream(MSG.ScriptDebugRegisteredEBusesResult, {
      MsgId: BigInt(crc32("ScriptDebugger")),
      EBusses: [
        {
          name: "TransformBus",
          canBroadcast: true,
          canQueue: true,
          hasHandler: false,
          events: [{ name: "GetWorldTranslation", info: "[=Vector3] ", category: "Event" }],
        },
      ],
    });
    const ebuses = asRegisteredEBuses(parseMessage(encoded).obj);
    assert.strictEqual(ebuses[0].name, "TransformBus");
    assert.strictEqual(ebuses[0].canQueue, true);
    assert.strictEqual(ebuses[0].events[0].category, "Event");
  });

  test("RegisteredGlobals result decodes methods + properties", () => {
    const encoded = encodeObjectStream(MSG.ScriptDebugRegisteredGlobalsResult, {
      MsgId: BigInt(crc32("ScriptDebugger")),
      methods: [{ name: "Print", info: "AZStd::string message" }],
      properties: [{ name: "g_const", isRead: true, isWrite: false }],
    });
    const globals = asRegisteredGlobals(parseMessage(encoded).obj);
    assert.strictEqual(globals.methods[0].name, "Print");
    assert.strictEqual(globals.properties[0].isWrite, false);
  });

  test("SetValue request encodes a DebugValue and round-trips", () => {
    const bytes = encodeSetValue({ name: "x", value: "5", type: 3, flags: 2, elements: [] });
    const { uuid, obj } = parseMessage(bytes);
    assert.strictEqual(uuid, MSG.ScriptDebugSetValue);
    const dv = asGetValueResult({ value: obj.value });
    assert.strictEqual(dv.name, "x");
    assert.strictEqual(dv.value, "5");
  });
});

suite("Lua protocol — TCP framing", () => {
  test("PacketFramer reassembles a header split across two reads", () => {
    const body = writeRemoteToolsMessageBody(0x3a1e3b6a, new Uint8Array([1, 2, 3, 4]), 4);
    const header = writeTcpHeader(PacketType.RemoteToolsMessage, body.length);
    const whole = new Uint8Array([...header, ...body]);

    const framer = new PacketFramer();
    // Deliver byte-by-byte to exercise the buffering.
    let packets = framer.push(whole.subarray(0, 3));
    assert.strictEqual(packets.length, 0);
    packets = framer.push(whole.subarray(3));
    assert.strictEqual(packets.length, 1);
    assert.strictEqual(packets[0].header.type, PacketType.RemoteToolsMessage);

    const chunk = parseRemoteToolsMessage(packets[0].payload);
    assert.strictEqual(chunk.totalSize, 4);
    assert.strictEqual(chunk.persistentId >>> 0, 0x3a1e3b6a);
    assert.deepStrictEqual([...chunk.chunk], [1, 2, 3, 4]);
  });

  test("MessageReassembler joins multi-chunk messages", () => {
    const reasm = new MessageReassembler();
    const first = reasm.add({ chunk: new Uint8Array([1, 2, 3]), totalSize: 5, persistentId: 1 });
    assert.strictEqual(first, null);
    const done = reasm.add({ chunk: new Uint8Array([4, 5]), totalSize: 5, persistentId: 1 });
    assert.deepStrictEqual(done ? [...done] : null, [1, 2, 3, 4, 5]);
  });

  test("parseRemoteToolsConnect reads capabilities/persistentId/displayName", () => {
    // Hand-build a connect body: u32 caps, u32 persistentId, then AZStd::string.
    const name = "Editor.exe";
    const nameBytes = new TextEncoder().encode(name);
    const buf = new Uint8Array(4 + 4 + 4 + 1 + nameBytes.length);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, 0); // capabilities
    dv.setUint32(4, 0x3a1e3b6a); // persistentId
    dv.setUint32(8, name.length); // AZStd::string full size (u32)
    dv.setUint8(12, name.length); // bounded size (1 byte, len ≤ 255)
    buf.set(nameBytes, 13);
    const c = parseRemoteToolsConnect(buf);
    assert.strictEqual(c.persistentId >>> 0, 0x3a1e3b6a);
    assert.strictEqual(c.displayName, name);
  });
});
