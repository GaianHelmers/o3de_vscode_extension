import * as assert from "assert";
import { parseProject, parseEngine, parseGem } from "../o3de/identity";
import { parseManifest } from "../o3de/manifest";

suite("O3DE identity parsers", () => {
  test("parseProject extracts name, engine, gems", () => {
    const p = parseProject(
      {
        project_name: "GS_Play",
        display_name: "GS_Play",
        engine: "GS_Play_Engine",
        external_subdirectories: ["Gem"],
        gem_names: ["Atom", "GS_Core"],
      },
      "D:/OffLocalDev/gs_play",
    );
    assert.ok(p);
    assert.strictEqual(p!.projectName, "GS_Play");
    assert.strictEqual(p!.engine, "GS_Play_Engine");
    assert.deepStrictEqual(p!.externalSubdirectories, ["Gem"]);
    assert.deepStrictEqual(p!.gemNames, ["Atom", "GS_Core"]);
  });

  test("parseProject returns undefined without project_name", () => {
    assert.strictEqual(parseProject({ display_name: "x" }, "d"), undefined);
  });

  test("parseEngine flags the prebuilt SDK via sdk_engine", () => {
    const sdk = parseEngine({ engine_name: "o3de-sdk", sdk_engine: true }, "d");
    const src = parseEngine({ engine_name: "o3de_sourcedev" }, "d");
    assert.strictEqual(sdk!.isSdkEngine, true);
    assert.strictEqual(src!.isSdkEngine, false);
  });

  test("parseGem reads type (Code vs asset)", () => {
    const g = parseGem({ gem_name: "GS_Core", type: "Code" }, "d");
    assert.strictEqual(g!.gemName, "GS_Core");
    assert.strictEqual(g!.type, "Code");
  });
});

suite("O3DE manifest parser", () => {
  test("maps engines/projects/gems and engines_path", () => {
    const m = parseManifest({
      engines: ["D:/GS_Sys/Engines/GS_Play_Engine"],
      engines_path: { GS_Play_Engine: "D:/GS_Sys/Engines/GS_Play_Engine" },
      projects: ["D:/OffLocalDev/gs_play"],
      external_subdirectories: ["D:/OffLocalDev/gs_play_gems/gs_core"],
      default_projects_folder: "D:/OffLocalDev",
    });
    assert.deepStrictEqual(m.engines, ["D:/GS_Sys/Engines/GS_Play_Engine"]);
    assert.strictEqual(m.enginesByName["GS_Play_Engine"], "D:/GS_Sys/Engines/GS_Play_Engine");
    assert.deepStrictEqual(m.projects, ["D:/OffLocalDev/gs_play"]);
    assert.strictEqual(m.gems.length, 1);
    assert.strictEqual(m.defaultProjectsFolder, "D:/OffLocalDev");
  });
});
