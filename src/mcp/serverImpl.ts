// ============================================================================
//  MCP server implementation — the SDK-facing layer (lazy-loaded).
//
//  Everything that touches @modelcontextprotocol/sdk + zod lives here so the
//  public O3deMcpServer (server.ts) can `await import()` it ONLY when the user
//  opts into LLM connections — nothing here is loaded/evaluated otherwise.
//
//  Transport: a Node http server bound to 127.0.0.1 speaking MCP over Streamable
//  HTTP with session routing. A client's `initialize` mints a session id; the
//  client echoes it (mcp-session-id header) on every later request and we route
//  it to that session's transport. Every request must carry the bearer token.
//  Tools: o3de_ping (health) and o3de_build (headless build + structured report).
// ============================================================================

import * as http from "http";
import { AddressInfo } from "net";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { log } from "../log";
import { BuildOptions, BuildConfig } from "../build/buildOptions";
import { runBuildHeadless } from "../build/buildRun";

const MCP_PATH = "/mcp";
const HOST = "127.0.0.1";
const SESSION_HEADER = "mcp-session-id";

export interface McpHttpOptions {
  port: number;
  token: string;
  version: string;
  buildOptions: BuildOptions;
}

export interface McpHttpHandle {
  port: number;
  close(): Promise<void>;
}

// ---- Lifecycle -------------------------------------------------------------
/** Start the localhost MCP http server, resolving with the actual port + a closer. */
export async function startMcpHttpServer(opts: McpHttpOptions): Promise<McpHttpHandle> {
  // Live sessions for this server instance (cleared on close / restart).
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const server = http.createServer((req, res) => void handleRequest(req, res, opts, sessions));
  const port = await listen(server, opts.port);
  log().info(`LLM (MCP) endpoint listening on http://${HOST}:${port}${MCP_PATH}`);

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const transport of sessions.values()) {
          void transport.close();
        }
        sessions.clear();
        server.close(() => resolve());
      }),
  };
}

/** Bind to the requested port on localhost; fall back to a free port if it's busy. */
function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException): void => {
      server.removeListener("error", onError);
      if (err.code === "EADDRINUSE" && port !== 0) {
        log().warn(`LLM (MCP) port ${port} is busy — falling back to a free port.`);
        resolve(listen(server, 0));
      } else {
        reject(err);
      }
    };
    server.once("error", onError);
    server.listen(port, HOST, () => {
      server.removeListener("error", onError);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

// ---- Request handling ------------------------------------------------------
async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: McpHttpOptions,
  sessions: Map<string, StreamableHTTPServerTransport>,
): Promise<void> {
  // Auth: every request must carry the bearer token (localhost bind is not enough
  // on its own — any local process could otherwise drive builds).
  if (req.headers["authorization"] !== `Bearer ${opts.token}`) {
    sendJson(res, 401, { error: "unauthorized" });
    return;
  }
  if (!(req.url ?? "").startsWith(MCP_PATH)) {
    sendJson(res, 404, { error: "not found" });
    return;
  }

  const sessionId = req.headers[SESSION_HEADER] as string | undefined;
  const body = req.method === "POST" ? await readJsonBody(req).catch(() => INVALID_BODY) : undefined;
  if (body === INVALID_BODY) {
    sendJson(res, 400, { error: "invalid JSON body" });
    return;
  }

  let transport: StreamableHTTPServerTransport;
  if (sessionId && sessions.has(sessionId)) {
    // Existing session — route to its transport (POST calls, GET stream, DELETE).
    transport = sessions.get(sessionId)!;
  } else if (!sessionId && req.method === "POST" && isInitialize(body)) {
    // New session — the initialize handshake mints an id we hand back to the client.
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        sessions.set(id, transport);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
      }
    };
    await buildMcpServer(opts).connect(transport);
  } else {
    sendJson(res, 400, { error: "no valid MCP session — send an initialize request first" });
    return;
  }

  await transport.handleRequest(req, res, body);
}

const INVALID_BODY = Symbol("invalid-body");

function isInitialize(body: unknown): boolean {
  return typeof body === "object" && body !== null && !Array.isArray(body) && (body as { method?: string }).method === "initialize";
}

// ---- Tool registration -----------------------------------------------------
function buildMcpServer(opts: McpHttpOptions): McpServer {
  const server = new McpServer({ name: "o3de-development-tools", version: opts.version });

  server.registerTool(
    "o3de_ping",
    {
      title: "O3DE Ping",
      description: "Health check — confirms the O3DE Development Tools MCP endpoint is live and reachable.",
      inputSchema: {},
    },
    async () => ({ content: [{ type: "text" as const, text: `o3de-development-tools ${opts.version} — ready` }] }),
  );

  server.registerTool(
    "o3de_build",
    {
      title: "O3DE Build",
      description:
        "Build the O3DE project (cmake --build) and return structured pass/fail plus parsed compiler/linker " +
        "diagnostics — so you can compile a change and react to the errors. Windows/MSVC only. The Editor must " +
        "be CLOSED (a running Editor locks gem DLLs and the link step fails; the tool reports blocked:editor-running " +
        "if so). Targets/config default to the selection in the O3DE panel.",
      inputSchema: {
        targets: z
          .array(z.string())
          .optional()
          .describe('CMake target names, e.g. ["Editor"]. Omit to use the panel selection; [] builds everything.'),
        config: z
          .enum(["profile", "debug", "release"])
          .optional()
          .describe("Build configuration. Omit to use the panel selection."),
      },
    },
    async (args: { targets?: string[]; config?: BuildConfig }) => {
      const result = await runBuildHeadless({
        generator: opts.buildOptions.generator,
        config: args.config ?? opts.buildOptions.config,
        targets: args.targets ?? opts.buildOptions.targets,
      });
      const headline = result.blocked ? `${result.summary} (blocked: ${result.blocked})` : result.summary;
      return {
        content: [
          { type: "text" as const, text: headline },
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
        // A build that ran and failed is a valid result (errors listed); only a
        // couldn't-run "blocked" state is surfaced as a tool error.
        isError: result.blocked !== undefined,
      };
    },
  );

  return server;
}

// ---- Small http helpers ----------------------------------------------------
function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("error", reject);
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err as Error);
      }
    });
  });
}
