import * as assert from "assert";
import { buildProjectSettings, mergeSettings } from "../build/vscodeConfig";

suite("buildProjectSettings", () => {
  const s = buildProjectSettings({
    generator: "Ninja Multi-Config",
    thirdPartyPath: "C:/Users/gaian/.o3de/3rdParty",
    parallelJobs: 16,
    platformBuildDir: "windows",
    defaultConfig: "profile",
  });

  test("uses the chosen generator; no CMake-Tools IntelliSense coupling (Approach 1 rejected)", () => {
    assert.strictEqual(s["cmake.generator"], "Ninja Multi-Config");
    // Approach 2: we own IntelliSense via c_cpp_properties.json — no provider, no n_cc.
    assert.ok(
      !("C_Cpp.default.configurationProvider" in s),
      "must not defer IntelliSense to CMake Tools (it can't build O3DE)",
    );
    assert.ok(!("C_Cpp.default.compileCommands" in s), "must not emit compileCommands (n_cc)");
    assert.strictEqual(s["cmake.configureOnOpen"], false); // stop CMake Tools' failing auto-configure
  });

  test("wires source/build dirs and 3rd-party path", () => {
    assert.strictEqual(s["cmake.sourceDirectory"], "${workspaceFolder}");
    assert.strictEqual(s["cmake.buildDirectory"], "${workspaceFolder}/build/windows");
    assert.deepStrictEqual(s["cmake.configureSettings"], {
      LY_3RDPARTY_PATH: "C:/Users/gaian/.o3de/3rdParty",
    });
    assert.strictEqual(s["cmake.parallelJobs"], 16);
  });
});

suite("mergeSettings", () => {
  test("keeps existing keys, overrides ours, deep-merges objects", () => {
    const existing = {
      "editor.tabSize": 4, // user's own — preserve
      "cmake.generator": "Visual Studio 17 2022", // ours overrides
      "cmake.configureSettings": { CUSTOM_FLAG: "keep" }, // deep-merge
    };
    const generated = {
      "cmake.generator": "Ninja Multi-Config",
      "cmake.configureSettings": { LY_3RDPARTY_PATH: "C:/tp" },
    };
    const merged = mergeSettings(existing, generated);
    assert.strictEqual(merged["editor.tabSize"], 4);
    assert.strictEqual(merged["cmake.generator"], "Ninja Multi-Config");
    assert.deepStrictEqual(merged["cmake.configureSettings"], {
      CUSTOM_FLAG: "keep",
      LY_3RDPARTY_PATH: "C:/tp",
    });
  });
});
