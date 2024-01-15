/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  CancellationToken,
  Command,
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
  workspace,
} from "vscode";
import { Commands, Configuration, asCommand, readConfig, registerCommand } from "./common";
import { IPdmScriptInfo, readPyproject } from "./readPyproject";
import { createTask, getPackageManager, startDebugging } from "./tasks";

import { dirname } from "path";

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
    const isEnabled = () => !!readConfig(workspace, Configuration.scriptHover);
    this.enabled = isEnabled();
    context.subscriptions.push(
      registerCommand(commands, Commands.PdmRunScriptFromHover, this.runScriptFromHover, this),
      registerCommand(commands, Commands.PdmDebugScriptFromHover, this.debugScriptFromHover, this),
      workspace.onDidChangeTextDocument((e) => {
        invalidateHoverScriptsCache(e.document);
      }),
      workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(Configuration.scriptHover)) {
          this.enabled = isEnabled();
        }
      }),
    );
  }

  public provideHover(document: TextDocument, position: Position, _token: CancellationToken): ProviderResult<Hover> {
    if (!this.enabled) {
      return;
    }

    let hover: Hover | undefined = undefined;

    if (!cachedDocument || cachedDocument.fsPath !== document.uri.fsPath) {
      cachedScripts = readPyproject(document)?.scripts;
      cachedDocument = document.uri;
    }

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
    return this.createMarkdownLink(
      asCommand({
        title: "Run PDM Script",
        command: Commands.PdmRunScriptFromHover,
        tooltip: "Run the script as a task",
        arguments: [
          {
            documentUri: documentUri,
            script: script,
          },
        ],
      }),
    );
  }

  private createMarkdownLink(command: Command, separator?: string): string {
    const encodedArgs = encodeURIComponent(JSON.stringify(command.arguments));
    let prefix = "";
    if (separator) {
      prefix = ` ${separator} `;
    }
    return `${prefix}[${command.title}](command:${command.command}?${encodedArgs} "${command.tooltip}")`;
  }

  public async runScriptFromHover(args: { script: string; documentUri: Uri }) {
    const script = args.script;
    const documentUri = args.documentUri;
    const folder = workspace.getWorkspaceFolder(documentUri);
    if (folder) {
      const task = await createTask(
        await getPackageManager(this.context, folder.uri),
        script,
        ["run", script],
        folder,
        documentUri,
      );
      await tasks.executeTask(task);
    }
  }

  public async debugScriptFromHover(args: { script: string; documentUri: Uri }) {
    const script = args.script;
    const documentUri = args.documentUri;
    const folder = workspace.getWorkspaceFolder(documentUri);
    if (folder) {
      startDebugging(this.context, script, dirname(documentUri.fsPath), folder);
    }
  }
}
