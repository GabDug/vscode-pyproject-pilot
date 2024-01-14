/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import {
  runSelectedScript,
  selectAndRunScriptFromFile,
  selectAndRunScriptFromFolder,
} from "./commands";
import {
  Commands,
  Configuration,
  ContextKey,
  registerCommand,
  setContextKey,
} from "./enums";
import {
  PdmScriptHoverProvider,
  invalidateHoverScriptsCache,
} from "./scriptHover";
import {
  PdmTaskProvider,
  getPackageManager,
  hasPyprojectToml,
  invalidateTasksCache,
} from "./tasks";

import { PdmScriptLensProvider } from "./pdmCodeLens";
import { PdmScriptsTreeDataProvider } from "./pdmView";

let treeDataProvider: PdmScriptsTreeDataProvider | undefined;
let outputChannel: vscode.OutputChannel | undefined;

function invalidateScriptCaches(echo = false) {
  console.debug("Invalidating script caches");
  invalidateHoverScriptsCache();
  invalidateTasksCache();
  if (treeDataProvider) {
    console.debug("Refreshing treeDataProvider");
    treeDataProvider.refresh();
  }
  if (echo) {
    vscode.window.showInformationMessage("PDM scripts refreshed.");
  }
  console.debug("Invalidated script caches");
}

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  outputChannel = vscode.window.createOutputChannel("PDM");
  printChannelOutput("Extension 'pdm' is now active!");

  registerTaskProvider(context);
  treeDataProvider = registerExplorer(context);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration(Configuration.exclude) ||
        e.affectsConfiguration(Configuration.autoDetect) ||
        e.affectsConfiguration(Configuration.scriptExplorerExclude)
      ) {
        invalidateTasksCache();
        if (treeDataProvider) {
          treeDataProvider.refresh();
        }
      }
      if (e.affectsConfiguration(Configuration.scriptExplorerAction)) {
        if (treeDataProvider) {
          treeDataProvider.refresh();
        }
      }
    })
  );

  registerHoverProvider(context);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      Commands.runSelectedScript,
      runSelectedScript
    )
  );

  if (await hasPyprojectToml()) {
    setContextKey(vscode.commands, ContextKey.showScriptExplorer, true);
  }

  context.subscriptions.push(
    registerCommand(vscode.commands, Commands.runScriptFromFolder, (args) => {
      // If args is not an ExtensioContext, add it
      printChannelOutput(args);
      if (args instanceof vscode.Uri) {
        printChannelOutput("args is instanceof vscode.Uri");
        return selectAndRunScriptFromFolder(context, [args]);
      }
      // Elif args is a list or array

      if (Array.isArray(args)) {
        printChannelOutput("args is Array.isArray");
        return selectAndRunScriptFromFolder(context, args);
      }
      // Unpack args (which contains context)
      printChannelOutput("args is not instanceof vscode.Uri");
      return selectAndRunScriptFromFolder(context, [args]);
    }),
    registerCommand(vscode.commands, Commands.runScriptFromFile, (args) => {
      // If args is not an ExtensioContext, add it
      if (args instanceof vscode.Uri) {
        printChannelOutput("args is instanceof vscode.Uri");
        return selectAndRunScriptFromFile(context, args);
      }
      // Elif args is a list or array

      if (Array.isArray(args)) {
        printChannelOutput("args is Array.isArray");
        return selectAndRunScriptFromFile(context, args[0]);
      }
      // Unpack args (which contains context)
      printChannelOutput("args is not instanceof vscode.Uri");
      return selectAndRunScriptFromFile(context, args);
    }),
    registerCommand(vscode.commands, Commands.PdmRefresh, (echo) => {
      // If we have no arguments, assume we are comming from UI and echo
      if (typeof echo !== "boolean" || echo === undefined) {
        echo = true;
      }
      invalidateScriptCaches(echo);
      return Promise.resolve();
    }),
    registerCommand(vscode.commands, Commands.PdmPackageManager, (args) => {
      if (args instanceof vscode.Uri) {
        return getPackageManager(context, args);
      }

      return Promise.resolve("");
    }),
    new PdmScriptLensProvider(context)
  );
}

let taskProvider: PdmTaskProvider;
function registerTaskProvider(
  context: vscode.ExtensionContext
): vscode.Disposable | undefined {
  if (vscode.workspace.workspaceFolders) {
    const watcher =
      vscode.workspace.createFileSystemWatcher("**/pyproject.toml");
    watcher.onDidChange((_e) => invalidateScriptCaches(false));
    watcher.onDidDelete((_e) => invalidateScriptCaches(false));
    watcher.onDidCreate((_e) => invalidateScriptCaches(false));
    context.subscriptions.push(watcher);

    const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(
      (_e) => invalidateScriptCaches(false)
    );
    context.subscriptions.push(workspaceWatcher);

    taskProvider = new PdmTaskProvider(context);
    const disposable = vscode.tasks.registerTaskProvider("pdm", taskProvider);
    context.subscriptions.push(disposable);
    return disposable;
  }
  return undefined;
}

function registerExplorer(
  context: vscode.ExtensionContext
): PdmScriptsTreeDataProvider | undefined {
  if (vscode.workspace.workspaceFolders) {
    const treeDataProvider = new PdmScriptsTreeDataProvider(
      context,
      taskProvider!
    );
    const view = vscode.window.createTreeView("pdm", {
      treeDataProvider: treeDataProvider,
      showCollapseAll: true,
    });
    context.subscriptions.push(view);
    return treeDataProvider;
  }
  return undefined;
}

function registerHoverProvider(
  context: vscode.ExtensionContext
): PdmScriptHoverProvider | undefined {
  if (vscode.workspace.workspaceFolders) {
    const pdmSelector: vscode.DocumentSelector = {
      language: "toml",
      scheme: "file",
      pattern: "**/pyproject.toml",
    };
    const provider = new PdmScriptHoverProvider(context);
    context.subscriptions.push(
      vscode.languages.registerHoverProvider(pdmSelector, provider)
    );
    return provider;
  }
  return undefined;
}

/**
 * Prints the given content on the output channel.
 *
 * @param content The content to be printed.
 * @param reveal Whether the output channel should be revealed.
 */
export const printChannelOutput = (content: any, reveal = false): void => {
  // If not string, try to stringify
  if (typeof content !== "string") {
    try {
      content = JSON.stringify(content, null, 2);
    } catch (e) {
      content = content.toString();
    }
  }
  if (!outputChannel) {
    printChannelOutput("Output channel not initialized for PDM!");
    printChannelOutput(content);
    return;
  }
  outputChannel.appendLine(`[${getTimeForLogging()}] ${content}`);
  if (reveal) {
    outputChannel.show(true);
  }
};

export function getTimeForLogging(): string {
  const date = new Date();
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()} ${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}.${date.getMilliseconds()}`;
}
