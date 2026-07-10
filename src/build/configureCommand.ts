// ============================================================================
//  Configure command — pure helpers (vscode-free, unit-tested).
//
//  The shape of the CMake configure invocation and the small bits of build-tree
//  inspection that back it. Kept free of vscode / I/O so it can be exercised
//  directly by unit tests and node proofs. The command itself (terminal, MSVC
//  environment, File API query) lives in configure.ts.
// ============================================================================

import * as path from "path";

// ---- Build directory -------------------------------------------------------
/** Per-platform build sub-directory name (build/<platform>). */
export function platformBuildDir(): string {
  if (process.platform === "win32") {
    return "windows";
  }
  return process.platform === "darwin" ? "mac" : "linux";
}

/** Absolute build tree for a project: <project>/build/<platform>. */
export function projectBuildDir(projectPath: string): string {
  return path.join(projectPath, "build", platformBuildDir());
}

/** The CMake File API reply directory for a project's build tree. */
export function fileApiReplyDir(projectPath: string): string {
  return path.join(projectBuildDir(projectPath), ".cmake", "api", "v1", "reply");
}

// ---- CMakeCache inspection -------------------------------------------------
/**
 * The generator a build tree was configured with, read from CMakeCache.txt's
 * `CMAKE_GENERATOR:INTERNAL=` line, or undefined if not present. CMake refuses
 * to switch generators in place, so this drives the reconfigure decision.
 */
export function parseCachedGenerator(cacheText: string): string | undefined {
  for (const line of cacheText.split(/\r?\n/)) {
    const match = /^CMAKE_GENERATOR:INTERNAL=(.*)$/.exec(line.trim());
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

// ---- Configure command line ------------------------------------------------
export interface ConfigureInputs {
  projectPath: string;
  buildDir: string;
  generator: string; // "Ninja Multi-Config" | "Visual Studio 17 2022"
  thirdPartyPath: string; // LY_3RDPARTY_PATH
  compiler?: "MSVC" | "Clang"; // default MSVC
}

/**
 * The argv for the O3DE configure: cmake -G <gen> -S <project> -B <build>
 * -DLY_3RDPARTY_PATH=<3rd>, plus the compiler selection. Clang maps to O3DE's
 * two supported paths (matching its CMakePresets):
 *   - VS generator  → -T ClangCl  (the clang-cl toolset that ships with VS)
 *   - Ninja         → -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++
 */
export function buildConfigureArgs(inputs: ConfigureInputs): string[] {
  const args = [
    "cmake",
    "-G",
    inputs.generator,
    "-S",
    inputs.projectPath,
    "-B",
    inputs.buildDir,
    `-DLY_3RDPARTY_PATH=${inputs.thirdPartyPath}`,
  ];

  if (inputs.compiler === "Clang") {
    if (inputs.generator.startsWith("Visual Studio")) {
      args.push("-T", "ClangCl");
    } else {
      args.push("-DCMAKE_C_COMPILER=clang", "-DCMAKE_CXX_COMPILER=clang++");
    }
  }
  return args;
}

/** Join argv into a shell line, double-quoting tokens with spaces, `=`, or path chars. */
export function formatCommand(argv: string[]): string {
  return argv.map((token) => (/[\s="\\/:]/.test(token) ? `"${token}"` : token)).join(" ");
}

// ---- CMake File API query --------------------------------------------------
/** Object kinds we ask CMake to emit (a File API reply) at configure time. */
export const FILE_API_REQUESTS = [
  { kind: "codemodel", version: 2 },
  { kind: "cache", version: 2 },
  { kind: "cmakeFiles", version: 1 },
  { kind: "toolchains", version: 1 },
];
