// ============================================================================
//  Build output — pure parsing + result types (vscode-free, unit-tested).
//
//  Turns raw `cmake --build` console output into a structured list of
//  diagnostics an LLM (or the UI) can react to without scraping logs. Kept free
//  of vscode / I/O so it can be exercised directly by unit tests. The runner
//  that spawns the build and captures its output lives in buildRun.ts.
//
//  Recognized shapes (the four ways an O3DE build failure actually reads):
//    - MSVC compiler   file(line[,col]): error|warning C####: message
//    - Linker          [file :] error|warning LNK####: message
//    - CMake           CMake Error[ at file:line] : message
//    - Ninja           FAILED: … / ninja: build stopped: …
// ============================================================================

// ---- Types -----------------------------------------------------------------
export type BuildSeverity = "error" | "warning";

export interface BuildDiagnostic {
  severity: BuildSeverity;
  file?: string;
  line?: number;
  column?: number;
  code?: string; // C2065, LNK2019, CMake, ninja …
  message: string;
}

/** Why a headless build could not run (vs. ran-and-failed, which is ok:false). */
export type BuildBlockedReason =
  | "not-windows"
  | "no-project"
  | "no-msvc"
  | "not-configured"
  | "editor-running"
  | "invalid-targets"
  | "env-failed"
  | "busy";

export interface BuildResult {
  ok: boolean; // exitCode === 0 (false when blocked)
  exitCode: number | null;
  durationMs: number;
  command: string; // the exact cmake --build … line
  targets: string[];
  config: string;
  errors: BuildDiagnostic[];
  warnings: BuildDiagnostic[];
  summary: string; // one-line human read-out
  rawTail: string; // last N lines — the safety net when a matcher misses
  blocked?: BuildBlockedReason;
}

// ---- Matchers --------------------------------------------------------------
//  MSVC compiler:  D:\src\Foo.cpp(42): error C2065: 'x': undeclared identifier
//                  D:\src\Foo.cpp(42,10): warning C4189: …   (newer MSVC adds a column)
const MSVC_RE =
  /^\s*(.+?)\((\d+)(?:,(\d+))?\)\s*:\s*(fatal error|error|warning)\s+([A-Za-z]+\d+)\s*:\s*(.*?)\s*$/;

//  Linker:  Foo.obj : error LNK2019: unresolved external symbol …
//           LINK : fatal error LNK1181: cannot open input file 'x.lib'
const LINK_RE = /^\s*(?:(.+?)\s*:\s*)?(?:fatal\s+)?(error|warning)\s+(LNK\d+)\s*:\s*(.*?)\s*$/;

//  CMake, located:  CMake Error at CMakeLists.txt:12 (find_package):
const CMAKE_AT_RE = /^\s*CMake (Error|Warning)(?:\s*\(dev\))?\s+at\s+(.+?):(\d+)/;
//  CMake, general:  CMake Error: The source directory … does not exist.
const CMAKE_MSG_RE = /^\s*CMake (Error|Warning)\b\s*:?\s*(.*?)\s*$/;

//  Ninja failure markers (not file diagnostics, but they explain a non-zero exit).
const NINJA_FAIL_RE = /^\s*(FAILED:.*|ninja: build stopped:.*)$/;

// ---- Parse -----------------------------------------------------------------
/**
 * Extract deduplicated error/warning diagnostics from raw build output. MSVC
 * re-emits the same header error once per translation unit, so identical
 * (file, line, code, message) tuples collapse to one entry.
 */
export function parseBuildOutput(output: string): { errors: BuildDiagnostic[]; warnings: BuildDiagnostic[] } {
  const errors: BuildDiagnostic[] = [];
  const warnings: BuildDiagnostic[] = [];
  const seen = new Set<string>();

  const push = (d: BuildDiagnostic): void => {
    const key = `${d.severity}|${d.file ?? ""}|${d.line ?? ""}|${d.column ?? ""}|${d.code ?? ""}|${d.message}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    (d.severity === "error" ? errors : warnings).push(d);
  };

  for (const raw of output.split(/\r?\n/)) {
    let m = MSVC_RE.exec(raw);
    if (m) {
      push({
        severity: m[4] === "warning" ? "warning" : "error",
        file: m[1].trim(),
        line: Number(m[2]),
        column: m[3] ? Number(m[3]) : undefined,
        code: m[5],
        message: m[6],
      });
      continue;
    }
    m = LINK_RE.exec(raw);
    if (m) {
      const file = m[1]?.trim();
      push({ severity: m[2] === "warning" ? "warning" : "error", file: file || undefined, code: m[3], message: m[4] });
      continue;
    }
    m = CMAKE_AT_RE.exec(raw);
    if (m) {
      push({
        severity: m[1] === "Warning" ? "warning" : "error",
        file: m[2].trim(),
        line: Number(m[3]),
        code: "CMake",
        message: raw.trim(),
      });
      continue;
    }
    m = CMAKE_MSG_RE.exec(raw);
    if (m) {
      push({ severity: m[1] === "Warning" ? "warning" : "error", code: "CMake", message: m[2] || raw.trim() });
      continue;
    }
    m = NINJA_FAIL_RE.exec(raw);
    if (m) {
      push({ severity: "error", code: "ninja", message: raw.trim() });
    }
  }

  return { errors, warnings };
}

// ---- Helpers ---------------------------------------------------------------
/** The last `n` non-empty-trimmed lines of `output`, rejoined (context safety net). */
export function tailLines(output: string, n: number): string {
  const lines = output.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - n)).join("\n").trim();
}

/** The one-line human read-out shown in the summary field. */
export function summarize(ok: boolean, errors: number, warnings: number, durationMs: number): string {
  const verb = ok ? "succeeded" : "FAILED";
  return `Build ${verb} — ${errors} error(s), ${warnings} warning(s) in ${(durationMs / 1000).toFixed(1)}s`;
}
