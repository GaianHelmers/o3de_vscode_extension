// ============================================================================
//  Project config writer — generate + merge O3DE settings into
//  <project>/.vscode/settings.json (workspace_setup A.3 / build_launch B.1).
//
//  `writeProjectSettings` is the reusable core (used by both the standalone
//  command and the setup wizard). Values come from detection (3rd-party path
//  from the manifest, parallel jobs from CPU count, platform) + the current
//  BuildOptions (generator / config). Existing settings are merged JSONC-
//  tolerantly so user config is never clobbered.
// ============================================================================

import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as jsonc from "jsonc-parser";
import { log } from "../log";
import { O3deProject } from "../o3de/identity";
import { readManifest } from "../o3de/manifest";
import { buildProjectSettings, mergeSettings } from "./vscodeConfig";
import { BuildOptions } from "./buildOptions";
import { platformBuildDir } from "./configureCommand";
import { resolveWorkspaceProject } from "./projectResolve";

// ---- Core: write <project>/.vscode/settings.json (reusable) ----------------
/** Returns the settings.json path on success, or undefined if not written. */
export async function writeProjectSettings(
  project: O3deProject,
  options: BuildOptions,
): Promise<string | undefined> {
  const manifest = readManifest();
  const thirdPartyPath =
    manifest?.defaultThirdPartyFolder ?? path.join(os.homedir(), ".o3de", "3rdParty");
  const generated = buildProjectSettings({
    generator: options.generator,
    thirdPartyPath,
    parallelJobs: os.cpus().length,
    platformBuildDir: platformBuildDir(),
    defaultConfig: options.config,
  });

  const vscodeDir = path.join(project.path, ".vscode");
  const settingsPath = path.join(vscodeDir, "settings.json");

  // Read existing settings JSONC-tolerantly so we never clobber user config.
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    const errors: jsonc.ParseError[] = [];
    const parsed = jsonc.parse(fs.readFileSync(settingsPath, "utf8"), errors, {
      allowTrailingComma: true,
    });
    if (parsed === undefined || typeof parsed !== "object" || Array.isArray(parsed)) {
      void vscode.window.showErrorMessage(
        `Could not parse ${settingsPath}; leaving it untouched. Fix it and retry.`,
      );
      return undefined;
    }
    existing = parsed as Record<string, unknown>;
  }

  const merged = mergeSettings(existing, generated);
  try {
    fs.mkdirSync(vscodeDir, { recursive: true });
    fs.writeFileSync(settingsPath, `${JSON.stringify(merged, null, 4)}\n`, "utf8");
  } catch (err) {
    log().error(`Failed to write ${settingsPath}: ${String(err)}`);
    void vscode.window.showErrorMessage("O3DE: failed to write .vscode/settings.json (see the O3DE log).");
    return undefined;
  }

  log().info(
    `Wrote ${settingsPath} — generator=${options.generator}, config=${options.config}, ` +
      `3rdParty=${thirdPartyPath}, jobs=${os.cpus().length}, IntelliSense=configurationProvider.`,
  );
  return settingsPath;
}

// ---- Command: resolve project from workspace, then write -------------------
export async function writeProjectConfig(options: BuildOptions): Promise<void> {
  const project = await resolveWorkspaceProject("O3DE: Write Project Config");
  if (!project) {
    return;
  }
  const settingsPath = await writeProjectSettings(project, options);
  if (settingsPath) {
    void vscode.window.showInformationMessage(
      `O3DE: project settings written to ${project.projectName}/.vscode/settings.json`,
    );
  }
}
