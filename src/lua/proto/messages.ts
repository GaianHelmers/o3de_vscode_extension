// ============================================================================
//  ScriptDebug message catalog — typed builders and parsers.
//
//  Thin, typed wrappers over the ObjectStream codec for the messages exchanged
//  with AzFramework::ScriptDebugAgent. Class UUIDs and field names are verified
//  against AzFramework/Script/ScriptDebugMsgReflection.cpp; command/ack codes are
//  AZ::Crc32 of the command strings (see ScriptRemoteDebugging.cpp).
// ============================================================================

import { crc32 } from "./crc32";
import { AzObject, AzValue, decodeObjectStream, encodeObjectStream } from "./objectStream";

// ---- Class UUIDs (ScriptDebugMsgReflection.cpp) ----------------------------
export const MSG = {
  ScriptDebugRequest: "{2137E01A-F2AE-4137-A17E-6B82F3B7E4DE}",
  ScriptDebugBreakpointRequest: "{707F97AB-1CA0-4191-82E0-FFE9C9D0F788}",
  ScriptDebugSetValue: "{11E0E012-BD54-457D-A44B-FDDA55736ED3}",
  ScriptDebugAck: "{0CA1671A-BAFD-499C-B2CD-7B7E3DD5E2A8}",
  ScriptDebugAckBreakpoint: "{D9644B8A-92FD-43B6-A579-77E123A72EC2}",
  ScriptDebugAckExecute: "{F5B24F7E-85DA-4FE8-B720-AABE35CE631D}",
  ScriptDebugEnumLocalsResult: "{201701DD-0B74-4886-AB84-93BDB338A8DD}",
  ScriptDebugEnumContextsResult: "{8CE74569-9B7D-4993-AFE8-38BB8CE419F5}",
  ScriptDebugGetValueResult: "{B10720F1-B8FE-476F-A39D-6E80711580FD}",
  ScriptDebugSetValueResult: "{2E2BD168-1805-43D6-8602-FDE14CED8E53}",
  ScriptDebugCallStackResult: "{B2606AC6-F966-4991-8144-BA6117F4A54E}",
  ScriptDebugRegisteredGlobalsResult: "{CEE4E889-0249-4D59-9D56-CD4BD159E411}",
  ScriptDebugRegisteredClassesResult: "{7DF455AB-9AB1-4A95-B906-5DB1D1087EBB}",
  ScriptDebugRegisteredEBusesResult: "{D2B5D77C-09F3-476D-A611-49B0A1B9EDFB}",
} as const;

// The RemoteToolsMessage base carries a u64 MsgId. Requests are addressed to the
// "ScriptDebugAgent"; the value is not used for dispatch (RTTI is) but the field
// must be present and correct.
const MSGID_SCRIPT_DEBUG_AGENT = BigInt(crc32("ScriptDebugAgent"));

// ---- Command + ack codes (AZ::Crc32 of the command string) -----------------
export const CMD = {
  AttachDebugger: crc32("AttachDebugger"),
  DetachDebugger: crc32("DetachDebugger"),
  EnumContexts: crc32("EnumContexts"),
  AddBreakpoint: crc32("AddBreakpoint"),
  RemoveBreakpoint: crc32("RemoveBreakpoint"),
  EnumRegisteredClasses: crc32("EnumRegisteredClasses"),
  EnumRegisteredEBuses: crc32("EnumRegisteredEBuses"),
  EnumRegisteredGlobals: crc32("EnumRegisteredGlobals"),
  GetValue: crc32("GetValue"),
  GetCallstack: crc32("GetCallstack"),
  EnumLocals: crc32("EnumLocals"),
  StepOver: crc32("StepOver"),
  StepIn: crc32("StepIn"),
  StepOut: crc32("StepOut"),
  Continue: crc32("Continue"),
} as const;

export const ACK = {
  Ack: crc32("Ack"),
  IllegalOperation: crc32("IllegalOperation"),
  AccessDenied: crc32("AccessDenied"),
  InvalidCmd: crc32("InvalidCmd"),
  BreakpointHit: crc32("BreakpointHit"),
  AddBreakpoint: crc32("AddBreakpoint"),
  RemoveBreakpoint: crc32("RemoveBreakpoint"),
} as const;

// ---- DebugValue (recursive value tree) -------------------------------------
export interface DebugValue {
  name: string;
  value: string;
  type: number; // Lua type tag: nil0 bool1 lightuserdata2 number3 string4 table5 function6 userdata7 thread8
  flags: number; // 1 = READ_ONLY, 2 = ALLOW_TYPE_CHANGE
  typeId?: string;
  elements: DebugValue[];
}

function debugValueToAz(v: DebugValue): AzObject {
  return {
    name: v.name,
    value: v.value,
    type: v.type,
    flags: v.flags,
    elements: v.elements.map(debugValueToAz),
  };
}

function azToDebugValue(o: AzObject): DebugValue {
  const elements = Array.isArray(o.elements) ? (o.elements as AzObject[]) : [];
  return {
    name: String(o.name ?? ""),
    value: String(o.value ?? ""),
    type: Number(o.type ?? 0),
    flags: Number(o.flags ?? 0),
    elements: elements.map(azToDebugValue),
  };
}

// ---- Outbound builders (→ ObjectStream bytes) ------------------------------

export function encodeScriptDebugRequest(command: number, context = "Default"): Uint8Array {
  const value: AzObject = { MsgId: MSGID_SCRIPT_DEBUG_AGENT, request: command, context };
  return encodeObjectStream(MSG.ScriptDebugRequest, value);
}

export function encodeBreakpointRequest(command: number, module: string, line: number): Uint8Array {
  const value: AzObject = { MsgId: MSGID_SCRIPT_DEBUG_AGENT, request: command, context: module, line };
  return encodeObjectStream(MSG.ScriptDebugBreakpointRequest, value);
}

export function encodeSetValue(debugValue: DebugValue): Uint8Array {
  const value: AzObject = { MsgId: MSGID_SCRIPT_DEBUG_AGENT, value: debugValueToAz(debugValue) };
  return encodeObjectStream(MSG.ScriptDebugSetValue, value);
}

// ---- Inbound parsing (ObjectStream bytes →) --------------------------------

export interface ParsedMessage {
  uuid: string;
  obj: AzObject;
}

export function parseMessage(bytes: Uint8Array): ParsedMessage {
  const { uuid, value } = decodeObjectStream(bytes);
  return { uuid, obj: (value as AzObject) ?? {} };
}

export function asAck(obj: AzObject): { request: number; ackCode: number } {
  return { request: Number(obj.request ?? 0), ackCode: Number(obj.ackCode ?? 0) };
}

export function asBreakpointAck(obj: AzObject): { id: number; moduleName: string; line: number } {
  return { id: Number(obj.id ?? 0), moduleName: String(obj.moduleName ?? ""), line: Number(obj.line ?? 0) };
}

export function asStringList(obj: AzObject): string[] {
  const names = Array.isArray(obj.names) ? (obj.names as AzValue[]) : [];
  return names.map((n) => String(n));
}

export function asCallstack(obj: AzObject): string {
  return String(obj.callstack ?? "");
}

export function asGetValueResult(obj: AzObject): DebugValue {
  return azToDebugValue((obj.value as AzObject) ?? {});
}

export function asSetValueResult(obj: AzObject): { name: string; result: boolean } {
  return { name: String(obj.name ?? ""), result: Boolean(obj.result) };
}

// ---- Registered reflection results (live IntelliSense source) --------------
// Same shape as the Python LuaSymbolsReporter dump — both come from
// ScriptContextDebug's Enum* — so these map straight into a ReflectionDump.
export interface WireMethod {
  name: string;
  info: string; // debugArgumentInfo
}
export interface WireProperty {
  name: string;
  isRead: boolean;
  isWrite: boolean;
}
export interface WireClass {
  name: string;
  typeId: string;
  methods: WireMethod[];
  properties: WireProperty[];
}
export interface WireEBusSender extends WireMethod {
  category: string; // "Event" | "Broadcast" | "Notification"
}
export interface WireEBus {
  name: string;
  canBroadcast: boolean;
  canQueue: boolean;
  hasHandler: boolean;
  events: WireEBusSender[];
}

function toMethods(v: AzValue | undefined): WireMethod[] {
  return (Array.isArray(v) ? (v as AzObject[]) : []).map((m) => ({
    name: String(m.name ?? ""),
    info: String(m.info ?? ""),
  }));
}
function toProps(v: AzValue | undefined): WireProperty[] {
  return (Array.isArray(v) ? (v as AzObject[]) : []).map((p) => ({
    name: String(p.name ?? ""),
    isRead: Boolean(p.isRead),
    isWrite: Boolean(p.isWrite),
  }));
}

export function asRegisteredClasses(obj: AzObject): WireClass[] {
  const arr = Array.isArray(obj.classes) ? (obj.classes as AzObject[]) : [];
  return arr.map((c) => ({
    name: String(c.name ?? ""),
    typeId: typeof c.type === "string" ? c.type : "",
    methods: toMethods(c.methods),
    properties: toProps(c.properties),
  }));
}

export function asRegisteredEBuses(obj: AzObject): WireEBus[] {
  // Field is spelled "EBusses" in the engine reflection.
  const arr = Array.isArray(obj.EBusses) ? (obj.EBusses as AzObject[]) : [];
  return arr.map((e) => ({
    name: String(e.name ?? ""),
    canBroadcast: Boolean(e.canBroadcast),
    canQueue: Boolean(e.canQueue),
    hasHandler: Boolean(e.hasHandler),
    events: (Array.isArray(e.events) ? (e.events as AzObject[]) : []).map((s) => ({
      name: String(s.name ?? ""),
      info: String(s.info ?? ""),
      category: String(s.category ?? ""),
    })),
  }));
}

export function asRegisteredGlobals(obj: AzObject): { methods: WireMethod[]; properties: WireProperty[] } {
  return { methods: toMethods(obj.methods), properties: toProps(obj.properties) };
}
