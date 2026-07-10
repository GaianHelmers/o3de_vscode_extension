// ============================================================================
//  Terminal reuse — one terminal per named purpose.
//
//  Build / Configure previously created a fresh terminal on every run, so
//  "O3DE Build" / "O3DE Configure" terminals piled up. This disposes any
//  existing same-named terminal (a re-run replaces it) and returns a fresh one,
//  so there's only ever one per purpose.
// ============================================================================

import * as vscode from "vscode";

export function freshTerminal(
  name: string,
  env?: NodeJS.ProcessEnv,
  shellPath?: string,
): vscode.Terminal {
  vscode.window.terminals.filter((t) => t.name === name).forEach((t) => t.dispose());
  return vscode.window.createTerminal({ name, env, shellPath });
}
