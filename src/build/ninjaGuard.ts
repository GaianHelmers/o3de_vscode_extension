// ============================================================================
//  Ninja guard — user-facing check + install offer.
//
//  Wraps ninja detection with VS Code messaging:
//    - found            -> log; (interactive) info toast
//    - missing, Windows -> offer `winget install Ninja-build.Ninja` in a terminal
//    - missing, other   -> advise the platform package manager
// ============================================================================

import * as vscode from "vscode";
import { log } from "../log";
import { findNinja } from "./ninja";

const WINGET_INSTALL_NINJA = "winget install Ninja-build.Ninja";

/**
 * Ensure Ninja is available. Returns true if found. When missing on Windows,
 * offers a winget install (run in a visible terminal).
 */
export async function ensureNinja(options: { interactive: boolean }): Promise<boolean> {
  const found = await findNinja();

  if (found) {
    log().info(`Ninja found: ${found.version} @ ${found.path}`);
    if (options.interactive) {
      void vscode.window.showInformationMessage(`O3DE: Ninja is available — ${found.version}.`);
    }
    return true;
  }

  log().warn("Ninja not found.");

  // Non-Windows: point at the package manager rather than winget.
  if (process.platform !== "win32") {
    if (options.interactive) {
      void vscode.window.showWarningMessage(
        "O3DE: Ninja was not found. Install it with your package manager " +
          "(e.g. `apt install ninja-build` / `brew install ninja`).",
      );
    }
    return false;
  }

  const choice = await vscode.window.showWarningMessage(
    "O3DE Development Tools: Ninja is not installed. Ninja (Multi-Config) is the recommended " +
      "build generator for O3DE.",
    "Install Ninja (winget)",
    "Not now",
  );
  if (choice === "Install Ninja (winget)") {
    const terminal = vscode.window.createTerminal("O3DE — Install Ninja");
    terminal.show();
    terminal.sendText(WINGET_INSTALL_NINJA);
    log().info(`Launched Ninja install: ${WINGET_INSTALL_NINJA}`);
    void vscode.window.showInformationMessage(
      "Installing Ninja via winget. When it finishes, open a new terminal (to refresh PATH) " +
        "and run “O3DE: Check Ninja” to confirm.",
    );
  }
  return false;
}
