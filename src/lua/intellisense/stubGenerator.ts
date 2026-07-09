// ============================================================================
//  LuaLS stub generator — reflection dump → EmmyLua/LuaCATS annotations.
//
//  Produces a single `---@meta` definition file that gives the Lua language
//  server (sumneko) typed completion for O3DE's reflected API: classes with
//  colon-call methods and property fields, EBus Broadcast/Event/Queue tables,
//  and global functions/properties. This is what makes VS Code's Lua editing
//  equal-or-better than the built-in Lua IDE's live-only, untyped completion.
//
//  Fidelity notes (documented, not bugs):
//   - Class methods are emitted as colon methods (the common member case); a few
//     static factories will read as `:` instead of `.` — still discoverable.
//   - Property types are unknown from reflection → `any` (names still complete).
//   - Signatures are best-effort parsed from debugArgumentInfo (see signature.ts).
// ============================================================================

import { ReflectionDump } from "./symbols";
import { ParsedParam, parseSignature } from "./signature";

// ---- Public API ------------------------------------------------------------

/** Render the whole dump to one LuaLS meta file. */
export function generateStubs(dump: ReflectionDump): string {
  const out = new LineWriter();

  out.line("---@meta");
  out.line("--");
  out.line("-- O3DE reflected Lua API — GENERATED, do not edit.");
  if (dump.engine || dump.project) {
    out.line(`-- Source: ${[dump.project, dump.engine].filter(Boolean).join(" @ ")}`);
  }
  out.line(`-- ${dump.classes.length} classes, ${dump.ebuses.length} EBuses, ` +
    `${dump.globalFunctions.length} globals, ${dump.globalProperties.length} global properties.`);
  out.blank();

  for (const cls of sortByName(dump.classes)) {
    writeClass(out, cls);
  }
  for (const bus of sortByName(dump.ebuses)) {
    writeEBus(out, bus);
  }
  writeGlobals(out, dump);

  return out.toString();
}

// ---- Classes ---------------------------------------------------------------

function writeClass(out: LineWriter, cls: ReflectionDump["classes"][number]): void {
  const name = sanitizeIdent(cls.name);
  if (!name) {
    return;
  }

  out.line(`--- ${cls.name}${cls.typeId ? `  ${cls.typeId}` : ""}`);
  out.line(`---@class ${name}`);
  for (const prop of cls.properties) {
    if (!isIdent(prop.name)) {
      continue;
    }
    const ro = prop.canWrite ? "" : "  # read-only";
    out.line(`---@field ${prop.name} any${ro}`);
  }
  // Make the class table callable as a constructor: `local v = Vector3(...)`.
  out.line(`---@overload fun(...):${name}`);
  out.line(`${name} = {}`);
  out.blank();

  for (const method of cls.methods) {
    if (!isIdent(method.name)) {
      continue;
    }
    const sig = parseSignature(method.debugArgumentInfo);
    writeAnnotatedFunction(out, `${name}:${method.name}`, sig.params, sig.returnType);
  }
  out.blank();
}

// ---- EBuses ----------------------------------------------------------------

function writeEBus(out: LineWriter, bus: ReflectionDump["ebuses"][number]): void {
  const name = sanitizeIdent(bus.name);
  if (!name) {
    return;
  }

  out.line(`--- ${bus.name} (EBus)`);
  out.line(`---@class ${name}`);
  out.line(`${name} = {}`);

  // Sub-tables that actually get used, based on the senders present.
  const broadcast = bus.senders.filter((s) => s.category === "Broadcast");
  const events = bus.senders.filter((s) => s.category === "Event");
  const notifications = bus.senders.filter((s) => s.category === "Notification");

  if (broadcast.length) {
    out.line(`${name}.Broadcast = {}`);
    if (bus.canQueue) {
      out.line(`${name}.QueueBroadcast = {}`);
    }
  }
  if (events.length) {
    out.line(`${name}.Event = {}`);
    if (bus.canQueue) {
      out.line(`${name}.QueueEvent = {}`);
    }
  }
  out.blank();

  for (const sender of broadcast) {
    if (!isIdent(sender.name)) {
      continue;
    }
    const sig = parseSignature(sender.debugArgumentInfo);
    writeAnnotatedFunction(out, `${name}.Broadcast.${sender.name}`, sig.params, sig.returnType);
    if (bus.canQueue) {
      writeAnnotatedFunction(out, `${name}.QueueBroadcast.${sender.name}`, sig.params, undefined);
    }
  }
  for (const sender of events) {
    if (!isIdent(sender.name)) {
      continue;
    }
    const sig = parseSignature(sender.debugArgumentInfo);
    // Addressed events take the target bus id as the first argument.
    const params: ParsedParam[] = [{ name: "busId", luaType: "any" }, ...sig.params];
    writeAnnotatedFunction(out, `${name}.Event.${sender.name}`, params, sig.returnType);
    if (bus.canQueue) {
      writeAnnotatedFunction(out, `${name}.QueueEvent.${sender.name}`, params, undefined);
    }
  }

  // Handler connect helpers, documented for discoverability.
  if (bus.hasHandler) {
    out.line("--- Connect a handler table (keys = notification names) to this bus.");
    if (notifications.length) {
      out.line(`--- Notifications: ${notifications.map((n) => n.name).join(", ")}`);
    }
    writeAnnotatedFunction(
      out,
      `${name}.Connect`,
      [{ name: "handler", luaType: "table" }, { name: "busId", luaType: "any" }],
      "any",
    );
    writeAnnotatedFunction(
      out,
      `${name}.CreateHandler`,
      [{ name: "handler", luaType: "table" }, { name: "busId", luaType: "any" }],
      "any",
    );
  }
  out.blank();
}

// ---- Globals ---------------------------------------------------------------

function writeGlobals(out: LineWriter, dump: ReflectionDump): void {
  if (dump.globalFunctions.length === 0 && dump.globalProperties.length === 0) {
    return;
  }
  out.line("--- Global functions and properties");
  for (const prop of sortByName(dump.globalProperties)) {
    if (!isIdent(prop.name)) {
      continue;
    }
    out.line(`---@type any${prop.canWrite ? "" : "  # read-only"}`);
    out.line(`${prop.name} = nil`);
  }
  out.blank();
  for (const fn of sortByName(dump.globalFunctions)) {
    if (!isIdent(fn.name)) {
      continue;
    }
    const sig = parseSignature(fn.debugArgumentInfo);
    writeAnnotatedFunction(out, fn.name, sig.params, sig.returnType);
  }
}

// ---- Emit helpers ----------------------------------------------------------

function writeAnnotatedFunction(
  out: LineWriter,
  qualifiedName: string,
  params: ParsedParam[],
  returnType: string | undefined,
): void {
  const emittedNames: string[] = [];
  for (const p of params) {
    if (p.name === "...") {
      out.line(`---@param ... ${p.luaType}`);
      emittedNames.push("...");
    } else {
      out.line(`---@param ${p.name} ${p.luaType}`);
      emittedNames.push(p.name);
    }
  }
  if (returnType) {
    out.line(`---@return ${returnType}`);
  }
  out.line(`function ${qualifiedName}(${emittedNames.join(", ")}) end`);
}

class LineWriter {
  private readonly lines: string[] = [];
  line(text: string): void {
    this.lines.push(text);
  }
  blank(): void {
    if (this.lines.length && this.lines[this.lines.length - 1] !== "") {
      this.lines.push("");
    }
  }
  toString(): string {
    return this.lines.join("\n") + "\n";
  }
}

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

function isIdent(s: string): boolean {
  return /^[A-Za-z_]\w*$/.test(s);
}

// A reflected class/bus name is normally a valid identifier; if not, drop it
// (rather than emit invalid Lua). Returns "" when unusable.
function sanitizeIdent(s: string): string {
  return isIdent(s) ? s : "";
}
