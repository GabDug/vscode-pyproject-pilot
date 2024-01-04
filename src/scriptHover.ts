/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	CancellationToken,
	ExtensionContext,
	Hover,
	HoverProvider,
	MarkdownString,
	Position,
	ProviderResult,
	TextDocument,
	Uri,
	commands,
	tasks,
	workspace
} from 'vscode';
import { IPdmScriptInfo, readScripts } from './readScripts';
import {
	createTask,
	getPackageManager,
	startDebugging
} from './tasks';

import { dirname } from 'path';

let cachedDocument: Uri | undefined = undefined;
let cachedScripts: IPdmScriptInfo | undefined = undefined;

export function invalidateHoverScriptsCache(document?: TextDocument) {
	if (!document) {
		cachedDocument = undefined;
		return;
	}
	if (document.uri === cachedDocument) {
		cachedDocument = undefined;
	}
}

export class PdmScriptHoverProvider implements HoverProvider {
	private enabled: boolean;

	constructor(private context: ExtensionContext) {
		context.subscriptions.push(commands.registerCommand('pdm.runScriptFromHover', this.runScriptFromHover, this));
		context.subscriptions.push(commands.registerCommand('pdm.debugScriptFromHover', this.debugScriptFromHover, this));
		context.subscriptions.push(workspace.onDidChangeTextDocument((e) => {
			invalidateHoverScriptsCache(e.document);
		}));

		const isEnabled = () => workspace.getConfiguration('pdm').get<boolean>('scriptHover', true);
		this.enabled = isEnabled();
		context.subscriptions.push(workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('pdm.scriptHover')) {
				this.enabled = isEnabled();
			}
		}));
	}

	public provideHover(document: TextDocument, position: Position, _token: CancellationToken): ProviderResult<Hover> {
		if (!this.enabled) {
			return;
		}

		let hover: Hover | undefined = undefined;

		if (!cachedDocument || cachedDocument.fsPath !== document.uri.fsPath) {
			cachedScripts = readScripts(document);
			cachedDocument = document.uri;
		}
			// @ts-ignore
		cachedScripts?.scripts.forEach(({ name, nameRange }) => {
			if (nameRange.contains(position)) {
				const contents: MarkdownString = new MarkdownString();
				contents.isTrusted = true;
				contents.appendMarkdown(this.createRunScriptMarkdown(name, document.uri));
				hover = new Hover(contents);
			}
		});
		return hover;
	}

	private createRunScriptMarkdown(script: string, documentUri: Uri): string {
		const args = {
			documentUri: documentUri,
			script: script,
		};
		return this.createMarkdownLink(
			"Run Script",
			'pdm.runScriptFromHover',
			args,
			"Run the script as a task"
		);
	}



	private createMarkdownLink(label: string, cmd: string, args: any, tooltip: string, separator?: string): string {
		const encodedArgs = encodeURIComponent(JSON.stringify(args));
		let prefix = '';
		if (separator) {
			prefix = ` ${separator} `;
		}
		return `${prefix}[${label}](command:${cmd}?${encodedArgs} "${tooltip}")`;
	}

	public async runScriptFromHover(args: any) {
		const script = args.script;
		const documentUri = args.documentUri;
		const folder = workspace.getWorkspaceFolder(documentUri);
		if (folder) {
			const task = await createTask(await getPackageManager(this.context, folder.uri), script, ['run', script], folder, documentUri);
			await tasks.executeTask(task);
		}
	}

	public debugScriptFromHover(args: { script: string; documentUri: Uri }) {
		const script = args.script;
		const documentUri = args.documentUri;
		const folder = workspace.getWorkspaceFolder(documentUri);
		if (folder) {
			startDebugging(this.context, script, dirname(documentUri.fsPath), folder);
		}
	}
}
