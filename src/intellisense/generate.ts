// ============================================================================
//  Generate C++ IntelliSense (build_launch B.4.1).
//
//  Reads the CMake File API reply our Configure produced, consolidates the
//  include/define graph, remaps engine paths to the workspace SOURCE engine
//  (so F12 lands in the folder the user edits, not the prebuilt build engine),
//  and writes <project>/.vscode/c_cpp_properties.json. Also removes the dead
//  `C_Cpp.default.configurationProvider` from settings.json — with it set,
//  cpptools would defer to CMake Tools (which can't build O3DE) and ignore our
//  file. No CMake Tools dependency: we own the whole data layer.
// ============================================================================

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as jsonc from "jsonc-parser";
import { log } from "../log";
import { resolveProjectEngine, discoverEngines } from "../o3de/discovery";
import { BuildOptions } from "../build/buildOptions";
import { fileApiReplyDir } from "../build/configureCommand";
import { resolveWorkspaceProject } from "../build/projectResolve";
import { O3deProject, readProject } from "../o3de/identity";
import { folderRef, sourceEngineFolder } from "../build/workspaceFolders";
import { loadFileApiReply } from "./fileApi";
import { consolidateTargets } from "./consolidate";
import { remapIncludes, remapPath, RootMapping } from "./remap";
import { buildCppConfiguration, mergeCppProperties } from "./cppProperties";
import { isUnderRoot, normalizePath, uniqueStable } from "./paths";

const CONFIG_NAME = "O3DE";
const CONFIGURATION_PROVIDER_KEY = "C_Cpp.default.configurationProvider";

// ---- Remap targets (workspace-aware) ---------------------------------------
/** The build engine (File API root): project.json `engine`, else the registered engine the includes sit under. */
function detectBuildEngineRoot(project: O3deProject, includePaths: string[]): string | undefined {
  const engine = resolveProjectEngine(project);
  if (engine) {
    return normalizePath(engine.path);
  }
  for (const candidate of discoverEngines()) {
    if (includePaths.some((p) => isUnderRoot(p, candidate.path))) {
      return normalizePath(candidate.path);
    }
  }
  return undefined;
}

/** Engine redirect (build → source) + relativize any other in-workspace path. */
function buildMappings(project: O3deProject, includePaths: string[]): RootMapping[] {
  const mappings: RootMapping[] = [];
  const buildEngineRoot = detectBuildEngineRoot(project, includePaths);
  const sourceEngine = sourceEngineFolder();
  if (buildEngineRoot && sourceEngine) {
    mappings.push({
      fromRoot: buildEngineRoot,
      toRef: sourceEngine.ref,
      verifyBase: sourceEngine.path, // only redirect headers the source engine actually has…
      exists: (absPath) => fs.existsSync(absPath), // …else keep the build path (generated dirs)
    });
    log().info(`IntelliSense: remapping engine ${buildEngineRoot} → ${sourceEngine.path}`);
  }
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    mappings.push({
      fromRoot: folder.uri.fsPath,
      toRef: folderRef(folder.uri.fsPath, folder.name, project.path),
    });
  }
  return mappings;
}

// ---- settings.json hygiene -------------------------------------------------
/** Remove the dead configurationProvider so cpptools reads c_cpp_properties.json. */
function disableConfigurationProvider(projectPath: string): void {
  const settingsPath = path.join(projectPath, ".vscode", "settings.json");
  if (!fs.existsSync(settingsPath)) {
    return;
  }
  const parsed = jsonc.parse(fs.readFileSync(settingsPath, "utf8"), [], { allowTrailingComma: true });
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return;
  }
  const settings = parsed as Record<string, unknown>;
  if (CONFIGURATION_PROVIDER_KEY in settings) {
    delete settings[CONFIGURATION_PROVIDER_KEY];
    fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 4)}\n`, "utf8");
    log().info(`IntelliSense: removed dead ${CONFIGURATION_PROVIDER_KEY} from settings.json.`);
  }
}

// ---- Core emit (no UI) — shared by the command and startup refresh ---------
/** The File API reply directory for a project's build tree. */
function replyDirFor(project: O3deProject): string {
  return fileApiReplyDir(project.path);
}

/** Parse reply → consolidate → remap → write c_cpp_properties.json. Returns include count, or undefined. */
function emitCppProperties(project: O3deProject, options: BuildOptions): number | undefined {
  const replyDir = replyDirFor(project);
  const reply = fs.existsSync(replyDir) ? loadFileApiReply(replyDir, options.config) : undefined;
  if (!reply || reply.targets.length === 0) {
    return undefined;
  }

  const consolidated = consolidateTargets(reply.targets);
  const mappings = buildMappings(
    project,
    consolidated.includes.map((inc) => inc.path),
  );
  const includePath = uniqueStable(remapIncludes(consolidated.includes, mappings).map((i) => i.path));
  const forcedInclude = uniqueStable(consolidated.forcedIncludes.map((p) => remapPath(p, mappings)));

  const config = buildCppConfiguration({
    name: CONFIG_NAME,
    includePath,
    defines: consolidated.defines,
    forcedInclude,
    compilerPath: reply.compilerPath,
    standard: consolidated.standard,
  });

  const cppPropsPath = path.join(project.path, ".vscode", "c_cpp_properties.json");
  const rawExisting = fs.existsSync(cppPropsPath) ? fs.readFileSync(cppPropsPath, "utf8") : undefined;
  let existing: Record<string, unknown> | undefined;
  if (rawExisting !== undefined) {
    const parsed = jsonc.parse(rawExisting, [], { allowTrailingComma: true });
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  }
  const output = `${JSON.stringify(mergeCppProperties(existing, config), null, 4)}\n`;
  disableConfigurationProvider(project.path);

  // Skip the write (and the cpptools reparse it triggers) when nothing changed — this is what
  // keeps the startup auto-refresh truly low-cost when the last configure is still current.
  if (rawExisting === output) {
    log().info(`IntelliSense up to date: ${cppPropsPath} (${includePath.length} include paths).`);
    return includePath.length;
  }
  try {
    fs.mkdirSync(path.dirname(cppPropsPath), { recursive: true });
    fs.writeFileSync(cppPropsPath, output, "utf8");
  } catch (err) {
    log().error(`Failed to write ${cppPropsPath}: ${String(err)}`);
    return undefined;
  }

  log().info(
    `IntelliSense written: ${cppPropsPath} — config=${reply.configName}, ` +
      `${includePath.length} include paths, ${consolidated.defines.length} defines, ` +
      `${forcedInclude.length} forced-include(s), std=${consolidated.standard ?? "?"}, ` +
      `compiler=${reply.compilerPath ?? "(none)"}.`,
  );
  return includePath.length;
}

// ---- Command ---------------------------------------------------------------
export async function generateCppProperties(options: BuildOptions): Promise<void> {
  const project = await resolveWorkspaceProject("O3DE: Generate C++ IntelliSense");
  if (!project) {
    return;
  }
  if (!fs.existsSync(replyDirFor(project))) {
    void vscode.window.showErrorMessage(
      "O3DE: no CMake File API data found. Run “O3DE: Configure Project” first, then retry.",
    );
    return;
  }
  const count = emitCppProperties(project, options);
  if (count === undefined) {
    void vscode.window.showErrorMessage(
      "O3DE: could not write C++ IntelliSense (empty File API reply or write error — see the O3DE log). " +
        "Re-run “O3DE: Configure Project” and retry.",
    );
    return;
  }
  void vscode.window.showInformationMessage(
    `O3DE: C++ IntelliSense written for ${project.projectName} (${count} include paths). ` +
      "The C/C++ extension is now indexing — wait for the “Parsing workspace” spinner to finish " +
      "before F12 / completions are accurate.",
  );
}

// ---- Startup auto-refresh (low cost: re-emit from the existing reply) -------
/** On activation, silently re-emit c_cpp_properties.json for each workspace project that has a
 *  File API reply. No `cmake` — just re-parses the existing reply, so IntelliSense tracks the last
 *  configure across sessions. Gated by the o3de.intellisense.autoRefreshOnStartup setting. */
export async function refreshCppPropertiesOnStartup(options: BuildOptions): Promise<void> {
  let refreshed = 0;
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const project = readProject(folder.uri.fsPath);
    if (!project || !fs.existsSync(replyDirFor(project))) {
      continue;
    }
    if (emitCppProperties(project, options) !== undefined) {
      refreshed += 1;
    }
  }
  if (refreshed > 0) {
    log().info(`IntelliSense: auto-refreshed ${refreshed} project(s) on startup.`);
  }
}
