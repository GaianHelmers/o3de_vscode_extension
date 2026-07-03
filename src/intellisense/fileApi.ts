// ============================================================================
//  CMake File API reader — the IntelliSense data source (Approach 2).
//
//  Our Configure command writes a File API query; CMake emits a reply under
//  build/<platform>/.cmake/api/v1/reply/. This module turns that reply into the
//  per-target compile data (include paths, defines, C++ standard, compiler) that
//  we consolidate + remap into c_cpp_properties.json — with NO dependency on
//  CMake Tools (which cannot establish the MSVC environment for O3DE).
//
//  parse* functions are pure (JSON → typed); loadFileApiReply does the I/O.
// ============================================================================

import * as fs from "fs";
import * as path from "path";

// ---- Extracted shapes ------------------------------------------------------
export interface IncludeEntry {
  path: string;
  isSystem?: boolean;
}

export interface TargetCompile {
  includes: IncludeEntry[]; // from compileGroups[].includes + external:I fragments
  defines: string[]; // e.g. AZ_ENABLE_TRACING, WIN64, _HAS_EXCEPTIONS=0
  standard?: string; // C++ standard digits, e.g. "20"
}

export interface FileApiReply {
  configName: string;
  compilerPath?: string; // CXX compiler (cl.exe) for c_cpp_properties.compilerPath
  targets: TargetCompile[];
}

// ---- Raw JSON shapes (only the fields we read) -----------------------------
interface IndexJson {
  objects?: { kind: string; jsonFile: string }[];
}
interface CodemodelJson {
  configurations?: { name: string; targets?: { name: string; jsonFile: string }[] }[];
}
interface ToolchainsJson {
  toolchains?: { language?: string; compiler?: { path?: string } }[];
}
interface CompileGroup {
  language?: string;
  includes?: { path: string; isSystem?: boolean }[];
  defines?: { define: string }[];
  compileCommandFragments?: { fragment: string; role?: string }[];
  languageStandard?: { standard?: string };
}
interface TargetJson {
  compileGroups?: CompileGroup[];
}

// ---- Pure parsers ----------------------------------------------------------
const EXTERNAL_INCLUDE_PREFIXES = ["-external:I", "/external:I", "-I", "/I"];

/** Pull include paths carried as compiler flags (O3DE 3rd-party libs use `-external:I<path>`). */
export function extractFragmentIncludes(fragments: { fragment: string }[]): string[] {
  const out: string[] = [];
  for (const { fragment } of fragments) {
    for (const prefix of EXTERNAL_INCLUDE_PREFIXES) {
      if (fragment.startsWith(prefix) && fragment.length > prefix.length) {
        out.push(fragment.slice(prefix.length).trim().replace(/^"|"$/g, ""));
        break;
      }
    }
  }
  return out;
}

/** Extract include paths / defines / C++ standard from a target's compileGroups. */
export function parseTarget(json: TargetJson): TargetCompile {
  const includes: IncludeEntry[] = [];
  const defines: string[] = [];
  let standard: string | undefined;

  for (const group of json.compileGroups ?? []) {
    for (const inc of group.includes ?? []) {
      includes.push({ path: inc.path, isSystem: inc.isSystem });
    }
    for (const ext of extractFragmentIncludes(group.compileCommandFragments ?? [])) {
      includes.push({ path: ext, isSystem: true }); // 3rd-party → treat as system
    }
    for (const def of group.defines ?? []) {
      defines.push(def.define);
    }
    if (!standard && group.language === "CXX" && group.languageStandard?.standard) {
      standard = group.languageStandard.standard;
    }
  }
  return { includes, defines, standard };
}

/** The CXX compiler path (cl.exe) from the toolchains reply. */
export function parseCompilerPath(json: ToolchainsJson): string | undefined {
  const cxx = (json.toolchains ?? []).find((t) => t.language === "CXX");
  return cxx?.compiler?.path;
}

/** Choose the codemodel configuration matching `configName` (case-insensitive), else the first. */
export function pickConfiguration(
  json: CodemodelJson,
  configName: string,
): { name: string; targets: { name: string; jsonFile: string }[] } | undefined {
  const configs = json.configurations ?? [];
  const match =
    configs.find((c) => c.name.toLowerCase() === configName.toLowerCase()) ?? configs[0];
  return match ? { name: match.name, targets: match.targets ?? [] } : undefined;
}

// ---- I/O loader ------------------------------------------------------------
function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Newest index-*.json in a reply directory (timestamped names sort lexically). */
function latestIndexFile(replyDir: string): string | undefined {
  const names = fs
    .readdirSync(replyDir)
    .filter((n) => /^index-.*\.json$/.test(n))
    .sort();
  return names.length ? path.join(replyDir, names[names.length - 1]) : undefined;
}

/** Load + parse the File API reply for the given build config. */
export function loadFileApiReply(replyDir: string, configName: string): FileApiReply | undefined {
  const indexFile = latestIndexFile(replyDir);
  if (!indexFile) {
    return undefined;
  }
  const index = readJson<IndexJson>(indexFile);
  const objects = index?.objects ?? [];
  const codemodelName = objects.find((o) => o.kind === "codemodel")?.jsonFile;
  const toolchainsName = objects.find((o) => o.kind === "toolchains")?.jsonFile;
  if (!codemodelName) {
    return undefined;
  }

  const codemodel = readJson<CodemodelJson>(path.join(replyDir, codemodelName));
  if (!codemodel) {
    return undefined;
  }
  const config = pickConfiguration(codemodel, configName);
  if (!config) {
    return undefined;
  }

  const targets: TargetCompile[] = [];
  for (const target of config.targets) {
    const targetJson = readJson<TargetJson>(path.join(replyDir, target.jsonFile));
    if (targetJson) {
      targets.push(parseTarget(targetJson));
    }
  }

  const compilerPath = toolchainsName
    ? parseCompilerPath(readJson<ToolchainsJson>(path.join(replyDir, toolchainsName)) ?? {})
    : undefined;

  return { configName: config.name, compilerPath, targets };
}
