// ============================================================================
//  Process-guard — the #1 O3DE build failure (locked gem DLLs).
//
//  A running Editor.exe / ScriptCanvasApplication.exe holds the project's gem
//  DLLs open, so the link step fails mid-build. The user's .bats warn (and one
//  kills) before building; we replicate that as a native, modal pre-flight so
//  the Build command doesn't fail halfway through a link.
// ============================================================================

import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";
import { log } from "../log";

const execAsync = promisify(exec);

/** Processes that lock gem DLLs during an O3DE link (mirrors the user's build .bats). */
const GUARDED_PROCESSES = ["Editor.exe", "ScriptCanvasApplication.exe"];

// ---- Windows process probing -----------------------------------------------
async function isRunning(imageName: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`tasklist /FI "IMAGENAME eq ${imageName}" /NH`);
    // When nothing matches, tasklist prints an INFO line (no image name) → false.
    return stdout.toLowerCase().includes(imageName.toLowerCase());
  } catch {
    return false; // tasklist unavailable → don't block the build
  }
}

async function killProcess(imageName: string): Promise<void> {
  try {
    await execAsync(`taskkill /F /IM ${imageName}`);
    log().info(`Process-guard: closed ${imageName}.`);
  } catch (err) {
    log().warn(`Process-guard: failed to close ${imageName}: ${String(err)}`);
  }
}

// ---- Guard -----------------------------------------------------------------
/** Returns true to proceed with the build, false to cancel. Non-Windows always proceeds. */
export async function guardEditorProcesses(): Promise<boolean> {
  if (process.platform !== "win32") {
    return true;
  }

  const running: string[] = [];
  for (const image of GUARDED_PROCESSES) {
    if (await isRunning(image)) {
      running.push(image);
    }
  }
  if (running.length === 0) {
    return true;
  }

  const verb = running.length > 1 ? "are" : "is";
  const choice = await vscode.window.showWarningMessage(
    `${running.join(" and ")} ${verb} running. O3DE gem DLLs may be locked during the link step and ` +
      "the build can fail. Close before building?",
    { modal: true },
    "Close & Build",
    "Build Anyway",
  );

  if (choice === "Close & Build") {
    for (const image of running) {
      await killProcess(image);
    }
    return true;
  }
  return choice === "Build Anyway"; // dismissed → cancel the build
}
