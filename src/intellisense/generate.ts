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
import { projectBuildDir } from "../build/configureCommand";
import { resolveWorkspaceProject } from "../build/projectResolve";
import { O3deProject } from "../o3de/identity";
import { loadFileApiReply } from "./fileApi";
import { consolidateTargets } from "./consolidate";
import { remapIncludes, RootMapping } from "./remap";
import { buildCppConfiguration, mergeCppProperties } from "./cppProperties";
import { isUnderRoot, normalizePath, uniqueStable } from "./paths";

const CONFIG_NAME = "O3DE";
const CONFIGURATION_PROVIDER_KEY = "C_Cpp.default.configurationProvider";

// ---- Remap targets (workspace-aware) ---------------------------------------
interface SourceEngineFolder {
  path: string;
  ref: string;
}

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

/** The workspace's source-engine folder (the "Engine (source): …" folder) — the F12 target. */
function findSourceEngineFolder(): SourceEngineFolder | undefined {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (folder.name.startsWith("Engine (source):")) {
      return { path: folder.uri.fsPath, ref: `\${workspaceFolder:${folder.name}}` };
    }
  }
  return undefined;
}

/** `${workspaceFolder}` for the project folder itself, else `${workspaceFolder:<name>}`. */
function folderRef(folderPath: string, folderName: string, projectPath: string): string {
  return normalizePath(folderPath) === normalizePath(projectPath)
    ? "${workspaceFolder}"
    : `\${workspaceFolder:${folderName}}`;
}

/** Engine redirect (build → source) + relativize any other in-workspace path. */
function buildMappings(project: O3deProject, includePaths: string[]): RootMapping[] {
  const mappings: RootMapping[] = [];
  const buildEngineRoot = detectBuildEngineRoot(project, includePaths);
  const sourceEngine = findSourceEngineFolder();
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

// ---- Command ---------------------------------------------------------------
export async function generateCppProperties(options: BuildOptions): Promise<void> {
  const project = await resolveWorkspaceProject("O3DE: Generate C++ IntelliSense");
  if (!project) {
    return;
  }

  const replyDir = path.join(projectBuildDir(project.path), ".cmake", "api", "v1", "reply");
  if (!fs.existsSync(replyDir)) {
    void vscode.window.showErrorMessage(
      "O3DE: no CMake File API data found. Run “O3DE: Configure Project” first, then retry.",
    );
    return;
  }

  const reply = loadFileApiReply(replyDir, options.config);
  if (!reply || reply.targets.length === 0) {
    void vscode.window.showErrorMessage(
      "O3DE: the CMake File API reply is empty. Re-run “O3DE: Configure Project” and retry.",
    );
    return;
  }

  const consolidated = consolidateTargets(reply.targets);
  const mappings = buildMappings(
    project,
    consolidated.includes.map((inc) => inc.path),
  );
  const includePath = uniqueStable(remapIncludes(consolidated.includes, mappings).map((i) => i.path));

  const config = buildCppConfiguration({
    name: CONFIG_NAME,
    includePath,
    defines: consolidated.defines,
    compilerPath: reply.compilerPath,
    standard: consolidated.standard,
  });

  const cppPropsPath = path.join(project.path, ".vscode", "c_cpp_properties.json");
  let existing: Record<string, unknown> | undefined;
  if (fs.existsSync(cppPropsPath)) {
    const parsed = jsonc.parse(fs.readFileSync(cppPropsPath, "utf8"), [], { allowTrailingComma: true });
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  }
  const merged = mergeCppProperties(existing, config);

  try {
    fs.mkdirSync(path.dirname(cppPropsPath), { recursive: true });
    fs.writeFileSync(cppPropsPath, `${JSON.stringify(merged, null, 4)}\n`, "utf8");
  } catch (err) {
    log().error(`Failed to write ${cppPropsPath}: ${String(err)}`);
    void vscode.window.showErrorMessage("O3DE: failed to write c_cpp_properties.json (see the O3DE log).");
    return;
  }
  disableConfigurationProvider(project.path);

  log().info(
    `IntelliSense written: ${cppPropsPath} — config=${reply.configName}, ` +
      `${includePath.length} include paths, ${consolidated.defines.length} defines, ` +
      `std=${consolidated.standard ?? "?"}, compiler=${reply.compilerPath ?? "(none)"}.`,
  );
  void vscode.window.showInformationMessage(
    `O3DE: C++ IntelliSense written for ${project.projectName} (${includePath.length} include paths). ` +
      "Open a .cpp and hit F12 on an AZ type to verify.",
  );
}
