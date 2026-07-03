import * as assert from "assert";
import {
  extractFragmentIncludes,
  parseTarget,
  parseCompilerPath,
  pickConfiguration,
} from "../intellisense/fileApi";
import { consolidateTargets } from "../intellisense/consolidate";
import { remapPath, remapIncludes, RootMapping } from "../intellisense/remap";
import { buildCppConfiguration, cppStandardFromApi, mergeCppProperties } from "../intellisense/cppProperties";
import { normalizePath, isUnderRoot, replaceRoot, uniqueStable } from "../intellisense/paths";

// ---- paths -----------------------------------------------------------------
suite("intellisense/paths", () => {
  test("normalizePath forward-slashes and collapses . / ..", () => {
    assert.strictEqual(normalizePath("D:\\a\\AzCore\\."), "D:/a/AzCore");
    assert.strictEqual(normalizePath("D:/a/AzGameFramework/.."), "D:/a");
    assert.strictEqual(normalizePath("D:/a/Legacy/CryCommon/.."), "D:/a/Legacy");
  });

  test("isUnderRoot is segment-aware + case-insensitive", () => {
    assert.ok(isUnderRoot("D:/Eng/Code/AzCore", "d:/eng"));
    assert.ok(isUnderRoot("D:/Eng", "D:/Eng/"));
    assert.ok(!isUnderRoot("D:/Engine2/Code", "D:/Eng")); // not a segment boundary
  });

  test("replaceRoot swaps the prefix, keeps the tail", () => {
    assert.strictEqual(
      replaceRoot("D:/GS/GS_Play_Engine/Code/Framework/AzCore/.", "D:/GS/GS_Play_Engine", "${workspaceFolder:Eng}"),
      "${workspaceFolder:Eng}/Code/Framework/AzCore",
    );
  });

  test("uniqueStable dedupes case-insensitively, keeps first order", () => {
    assert.deepStrictEqual(uniqueStable(["A", "b", "a", "B", "c"]), ["A", "b", "c"]);
  });
});

// ---- File API parsing ------------------------------------------------------
suite("intellisense/fileApi", () => {
  test("extractFragmentIncludes pulls -external:I / /I paths (O3DE 3rd-party)", () => {
    const got = extractFragmentIncludes([
      { fragment: "-external:IC:/tp/Lua/include" },
      { fragment: "/external:IC:/tp/zlib/include" },
      { fragment: "-std:c++20" }, // not an include
      { fragment: "/W4" }, // not an include
      { fragment: '-I"C:/tp/quoted/include"' },
    ]);
    assert.deepStrictEqual(got, [
      "C:/tp/Lua/include",
      "C:/tp/zlib/include",
      "C:/tp/quoted/include",
    ]);
  });

  test("parseTarget extracts includes (+external), defines, and CXX standard", () => {
    const target = parseTarget({
      compileGroups: [
        {
          language: "CXX",
          includes: [
            { path: "D:/Proj/Gem/Include" },
            { path: "D:/Eng/Code/Framework/AzCore/.", isSystem: true },
          ],
          defines: [{ define: "AZ_ENABLE_TRACING" }, { define: "_HAS_EXCEPTIONS=0" }],
          compileCommandFragments: [{ fragment: "-external:IC:/tp/Lua/include" }, { fragment: "/W4" }],
          languageStandard: { standard: "20" },
        },
      ],
    });
    assert.deepStrictEqual(target.defines, ["AZ_ENABLE_TRACING", "_HAS_EXCEPTIONS=0"]);
    assert.strictEqual(target.standard, "20");
    assert.deepStrictEqual(
      target.includes.map((i) => i.path),
      ["D:/Proj/Gem/Include", "D:/Eng/Code/Framework/AzCore/.", "C:/tp/Lua/include"],
    );
    assert.strictEqual(target.includes[2].isSystem, true); // external → system
  });

  test("parseCompilerPath picks the CXX toolchain; pickConfiguration matches by name", () => {
    assert.strictEqual(
      parseCompilerPath({
        toolchains: [
          { language: "C", compiler: { path: "cc.exe" } },
          { language: "CXX", compiler: { path: "cl.exe" } },
        ],
      }),
      "cl.exe",
    );
    const cfg = pickConfiguration(
      { configurations: [{ name: "debug", targets: [] }, { name: "profile", targets: [{ name: "T", jsonFile: "t.json" }] }] },
      "profile",
    );
    assert.strictEqual(cfg?.name, "profile");
    assert.strictEqual(cfg?.targets[0].jsonFile, "t.json");
  });
});

// ---- consolidation ---------------------------------------------------------
suite("intellisense/consolidate", () => {
  test("unions + dedupes includes/defines across targets, normalizes paths", () => {
    const c = consolidateTargets([
      {
        includes: [{ path: "D:/Eng/Code/Framework/AzCore/." }, { path: "D:/Proj/Gem/Include" }],
        defines: ["WIN64", "AZ_PROFILE_BUILD"],
        standard: "20",
      },
      {
        includes: [{ path: "D:\\Eng\\Code\\Framework\\AzCore\\.", isSystem: true }, { path: "D:/Eng/Code/Framework/AzFramework/." }],
        defines: ["WIN64", "NDEBUG"],
        standard: "17",
      },
    ]);
    assert.deepStrictEqual(c.includes.map((i) => i.path), [
      "D:/Eng/Code/Framework/AzCore", // normalized + deduped across the two targets
      "D:/Proj/Gem/Include",
      "D:/Eng/Code/Framework/AzFramework",
    ]);
    assert.deepStrictEqual(c.defines, ["WIN64", "AZ_PROFILE_BUILD", "NDEBUG"]);
    assert.strictEqual(c.standard, "20"); // first seen
  });
});

// ---- remap -----------------------------------------------------------------
suite("intellisense/remap", () => {
  const mappings: RootMapping[] = [
    { fromRoot: "D:/GS/GS_Play_Engine", toRef: "${workspaceFolder:Engine (source): o3de_sourcedev}" },
    { fromRoot: "D:/OffLocalDev/CurvesTest", toRef: "${workspaceFolder}" },
  ];

  test("build-engine paths remap to the workspace source engine", () => {
    assert.strictEqual(
      remapPath("D:/GS/GS_Play_Engine/Code/Framework/AzCore/.", mappings),
      "${workspaceFolder:Engine (source): o3de_sourcedev}/Code/Framework/AzCore",
    );
  });

  test("project paths relativize to ${workspaceFolder}; 3rd-party stays absolute", () => {
    assert.strictEqual(remapPath("D:/OffLocalDev/CurvesTest/Gem/Include", mappings), "${workspaceFolder}/Gem/Include");
    assert.strictEqual(remapPath("C:/Users/x/.o3de/3rdParty/Lua/include", mappings), "C:/Users/x/.o3de/3rdParty/Lua/include");
  });

  test("remapIncludes preserves the system flag", () => {
    const out = remapIncludes([{ path: "D:/GS/GS_Play_Engine/Code/Framework/AzCore/.", isSystem: true }], mappings);
    assert.strictEqual(out[0].isSystem, true);
    assert.ok(out[0].path.startsWith("${workspaceFolder:Engine (source)"));
  });

  test("engine redirect falls back to the build path when the source lacks it (generated dirs)", () => {
    // Source engine has AzCore but NOT the build-generated Azcg dir.
    const sourceHas = (abs: string) => !abs.includes("/Azcg/Generated/");
    const verified: RootMapping[] = [
      {
        fromRoot: "D:/GS/GS_Play_Engine",
        toRef: "${workspaceFolder:Engine (source): o3de_sourcedev}",
        verifyBase: "D:/OffLocalDev/o3de_sourcedev",
        exists: sourceHas,
      },
    ];
    // Present in source → remaps to the workspace source engine.
    assert.strictEqual(
      remapPath("D:/GS/GS_Play_Engine/Code/Framework/AzCore/.", verified),
      "${workspaceFolder:Engine (source): o3de_sourcedev}/Code/Framework/AzCore",
    );
    // Build-only generated dir → keeps the absolute build-engine path (headers still resolve).
    assert.strictEqual(
      remapPath("D:/GS/GS_Play_Engine/Code/Framework/AzNetworking/Azcg/Generated/AzNetworking", verified),
      "D:/GS/GS_Play_Engine/Code/Framework/AzNetworking/Azcg/Generated/AzNetworking",
    );
  });
});

// ---- c_cpp_properties ------------------------------------------------------
suite("intellisense/cppProperties", () => {
  test("cppStandardFromApi maps digits, defaults to c++20", () => {
    assert.strictEqual(cppStandardFromApi("20"), "c++20");
    assert.strictEqual(cppStandardFromApi("17"), "c++17");
    assert.strictEqual(cppStandardFromApi(undefined), "c++20");
  });

  test("buildCppConfiguration sets MSVC fields + browse.path", () => {
    const cfg = buildCppConfiguration({
      name: "O3DE",
      includePath: ["${workspaceFolder}/Gem/Include"],
      defines: ["WIN64"],
      compilerPath: "C:/msvc/cl.exe",
      standard: "20",
    });
    assert.strictEqual(cfg["intelliSenseMode"], "windows-msvc-x64");
    assert.strictEqual(cfg["compilerPath"], "C:/msvc/cl.exe");
    assert.strictEqual(cfg["cppStandard"], "c++20");
    assert.deepStrictEqual((cfg["browse"] as Record<string, unknown>)["path"], ["${workspaceFolder}/Gem/Include"]);
  });

  test("mergeCppProperties replaces our config by name, keeps others + version", () => {
    const existing = {
      version: 4,
      configurations: [{ name: "Linux" }, { name: "O3DE", includePath: ["old"] }],
    };
    const merged = mergeCppProperties(existing, { name: "O3DE", includePath: ["new"] });
    const configs = merged["configurations"] as Record<string, unknown>[];
    assert.strictEqual(configs.length, 2);
    assert.strictEqual(configs[0]["name"], "Linux"); // preserved
    assert.deepStrictEqual(configs[1]["includePath"], ["new"]); // replaced
    assert.strictEqual(merged["version"], 4);
  });
});
