// ============================================================================
//  Live reflection scrape — build the IntelliSense dump from a RUNNING Editor,
//  no headless boot. When an Editor/GameLauncher is up and nothing else holds
//  the RemoteTools port, we connect, attach, and enumerate its registered
//  classes / EBuses / globals — the same data the Python dump produces (both
//  come from ScriptContextDebug) — then map it into a ReflectionDump.
//
//  Requires the port to be free: a live debug session or the built-in Lua IDE
//  holding 127.0.0.1:6777 will block it (only one host at a time).
// ============================================================================

import { log } from "../../log";
import { LUA_TOOLS_PORT, RemoteToolsHost } from "../debug/remoteToolsHost";
import { WireClass, WireEBus, WireMethod, WireProperty } from "../proto/messages";
import { ClassSymbol, DUMP_VERSION, EBusSymbol, ReflectionDump } from "./symbols";

const CONNECT_TIMEOUT_MS = 45_000; // Editor is already up; connect+attach+enum is fast, but be generous

export interface LiveScrapeOptions {
  projectPath: string;
  enginePath?: string;
  port?: number;
  scriptContext?: string;
}

/** Connect to a running Editor and return its reflected API as a ReflectionDump. Throws on failure/timeout. */
export function scrapeReflectionFromEditor(options: LiveScrapeOptions): Promise<ReflectionDump> {
  const port = options.port ?? LUA_TOOLS_PORT;
  const context = options.scriptContext ?? "Default";

  return new Promise<ReflectionDump>((resolve, reject) => {
    const host = new RemoteToolsHost(port);
    let settled = false;

    let classes: WireClass[] | undefined;
    let ebuses: WireEBus[] | undefined;
    let globals: { methods: WireMethod[]; properties: WireProperty[] } | undefined;

    const finish = (err?: Error, dump?: ReflectionDump): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      host.stop();
      if (err) {
        reject(err);
      } else if (dump) {
        resolve(dump);
      }
    };

    const tryComplete = (): void => {
      if (classes && ebuses && globals) {
        log().info(`Live scrape: ${classes.length} classes, ${ebuses.length} EBuses, ${globals.methods.length} globals.`);
        finish(undefined, buildDump(options, classes, ebuses, globals));
      }
    };

    const timer = setTimeout(
      () => finish(new Error("No running O3DE Editor connected in time (is it running, non-Release, with RemoteTools?).")),
      CONNECT_TIMEOUT_MS,
    );

    host.on("error", (message) => finish(new Error(message)));
    host.on("targetConnected", () => host.enumContexts());
    host.on("contexts", (names) => host.attach(names.includes(context) ? context : names[0] ?? "Default"));
    host.on("attached", () => {
      host.enumRegisteredClasses(context);
      host.enumRegisteredEBuses(context);
      host.enumRegisteredGlobals(context);
    });
    host.on("registeredClasses", (c) => {
      classes = c;
      tryComplete();
    });
    host.on("registeredEBuses", (e) => {
      ebuses = e;
      tryComplete();
    });
    host.on("registeredGlobals", (g) => {
      globals = g;
      tryComplete();
    });

    try {
      host.start();
    } catch (err) {
      finish(new Error(`Could not open the RemoteTools port ${port}: ${(err as Error).message}`));
    }
  });
}

// ---- Wire → ReflectionDump mapping -----------------------------------------

function buildDump(
  options: LiveScrapeOptions,
  classes: WireClass[],
  ebuses: WireEBus[],
  globals: { methods: WireMethod[]; properties: WireProperty[] },
): ReflectionDump {
  return {
    version: DUMP_VERSION,
    engine: options.enginePath,
    project: options.projectPath,
    classes: classes.map(toClassSymbol),
    ebuses: ebuses.map(toEBusSymbol),
    globalFunctions: globals.methods.map((m) => ({ name: m.name, debugArgumentInfo: m.info })),
    globalProperties: globals.properties.map((p) => ({ name: p.name, canRead: p.isRead, canWrite: p.isWrite })),
  };
}

function toClassSymbol(c: WireClass): ClassSymbol {
  return {
    name: c.name,
    typeId: c.typeId,
    properties: c.properties.map((p) => ({ name: p.name, canRead: p.isRead, canWrite: p.isWrite })),
    methods: c.methods.map((m) => ({ name: m.name, debugArgumentInfo: m.info })),
  };
}

function toEBusSymbol(e: WireEBus): EBusSymbol {
  return {
    name: e.name,
    canBroadcast: e.canBroadcast,
    canQueue: e.canQueue,
    hasHandler: e.hasHandler,
    senders: e.events.map((s) => ({ name: s.name, debugArgumentInfo: s.info, category: s.category })),
  };
}
