/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import { PdmTaskProvider, getPackageManager, hasPyprojectToml, invalidateTasksCache } from './tasks';
import { runSelectedScript, selectAndRunScriptFromFolder } from './commands';

import { PdmScriptHoverProvider } from './scriptHover';
import { PdmScriptLensProvider } from './pdmScriptLens';
import { PdmScriptsTreeDataProvider } from './pdmView';

let treeDataProvider: PdmScriptsTreeDataProvider | undefined;

function invalidateScriptCaches() {
	// invalidateHoverScriptsCache();
	// invalidateTasksCache();
	if (treeDataProvider) {
		treeDataProvider.refresh();
	}
}
let pdmTaskProvider: vscode.Disposable | undefined;
let pdmCodeLensProvider: vscode.Disposable | undefined;
export  async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceRoot = vscode.workspace.rootPath;
  console.log("Extension 'pdm' is now active!");
//   console.error("workspaceRoot", workspaceRoot)
  // console.error("workspaceRoot",  )
//   vscode.commands.getCommands().then((commands) => {console.error("commands", commands)})
  if (!workspaceRoot) {
    // FIXME support workspaces
    // XX Support when only pyproject.toml has been opened (no folder)
    return;
  }

  registerTaskProvider(context);
  treeDataProvider = registerExplorer(context);

	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration('pdm.exclude') || e.affectsConfiguration('pdm.autoDetect') || e.affectsConfiguration('pdm.scriptExplorerExclude')) {
			invalidateTasksCache();
			if (treeDataProvider) {
				treeDataProvider.refresh();
			}
		}
		if (e.affectsConfiguration('pdm.scriptExplorerAction')) {
			if (treeDataProvider) {
				treeDataProvider.refresh();
			}
		}
	}));

	registerHoverProvider(context);

	context.subscriptions.push(vscode.commands.registerCommand('pdm.runSelectedScript', runSelectedScript));

	if (await hasPyprojectToml()) {
		vscode.commands.executeCommand('setContext', 'pdm:showScriptExplorer', true);
	}
	context.subscriptions.push(vscode.commands.registerCommand('pdm.runScriptFromFolder', selectAndRunScriptFromFolder));
	context.subscriptions.push(vscode.commands.registerCommand('pdm.refresh', () => {
		invalidateScriptCaches();
	}));
	context.subscriptions.push(vscode.commands.registerCommand('pdm.packageManager', (args) => {
		if (args instanceof vscode.Uri) {
			return getPackageManager(context, args);
		}
		return '';
	}));
	context.subscriptions.push(new PdmScriptLensProvider());
      // @ts-ignore
	// context.subscriptions.push(vscode.window.registerTerminalQuickFixProvider('pdm.pdm-command', {
	// 	      // @ts-ignore
    // provideTerminalQuickFixes({ outputMatch }) {
	// 		if (!outputMatch) {
	// 			return;
	// 		}

	// 		const lines = outputMatch.regexMatch[1];
    //   // @ts-ignore
	// 		const fixes: vscode.TerminalQuickFixTerminalCommand[] = [];
	// 		for (const line of lines.split('\n')) {
	// 			// search from the second char, since the lines might be prefixed with
	// 			// "pdm ERR!" which comes before the actual command suggestion.
	// 			const begin = line.indexOf('pdm', 1);
	// 			if (begin === -1) {
	// 				continue;
	// 			}

	// 			const end = line.lastIndexOf('#');
	// 			fixes.push({ terminalCommand: line.slice(begin, end === -1 ? undefined : end - 1) });
	// 		}

	// 		return fixes;
	// 	},
	// }));

  // pdmTaskProvider = vscode.tasks.registerTaskProvider(
  //   PDMTaskProvider.PDMType,
  //   new PDMTaskProvider(workspaceRoot)
  // );
  // pdmCodeLensProvider = vscode.languages.registerCodeLensProvider(
  //   { language: "toml",  },
  //   // { language: "toml", pattern: "pyproject.toml" },
  //   new PDMCodeLensProvider()
  // );
  }
export function deactivate(): void {
  if (pdmTaskProvider) {
    pdmTaskProvider.dispose();
  }
  if (pdmCodeLensProvider) {
    pdmCodeLensProvider.dispose();
  }
}
let taskProvider: PdmTaskProvider;
function registerTaskProvider(context: vscode.ExtensionContext): vscode.Disposable | undefined {
	if (vscode.workspace.workspaceFolders) {
		const watcher = vscode.workspace.createFileSystemWatcher('**/pyproject.toml');
		watcher.onDidChange((_e) => invalidateScriptCaches());
		watcher.onDidDelete((_e) => invalidateScriptCaches());
		watcher.onDidCreate((_e) => invalidateScriptCaches());
		context.subscriptions.push(watcher);

		const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders((_e) => invalidateScriptCaches());
		context.subscriptions.push(workspaceWatcher);

		taskProvider = new PdmTaskProvider(context);
		const disposable = vscode.tasks.registerTaskProvider('pdm', taskProvider);
		context.subscriptions.push(disposable);
		return disposable;
	}
	return undefined;
}

function registerExplorer(context: vscode.ExtensionContext): PdmScriptsTreeDataProvider | undefined {
	if (vscode.workspace.workspaceFolders) {
		const treeDataProvider = new PdmScriptsTreeDataProvider(context, taskProvider!);
		const view = vscode.window.createTreeView('pdm', { treeDataProvider: treeDataProvider, showCollapseAll: true });
		context.subscriptions.push(view);
		return treeDataProvider;
	}
	return undefined;
}

function registerHoverProvider(context: vscode.ExtensionContext): PdmScriptHoverProvider | undefined {
	if (vscode.workspace.workspaceFolders) {
		const pdmSelector: vscode.DocumentSelector = {
			language: 'toml',
			scheme: 'file',
			pattern: '**/pyproject.toml'
		};
		const provider = new PdmScriptHoverProvider(context);
		context.subscriptions.push(vscode.languages.registerHoverProvider(pdmSelector, provider));
		return provider;
	}
	return undefined;
}
