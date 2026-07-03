import * as assert from "assert";
import {
  parseVsWhereJson,
  pickBestInstall,
  VisualStudioInstall,
} from "../env/visualStudio";

suite("parseVsWhereJson", () => {
  test("parses a typical vswhere JSON payload", () => {
    const json = JSON.stringify([
      {
        displayName: "Visual Studio Community 2022",
        installationPath: "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community",
        installationVersion: "17.10.35013.160",
        isPrerelease: false,
      },
    ]);
    const parsed = parseVsWhereJson(json);
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].displayName, "Visual Studio Community 2022");
    assert.ok(parsed[0].installationPath.includes("2022"));
    assert.strictEqual(parsed[0].version, "17.10.35013.160");
    assert.strictEqual(parsed[0].isPrerelease, false);
  });

  test("returns [] on empty or malformed input", () => {
    assert.deepStrictEqual(parseVsWhereJson(""), []);
    assert.deepStrictEqual(parseVsWhereJson("not json"), []);
    assert.deepStrictEqual(parseVsWhereJson("{}"), []);
  });

  test("skips entries without an installationPath", () => {
    const json = JSON.stringify([{ displayName: "Broken" }, { installationPath: "C:\\VS" }]);
    const parsed = parseVsWhereJson(json);
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].installationPath, "C:\\VS");
  });

  test("falls back to a default display name", () => {
    const json = JSON.stringify([{ installationPath: "C:\\VS" }]);
    assert.strictEqual(parseVsWhereJson(json)[0].displayName, "Visual Studio");
  });
});

suite("pickBestInstall", () => {
  const mk = (version: string, hasCppTools: boolean): VisualStudioInstall => ({
    displayName: version,
    installationPath: `C:\\VS\\${version}`,
    version,
    isPrerelease: false,
    hasCppTools,
  });

  test("prefers the newest version among C++-capable installs", () => {
    const best = pickBestInstall([mk("16.11.1", true), mk("17.14.2", true), mk("17.9.9", false)]);
    assert.strictEqual(best?.version, "17.14.2");
  });

  test("prefers a C++-capable install over a newer one without C++ tools", () => {
    const best = pickBestInstall([mk("17.20.0", false), mk("17.10.0", true)]);
    assert.strictEqual(best?.version, "17.10.0");
  });

  test("returns undefined for empty input", () => {
    assert.strictEqual(pickBestInstall([]), undefined);
  });
});
