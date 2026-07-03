import * as assert from "assert";
import * as path from "path";
import {
  parseLaunchArgs,
  runArgsFor,
  projectRuntimeExe,
  gameLauncherExeName,
  runSummary,
  launchArgsLabel,
} from "../build/runCommand";
import { platformBuildDir } from "../build/configureCommand";

suite("runCommand", () => {
  test("parseLaunchArgs splits on whitespace and honors double quotes", () => {
    assert.deepStrictEqual(parseLaunchArgs("+LoadLevel DefaultLevel +r_displayInfo 1"), [
      "+LoadLevel",
      "DefaultLevel",
      "+r_displayInfo",
      "1",
    ]);
    assert.deepStrictEqual(parseLaunchArgs('+LoadLevel "My Level"'), ["+LoadLevel", "My Level"]);
    assert.deepStrictEqual(parseLaunchArgs("   "), []);
    assert.deepStrictEqual(parseLaunchArgs(""), []);
  });

  test("runArgsFor: Editor gets --project-path + options; GameLauncher gets only options", () => {
    assert.deepStrictEqual(runArgsFor("Editor", "D:/proj", ""), ["--project-path", "D:/proj"]);
    assert.deepStrictEqual(runArgsFor("Editor", "D:/proj", "+r_displayInfo 1"), [
      "--project-path",
      "D:/proj",
      "+r_displayInfo",
      "1",
    ]);
    assert.deepStrictEqual(runArgsFor("GameLauncher", "D:/proj", "+LoadLevel DefaultLevel"), [
      "+LoadLevel",
      "DefaultLevel",
    ]);
    assert.deepStrictEqual(runArgsFor("GameLauncher", "D:/proj", ""), []);
  });

  test("projectRuntimeExe composes <project>/build/<platform>/bin/<config>/<exe>", () => {
    assert.strictEqual(
      projectRuntimeExe("D:/proj", "profile", "Editor.exe"),
      path.join("D:/proj", "build", platformBuildDir(), "bin", "profile", "Editor.exe"),
    );
  });

  test("gameLauncherExeName is project-prefixed (matches the real build output)", () => {
    assert.strictEqual(gameLauncherExeName("GS_Play"), "GS_Play.GameLauncher.exe");
  });

  test("runSummary / launchArgsLabel reflect the current selection", () => {
    assert.strictEqual(runSummary("Editor", ""), "Editor");
    assert.strictEqual(runSummary("GameLauncher", "+LoadLevel DefaultLevel"), "GameLauncher · +LoadLevel DefaultLevel");
    assert.strictEqual(launchArgsLabel(""), "(none)");
    assert.strictEqual(launchArgsLabel("  "), "(none)");
    assert.strictEqual(launchArgsLabel("+r_displayInfo 1"), "+r_displayInfo 1");
  });
});
