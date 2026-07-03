import * as assert from "assert";
import { buildProviderModel } from "../intellisense/providerModel";
import { parseTargetSourcePaths } from "../intellisense/fileApi";
import { RootMapping } from "../intellisense/remap";
import { normalizePath } from "../intellisense/paths";

suite("intellisense/fileApi.parseTargetSourcePaths", () => {
  test("keeps C/C++ sources, drops the unity blob's non-code neighbours (.cmake/.props)", () => {
    const sources = parseTargetSourcePaths({
      sources: [
        { path: "build/windows/.../Unity/unity_0_cxx.cxx" }, // unity blob (still .cxx → kept)
        { path: "Gem/Source/CurvesTestSystemComponent.cpp" },
        { path: "Gem/Source/CurvesTestSystemComponent.h" },
        { path: "D:/Eng/cmake/Platform/Common/Configurations_common.cmake" }, // dropped
        { path: "D:/Eng/cmake/MSVC/TestProject.props" }, // dropped
      ],
    });
    assert.deepStrictEqual(sources, [
      "build/windows/.../Unity/unity_0_cxx.cxx",
      "Gem/Source/CurvesTestSystemComponent.cpp",
      "Gem/Source/CurvesTestSystemComponent.h",
    ]);
  });
});

suite("intellisense/providerModel", () => {
  const PROJECT_ROOT = "D:/OffLocalDev/CurvesTest";
  // Engine build → source engine, ABSOLUTE (provider responses aren't ${var}-resolved).
  const mappings: RootMapping[] = [
    { fromRoot: "D:/GS/GS_Play_Engine", toRef: "D:/OffLocalDev/o3de_sourcedev" },
  ];

  const reply = {
    configName: "profile",
    compilerPath: "C:/msvc/cl.exe",
    targets: [
      {
        compile: {
          includes: [
            { path: "D:/OffLocalDev/CurvesTest/Gem/Include" },
            { path: "D:/GS/GS_Play_Engine/Code/Framework/AzCore/.", isSystem: true },
          ],
          defines: ["AZ_PROFILE_BUILD", "WIN64"],
          forcedIncludes: ["D:/GS/GS_Play_Engine/Code/Framework/AzCore/Platform/Common/VSCompat.h"],
          standard: "20",
        },
        sourcePaths: ["Gem/Source/CurvesTestSystemComponent.cpp", "Gem/Include/CurvesTest/CurvesTestBus.h"],
      },
    ],
  };

  test("per-file config maps a project source to its target (paths absolute, engine remapped)", () => {
    const model = buildProviderModel(reply, PROJECT_ROOT, mappings);
    const key = normalizePath("D:/OffLocalDev/CurvesTest/Gem/Source/CurvesTestSystemComponent.cpp").toLowerCase();
    const cfg = model.perFile.get(key);
    assert.ok(cfg, "the .cpp is indexed to its target");
    assert.ok(cfg!.includePath.includes("D:/OffLocalDev/CurvesTest/Gem/Include"), "project include kept absolute");
    assert.ok(
      cfg!.includePath.includes("D:/OffLocalDev/o3de_sourcedev/Code/Framework/AzCore"),
      "engine include remapped to the source engine (absolute)",
    );
    assert.strictEqual(cfg!.standard, "c++20");
    assert.strictEqual(cfg!.intelliSenseMode, "windows-msvc-x64");
    assert.strictEqual(cfg!.compilerPath, "C:/msvc/cl.exe");
    assert.strictEqual((cfg!.forcedInclude ?? []).length, 1);
  });

  test("browse config is the consolidated union; default fallback exists for headers/unknown", () => {
    const model = buildProviderModel(reply, PROJECT_ROOT, mappings);
    assert.ok(model.browsePath.includes("D:/OffLocalDev/o3de_sourcedev/Code/Framework/AzCore"));
    assert.ok(model.defaultConfig.includePath.length >= model.browsePath.length - 1);
    // a header listed under the target is also indexed per-file
    assert.ok(model.perFile.has(normalizePath("D:/OffLocalDev/CurvesTest/Gem/Include/CurvesTest/CurvesTestBus.h").toLowerCase()));
  });
});
