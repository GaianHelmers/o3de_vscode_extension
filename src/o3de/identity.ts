// ============================================================================
//  O3DE identity files — project.json / engine.json / gem.json.
//
//  Parses the marker files that identify each root of an O3DE workspace.
//  Field names verified against real files on disk (see workspace_setup/plan.md).
//  vscode-free; parse* functions are pure (JSON in → typed object) and tested.
// ============================================================================

import * as fs from "fs";
import * as path from "path";

// ---- Types -----------------------------------------------------------------
export interface O3deProject {
  projectName: string;
  displayName?: string;
  engine?: string; // engine NAME — resolve to a path via the manifest
  externalSubdirectories: string[]; // own gem(s), relative to the project root
  gemNames: string[];
  path: string;
}

export interface O3deEngine {
  engineName: string;
  version?: string;
  displayVersion?: string;
  isSdkEngine: boolean; // sdk_engine === true → prebuilt, NO source vision
  externalSubdirectories: string[]; // engine's built-in gem dirs, relative to the engine root
  path: string;
}

export interface O3deGem {
  gemName: string;
  displayName?: string;
  type?: string; // "Code" (C++) vs asset-only
  path: string;
}

// ---- Helpers ---------------------------------------------------------------
function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

// ---- Pure parsers (JSON object → typed record) -----------------------------
export function parseProject(json: Record<string, unknown>, dir: string): O3deProject | undefined {
  if (typeof json.project_name !== "string") {
    return undefined;
  }
  return {
    projectName: json.project_name,
    displayName: typeof json.display_name === "string" ? json.display_name : undefined,
    engine: typeof json.engine === "string" ? json.engine : undefined,
    externalSubdirectories: asStringArray(json.external_subdirectories),
    gemNames: asStringArray(json.gem_names),
    path: dir,
  };
}

export function parseEngine(json: Record<string, unknown>, dir: string): O3deEngine | undefined {
  if (typeof json.engine_name !== "string") {
    return undefined;
  }
  return {
    engineName: json.engine_name,
    version: typeof json.version === "string" ? json.version : undefined,
    displayVersion: typeof json.display_version === "string" ? json.display_version : undefined,
    isSdkEngine: json.sdk_engine === true,
    externalSubdirectories: asStringArray(json.external_subdirectories),
    path: dir,
  };
}

export function parseGem(json: Record<string, unknown>, dir: string): O3deGem | undefined {
  if (typeof json.gem_name !== "string") {
    return undefined;
  }
  return {
    gemName: json.gem_name,
    displayName: typeof json.display_name === "string" ? json.display_name : undefined,
    type: typeof json.type === "string" ? json.type : undefined,
    path: dir,
  };
}

// ---- Disk readers (folder → typed record, or undefined) --------------------
export function readProject(dir: string): O3deProject | undefined {
  const json = readJsonFile(path.join(dir, "project.json"));
  return json ? parseProject(json as Record<string, unknown>, dir) : undefined;
}

export function readEngine(dir: string): O3deEngine | undefined {
  const json = readJsonFile(path.join(dir, "engine.json"));
  return json ? parseEngine(json as Record<string, unknown>, dir) : undefined;
}

export function readGem(dir: string): O3deGem | undefined {
  const json = readJsonFile(path.join(dir, "gem.json"));
  return json ? parseGem(json as Record<string, unknown>, dir) : undefined;
}
