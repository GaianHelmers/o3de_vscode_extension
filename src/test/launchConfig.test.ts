import * as assert from "assert";
import {
  buildLaunchConfigurations,
  mergeLaunchJson,
  LaunchInputs,
} from "../build/launchConfig";

const FULL: LaunchInputs = {
  projectRef: "${workspaceFolder}",
  editorProgram: "C:/Engines/SDK/bin/Windows/profile/Default/Editor.exe",
  gameLauncherProgram: "${workspaceFolder}/build/windows/bin/profile/DECOYPROGSGE.GameLauncher.exe",
  natvisPath: "${workspaceFolder:Engine (source): O3DEEditor}/Code/Framework/AzCore/Platform/Common/VisualStudio/AzCore/Natvis/azcore.natvis",
  sourceEngineRef: "${workspaceFolder:Engine (source): O3DEEditor}",
};

function byName(configs: Record<string, unknown>[], name: string): Record<string, unknown> | undefined {
  return configs.find((c) => c["name"] === name);
}

suite("launchConfig", () => {
  test("full inputs → Editor, GameLauncher, Attach, Attach (visualized), ClassWizard", () => {
    const configs = buildLaunchConfigurations(FULL);
    assert.deepStrictEqual(
      configs.map((c) => c["name"]),
      ["O3DE: Editor", "O3DE: GameLauncher", "O3DE: Attach", "O3DE: Attach (visualized)", "O3DE: Class Creation Wizard"],
    );
  });

  test("Editor gets --project-path + source-engine natvis", () => {
    const editor = byName(buildLaunchConfigurations(FULL), "O3DE: Editor")!;
    assert.strictEqual(editor["type"], "cppvsdbg");
    assert.deepStrictEqual(editor["args"], ["--project-path", "${workspaceFolder}"]);
    assert.strictEqual(editor["visualizerFile"], FULL.natvisPath);
  });

  test("ClassWizard points python at the SOURCE engine Tools/ and passes engine + project paths", () => {
    const wiz = byName(buildLaunchConfigurations(FULL), "O3DE: Class Creation Wizard")!;
    assert.strictEqual(wiz["type"], "debugpy");
    assert.strictEqual(
      wiz["program"],
      "${workspaceFolder:Engine (source): O3DEEditor}/Tools/ClassCreationWizard/ClassWizard.py",
    );
    assert.deepStrictEqual(wiz["args"], [
      "--engine-path",
      "${workspaceFolder:Engine (source): O3DEEditor}",
      "--project-path",
      "${workspaceFolder}",
    ]);
  });

  test("no source engine → no ClassWizard, no visualized attach, no natvis on Editor", () => {
    const configs = buildLaunchConfigurations({
      projectRef: "${workspaceFolder}",
      editorProgram: "${workspaceFolder}/build/windows/bin/profile/Editor.exe",
      gameLauncherProgram: "${workspaceFolder}/build/windows/bin/profile/P.GameLauncher.exe",
    });
    assert.deepStrictEqual(configs.map((c) => c["name"]), [
      "O3DE: Editor",
      "O3DE: GameLauncher",
      "O3DE: Attach",
    ]);
    assert.ok(!("visualizerFile" in byName(configs, "O3DE: Editor")!));
  });

  test("mergeLaunchJson replaces our O3DE configs, preserves the user's own", () => {
    const existing = {
      version: "0.2.0",
      configurations: [
        { name: "My Custom Attach", type: "cppvsdbg" }, // user's — keep
        { name: "O3DE: Editor", program: "stale" }, // ours — replace
      ],
    };
    const merged = mergeLaunchJson(existing, buildLaunchConfigurations(FULL));
    const names = (merged["configurations"] as Record<string, unknown>[]).map((c) => c["name"]);
    assert.ok(names.includes("My Custom Attach"), "user config preserved");
    assert.strictEqual(names.filter((n) => n === "O3DE: Editor").length, 1, "no duplicate O3DE: Editor");
    assert.strictEqual(merged["version"], "0.2.0");
  });
});
