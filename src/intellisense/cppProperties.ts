// ============================================================================
//  c_cpp_properties.json builder (pure).
//
//  Emits the single consolidated "O3DE" configuration cpptools reads for C++
//  IntelliSense. compilerPath (cl.exe) lets cpptools derive the MSVC / Windows
//  SDK system includes itself, so we only supply the O3DE include graph + defines.
//  mergeCppProperties replaces our named config in place, preserving any other
//  configurations the user keeps.
// ============================================================================

export interface CppConfigInput {
  name: string;
  includePath: string[];
  defines: string[];
  compilerPath?: string;
  standard?: string; // File API digits, e.g. "20" | "17"
}

/** Map File API C++ standard digits to a cpptools cppStandard value. */
export function cppStandardFromApi(standard: string | undefined): string {
  return standard ? `c++${standard}` : "c++20";
}

/** Build one c_cpp_properties configuration (Win32 / MSVC). */
export function buildCppConfiguration(input: CppConfigInput): Record<string, unknown> {
  return {
    name: input.name,
    includePath: input.includePath,
    defines: input.defines,
    ...(input.compilerPath ? { compilerPath: input.compilerPath } : {}),
    cStandard: "c17",
    cppStandard: cppStandardFromApi(input.standard),
    intelliSenseMode: "windows-msvc-x64",
    browse: {
      path: input.includePath,
      limitSymbolsToIncludedHeaders: true,
    },
  };
}

/** Merge our config into an existing c_cpp_properties.json (replace by name, keep others). */
export function mergeCppProperties(
  existing: Record<string, unknown> | undefined,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const current = Array.isArray(existing?.["configurations"])
    ? (existing!["configurations"] as Record<string, unknown>[]).slice()
    : [];
  const index = current.findIndex((c) => c && c["name"] === config["name"]);
  if (index >= 0) {
    current[index] = config;
  } else {
    current.push(config);
  }
  const version = typeof existing?.["version"] === "number" ? (existing!["version"] as number) : 4;
  return { version, configurations: current };
}
