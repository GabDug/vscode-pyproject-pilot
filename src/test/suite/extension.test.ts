import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";

suite("Open Pyproject Test", () => {
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
  });
});
