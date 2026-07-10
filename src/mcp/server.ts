// ============================================================================
//  O3DE MCP server — the public lifecycle handle (SDK-free).
//
//  Wraps the localhost MCP endpoint an LLM (e.g. Claude) connects to. This file
//  imports NONE of the MCP SDK directly: start() does an `await import()` of
//  serverImpl.ts, so the SDK is only loaded/evaluated when the user opts into
//  LLM connections. Off by default → zero cost at activation.
//
//  Security: binds 127.0.0.1 only and mints a per-machine bearer token (kept in
//  globalState). Show the client config via the "Show LLM Connection Info" command.
// ============================================================================

import * as vscode from "vscode";
import * as crypto from "crypto";
import { log } from "../log";
import { BuildOptions } from "../build/buildOptions";
import { readProject } from "../o3de/identity";
import { writeMcpServerEntry, removeMcpServerEntry } from "./mcpConfig";
import type { McpHttpHandle } from "./serverImpl";

const TOKEN_KEY = "o3de.llm.token";
const DEFAULT_PORT = 8975;

export class O3deMcpServer {
  private handle: McpHttpHandle | undefined;
  private busy = false; // guards overlapping start/stop transitions

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly buildOptions: BuildOptions,
  ) {}

  get isRunning(): boolean {
    return this.handle !== undefined;
  }

  get port(): number | undefined {
    return this.handle?.port;
  }

  /** The per-machine bearer token, minted once and persisted. */
  get token(): string {
    let token = this.context.globalState.get<string>(TOKEN_KEY);
    if (!token) {
      token = crypto.randomBytes(24).toString("hex");
      void this.context.globalState.update(TOKEN_KEY, token);
    }
    return token;
  }

  // ---- Lifecycle -----------------------------------------------------------
  /** Start the endpoint (no-op if already running). Lazy-loads the MCP SDK. */
  async start(): Promise<void> {
    if (this.handle || this.busy) {
      return;
    }
    this.busy = true;
    try {
      const port = configuredPort();
      const version = (this.context.extension.packageJSON as { version?: string }).version ?? "0.0.0";
      const { startMcpHttpServer } = await import("./serverImpl.js");
      this.handle = await startMcpHttpServer({
        port,
        token: this.token,
        requireToken: requireToken(),
        version,
        buildOptions: this.buildOptions,
      });
      this.writeClientConfig(); // keep the project's .mcp.json in sync with the live port
    } catch (err) {
      log().error(`Failed to start the LLM (MCP) endpoint: ${message(err)}`);
      void vscode.window.showErrorMessage(`O3DE: could not start the LLM connection endpoint — ${message(err)}`);
    } finally {
      this.busy = false;
    }
  }

  /** Stop the endpoint (no-op if not running). */
  async stop(): Promise<void> {
    const handle = this.handle;
    if (!handle) {
      return;
    }
    this.handle = undefined;
    try {
      await handle.close();
      log().info("LLM (MCP) endpoint stopped.");
    } catch (err) {
      log().warn(`Error stopping the LLM (MCP) endpoint: ${message(err)}`);
    }
  }

  /** Stop then start — used to pick up a changed port while enabled. */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** The connection details a client (Claude Code `.mcp.json`) needs. */
  connectionInfo(): { url: string; token: string; mcpJson: string } {
    const entry = this.serverEntry();
    return { url: entry.url, token: this.token, mcpJson: JSON.stringify({ mcpServers: { o3de: entry } }, null, 2) };
  }

  /** Auto-merge our entry into the project's .mcp.json (setting-gated). */
  writeClientConfig(): void {
    if (!writeConfigEnabled()) {
      return;
    }
    const root = projectRoot();
    if (!root) {
      return; // no project folder to write into
    }
    writeMcpServerEntry(root, this.serverEntry());
  }

  /** Remove our entry from the project's .mcp.json (on disable). */
  removeClientConfig(): void {
    const root = projectRoot();
    if (root) {
      removeMcpServerEntry(root);
    }
  }

  /** The `.mcp.json` server entry for the live endpoint (url + optional bearer). */
  private serverEntry(): { type: "http"; url: string; headers?: { Authorization: string } } {
    const port = this.handle?.port ?? configuredPort();
    const url = `http://127.0.0.1:${port}/mcp`;
    // Only advertise the bearer header when token auth is on — otherwise the
    // endpoint is open on localhost and a header would just confuse the client.
    return requireToken() ? { type: "http", url, headers: { Authorization: `Bearer ${this.token}` } } : { type: "http", url };
  }

  dispose(): void {
    void this.stop();
  }
}

// ---- Helpers ---------------------------------------------------------------
//  Port resolution supports multiple VS Code windows (one per O3DE project):
//  each window binds its OWN stable port so they never collide, and each
//  project's pasted .mcp.json stays valid across reloads. `o3de.llm.port` = 0
//  (default) derives a deterministic per-project port; a non-zero value pins it.
function configuredPort(): number {
  const explicit = vscode.workspace.getConfiguration("o3de").get<number>("llm.port", 0);
  return explicit && explicit > 0 ? explicit : derivePerProjectPort();
}

/** A stable port in [BASE, BASE+SPAN) derived from the project identity (FNV-1a). */
function derivePerProjectPort(): number {
  const SPAN = 200;
  const id = projectIdentity();
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return DEFAULT_PORT + (Math.abs(h) % SPAN);
}

/** The identity that distinguishes this window's endpoint — its O3DE project path. */
function projectIdentity(): string {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (readProject(folder.uri.fsPath)) {
      return folder.uri.fsPath;
    }
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "o3de-default";
}

function requireToken(): boolean {
  return vscode.workspace.getConfiguration("o3de").get<boolean>("llm.requireToken", false);
}

function writeConfigEnabled(): boolean {
  return vscode.workspace.getConfiguration("o3de").get<boolean>("llm.writeMcpConfig", true);
}

/** The project folder to write .mcp.json into (the O3DE project, else the first folder). */
function projectRoot(): string | undefined {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (readProject(folder.uri.fsPath)) {
      return folder.uri.fsPath;
    }
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function message(err: unknown): string {
  return (err as { message?: string })?.message ?? String(err);
}
