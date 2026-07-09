// ============================================================================
//  Lua IntelliSense pipeline — reflection dump → LuaLS stubs → wired config.
//
//  Two entry points:
//   - generateLuaIntelliSense: run the O3DE Editor headless to dump the reflected
//     API, then generate stubs and wire LuaLS. Reuses an existing dump if present.
//   - generateLuaStubsFromDump: skip the Editor; generate from a chosen JSON dump
//     (fast path, and useful when a dump already exists).
// ============================================================================

import * as vscode from "vscode";
import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { spawn } from "child_process";
import { log } from "../../log";
import { BuildOptions } from "../../build/buildOptions";
import { resolveWorkspaceProject } from "../../build/projectResolve";
import { resolveProjectEngine } from "../../o3de/discovery";
import { editorExeCandidates } from "../../build/runCommand";
import { cleanChildEnv } from "../../build/runManager";
import { O3deProject } from "../../o3de/identity";
import { parseReflectionDump } from "./symbols";
import { generateStubs } from "./stubGenerator";
import { applyLuaIntelliSense } from "./luaLsConfig";

const DUMP_TIMEOUT_MS = 8 * 60 * 1000; // hard cap — a cold headless Editor boot can be minutes
const DUMP_POLL_MS = 1500;

// Guard so a second click doesn't launch another headless Editor while one runs.
let dumpInProgress = false;

function dumpJsonPath(project: O3deProject): string {
  return path.join(project.path, "user", "lua_symbols.json");
}

function resolveEditorExe(project: O3deProject, config: string): string {
  const candidates = editorExeCandidates(resolveProjectEngine(project), project.path, config);
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0];
}

// ---- Full pipeline: dump (via Editor) → stubs → config ---------------------

export async function generateLuaIntelliSense(
  context: vscode.ExtensionContext,
  options: BuildOptions,
): Promise<void> {
  const project = await resolveWorkspaceProject("O3DE: Generate Lua IntelliSense");
  if (!project) {
    return;
  }

  const dumpPath = dumpJsonPath(project);
  let useExisting = false;
  if (fs.existsSync(dumpPath)) {
    const choice = await vscode.window.showQuickPick(
      [
        { label: "Refresh from the Editor", detail: "Run O3DE headless to re-scan the reflected API (slower, current).", refresh: true },
        { label: "Reuse the existing dump", detail: dumpPath, refresh: false },
      ],
      { title: "O3DE: Generate Lua IntelliSense", placeHolder: "A reflection dump already exists." },
    );
    if (!choice) {
      return;
    }
    useExisting = !choice.refresh;
  }

  if (!useExisting) {
    const ok = await runEditorDump(context, project, options.config, dumpPath);
    if (!ok) {
      return;
    }
  }

  await generateFromDumpFile(project.path, dumpPath);
}

// ---- Fast path: generate from an existing dump JSON ------------------------

export async function generateLuaStubsFromDump(): Promise<void> {
  const project = await resolveWorkspaceProject("O3DE: Generate Lua Stubs From Dump");
  if (!project) {
    return;
  }
  let dumpPath = dumpJsonPath(project);
  if (!fs.existsSync(dumpPath)) {
    const picked = await vscode.window.showOpenDialog({
      title: "Select a lua_symbols.json dump",
      canSelectMany: false,
      filters: { "Reflection dump": ["json"] },
    });
    if (!picked || picked.length === 0) {
      return;
    }
    dumpPath = picked[0].fsPath;
  }
  await generateFromDumpFile(project.path, dumpPath);
}

// ---- Shared: read dump → generate → apply ---------------------------------

async function generateFromDumpFile(projectPath: string, dumpPath: string): Promise<void> {
  let dump;
  try {
    dump = parseReflectionDump(await fsp.readFile(dumpPath, "utf8"));
  } catch (err) {
    void vscode.window.showErrorMessage(`O3DE: could not read reflection dump — ${(err as Error).message}`);
    return;
  }

  const lua = generateStubs(dump);
  const { stubPath } = await applyLuaIntelliSense(projectPath, lua);

  const total = dump.classes.length + dump.ebuses.length + dump.globalFunctions.length;
  void vscode.window.showInformationMessage(
    `O3DE Lua IntelliSense ready: ${dump.classes.length} classes, ${dump.ebuses.length} EBuses, ` +
      `${dump.globalFunctions.length} globals (${total} symbols). Reload if completions don't appear yet.`,
  );
  log().info(`Generated Lua stubs at ${stubPath}.`);
}

// ---- Editor headless dump --------------------------------------------------

async function runEditorDump(
  context: vscode.ExtensionContext,
  project: O3deProject,
  config: string,
  dumpPath: string,
): Promise<boolean> {
  const exe = resolveEditorExe(project, config);
  if (!fs.existsSync(exe)) {
    const choice = await vscode.window.showErrorMessage(
      `O3DE: Editor.exe not found for config "${config}" (${exe}). Build the Editor first.`,
      "Build",
      "Cancel",
    );
    if (choice === "Build") {
      await vscode.commands.executeCommand("o3de.build");
    }
    return false;
  }

  const script = context.asAbsolutePath(path.join("resources", "python", "dump_lua_symbols.py"));
  const engine = resolveProjectEngine(project);
  const enginePath = engine?.path ?? "";

  const args = [
    "--runpython", script,
    "--project-path", project.path,
    "--BatchMode",
    "--NullRenderer",
    "--skipWelcomeScreenDialog",
    "--autotest_mode",
    "--rhi", "null",
  ];
  if (enginePath) {
    args.push("--engine-path", enginePath);
  }

  const env: NodeJS.ProcessEnv = {
    ...cleanChildEnv(),
    O3DE_LUA_SYMBOLS_OUT: dumpPath,
    O3DE_PROJECT_PATH: project.path,
    O3DE_ENGINE_PATH: enginePath,
  };

  if (dumpInProgress) {
    void vscode.window.showInformationMessage("O3DE: a Lua API scan is already running.");
    return false;
  }

  // Fresh output only — remove any stale dump so we can detect success by its reappearance.
  try {
    await fsp.rm(dumpPath, { force: true });
  } catch {
    /* ignore */
  }

  log().info(`Dumping Lua symbols: ${exe} ${args.join(" ")}`);

  dumpInProgress = true;
  try {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "O3DE: scanning reflected Lua API (headless Editor — first run can take a few minutes)…",
        cancellable: true,
      },
      (_progress, token) =>
        new Promise<boolean>((resolve) => {
          const child = spawn(exe, args, { cwd: project.path, env, stdio: "ignore" });
          let settled = false;

          // The Editor may not exit on its own after --runpython, so we treat the
          // output file appearing (and parsing) as success and then kill it.
          const poll = setInterval(() => {
            if (settled || !dumpProduced(dumpPath)) {
              return;
            }
            log().info("Lua symbol dump produced output; stopping the headless Editor.");
            finish(true);
          }, DUMP_POLL_MS);

          const timer = setTimeout(() => {
            log().error("Lua symbol dump timed out; killing the headless Editor.");
            finish(dumpProduced(dumpPath));
          }, DUMP_TIMEOUT_MS);

          token.onCancellationRequested(() => {
            log().info("Lua symbol dump cancelled by user.");
            finish(false);
          });

          const finish = (ok: boolean): void => {
            if (settled) {
              return;
            }
            settled = true;
            clearInterval(poll);
            clearTimeout(timer);
            child.kill(); // stop the (possibly lingering) headless Editor
            if (ok) {
              log().info("Lua symbol dump complete.");
            }
            resolve(ok);
          };

          child.on("error", (err) => {
            log().error(`Failed to launch headless Editor: ${String(err)}`);
            void vscode.window.showErrorMessage(`O3DE: failed to launch Editor for the dump — ${err.message}`);
            finish(false);
          });
          child.on("exit", (code) => {
            // If it exits cleanly before our poll catches the file, honor the result.
            if (dumpProduced(dumpPath)) {
              finish(true);
            } else {
              log().error(`Editor exited (${code ?? "?"}) without producing ${dumpPath}.`);
              finish(false);
            }
          });
        }),
    );
  } finally {
    dumpInProgress = false;
  }
}

// The dump is "done" once the file exists and parses as JSON (avoids reading a
// half-written file mid-flush).
function dumpProduced(dumpPath: string): boolean {
  try {
    if (!fs.existsSync(dumpPath)) {
      return false;
    }
    JSON.parse(fs.readFileSync(dumpPath, "utf8"));
    return true;
  } catch {
    return false;
  }
}
