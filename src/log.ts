// ============================================================================
//  Logging — a single dedicated Output channel for the whole extension.
//
//  Everything the extension reports goes here, NOT to console.log. This channel
//  appears in the VS Code "Output" panel (dropdown → "O3DE Development Tools")
//  and shows ONLY our messages — isolated from every other extension's noise.
//
//  It is a LogOutputChannel, so it supports levels (trace/debug/info/warn/error)
//  with timestamps, and the user can filter by level in the panel.
// ============================================================================

import * as vscode from "vscode";

let channel: vscode.LogOutputChannel | undefined;

// ---- Lifecycle -------------------------------------------------------------
/** Create the channel. Call once from activate(); disposed with the extension. */
export function initLog(context: vscode.ExtensionContext): vscode.LogOutputChannel {
  channel = vscode.window.createOutputChannel("O3DE Development Tools", { log: true });
  context.subscriptions.push(channel);
  return channel;
}

// A console-backed fallback so code paths that can run before activate() (e.g.
// unit tests exercising a module directly) don't crash on log().
const fallback = {
  trace: (...a: unknown[]) => console.trace(...a),
  debug: (...a: unknown[]) => console.debug(...a),
  info: (...a: unknown[]) => console.info(...a),
  warn: (...a: unknown[]) => console.warn(...a),
  error: (...a: unknown[]) => console.error(...a),
  show: () => undefined,
} as unknown as vscode.LogOutputChannel;

// ---- Access ----------------------------------------------------------------
/** The shared logger. Falls back to console if used before initLog() (e.g. tests). */
export function log(): vscode.LogOutputChannel {
  return channel ?? fallback;
}
