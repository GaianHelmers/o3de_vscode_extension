// ============================================================================
//  Headless build — run `cmake --build` and return a structured result.
//
//  The non-interactive sibling of build.ts: same prep (project, MSVC env,
//  configured-tree + process-guard checks), but instead of a terminal it spawns
//  the build, captures stdout/stderr, and resolves a BuildResult (pass/fail +
//  parsed diagnostics). This is what the LLM/MCP `o3de_build` tool calls so an
//  assistant can compile a change and react to the errors — no rebuilt scripts,
//  no log scraping. Output still tees to the O3DE channel so a human sees it.
//
//  Windows-only (MSVC), like the rest of the build layer. One build at a time.
// ============================================================================

import { spawn } from "child_process";
import * as vscode from "vscode";
import { log } from "../log";
import { ensureVisualStudio } from "../env/visualStudioGuard";
import { captureMsvcEnvironmentDelta } from "../env/msvcEnvironment";
import { readProject, O3deProject } from "../o3de/identity";
import { projectBuildDir, formatCommand } from "./configureCommand";
import { buildBuildArgs } from "./buildCommand";
import { isConfiguredFor } from "./configure";
import { runningGuardedProcesses } from "./processGuard";
import {
  BuildBlockedReason,
  BuildResult,
  parseBuildOutput,
  summarize,
  tailLines,
} from "./buildOutput";

// A build target passed by an LLM ends up in a shell command line, so constrain
// it to CMake-target-safe characters (defeats shell injection via shell:true).
const SAFE_TARGET = /^[A-Za-z0-9_.+-]+$/;

const MAX_DIAGNOSTICS = 100; // cap the returned lists; rawTail still carries the full context
const RAW_TAIL_LINES = 120;

export interface HeadlessBuildParams {
  generator: string; // must match the configured tree's generator
  config: string; // profile | debug | release
  targets: string[]; // empty = build everything
}

let building = false; // in-flight lock — one headless build at a time

// ---- Public entry ----------------------------------------------------------
/** Run the build for the given params without any UI, returning a structured result. */
export async function runBuildHeadless(params: HeadlessBuildParams): Promise<BuildResult> {
  const targets = params.targets ?? [];

  const blocked = (reason: BuildBlockedReason, summary: string, command = ""): BuildResult => ({
    ok: false,
    exitCode: null,
    durationMs: 0,
    command,
    targets,
    config: params.config,
    errors: [],
    warnings: [],
    summary,
    rawTail: "",
    blocked: reason,
  });

  if (process.platform !== "win32") {
    return blocked("not-windows", "Build currently targets Windows (MSVC).");
  }
  if (building) {
    return blocked("busy", "A build is already running — wait for it to finish, then retry.");
  }

  const bad = targets.filter((t) => !SAFE_TARGET.test(t));
  if (bad.length > 0) {
    return blocked("invalid-targets", `Rejected unsafe target name(s): ${bad.join(", ")}.`);
  }

  const project = resolveProjectHeadless();
  if (!project) {
    return blocked("no-project", "No O3DE project in this workspace — run “O3DE: Set Up Workspace…” first.");
  }

  const vs = await ensureVisualStudio({ interactive: false });
  if (!vs?.vcvars64Path) {
    return blocked("no-msvc", "No usable Visual Studio (MSVC) — vcvars64.bat not found.");
  }

  if (!isConfiguredFor(project, params.generator)) {
    return blocked(
      "not-configured",
      `${project.projectName} isn't configured for "${params.generator}". Run “O3DE: Configure Project” first.`,
    );
  }

  const running = await runningGuardedProcesses();
  if (running.length > 0) {
    const verb = running.length > 1 ? "are" : "is";
    return blocked(
      "editor-running",
      `${running.join(" and ")} ${verb} running — O3DE gem DLLs are locked and the link step will fail. ` +
        "Stop the app before building.",
    );
  }

  const buildDir = projectBuildDir(project.path);
  const command = formatCommand(buildBuildArgs({ buildDir, config: params.config, targets }));

  let env: Record<string, string>;
  try {
    env = await captureMsvcEnvironmentDelta(vs.vcvars64Path);
  } catch (err) {
    const message = (err as { message?: string }).message ?? String(err);
    return blocked("env-failed", `Failed to establish the MSVC environment: ${message}`, command);
  }

  building = true;
  const started = Date.now();
  try {
    log().info(`o3de_build: ${project.projectName} — targets=[${targets.join(", ") || "all"}], config=${params.config}`);
    log().info(`  ${command}`);
    const { code, output } = await spawnCapture(command, { ...process.env, ...env }, buildDir);
    const durationMs = Date.now() - started;
    const { errors, warnings } = parseBuildOutput(output);
    const ok = code === 0;
    return {
      ok,
      exitCode: code,
      durationMs,
      command,
      targets,
      config: params.config,
      errors: errors.slice(0, MAX_DIAGNOSTICS),
      warnings: warnings.slice(0, MAX_DIAGNOSTICS),
      summary: summarize(ok, errors.length, warnings.length, durationMs),
      rawTail: tailLines(output, RAW_TAIL_LINES),
    };
  } finally {
    building = false;
  }
}

// ---- Internals -------------------------------------------------------------
/** The single O3DE project in the workspace (first one if several); no prompt. */
function resolveProjectHeadless(): O3deProject | undefined {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const project = readProject(folder.uri.fsPath);
    if (project) {
      return project;
    }
  }
  return undefined;
}

/** Spawn the (already shell-quoted) build command, capture combined output, tee to the log. */
function spawnCapture(
  command: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, cwd, env, windowsHide: true });
    let output = "";
    const onChunk = (chunk: Buffer): void => {
      const text = chunk.toString();
      output += text;
      appendToLog(text);
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.on("error", (err) => {
      output += `\n[spawn error] ${String(err)}\n`;
      resolve({ code: null, output });
    });
    child.on("close", (code) => resolve({ code, output }));
  });
}

/** Stream raw build output to the O3DE channel when it supports append (real runtime channel). */
function appendToLog(text: string): void {
  const channel = log() as unknown as { append?: (value: string) => void };
  if (typeof channel.append === "function") {
    channel.append(text);
  }
}
