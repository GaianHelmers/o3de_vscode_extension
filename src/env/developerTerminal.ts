// ============================================================================
//  O3DE Developer terminal.
//
//  Opens an integrated terminal with the MSVC developer environment already
//  established — the extension-native equivalent of `call vcvars64.bat` at the
//  top of a build script. Any command run here (cmake, ninja, cl) works without
//  a manual environment call.
// ============================================================================

import * as vscode from "vscode";
import { log } from "../log";
import { ensureVisualStudio } from "./visualStudioGuard";
import { captureMsvcEnvironmentDelta } from "./msvcEnvironment";

export async function openDeveloperTerminal(): Promise<void> {
  if (process.platform !== "win32") {
    void vscode.window.showInformationMessage(
      "The O3DE Developer terminal (MSVC environment) is Windows-only.",
    );
    return;
  }

  // Locate a usable Visual Studio (alerts the user itself if none/no C++ tools).
  const vs = await ensureVisualStudio({ interactive: false });
  if (!vs?.vcvars64Path) {
    log().error("Cannot open developer terminal — no usable Visual Studio (vcvars64.bat) found.");
    return;
  }

  // Establish the MSVC environment (equivalent to `call vcvars64.bat`).
  log().info(`Establishing MSVC environment from ${vs.vcvars64Path} …`);
  let env: Record<string, string>;
  try {
    env = await captureMsvcEnvironmentDelta(vs.vcvars64Path);
  } catch (err) {
    const e = err as { message?: string; stderr?: string };
    log().error(`Failed to capture MSVC environment: ${e.message ?? String(err)}`);
    if (e.stderr) {
      log().error(e.stderr);
    }
    void vscode.window.showErrorMessage(
      "O3DE: failed to establish the Visual Studio environment (see the O3DE Development Tools log).",
    );
    return;
  }

  log().info(`MSVC environment ready — ${vs.displayName} (${Object.keys(env).length} vars applied).`);

  const terminal = vscode.window.createTerminal({ name: "O3DE Developer", env });
  terminal.show();
}
