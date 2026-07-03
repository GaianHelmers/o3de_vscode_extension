// ============================================================================
//  Visual Studio detection (Windows) — data layer.
//
//  O3DE builds on Windows against the MSVC toolchain, provided by a Visual
//  Studio installation (Community / Professional / Enterprise / Build Tools).
//  "Establishing the terminal environment" means invoking that install's
//  VsDevCmd.bat / vcvars script — so first we must locate an install.
//
//  This module is deliberately free of any `vscode` dependency so it can be
//  unit-tested. All UI/alerting lives in visualStudioGuard.ts.
//
//  Detection order: vswhere.exe (authoritative) -> probe well-known roots.
// ============================================================================

import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";

const execFileAsync = promisify(execFile);

// ---- Public data shape -----------------------------------------------------
export interface VisualStudioInstall {
  displayName: string;
  installationPath: string;
  version: string;
  isPrerelease: boolean;
  hasCppTools: boolean; // VC\Auxiliary\Build\vcvars64.bat present
  vsDevCmdPath?: string; // Common7\Tools\VsDevCmd.bat
  vcvars64Path?: string; // VC\Auxiliary\Build\vcvars64.bat
}

// Base fields known before we touch the filesystem (from vswhere or a probe).
export interface VsWhereInstall {
  displayName: string;
  installationPath: string;
  version: string;
  isPrerelease: boolean;
}

// ---- vswhere JSON parsing (pure — unit-testable) ---------------------------
interface RawVsWhereEntry {
  displayName?: string;
  installationName?: string;
  installationPath?: string;
  installationVersion?: string;
  isPrerelease?: boolean;
}

/** Parse `vswhere -format json` output into base install records. Never throws. */
export function parseVsWhereJson(stdout: string): VsWhereInstall[] {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  return (raw as RawVsWhereEntry[])
    .filter((e) => typeof e.installationPath === "string" && e.installationPath.length > 0)
    .map((e) => ({
      displayName: e.displayName ?? e.installationName ?? "Visual Studio",
      installationPath: e.installationPath as string,
      version: e.installationVersion ?? "unknown",
      isPrerelease: e.isPrerelease ?? false,
    }));
}

// ---- Enrich a base record with on-disk env-script locations ----------------
function describeInstall(base: VsWhereInstall): VisualStudioInstall {
  const vsDevCmd = path.join(base.installationPath, "Common7", "Tools", "VsDevCmd.bat");
  const vcvars64 = path.join(base.installationPath, "VC", "Auxiliary", "Build", "vcvars64.bat");
  return {
    ...base,
    hasCppTools: fs.existsSync(vcvars64),
    vsDevCmdPath: fs.existsSync(vsDevCmd) ? vsDevCmd : undefined,
    vcvars64Path: fs.existsSync(vcvars64) ? vcvars64 : undefined,
  };
}

// ---- Detection layer 1: vswhere.exe ----------------------------------------
function vswherePath(): string {
  const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  return path.join(programFilesX86, "Microsoft Visual Studio", "Installer", "vswhere.exe");
}

async function queryVsWhere(): Promise<VsWhereInstall[]> {
  const exe = vswherePath();
  if (!fs.existsSync(exe)) {
    return [];
  }
  const { stdout } = await execFileAsync(
    exe,
    ["-all", "-prerelease", "-products", "*", "-format", "json", "-utf8"],
    { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
  );
  return parseVsWhereJson(stdout);
}

// ---- Detection layer 2: probe well-known install roots ---------------------
function probeWellKnownRoots(): VsWhereInstall[] {
  const bases = [
    process.env["ProgramFiles"] ?? "C:\\Program Files",
    process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
  ];
  const years = ["2022", "2019", "2017"];
  const editions = ["Community", "Professional", "Enterprise", "BuildTools"];
  const found: VsWhereInstall[] = [];
  for (const base of bases) {
    for (const year of years) {
      for (const edition of editions) {
        const root = path.join(base, "Microsoft Visual Studio", year, edition);
        if (fs.existsSync(path.join(root, "Common7", "Tools", "VsDevCmd.bat"))) {
          found.push({
            displayName: `Visual Studio ${edition} ${year}`,
            installationPath: root,
            version: "unknown",
            isPrerelease: false,
          });
        }
      }
    }
  }
  return found;
}

// ---- Public API ------------------------------------------------------------
/** Detect Visual Studio installations. Windows only; returns [] elsewhere. */
export async function findVisualStudioInstalls(): Promise<VisualStudioInstall[]> {
  if (process.platform !== "win32") {
    return [];
  }
  let bases: VsWhereInstall[] = [];
  try {
    bases = await queryVsWhere();
  } catch {
    bases = [];
  }
  if (bases.length === 0) {
    bases = probeWellKnownRoots();
  }
  return bases.map(describeInstall);
}

// Compare dotted version strings ("17.14.36518.9"); true if `a` is newer than `b`.
function isNewerVersion(a: string, b: string): boolean {
  const toParts = (v: string) => v.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const av = toParts(a);
  const bv = toParts(b);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i++) {
    const diff = (av[i] ?? 0) - (bv[i] ?? 0);
    if (diff !== 0) {
      return diff > 0;
    }
  }
  return false;
}

/**
 * Choose the best install: prefer those with the MSVC C++ tools, and among
 * those the newest version. Falls back to the newest overall if none have C++
 * tools. (A machine may have several VS installs — e.g. 2022 alongside 2019.)
 */
export function pickBestInstall(
  installs: VisualStudioInstall[],
): VisualStudioInstall | undefined {
  const cppCapable = installs.filter((i) => i.hasCppTools);
  const pool = cppCapable.length > 0 ? cppCapable : installs;
  return pool.reduce<VisualStudioInstall | undefined>(
    (best, cur) => (!best || isNewerVersion(cur.version, best.version) ? cur : best),
    undefined,
  );
}
