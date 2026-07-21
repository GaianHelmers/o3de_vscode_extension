// ============================================================================
//  Process probe — is a Windows process image live? (tasklist).
//
//  Shared by the Run/Stop toolbar poller (runState) and the LLM/MCP is-running
//  tool (runQuery): both ask "is Editor.exe / <Project>.GameLauncher.exe up?"
//  the SAME way Stop's force-quit sweep works, so it also catches apps launched
//  outside this session. Non-Windows resolves to false (Run targets Windows).
// ============================================================================

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/** True if a process with this image name is live (tasklist prints its row; else an INFO line). */
export async function isImageRunning(image: string): Promise<boolean> {
  if (process.platform !== "win32") {
    return false;
  }
  try {
    const { stdout } = await execAsync(`tasklist /FI "IMAGENAME eq ${image}" /NH`);
    return stdout.toLowerCase().includes(image.toLowerCase());
  } catch {
    return false;
  }
}

/** True if ANY of the given image names is live. */
export async function anyImageRunning(images: string[]): Promise<boolean> {
  if (process.platform !== "win32" || images.length === 0) {
    return false;
  }
  const results = await Promise.all(images.map(isImageRunning));
  return results.some(Boolean);
}
