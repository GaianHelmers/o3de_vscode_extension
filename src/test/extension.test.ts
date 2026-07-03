import * as assert from "assert";
import * as vscode from "vscode";

suite("O3DE Development Tools", () => {
  test("registers the o3de.helloWorld command", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("o3de.helloWorld"),
      "expected o3de.helloWorld to be registered",
    );
  });
});
