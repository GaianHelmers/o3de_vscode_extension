import * as assert from "assert";
import {
  buildBuildArgs,
  curatedTargets,
  targetsLabel,
  parseCustomTargets,
} from "../build/buildCommand";
import { parseTargetNames } from "../intellisense/fileApi";

suite("buildCommand", () => {
  const buildDir = "D:/OffLocalDev/CurvesTest/build/windows";

  test("buildBuildArgs omits --target when no targets (build everything)", () => {
    assert.deepStrictEqual(buildBuildArgs({ buildDir, config: "profile", targets: [] }), [
      "cmake",
      "--build",
      buildDir,
      "--config",
      "profile",
    ]);
  });

  test("buildBuildArgs emits a single --target (matches the user's Editor .bat)", () => {
    assert.deepStrictEqual(buildBuildArgs({ buildDir, config: "profile", targets: ["Editor"] }), [
      "cmake",
      "--build",
      buildDir,
      "--target",
      "Editor",
      "--config",
      "profile",
    ]);
  });

  test("buildBuildArgs builds several targets together under one --target", () => {
    assert.deepStrictEqual(
      buildBuildArgs({ buildDir, config: "debug", targets: ["Editor", "GS_Play.GameLauncher"] }),
      [
        "cmake",
        "--build",
        buildDir,
        "--target",
        "Editor",
        "GS_Play.GameLauncher",
        "--config",
        "debug",
      ],
    );
  });

  test("curatedTargets pins Editor + <Project>.GameLauncher", () => {
    assert.deepStrictEqual(curatedTargets("GS_Play"), ["Editor", "GS_Play.GameLauncher"]);
  });

  test("targetsLabel: empty = All targets, small list joined, long list summarized", () => {
    assert.strictEqual(targetsLabel([]), "All targets");
    assert.strictEqual(targetsLabel(["Editor"]), "Editor");
    assert.strictEqual(targetsLabel(["Editor", "GS_Play.GameLauncher"]), "Editor, GS_Play.GameLauncher");
    assert.strictEqual(targetsLabel(["a", "b", "c", "d", "e"]), "a, b +3 more");
  });

  test("parseCustomTargets splits on commas / whitespace and drops blanks", () => {
    assert.deepStrictEqual(parseCustomTargets("Editor, GS_Play.GameLauncher"), [
      "Editor",
      "GS_Play.GameLauncher",
    ]);
    assert.deepStrictEqual(parseCustomTargets("  A   B\tC "), ["A", "B", "C"]);
    assert.deepStrictEqual(parseCustomTargets("   "), []);
  });
});

suite("fileApi.parseTargetNames", () => {
  const codemodel = {
    configurations: [
      {
        name: "profile",
        targets: [
          { name: "Editor", jsonFile: "target-Editor.json" },
          { name: "GS_Play.GameLauncher", jsonFile: "target-gl.json" },
          { name: "Editor", jsonFile: "target-Editor-dup.json" }, // duplicate name
        ],
      },
      { name: "debug", targets: [{ name: "OnlyDebug", jsonFile: "target-d.json" }] },
    ],
  };

  test("returns the matching config's target names, de-duplicated in order", () => {
    assert.deepStrictEqual(parseTargetNames(codemodel, "profile"), ["Editor", "GS_Play.GameLauncher"]);
  });

  test("matches config name case-insensitively", () => {
    assert.deepStrictEqual(parseTargetNames(codemodel, "Debug"), ["OnlyDebug"]);
  });

  test("falls back to the first config when the name is absent", () => {
    assert.deepStrictEqual(parseTargetNames(codemodel, "nonexistent"), [
      "Editor",
      "GS_Play.GameLauncher",
    ]);
  });

  test("empty when there are no configurations", () => {
    assert.deepStrictEqual(parseTargetNames({ configurations: [] }, "profile"), []);
  });
});
