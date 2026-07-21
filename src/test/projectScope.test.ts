import * as assert from "assert";
import { resolveEnableState } from "../workspace/projectScope";

suite("Project scope — enable-state resolution", () => {
  test("unset (undefined) is undecided → prompt", () => {
    assert.strictEqual(resolveEnableState(undefined), "undecided");
  });

  test("explicit true is enabled", () => {
    assert.strictEqual(resolveEnableState(true), "enabled");
  });

  test("explicit false is never (dormant, no re-prompt)", () => {
    assert.strictEqual(resolveEnableState(false), "never");
  });
});
