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
      this.handle = await startMcpHttpServer({ port, token: this.token, version, buildOptions: this.buildOptions });
    } catch (err) {
      log().error(`Failed to start the LLM (MCP) endpoint: ${message(err)}`);
      void vscode.window.showErrorMessage("O3DE: could not start the LLM connection endpoint (see the O3DE log).");
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
    const port = this.handle?.port ?? configuredPort();
    const url = `http://127.0.0.1:${port}/mcp`;
    const mcpJson = JSON.stringify(
      { mcpServers: { o3de: { type: "http", url, headers: { Authorization: `Bearer ${this.token}` } } } },
      null,
      2,
    );
    return { url, token: this.token, mcpJson };
  }

  dispose(): void {
    void this.stop();
  }
}

// ---- Helpers ---------------------------------------------------------------
function configuredPort(): number {
  return vscode.workspace.getConfiguration("o3de").get<number>("llm.port", DEFAULT_PORT);
}

function message(err: unknown): string {
  return (err as { message?: string })?.message ?? String(err);
}
