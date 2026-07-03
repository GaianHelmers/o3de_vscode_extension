import * as assert from "assert";
import { parseSetOutput, diffEnvironment } from "../env/msvcEnvironment";

suite("parseSetOutput", () => {
  test("parses KEY=VALUE lines (CRLF)", () => {
    const env = parseSetOutput("PATH=C:\\a;C:\\b\r\nINCLUDE=C:\\inc\r\nEMPTY=\r\n");
    assert.strictEqual(env.PATH, "C:\\a;C:\\b");
    assert.strictEqual(env.INCLUDE, "C:\\inc");
    assert.strictEqual(env.EMPTY, "");
  });

  test("ignores lines without '='", () => {
    const env = parseSetOutput("some banner text\r\nFOO=bar");
    assert.deepStrictEqual(Object.keys(env), ["FOO"]);
  });

  test("keeps '=' characters inside the value", () => {
    assert.strictEqual(parseSetOutput("Q=a=b=c").Q, "a=b=c");
  });
});

suite("diffEnvironment", () => {
  test("returns only new and changed keys", () => {
    const base = { PATH: "C:\\base", KEEP: "same" };
    const full = { PATH: "C:\\vc;C:\\base", KEEP: "same", VCINSTALLDIR: "C:\\vc" };
    const delta = diffEnvironment(base, full);
    assert.strictEqual(delta.PATH, "C:\\vc;C:\\base");
    assert.strictEqual(delta.VCINSTALLDIR, "C:\\vc");
    assert.ok(!("KEEP" in delta));
  });

  test("compares keys case-insensitively", () => {
    assert.deepStrictEqual(diffEnvironment({ Path: "x" }, { PATH: "x" }), {});
  });
});
