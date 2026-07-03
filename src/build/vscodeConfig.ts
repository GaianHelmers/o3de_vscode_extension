// ============================================================================
//  Project .vscode/settings.json generation (pure).
//
//  Produces the O3DE C++/CMake wiring written into <project>/.vscode/settings.json.
//  Uses ${workspaceFolder} (folder-level config → refers to the project itself),
//  so there are no cross-folder name references here.
//
//  C++ IntelliSense = we own it (Approach 2): our Configure runs CMake with the
//  MSVC env, and "Generate C++ IntelliSense" parses the File API reply into
//  c_cpp_properties.json. Approach 1 (CMake Tools as cpptools configurationProvider)
//  is REJECTED — CMake Tools cannot establish the MSVC environment for O3DE, so its
//  configure fails. We also set cmake.configureOnOpen=false to stop CMake Tools from
//  auto-running that failing configure.
// ============================================================================

export interface ProjectSettingsOptions {
  generator: string; // "Ninja Multi-Config" | "Visual Studio 17 2022"
  thirdPartyPath: string;
  parallelJobs: number;
  platformBuildDir: string; // "windows" | "linux" | "mac"
  defaultConfig: string; // profile | debug | release
}

// ---- Generate --------------------------------------------------------------
export function buildProjectSettings(opts: ProjectSettingsOptions): Record<string, unknown> {
  return {
    "cmake.generator": opts.generator,
    "cmake.sourceDirectory": "${workspaceFolder}",
    "cmake.buildDirectory": "${workspaceFolder}/build/" + opts.platformBuildDir,
    "cmake.configureSettings": {
      LY_3RDPARTY_PATH: opts.thirdPartyPath,
    },
    "cmake.parallelJobs": opts.parallelJobs,
    "cmake.exportCompileCommandsFile": false,
    // We own configure (MSVC env) — stop CMake Tools auto-running its failing configure.
    "cmake.configureOnOpen": false,
    "cmake.defaultVariants": {
      buildType: {
        default: opts.defaultConfig,
        description: "The build type.",
        choices: {
          debug: { short: "Debug", long: "No optimization; debug info.", buildType: "Debug" },
          profile: {
            short: "Profile",
            long: "Optimized for debug + run (recommended).",
            buildType: "Debug",
          },
          release: {
            short: "Release",
            long: "Full optimization; no debug info.",
            buildType: "Release",
          },
        },
      },
    },
  };
}

// ---- Merge (never clobber existing user settings) --------------------------
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-merge `generated` over `existing`: generated wins on scalars; objects merge; extras kept. */
export function mergeSettings(
  existing: Record<string, unknown>,
  generated: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(generated)) {
    const current = out[key];
    out[key] =
      isPlainObject(current) && isPlainObject(value) ? mergeSettings(current, value) : value;
  }
  return out;
}
