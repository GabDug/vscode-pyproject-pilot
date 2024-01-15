/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import { Commands, registerCommand } from "./common";
import {
  IFolderTaskItem,
  ITaskWithLocation,
  createTask,
  detectPdmScriptsForFolder,
  findScriptAtPosition,
  getPackageManager,
  providePdmScriptsForPyprojectToml,
  runScript,
} from "./tasks";

import path = require("path");

export class CommandsProvider {
  private extensionContext: vscode.ExtensionContext;
  constructor(private context: vscode.ExtensionContext) {
    this.extensionContext = context;

    context.subscriptions.push(
      registerCommand(vscode.commands, Commands.runSelectedScript, this.runSelectedScript, this),
      registerCommand(vscode.commands, Commands.runScriptFromFolder, this.selectAndRunScriptFromFolder, this),
      registerCommand(vscode.commands, Commands.runScriptFromFile, this.selectAndRunScriptFromFile, this),
      registerCommand(vscode.commands, Commands.runCommand, this.runCommand, this),
    );
  }

  async runSelectedScript() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const document = editor.document;
    const contents = document.getText();
    const script = findScriptAtPosition(editor.document, contents, editor.selection.anchor);
    if (script) {
      runScript(this.extensionContext, script, document);
    } else {
      const message = "Could not find a valid PDM script at the selection.";
      vscode.window.showErrorMessage(message);
    }
  }

  async selectAndRunScriptFromFile(selectedPath: vscode.Uri | vscode.Uri[]) {
    const context = this.extensionContext;
    if (Array.isArray(selectedPath)) {
      selectedPath = selectedPath[0];
    }
    const taskList: ITaskWithLocation[] = await providePdmScriptsForPyprojectToml(context, selectedPath, true);

    const itemList: IFolderTaskItem[] = taskList.map((task) => {
      return {
        label: task.task.name,
        task: task.task,
        description: task?.script?.help,
        iconPath: new vscode.ThemeIcon("wrench"),
        //  detail: task?.script?.exec_type
      };
    });

    await createTaskQuickList(itemList, selectedPath);
  }
  async selectAndRunScriptFromFolder(selectedFolders: vscode.Uri[] | vscode.Uri) {
    const context = this.extensionContext;

    // XXX(GabDug): support multiple folders selected (deduplicated)
    let selectedFolder: vscode.Uri;
    if (Array.isArray(selectedFolders)) {
      if (selectedFolders?.length === 0) {
        return;
      }
      selectedFolder = selectedFolders[0];
      if (selectedFolders?.length > 1) {
        vscode.window.showInformationMessage(
          `Only one folder can be selected at a time. While proceeding, only the first folder will be used: ${selectedFolder.fsPath}`,
        );
      }
    } else {
      selectedFolder = selectedFolders;
    }
    const taskList: IFolderTaskItem[] = await detectPdmScriptsForFolder(context, selectedFolder);
    await createTaskQuickList(taskList, selectedFolder);
  }

  async runCommand(pyprojectTomlUri: vscode.Uri, command: string, args?: string[]) {
    const folder = vscode.workspace.getWorkspaceFolder(pyprojectTomlUri);
    if (!folder) {
      return;
    }
    if (!args) {
      args = [command];
    }
    const task = await createTask(
      await getPackageManager(this.context, folder.uri, true),
      command,
      args,
      folder,
      pyprojectTomlUri,
      undefined,
      [],
    );
    vscode.tasks.executeTask(task);
  }
}

async function createTaskQuickList(taskList: IFolderTaskItem[], selectedPath: vscode.Uri) {
  if (taskList && taskList.length > 0) {
    const quickPick = vscode.window.createQuickPick<IFolderTaskItem>();
    quickPick.placeholder = "Select a PDM script to run";
    quickPick.items = taskList;

    const toDispose: vscode.Disposable[] = [];

    const pickPromise = new Promise<IFolderTaskItem | undefined>((c) => {
      toDispose.push(
        quickPick.onDidAccept(() => {
          toDispose.forEach((d) => d.dispose());
          c(quickPick.selectedItems[0]);
        }),
      );
      toDispose.push(
        quickPick.onDidHide(() => {
          toDispose.forEach((d) => d.dispose());
          c(undefined);
        }),
      );
    });
    quickPick.show();
    const result = await pickPromise;
    quickPick.dispose();
    if (result) {
      vscode.tasks.executeTask(result.task);
    }
  } else {
    vscode.window.showInformationMessage(`No PDM scripts found in ${selectedPath.fsPath}`, { modal: true });
  }
}
