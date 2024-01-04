/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';

import {
	CodeLens,
	CodeLensProvider,
	Disposable,
	EventEmitter,
	TextDocument,
	Uri,
	languages,
	workspace,
} from 'vscode';

import { findPreferredPM } from './preferred-pm';
import { readScripts } from './readScripts';

const enum Constants {
	ConfigKey = 'debug.javascript.codelens.npmScripts',
}

const getFreshLensLocation = () => workspace.getConfiguration().get(Constants.ConfigKey);

/**
 * Pdm script lens provider implementation. Can show a "Run script" text above any
 * npm script, or the npm scripts section.
 */
export class PdmScriptLensProvider implements CodeLensProvider, Disposable {
	// private lensLocation = "all";
	private lensLocation = getFreshLensLocation();
	private readonly changeEmitter = new EventEmitter<void>();
	private subscriptions: Disposable[] = [];

	/**
	 * @inheritdoc
	 */
	public readonly onDidChangeCodeLenses = this.changeEmitter.event;

	constructor() {
		this.subscriptions.push(
			this.changeEmitter,
			workspace.onDidChangeConfiguration(evt => {
				if (evt.affectsConfiguration(Constants.ConfigKey)) {
					// this.lensLocation = "all";
					this.lensLocation = getFreshLensLocation();
					this.changeEmitter.fire();
				}
			}),
			languages.registerCodeLensProvider(
				{
					language: 'toml',
					pattern: '**/pyproject.toml',
				},
				this,
			)
		);
	}

	/**
	 * @inheritdoc
	 */
	public async provideCodeLenses(document: TextDocument): Promise<CodeLens[]> {
		if (this.lensLocation === 'never') {
			return [];
		}

		const tokens = readScripts(document);
		if (!tokens) {
			return [];
		}

		const title = '$(debug-start) ' + "Run script";
		const cwd = path.dirname(document.uri.fsPath);
		if (this.lensLocation === 'top') {
			return [
				new CodeLens(
					tokens.location.range,
					{
						title,
						// FIXME this is the command to override
						command: 'pdm.runScriptFromFolder',
						// command: 'extension.js-debug.npmScript',
						arguments: [workspace.getWorkspaceFolder(document.uri)],
					},
				),
			];
		}

		if (this.lensLocation === 'all') {
			const packageManager = await findPreferredPM(Uri.joinPath(document.uri, '..').fsPath);
			return tokens.scripts.map(
				({ name, nameRange }) =>
					new CodeLens(
						nameRange,
						{
							title,
							command: 'extension.js-debug.createDebuggerTerminal',
							arguments: [`${packageManager.name} run ${name}`, workspace.getWorkspaceFolder(document.uri), { cwd }],
						},
					),
			);
		}

		return [];
	}

	/**
	 * @inheritdoc
	 */
	public dispose() {
		this.subscriptions.forEach(s => s.dispose());
	}
}
