// ============================================================================
//  RemoteTools host — the TCP server side of O3DE's Lua remote-debugging.
//
//  Counter-intuitively, the DEBUGGER is the server: it listens on 127.0.0.1:6777
//  and the Editor/GameLauncher/ServerLauncher dial out to it (their join thread
//  retries ~1/sec). Engine truth: Application.cpp registers the client role;
//  LuaIDE's StandaloneToolsApplication registers the host role.
//
//  This class owns the socket, frames packets, reassembles chunked messages,
//  decodes them, and raises typed events. It knows nothing about DAP — the
//  debug session subscribes to it.
// ============================================================================

import * as net from "net";
import { EventEmitter } from "events";
import { log } from "../../log";
import { crc32 } from "../proto/crc32";
import {
  MessageReassembler,
  Packet,
  PacketFramer,
  PacketType,
  REMOTE_TOOLS_CHUNK_MAX,
  parseRemoteToolsConnect,
  parseRemoteToolsMessage,
  writeRemoteToolsMessageBody,
  writeTcpHeader,
} from "../proto/packets";
import {
  ACK,
  CMD,
  DebugValue,
  MSG,
  ParsedMessage,
  asAck,
  asBreakpointAck,
  asCallstack,
  asGetValueResult,
  asSetValueResult,
  asStringList,
  encodeBreakpointRequest,
  encodeScriptDebugRequest,
  encodeSetValue,
  parseMessage,
} from "../proto/messages";

export const LUA_TOOLS_PORT = 6777;
const LUA_TOOLS_KEY = crc32("LuaRemoteTools"); // our persistentId on the wire

// ---- Events raised to the debug session ------------------------------------
export interface RemoteToolsHostEvents {
  listening: [];
  targetConnected: [displayName: string];
  attached: [];
  attachRefused: [];
  detached: [];
  breakpointHit: [module: string, line: number];
  breakpointAdded: [module: string, line: number];
  callstack: [text: string];
  locals: [names: string[]];
  contexts: [names: string[]];
  value: [value: DebugValue];
  setValueResult: [name: string, ok: boolean];
  disconnected: [];
  error: [message: string];
}

export class RemoteToolsHost extends EventEmitter {
  // Typed event surface over the untyped EventEmitter base.
  override on<E extends keyof RemoteToolsHostEvents>(e: E, l: (...a: RemoteToolsHostEvents[E]) => void): this {
    return super.on(e, l as (...a: unknown[]) => void);
  }
  override once<E extends keyof RemoteToolsHostEvents>(e: E, l: (...a: RemoteToolsHostEvents[E]) => void): this {
    return super.once(e, l as (...a: unknown[]) => void);
  }
  override emit<E extends keyof RemoteToolsHostEvents>(e: E, ...a: RemoteToolsHostEvents[E]): boolean {
    return super.emit(e, ...a);
  }

  private server: net.Server | null = null;
  private socket: net.Socket | null = null;
  private readonly framer = new PacketFramer();
  private readonly reassembler = new MessageReassembler();
  private attached = false;
  private closedByUser = false;

  constructor(private readonly port: number = LUA_TOOLS_PORT) {
    super();
  }

  get isConnected(): boolean {
    return this.socket !== null;
  }

  get isAttached(): boolean {
    return this.attached;
  }

  // ---- Lifecycle -----------------------------------------------------------

  start(): void {
    const server = net.createServer((socket) => this.onConnection(socket));
    server.on("error", (err) => this.emit("error", err.message));
    server.listen(this.port, "127.0.0.1", () => {
      log().info(`Lua debug host listening on 127.0.0.1:${this.port}`);
      this.emit("listening");
    });
    this.server = server;
  }

  stop(): void {
    this.closedByUser = true;
    this.socket?.destroy();
    this.socket = null;
    this.server?.close();
    this.server = null;
    this.attached = false;
  }

  private onConnection(socket: net.Socket): void {
    if (this.socket) {
      // Only one target at a time (matches the agent's single-debugger model).
      socket.destroy();
      return;
    }
    this.socket = socket;
    socket.on("data", (data) => this.onData(new Uint8Array(data)));
    socket.on("close", () => this.onSocketClosed());
    socket.on("error", () => this.onSocketClosed());
    log().info("Lua debug host: target connected.");
  }

  private onSocketClosed(): void {
    this.socket = null;
    this.attached = false;
    if (!this.closedByUser) {
      this.emit("disconnected");
    }
  }

  // ---- Inbound -------------------------------------------------------------

  private onData(data: Uint8Array): void {
    let packets: Packet[];
    try {
      packets = this.framer.push(data);
    } catch (err) {
      this.emit("error", `Framing error: ${(err as Error).message}`);
      return;
    }
    for (const packet of packets) {
      this.onPacket(packet);
    }
  }

  private onPacket(packet: Packet): void {
    switch (packet.header.type) {
      case PacketType.InitiateConnection:
        // Handshake only; the connect packet follows.
        break;
      case PacketType.RemoteToolsConnect: {
        const connect = parseRemoteToolsConnect(packet.payload);
        log().info(`Lua debug host: RemoteToolsConnect from "${connect.displayName}".`);
        this.emit("targetConnected", connect.displayName);
        break;
      }
      case PacketType.RemoteToolsMessage: {
        try {
          const chunk = parseRemoteToolsMessage(packet.payload);
          const full = this.reassembler.add(chunk);
          if (full) {
            this.onMessage(parseMessage(full));
          }
        } catch (err) {
          this.emit("error", `Message decode error: ${(err as Error).message}`);
        }
        break;
      }
      default:
        break;
    }
  }

  private onMessage(msg: ParsedMessage): void {
    switch (msg.uuid) {
      case MSG.ScriptDebugAck:
        this.onAck(msg);
        break;
      case MSG.ScriptDebugAckBreakpoint:
        this.onBreakpointAck(msg);
        break;
      case MSG.ScriptDebugEnumContextsResult:
        this.emit("contexts", asStringList(msg.obj));
        break;
      case MSG.ScriptDebugCallStackResult:
        this.emit("callstack", asCallstack(msg.obj));
        break;
      case MSG.ScriptDebugEnumLocalsResult:
        this.emit("locals", asStringList(msg.obj));
        break;
      case MSG.ScriptDebugGetValueResult:
        this.emit("value", asGetValueResult(msg.obj));
        break;
      case MSG.ScriptDebugSetValueResult: {
        const r = asSetValueResult(msg.obj);
        this.emit("setValueResult", r.name, r.result);
        break;
      }
      default:
        // Registered-classes/EBuses/globals results land here — wired in a later stage.
        break;
    }
  }

  private onAck(msg: ParsedMessage): void {
    const ack = asAck(msg.obj);
    if (ack.request === CMD.AttachDebugger) {
      if (ack.ackCode === ACK.Ack) {
        this.attached = true;
        this.emit("attached");
      } else {
        this.emit("attachRefused");
      }
    } else if (ack.request === CMD.DetachDebugger) {
      this.attached = false;
      this.emit("detached");
    }
  }

  private onBreakpointAck(msg: ParsedMessage): void {
    const bp = asBreakpointAck(msg.obj);
    if (bp.id === ACK.BreakpointHit) {
      this.emit("breakpointHit", bp.moduleName, bp.line);
    } else if (bp.id === ACK.AddBreakpoint) {
      this.emit("breakpointAdded", bp.moduleName, bp.line);
    }
  }

  // ---- Outbound ------------------------------------------------------------

  attach(context = "Default"): void {
    this.sendMessage(encodeScriptDebugRequest(CMD.AttachDebugger, context));
  }

  detach(): void {
    this.sendMessage(encodeScriptDebugRequest(CMD.DetachDebugger));
  }

  enumContexts(): void {
    this.sendMessage(encodeScriptDebugRequest(CMD.EnumContexts));
  }

  addBreakpoint(module: string, line: number): void {
    this.sendMessage(encodeBreakpointRequest(CMD.AddBreakpoint, module, line));
  }

  removeBreakpoint(module: string, line: number): void {
    this.sendMessage(encodeBreakpointRequest(CMD.RemoveBreakpoint, module, line));
  }

  getCallstack(): void {
    this.sendMessage(encodeScriptDebugRequest(CMD.GetCallstack));
  }

  enumLocals(): void {
    this.sendMessage(encodeScriptDebugRequest(CMD.EnumLocals));
  }

  getValue(expression: string): void {
    this.sendMessage(encodeScriptDebugRequest(CMD.GetValue, expression));
  }

  setValue(value: DebugValue): void {
    this.sendMessage(encodeSetValue(value));
  }

  stepOver(): void {
    this.sendMessage(encodeScriptDebugRequest(CMD.StepOver));
  }

  stepIn(): void {
    this.sendMessage(encodeScriptDebugRequest(CMD.StepIn));
  }

  stepOut(): void {
    this.sendMessage(encodeScriptDebugRequest(CMD.StepOut));
  }

  continue(): void {
    this.sendMessage(encodeScriptDebugRequest(CMD.Continue));
  }

  // Wrap an ObjectStream blob in RemoteToolsMessage packet(s) and send. Large
  // blobs split into REMOTE_TOOLS_CHUNK_MAX-byte chunks; the receiver reassembles.
  private sendMessage(blob: Uint8Array): void {
    const socket = this.socket;
    if (!socket) {
      return;
    }
    for (let offset = 0; offset < blob.length || offset === 0; offset += REMOTE_TOOLS_CHUNK_MAX) {
      const chunk = blob.subarray(offset, Math.min(offset + REMOTE_TOOLS_CHUNK_MAX, blob.length));
      const body = writeRemoteToolsMessageBody(LUA_TOOLS_KEY, new Uint8Array(chunk), blob.length);
      socket.write(writeTcpHeader(PacketType.RemoteToolsMessage, body.length));
      socket.write(body);
      if (blob.length === 0) {
        break;
      }
    }
  }
}
