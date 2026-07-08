// ============================================================================
//  Lua debug session — Debug Adapter Protocol ⇄ O3DE ScriptDebugAgent.
//
//  Translates VS Code's DAP requests into RemoteTools messages and the agent's
//  replies into DAP events. The agent is single-threaded and processes one
//  request at a time, so we serialize request/response pairs through a promise
//  chain and correlate each reply to the request that triggered it.
//
//  Model constraints reflected here (see lua_support/luaide_integration_reference):
//    - We are the TCP host; the Editor/launcher connects to us.
//    - One Lua thread; the whole target freezes while stopped at a breakpoint.
//    - Callstack/locals are only valid while paused; GetValue works any time.
// ============================================================================

import {
  Handles,
  InitializedEvent,
  LoggingDebugSession,
  Scope,
  Source,
  StackFrame,
  StoppedEvent,
  TerminatedEvent,
  Thread,
} from "@vscode/debugadapter";
import { DebugProtocol } from "@vscode/debugprotocol";
import { log } from "../../log";
import { DebugValue } from "../proto/messages";
import { localFromModule, moduleFromLocal } from "./pathMapper";
import { RemoteToolsHost } from "./remoteToolsHost";

export interface LuaAttachArguments extends DebugProtocol.AttachRequestArguments {
  projectPath: string;
  port?: number;
  scriptContext?: string;
}

const THREAD_ID = 1;
const REQUEST_TIMEOUT_MS = 8000;

type VarScope = { kind: "locals" } | { kind: "value"; dv: DebugValue };

export class LuaDebugSession extends LoggingDebugSession {
  private host = new RemoteToolsHost();
  private projectRoot = "";
  private scriptContext = "Default";
  private readonly handles = new Handles<VarScope>();

  // Breakpoints requested by VS Code, keyed by absolute file path.
  private readonly breakpoints = new Map<string, number[]>();
  // DebugValue backing each shown variable, so setVariable can edit in place.
  private readonly varBacking = new Map<string, DebugValue>();

  // Serialize agent requests (it handles one at a time).
  private chain: Promise<unknown> = Promise.resolve();

  constructor() {
    super("o3de-lua-debug.log");
    this.setDebuggerLinesStartAt1(true);
    this.setDebuggerColumnsStartAt1(true);
  }

  // ---- Initialize ----------------------------------------------------------

  protected initializeRequest(
    response: DebugProtocol.InitializeResponse,
    _args: DebugProtocol.InitializeRequestArguments,
  ): void {
    response.body = response.body ?? {};
    response.body.supportsConfigurationDoneRequest = true;
    response.body.supportsSetVariable = true;
    response.body.supportsEvaluateForHovers = true;
    response.body.supportsTerminateRequest = true;
    this.sendResponse(response);
    this.sendEvent(new InitializedEvent());
  }

  protected configurationDoneRequest(
    response: DebugProtocol.ConfigurationDoneResponse,
  ): void {
    this.sendResponse(response);
  }

  // ---- Attach --------------------------------------------------------------

  protected attachRequest(
    response: DebugProtocol.AttachResponse,
    args: LuaAttachArguments,
  ): void {
    this.projectRoot = args.projectPath ?? "";
    this.scriptContext = args.scriptContext ?? "Default";
    this.host = new RemoteToolsHost(args.port);
    this.wireHost();

    // The target dials us; once it connects we enumerate contexts and attach.
    // Hold the attach response until the agent acknowledges (or refuses/times out).
    let settled = false;
    const finish = (ok: boolean, message?: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (ok) {
        this.sendResponse(response);
      } else {
        this.sendErrorResponse(response, 1001, message ?? "Failed to attach to O3DE.");
      }
    };

    this.host.on("targetConnected", () => this.host.enumContexts());
    this.host.on("contexts", (names) => {
      const chosen = names.includes(this.scriptContext) ? this.scriptContext : names[0] ?? "Default";
      this.scriptContext = chosen;
      this.host.attach(chosen);
    });
    this.host.on("attached", () => {
      log().info(`Lua debug: attached to context "${this.scriptContext}".`);
      this.flushBreakpoints();
      finish(true);
    });
    this.host.on("attachRefused", () => finish(false, "O3DE refused the debugger attach."));

    try {
      this.host.start();
    } catch (err) {
      finish(false, `Could not start Lua debug host: ${(err as Error).message}`);
      return;
    }

    setTimeout(() => finish(false, `No O3DE target connected on port ${args.port ?? 6777}. Is the Editor running with the RemoteTools gem, in a non-Release build?`), 30000);
  }

  private wireHost(): void {
    this.host.on("breakpointHit", (module, line) => this.onStopped(module, line));
    this.host.on("disconnected", () => {
      log().info("Lua debug: target disconnected.");
      this.sendEvent(new TerminatedEvent());
    });
    this.host.on("error", (message) => log().error(`Lua debug host error: ${message}`));
  }

  private onStopped(_module: string, _line: number): void {
    this.handles.reset();
    this.varBacking.clear();
    this.sendEvent(new StoppedEvent("breakpoint", THREAD_ID));
  }

  // ---- Breakpoints ---------------------------------------------------------

  protected setBreakPointsRequest(
    response: DebugProtocol.SetBreakpointsResponse,
    args: DebugProtocol.SetBreakpointsArguments,
  ): void {
    const filePath = args.source.path ?? "";
    const previous = this.breakpoints.get(filePath) ?? [];
    const lines = (args.breakpoints ?? []).map((b) => b.line);
    this.breakpoints.set(filePath, lines);

    if (this.host.isAttached && this.projectRoot) {
      const module = moduleFromLocal(filePath, this.projectRoot);
      for (const line of previous) {
        this.host.removeBreakpoint(module, line);
      }
      for (const line of lines) {
        this.host.addBreakpoint(module, line);
      }
    }

    response.body = {
      breakpoints: lines.map((line) => ({ verified: true, line })),
    };
    this.sendResponse(response);
  }

  private flushBreakpoints(): void {
    if (!this.projectRoot) {
      return;
    }
    for (const [filePath, lines] of this.breakpoints) {
      const module = moduleFromLocal(filePath, this.projectRoot);
      for (const line of lines) {
        this.host.addBreakpoint(module, line);
      }
    }
  }

  // ---- Threads / stack / scopes / variables --------------------------------

  protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    response.body = { threads: [new Thread(THREAD_ID, "O3DE Lua")] };
    this.sendResponse(response);
  }

  protected async stackTraceRequest(
    response: DebugProtocol.StackTraceResponse,
    _args: DebugProtocol.StackTraceArguments,
  ): Promise<void> {
    const text = await this.enqueue(() => this.waitFor("callstack", () => this.host.getCallstack()));
    const frames = this.parseCallstack(String(text ?? ""));
    response.body = { stackFrames: frames, totalFrames: frames.length };
    this.sendResponse(response);
  }

  protected scopesRequest(
    response: DebugProtocol.ScopesResponse,
    _args: DebugProtocol.ScopesArguments,
  ): void {
    const localsRef = this.handles.create({ kind: "locals" });
    response.body = { scopes: [new Scope("Locals", localsRef, false)] };
    this.sendResponse(response);
  }

  protected async variablesRequest(
    response: DebugProtocol.VariablesResponse,
    args: DebugProtocol.VariablesArguments,
  ): Promise<void> {
    const scope = this.handles.get(args.variablesReference);
    let variables: DebugProtocol.Variable[] = [];

    if (scope?.kind === "locals") {
      const names = (await this.enqueue(() =>
        this.waitFor("locals", () => this.host.enumLocals()),
      )) as string[];
      for (const name of names) {
        const dv = (await this.enqueue(() =>
          this.waitFor("value", () => this.host.getValue(name)),
        )) as DebugValue;
        variables.push(this.toVariable(args.variablesReference, dv));
      }
    } else if (scope?.kind === "value") {
      variables = scope.dv.elements.map((child) => this.toVariable(args.variablesReference, child));
    }

    response.body = { variables };
    this.sendResponse(response);
  }

  private toVariable(containerRef: number, dv: DebugValue): DebugProtocol.Variable {
    this.varBacking.set(`${containerRef}:${dv.name}`, dv);
    const ref = dv.elements.length > 0 ? this.handles.create({ kind: "value", dv }) : 0;
    return {
      name: dv.name,
      value: dv.value,
      type: luaTypeName(dv.type),
      variablesReference: ref,
    };
  }

  protected async setVariableRequest(
    response: DebugProtocol.SetVariableResponse,
    args: DebugProtocol.SetVariableArguments,
  ): Promise<void> {
    const dv = this.varBacking.get(`${args.variablesReference}:${args.name}`);
    if (!dv) {
      this.sendErrorResponse(response, 1002, `Cannot set '${args.name}'.`);
      return;
    }
    const edited: DebugValue = { ...dv, value: args.value, elements: [] };
    const result = (await this.enqueue(() =>
      this.waitFor("setValueResult", () => this.host.setValue(edited)),
    )) as { name: string; ok: boolean } | undefined;
    if (result && result.ok === false) {
      this.sendErrorResponse(response, 1003, `O3DE rejected the new value for '${args.name}'.`);
      return;
    }
    dv.value = args.value;
    response.body = { value: args.value };
    this.sendResponse(response);
  }

  protected async evaluateRequest(
    response: DebugProtocol.EvaluateResponse,
    args: DebugProtocol.EvaluateArguments,
  ): Promise<void> {
    if (!args.expression) {
      this.sendErrorResponse(response, 1004, "Empty expression.");
      return;
    }
    const dv = (await this.enqueue(() =>
      this.waitFor("value", () => this.host.getValue(args.expression)),
    )) as DebugValue;
    const ref = dv.elements.length > 0 ? this.handles.create({ kind: "value", dv }) : 0;
    response.body = { result: dv.value, type: luaTypeName(dv.type), variablesReference: ref };
    this.sendResponse(response);
  }

  // ---- Execution control ---------------------------------------------------

  protected continueRequest(response: DebugProtocol.ContinueResponse): void {
    this.host.continue();
    this.sendResponse(response);
  }

  protected nextRequest(response: DebugProtocol.NextResponse): void {
    this.host.stepOver();
    this.sendResponse(response);
  }

  protected stepInRequest(response: DebugProtocol.StepInResponse): void {
    this.host.stepIn();
    this.sendResponse(response);
  }

  protected stepOutRequest(response: DebugProtocol.StepOutResponse): void {
    this.host.stepOut();
    this.sendResponse(response);
  }

  protected disconnectRequest(
    response: DebugProtocol.DisconnectResponse,
    _args: DebugProtocol.DisconnectArguments,
  ): void {
    if (this.host.isAttached) {
      this.host.detach();
    }
    this.host.stop();
    this.sendResponse(response);
  }

  protected terminateRequest(response: DebugProtocol.TerminateResponse): void {
    if (this.host.isAttached) {
      this.host.detach();
    }
    this.host.stop();
    this.sendResponse(response);
  }

  // ---- Callstack parsing ---------------------------------------------------

  // Agent format per frame: "[<type>] <source> (<line>) : <function>(<params>)".
  private parseCallstack(text: string): StackFrame[] {
    const frames: StackFrame[] = [];
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    const re = /^\[.*?\]\s+(.+?)\s+\((\d+)\)\s*:\s*(.*)$/;
    lines.forEach((line, index) => {
      const m = re.exec(line);
      if (!m) {
        return;
      }
      const [, module, lineNo, func] = m;
      const source = this.sourceForModule(module);
      frames.push(new StackFrame(index, func || module, source, Number(lineNo)));
    });
    if (frames.length === 0) {
      frames.push(new StackFrame(0, text.trim() || "?"));
    }
    return frames;
  }

  private sourceForModule(module: string): Source | undefined {
    if (!this.projectRoot || !module.startsWith("@")) {
      return undefined;
    }
    const abs = localFromModule(module, this.projectRoot);
    return new Source(module.slice(1), abs);
  }

  // ---- Request serialization + correlation ---------------------------------

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task, task);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  // Trigger a host request and resolve on its response event (with a timeout).
  private waitFor<T>(event: "callstack" | "locals" | "value" | "setValueResult", trigger: () => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.host.removeListener(event, onEvent);
        reject(new Error(`Timed out waiting for ${event}`));
      }, REQUEST_TIMEOUT_MS);
      const onEvent = (...a: unknown[]): void => {
        clearTimeout(timer);
        if (event === "setValueResult") {
          resolve({ name: a[0], ok: a[1] } as unknown as T);
        } else {
          resolve(a[0] as T);
        }
      };
      this.host.once(event, onEvent);
      trigger();
    });
  }
}

// Lua type tag → readable type name (ScriptContextDebug DebugValue m_type).
function luaTypeName(tag: number): string {
  switch (tag) {
    case 0:
      return "nil";
    case 1:
      return "boolean";
    case 2:
      return "lightuserdata";
    case 3:
      return "number";
    case 4:
      return "string";
    case 5:
      return "table";
    case 6:
      return "function";
    case 7:
      return "userdata";
    case 8:
      return "thread";
    default:
      return "value";
  }
}
