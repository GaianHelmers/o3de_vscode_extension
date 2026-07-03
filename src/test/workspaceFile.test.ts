import * as assert from "assert";
import {
  buildWorkspaceFileContent,
  defaultWorkspaceFilePath,
  orderWorkspaceFolders,
} from "../workspace/workspaceFile";

suite("buildWorkspaceFileContent", () => {
  test("orders folders (project → gems/custom → engine source) and preserves custom names", () => {
    const ws = buildWorkspaceFileContent(
      { projectName: "CurvesTest", path: "D:/OffLocalDev/CurvesTest" },
      [
        { name: "Engine (source): o3de_sourcedev", path: "D:/OffLocalDev/o3de_sourcedev" },
        { name: "Gem: CurvesTest", path: "D:/OffLocalDev/CurvesTest/Gem" },
        { name: "Gems", path: "D:/OffLocalDev/gs_play_gems" }, // custom, user-named
      ],
    );
    assert.strictEqual(ws.folders.length, 4);
    assert.strictEqual(ws.folders[0].name, "Project: CurvesTest");
    assert.strictEqual(ws.folders[0].path, "D:/OffLocalDev/CurvesTest");
    assert.strictEqual(ws.folders[1].name, "Gem: CurvesTest"); // gems/custom sit between…
    assert.strictEqual(ws.folders[2].name, "Gems"); // …and custom name preserved
    assert.strictEqual(ws.folders[3].name, "Engine (source): o3de_sourcedev"); // …engine source last
  });

  test("project-only workspace has a single folder and empty settings", () => {
    const ws = buildWorkspaceFileContent({ projectName: "CurvesTest", path: "D:/x" }, []);
    assert.strictEqual(ws.folders.length, 1);
    assert.deepStrictEqual(ws.settings, {});
  });

  test("orderWorkspaceFolders: Project → gems/custom → Engine source (stable)", () => {
    const ordered = orderWorkspaceFolders([
      { name: "Project: CurvesTest", path: "p" },
      { name: "Engine (source): o3de_sourcedev", path: "e1" },
      { name: "Gem: GS_Core", path: "g1" },
      { name: "Gems", path: "g2" },
      { name: "Engine (source): O3DEEditor", path: "e2" },
    ]);
    assert.deepStrictEqual(
      ordered.map((f) => f.name),
      [
        "Project: CurvesTest",
        "Gem: GS_Core",
        "Gems",
        "Engine (source): o3de_sourcedev",
        "Engine (source): O3DEEditor",
      ],
    );
  });

  test("defaultWorkspaceFilePath sits in the project's .vscode folder", () => {
    const p = defaultWorkspaceFilePath({
      projectName: "CurvesTest",
      path: "D:/OffLocalDev/CurvesTest",
    });
    assert.ok(p.endsWith("CurvesTest.code-workspace"));
    assert.ok(p.includes(".vscode"));
  });
});
