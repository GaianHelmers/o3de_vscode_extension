// ============================================================================
//  Configure — run the CMake configure for the project (build_launch B.2).
//
//  Reproduces the user's reconfigure step natively:
//    MSVC env (vcvars64) → cmake -G <generator> -S <project> -B build/<platform>
//                          -DLY_3RDPARTY_PATH=<3rd party>
//  Runs in a visible terminal (long + verbose; mirrors the .bat), triggered by
//  the user — configure is not needed every build, only on first setup or when
//  CMake inputs / the generator change.
//
//  Before running, a CMake File API query is written so the configure emits a
//  reply (build/<platform>/.cmake/api/v1/reply). That reply is the data source
//  for C++ IntelliSense (Approach 2) and backs the generator-consistency check
//  the Build step relies on (isConfiguredFor).
// ============================================================================

import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { log } from "../log";
import { ensureVisualStudio } from "../env/visualStudioGuard";
import { ensureNinja } from "./ninjaGuard";
import { captureMsvcEnvironmentDelta } from "../env/msvcEnvironment";
import { readManifest } from "../o3de/manifest";
import { O3deProject } from "../o3de/identity";
import { BuildOptions } from "./buildOptions";
import { resolveWorkspaceProject } from "./projectResolve";
import {
  buildConfigureArgs,
  formatCommand,
  parseCachedGenerator,
  projectBuildDir,
  FILE_API_REQUESTS,
} from "./configureCommand";

const FILE_API_CLIENT = "client-o3de-dev-tools";

// ---- Build-tree state (I/O) ------------------------------------------------
/** The generator a project's build tree was configured with, or undefined. */
function readCachedGenerator(buildDir: string): string | undefined {
  const cache = path.join(buildDir, "CMakeCache.txt");
  if (!fs.existsSync(cache)) {
    return undefined;
  }
  try {
    return parseCachedGenerator(fs.readFileSync(cache, "utf8"));
  } catch {
    return undefined;
  }
}

/** True when the project is configured AND with the given generator (Build's guard). */
export function isConfiguredFor(project: O3deProject, generator: string): boolean {
  return readCachedGenerator(projectBuildDir(project.path)) === generator;
}

// ---- File API query --------------------------------------------------------
/** Ask CMake to emit a File API reply for this build tree at next configure. */
function writeFileApiQuery(buildDir: string): void {
  const queryDir = path.join(buildDir, ".cmake", "api", "v1", "query", FILE_API_CLIENT);
  fs.mkdirSync(queryDir, { recursive: true });
  fs.writeFileSync(
    path.join(queryDir, "query.json"),
    `${JSON.stringify({ requests: FILE_API_REQUESTS }, null, 2)}\n`,
    "utf8",
  );
}

/** Clear only the CMake cache (not built artifacts) so a generator switch can proceed. */
function clearCmakeCache(buildDir: string): void {
  for (const entry of ["CMakeCache.txt", "CMakeFiles"]) {
    fs.rmSync(path.join(buildDir, entry), { recursive: true, force: true });
  }
  log().info(`Cleared CMake cache in ${buildDir} (generator switch).`);
}

// ---- Command ---------------------------------------------------------------
export async function configureProject(options: BuildOptions): Promise<void> {
  if (process.platform !== "win32") {
    void vscode.window.showInformationMessage("O3DE: Configure currently targets Windows (MSVC).");
    return;
  }

  const project = await resolveWorkspaceProject("O3DE: Configure Project");
  if (!project) {
    return;
  }

  // Toolchain prerequisites: Visual Studio always; Ninja only for the Ninja generator.
  const vs = await ensureVisualStudio({ interactive: false });
  if (!vs?.vcvars64Path) {
    log().error("Configure aborted — no usable Visual Studio (vcvars64.bat).");
    return;
  }
  if (options.generator === "Ninja Multi-Config" && !(await ensureNinja({ interactive: true }))) {
    log().error("Configure aborted — Ninja generator selected but Ninja is not installed.");
    return;
  }

  const buildDir = projectBuildDir(project.path);

  // Generator-consistency guard: CMake refuses to switch generators in place.
  const cachedGenerator = readCachedGenerator(buildDir);
  if (cachedGenerator && cachedGenerator !== options.generator) {
    const choice = await vscode.window.showWarningMessage(
      `${path.basename(buildDir)} was configured with "${cachedGenerator}", but "${options.generator}" ` +
        "is selected. CMake cannot switch generators in place. Clear the CMake cache and configure fresh?",
      "Configure Fresh",
      "Cancel",
    );
    if (choice !== "Configure Fresh") {
      return;
    }
    clearCmakeCache(buildDir);
  } else if (cachedGenerator) {
    const choice = await vscode.window.showInformationMessage(
      `${project.projectName} is already configured (${cachedGenerator}). Reconfigure now?`,
      "Reconfigure",
      "Cancel",
    );
    if (choice !== "Reconfigure") {
      return;
    }
  }

  // LY_3RDPARTY_PATH from the manifest — same source as the generated settings.json.
  const manifest = readManifest();
  const thirdPartyPath =
    manifest?.defaultThirdPartyFolder ?? path.join(os.homedir(), ".o3de", "3rdParty");

  // Request a File API reply so this configure yields the IntelliSense data
  // layer's source (and the reply the Build step's guard reads back).
  try {
    writeFileApiQuery(buildDir);
  } catch (err) {
    log().warn(`Could not write CMake File API query: ${String(err)}`);
  }

  const command = formatCommand(
    buildConfigureArgs({
      projectPath: project.path,
      buildDir,
      generator: options.generator,
      thirdPartyPath,
    }),
  );

  // MSVC environment (equivalent to `call vcvars64.bat`) applied to the terminal.
  let env: Record<string, string>;
  try {
    env = await captureMsvcEnvironmentDelta(vs.vcvars64Path);
  } catch (err) {
    const e = err as { message?: string };
    log().error(`Failed to establish MSVC environment: ${e.message ?? String(err)}`);
    void vscode.window.showErrorMessage(
      "O3DE: failed to establish the Visual Studio environment (see the O3DE log).",
    );
    return;
  }

  log().info(`Configuring ${project.projectName} → ${buildDir}`);
  log().info(`  ${command}`);
  const terminal = vscode.window.createTerminal({ name: "O3DE Configure", env });
  terminal.show();
  terminal.sendText(command);
}
