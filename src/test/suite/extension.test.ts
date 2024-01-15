import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";

suite("Open Pyproject Test", () => {
  test("Assert extension is activated", async () => {
    // Wait for extension to activate
    await vscode.extensions.getExtension("gabdug.pdm")?.activate();

    assert.strictEqual(
      vscode.extensions.getExtension("gabdug.pdm")?.isActive,
      true
    );
  });

  test("Open pyproject.toml file", async () => {
    const filePath = path.join(__dirname, "..", "..", "..", "pyproject.toml");
    const uri = vscode.Uri.file(filePath);

    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);

    assert.strictEqual(
      vscode.window.activeTextEditor?.document.fileName,
      filePath
    );

    // SHow explorer panel "PDM Scripts"

    // Sleep 10 seconds (with mocha)
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check we have the "PDM Scripts" explorer panel
    // assert.strictEqual(1, 2);
    // assert(false);
    // Get the explorer
    // const explorer = vscode.window.createTreeView("pdmScripts",
  });
});
