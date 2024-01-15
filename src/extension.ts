/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import { Commands, Configuration, ContextKey, registerCommand, setContextKey } from "./common";
import { PdmScriptHoverProvider, invalidateHoverScriptsCache } from "./scriptHover";
import { PdmTaskProvider, getPackageManager, hasPyprojectToml, invalidateTasksCache } from "./tasks";

import { CommandsProvider } from "./commands";
import { PdmScriptLensProvider } from "./pdmCodeLens";
import { PdmScriptsTreeDataProvider } from "./pdmView";

let treeDataProvider: PdmScriptsTreeDataProvider | undefined;
let outputChannel: vscode.OutputChannel | undefined;

async function invalidateScriptCaches(echo = true) {
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

export async function activate(context: vscode.ExtensionContext): Promise<void> {
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
    }),
  );

  registerHoverProvider(context);

  if (await hasPyprojectToml()) {
    setContextKey(vscode.commands, ContextKey.showScriptExplorer, true);
  }

  context.subscriptions.push(
    registerCommand(vscode.commands, Commands.PdmRefresh, invalidateScriptCaches),
    registerCommand(vscode.commands, Commands.PdmPackageManager, (args) => {
      if (args instanceof vscode.Uri) {
        return getPackageManager(context, args);
      }

      return Promise.resolve("");
    }),
  );
  registerCodeLensProvider(context);
  new CommandsProvider(context);
}

let taskProvider: PdmTaskProvider;
function registerTaskProvider(context: vscode.ExtensionContext): vscode.Disposable | undefined {
  if (vscode.workspace.workspaceFolders) {
    const watcher = vscode.workspace.createFileSystemWatcher("**/pyproject.toml");
    watcher.onDidChange((_e) => invalidateScriptCaches(false));
    watcher.onDidDelete((_e) => invalidateScriptCaches(false));
    watcher.onDidCreate((_e) => invalidateScriptCaches(false));

    const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders((_e) => invalidateScriptCaches(false));

    taskProvider = new PdmTaskProvider(context);
    const disposable = vscode.tasks.registerTaskProvider("pdm", taskProvider);
    context.subscriptions.push(workspaceWatcher, watcher, disposable);
    return disposable;
  }
  return undefined;
}

function registerExplorer(context: vscode.ExtensionContext): PdmScriptsTreeDataProvider | undefined {
  if (vscode.workspace.workspaceFolders) {
    const treeDataProvider = new PdmScriptsTreeDataProvider(context, taskProvider!);
    const view = vscode.window.createTreeView("pdm", {
      treeDataProvider: treeDataProvider,
      showCollapseAll: true,
    });
    context.subscriptions.push(view);
    return treeDataProvider;
  }
  return undefined;
}

function registerHoverProvider(context: vscode.ExtensionContext): PdmScriptHoverProvider | undefined {
  if (vscode.workspace.workspaceFolders) {
    const pdmSelector: vscode.DocumentSelector = {
      language: "toml",
      scheme: "file",
      pattern: "**/pyproject.toml",
    };
    const provider = new PdmScriptHoverProvider(context);
    context.subscriptions.push(vscode.languages.registerHoverProvider(pdmSelector, provider));
    return provider;
  }
  return undefined;
}

function registerCodeLensProvider(context: vscode.ExtensionContext): undefined {
  if (vscode.workspace.workspaceFolders) {
    const provider = new PdmScriptLensProvider(context);
    context.subscriptions.push(provider);
  }
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
    console.error("Output channel not initialized for PDM!");
    console.info(content);
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
