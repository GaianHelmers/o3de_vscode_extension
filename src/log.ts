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

// ---- Access ----------------------------------------------------------------
/** The shared logger. initLog() must have run first (it does, in activate()). */
export function log(): vscode.LogOutputChannel {
  if (!channel) {
    throw new Error("Logger used before initLog() was called in activate().");
  }
  return channel;
}
