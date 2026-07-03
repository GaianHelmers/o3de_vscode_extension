// ============================================================================
//  Ninja detection.
//
//  Ninja is the preferred O3DE build generator ("Ninja Multi-Config"). On Linux
//  it is normally preinstalled; on Windows it is optional and must be found or
//  installed. This module locates a ninja executable and reports its version.
//
//  vscode-free ⇒ testable. UI/install-offer lives in ninjaGuard.ts.
// ============================================================================

import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";

const execFileAsync = promisify(execFile);

export interface NinjaInfo {
  path: string; // resolved executable path, or "ninja" if only known to be on PATH
  version: string;
}

// ---- Known fallback locations (Windows) ------------------------------------
function knownWindowsNinjaPaths(): string[] {
  const paths: string[] = [];
  const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
  paths.push(path.join(programFiles, "Ninja", "ninja.exe"));
  const localAppData = process.env["LOCALAPPDATA"];
  if (localAppData) {
    paths.push(path.join(localAppData, "Microsoft", "WinGet", "Links", "ninja.exe"));
  }
  return paths;
}

// ---- Resolve the full path of a PATH-resident ninja ------------------------
async function resolveNinjaPath(): Promise<string | undefined> {
  const finder = process.platform === "win32" ? "where" : "which";
  try {
    const { stdout } = await execFileAsync(finder, ["ninja"], { windowsHide: true });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
  } catch {
    return undefined;
  }
}

async function versionOf(exe: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(exe, ["--version"], { windowsHide: true });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

// ---- Public API ------------------------------------------------------------
/** Locate ninja: first on PATH, then well-known Windows install locations. */
export async function findNinja(): Promise<NinjaInfo | undefined> {
  // 1. On PATH?
  const pathVersion = await versionOf("ninja");
  if (pathVersion !== undefined) {
    const resolved = await resolveNinjaPath();
    return { path: resolved ?? "ninja", version: pathVersion };
  }

  // 2. Known Windows locations.
  if (process.platform === "win32") {
    for (const candidate of knownWindowsNinjaPaths()) {
      if (fs.existsSync(candidate)) {
        const version = await versionOf(candidate);
        if (version !== undefined) {
          return { path: candidate, version };
        }
      }
    }
  }

  return undefined;
}
