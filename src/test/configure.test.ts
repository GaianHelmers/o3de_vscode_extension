import * as assert from "assert";
import {
  buildConfigureArgs,
  formatCommand,
  parseCachedGenerator,
} from "../build/configureCommand";

suite("configureCommand", () => {
  test("buildConfigureArgs emits the O3DE Ninja configure argv", () => {
    const argv = buildConfigureArgs({
      projectPath: "D:/OffLocalDev/CurvesTest",
      buildDir: "D:/OffLocalDev/CurvesTest/build/windows",
      generator: "Ninja Multi-Config",
      thirdPartyPath: "C:/Users/x/.o3de/3rdParty",
    });
    assert.deepStrictEqual(argv, [
      "cmake",
      "-G",
      "Ninja Multi-Config",
      "-S",
      "D:/OffLocalDev/CurvesTest",
      "-B",
      "D:/OffLocalDev/CurvesTest/build/windows",
      "-DLY_3RDPARTY_PATH=C:/Users/x/.o3de/3rdParty",
    ]);
  });

  test("formatCommand quotes tokens with spaces / = / path chars, leaves bare flags", () => {
    const cmd = formatCommand([
      "cmake",
      "-G",
      "Ninja Multi-Config",
      "-S",
      "D:\\a b\\proj",
      "-DLY_3RDPARTY_PATH=C:\\x",
    ]);
    assert.strictEqual(
      cmd,
      'cmake -G "Ninja Multi-Config" -S "D:\\a b\\proj" "-DLY_3RDPARTY_PATH=C:\\x"',
    );
  });

  test("parseCachedGenerator reads CMAKE_GENERATOR:INTERNAL", () => {
    const cache = [
      "# This is the CMakeCache file.",
      "CMAKE_BUILD_TYPE:STRING=",
      "CMAKE_GENERATOR:INTERNAL=Ninja Multi-Config",
      "CMAKE_GENERATOR_INSTANCE:INTERNAL=",
    ].join("\n");
    assert.strictEqual(parseCachedGenerator(cache), "Ninja Multi-Config");
  });

  test("parseCachedGenerator returns undefined when the line is absent", () => {
    assert.strictEqual(parseCachedGenerator("SOME_VAR:BOOL=ON\n"), undefined);
  });
});
