// ============================================================================
//  Reflection symbol model — the JSON produced by the Editor Python dump.
//
//  Mirrors AzToolsFramework::Script::LuaSymbolsReporterBus (module "script",
//  Automation scope) verified against LuaSymbolsReporterBus.h:
//    GetListOfClasses / GetListOfGlobalProperties / GetListOfGlobalFunctions /
//    GetListOfEBuses.
//  This is the data source for the LuaLS stub generator (L.3).
// ============================================================================

export interface PropertySymbol {
  name: string;
  canRead: boolean;
  canWrite: boolean;
}

export interface MethodSymbol {
  name: string;
  /** Free-text signature, e.g. "[=Vector3] Vector3 rhs" — best-effort parsed. */
  debugArgumentInfo: string;
}

export interface ClassSymbol {
  name: string;
  typeId: string;
  properties: PropertySymbol[];
  methods: MethodSymbol[];
}

export interface EBusSender {
  name: string;
  debugArgumentInfo: string;
  category: string; // "Event" | "Broadcast" | "Notification"
}

export interface EBusSymbol {
  name: string;
  canBroadcast: boolean;
  canQueue: boolean;
  hasHandler: boolean;
  senders: EBusSender[];
}

export interface ReflectionDump {
  version: number;
  engine?: string;
  project?: string;
  generatedAt?: string;
  classes: ClassSymbol[];
  globalProperties: PropertySymbol[];
  globalFunctions: MethodSymbol[];
  ebuses: EBusSymbol[];
}

export const DUMP_VERSION = 1;

// ---- Validation ------------------------------------------------------------

/** Parse + shape-validate a dump JSON string. Throws with a clear message on bad input. */
export function parseReflectionDump(json: string): ReflectionDump {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new Error(`Reflection dump is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Reflection dump must be a JSON object.");
  }
  const obj = raw as Record<string, unknown>;
  const dump: ReflectionDump = {
    version: typeof obj.version === "number" ? obj.version : DUMP_VERSION,
    engine: typeof obj.engine === "string" ? obj.engine : undefined,
    project: typeof obj.project === "string" ? obj.project : undefined,
    generatedAt: typeof obj.generatedAt === "string" ? obj.generatedAt : undefined,
    classes: asArray(obj.classes).map(toClass),
    globalProperties: asArray(obj.globalProperties).map(toProperty),
    globalFunctions: asArray(obj.globalFunctions).map(toMethod),
    ebuses: asArray(obj.ebuses).map(toEBus),
  };
  return dump;
}

function asArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v.filter((e) => typeof e === "object" && e !== null) as Record<string, unknown>[]) : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function bool(v: unknown): boolean {
  return v === true;
}

function toProperty(o: Record<string, unknown>): PropertySymbol {
  return { name: str(o.name), canRead: bool(o.canRead), canWrite: bool(o.canWrite) };
}

function toMethod(o: Record<string, unknown>): MethodSymbol {
  return { name: str(o.name), debugArgumentInfo: str(o.debugArgumentInfo) };
}

function toClass(o: Record<string, unknown>): ClassSymbol {
  return {
    name: str(o.name),
    typeId: str(o.typeId),
    properties: asArray(o.properties).map(toProperty),
    methods: asArray(o.methods).map(toMethod),
  };
}

function toSender(o: Record<string, unknown>): EBusSender {
  return { name: str(o.name), debugArgumentInfo: str(o.debugArgumentInfo), category: str(o.category) };
}

function toEBus(o: Record<string, unknown>): EBusSymbol {
  return {
    name: str(o.name),
    canBroadcast: bool(o.canBroadcast),
    canQueue: bool(o.canQueue),
    hasHandler: bool(o.hasHandler),
    senders: asArray(o.senders).map(toSender),
  };
}
