// ============================================================================
//  Run manager — launch, track, and force-quit O3DE runtime processes.
//
//  O3DE apps fan out into parallel helpers (the Editor spawns AssetProcessor
//  etc.), so a naive stop leaves orphans running — the user's core pain. We
//  spawn detached but keep the PID, and force-quit the whole PROCESS TREE with
//  `taskkill /T /F` (adopted from OPAL's process_utils). One tracked run per
//  project; a background exit hook clears the entry when the app closes.
// ============================================================================

import { spawn, exec, ChildProcess } from "child_process";
import { promisify } from "util";
import { log } from "../log";

const execAsync = promisify(exec);

interface RunEntry {
  child: ChildProcess;
  pid: number;
  label: string;
}

/** Currently-running app, keyed by project path (at most one per project). */
const running = new Map<string, RunEntry>();

// ---- State queries ---------------------------------------------------------
export function isRunning(projectPath: string): boolean {
  return running.has(projectPath);
}

export function runningLabel(projectPath: string): string | undefined {
  return running.get(projectPath)?.label;
}

// ---- Kill primitives (Windows) ---------------------------------------------
/** Force-kill a process AND its child tree — `taskkill /PID <pid> /T /F`. */
export async function killTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    try {
      await execAsync(`taskkill /PID ${pid} /T /F`);
    } catch (err) {
      log().warn(`Force-quit pid ${pid} failed: ${String(err)}`);
    }
    return;
  }
  try {
    process.kill(-pid, "SIGKILL"); // unix: kill the process group
  } catch {
    /* best-effort */
  }
}

/** Force-kill every process with the given image name — the orphan sweep. */
export async function killByName(image: string): Promise<void> {
  const exe = image.endsWith(".exe") ? image : `${image}.exe`;
  const cmd = process.platform === "win32" ? `taskkill /IM ${exe} /F` : `pkill -f ${image}`;
  try {
    await execAsync(cmd);
    log().info(`Force-quit ${exe}.`);
  } catch {
    /* not running → nothing to do */
  }
}

// ---- Launch / stop ---------------------------------------------------------
/** Spawn the app detached, track its PID, and clear the entry on exit. Returns the PID (0 on failure). */
export function launch(
  projectPath: string,
  exe: string,
  args: string[],
  cwd: string,
  label: string,
): number {
  const child = spawn(exe, args, { cwd, detached: true, stdio: "ignore" });
  child.unref(); // let the app outlive the extension host; we still hold the ref for exit/kill
  const pid = child.pid ?? 0;
  running.set(projectPath, { child, pid, label });

  child.on("exit", (code) => {
    running.delete(projectPath);
    log().info(`${label} exited (code ${code ?? "?"}).`);
  });
  child.on("error", (err) => {
    running.delete(projectPath);
    log().error(`${label} failed to start: ${String(err)}`);
  });
  return pid;
}

/** Force-quit the tracked app (and its tree) for a project. Returns false if nothing was tracked. */
export async function stop(projectPath: string): Promise<boolean> {
  const entry = running.get(projectPath);
  if (!entry) {
    return false;
  }
  await killTree(entry.pid);
  running.delete(projectPath);
  log().info(`Force-quit ${entry.label} (pid ${entry.pid}, process tree).`);
  return true;
}
