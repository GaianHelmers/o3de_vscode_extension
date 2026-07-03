// ============================================================================
//  Visual Studio guard — the user-facing check + alert.
//
//  Wraps the detection data layer (visualStudio.ts) with VS Code messaging:
//    - none found        -> error  + "Download Visual Studio"
//    - found, no C++ tools-> warning + link (MSVC workload required)
//    - found + C++ tools  -> log; (interactive) success toast
// ============================================================================

import * as vscode from "vscode";
import { log } from "../log";
import {
  findVisualStudioInstalls,
  pickBestInstall,
  VisualStudioInstall,
} from "./visualStudio";

const VS_DOWNLOAD_URL = "https://visualstudio.microsoft.com/downloads/";

async function openDownloads(): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(VS_DOWNLOAD_URL));
}

/**
 * Ensure a usable Visual Studio (MSVC) install exists on Windows.
 * Returns the chosen install, or undefined when none is usable.
 */
export async function ensureVisualStudio(
  options: { interactive: boolean },
): Promise<VisualStudioInstall | undefined> {
  if (process.platform !== "win32") {
    log().info("Visual Studio check skipped — not a Windows host.");
    return undefined;
  }

  const installs = await findVisualStudioInstalls();

  // ---- None found -> hard alert ----
  if (installs.length === 0) {
    log().error("No Visual Studio installation found.");
    const pick = await vscode.window.showErrorMessage(
      "O3DE Development Tools: no Visual Studio installation was found. Building O3DE on " +
        "Windows requires Visual Studio with the “Desktop development with C++” workload.",
      "Download Visual Studio",
    );
    if (pick === "Download Visual Studio") {
      await openDownloads();
    }
    return undefined;
  }

  // ---- Report everything found ----
  for (const i of installs) {
    log().info(
      `Found: ${i.displayName} (${i.version}) @ ${i.installationPath} — ` +
        `C++ tools: ${i.hasCppTools ? "yes" : "no"}`,
    );
  }

  const best = pickBestInstall(installs) as VisualStudioInstall;

  // ---- Found, but MSVC C++ toolset missing ----
  if (!best.hasCppTools) {
    log().warn(`${best.displayName} lacks the MSVC C++ toolset.`);
    const pick = await vscode.window.showWarningMessage(
      `O3DE Development Tools: ${best.displayName} was found, but the MSVC C++ toolset ` +
        "(“Desktop development with C++”) is not installed — required to build O3DE.",
      "Open Visual Studio downloads",
    );
    if (pick === "Open Visual Studio downloads") {
      await openDownloads();
    }
    return best;
  }

  // ---- Ready ----
  log().info(
    `Visual Studio ready: ${best.displayName} ` +
      `(env script: ${best.vsDevCmdPath ?? best.vcvars64Path}).`,
  );
  if (options.interactive) {
    void vscode.window.showInformationMessage(
      `O3DE: Visual Studio ready — ${best.displayName}.`,
    );
  }
  return best;
}
