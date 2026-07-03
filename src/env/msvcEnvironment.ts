// ============================================================================
//  MSVC environment capture (Windows).
//
//  cl.exe/link.exe only work once the Visual Studio "developer" environment is
//  established (INCLUDE, LIB, PATH, VCINSTALLDIR, …). The user's build scripts
//  do this with `call vcvars64.bat` before any build command.
//
//  We reproduce that non-interactively: run vcvars64.bat in a cmd shell, dump
//  the resulting environment with `set`, and diff it against the base process
//  environment to isolate exactly what vcvars added/changed. Those vars are
//  then applied to integrated terminals (and, later, task execution).
//
//  parseSetOutput/diffEnvironment are pure and unit-tested; only the capture
//  functions perform I/O.
// ============================================================================

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export type EnvMap = Record<string, string>;

// ---- Parsing (pure) --------------------------------------------------------
/** Parse `set` output ("KEY=VALUE" per line) into a map. Ignores non-KEY=VALUE lines. */
export function parseSetOutput(stdout: string): EnvMap {
  const env: EnvMap = {};
  for (const line of stdout.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue; // skip blank lines / banners / anything without a key
    }
    env[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return env;
}

// ---- Diff (pure) -----------------------------------------------------------
/**
 * Entries in `full` that are new or changed vs `base`. Keys compared
 * case-insensitively (Windows env vars are case-insensitive). Isolates the
 * vcvars contribution.
 */
export function diffEnvironment(base: EnvMap, full: EnvMap): EnvMap {
  const baseLower: EnvMap = {};
  for (const [key, value] of Object.entries(base)) {
    baseLower[key.toLowerCase()] = value;
  }
  const delta: EnvMap = {};
  for (const [key, value] of Object.entries(full)) {
    if (baseLower[key.toLowerCase()] !== value) {
      delta[key] = value;
    }
  }
  return delta;
}

// ---- Capture (I/O) ---------------------------------------------------------
function currentEnvironment(): EnvMap {
  const env: EnvMap = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  return env;
}

/** Run vcvars64.bat and capture the full resulting environment. Windows only. */
export async function captureFullEnvironment(vcvars64Path: string): Promise<EnvMap> {
  // Use exec (not execFile): Node runs this as `cmd.exe /d /s /c "<command>"` with
  // verbatim arguments, so the quoted path (which contains spaces) survives cmd's own
  // parsing. Passing cmd.exe through execFile escapes the embedded quotes and breaks it.
  const command = `call "${vcvars64Path}" >nul 2>&1 && set`;
  const { stdout } = await execAsync(command, {
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  return parseSetOutput(stdout);
}

/** Capture only the environment changes vcvars introduces vs the current process. */
export async function captureMsvcEnvironmentDelta(vcvars64Path: string): Promise<EnvMap> {
  const full = await captureFullEnvironment(vcvars64Path);
  return diffEnvironment(currentEnvironment(), full);
}
