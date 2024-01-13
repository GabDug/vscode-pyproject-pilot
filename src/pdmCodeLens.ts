/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";

import {
  CodeLens,
  CodeLensProvider,
  Disposable,
  EventEmitter,
  ExtensionContext,
  Range,
  TextDocument,
  Uri,
  languages,
  workspace,
} from "vscode";
import { readPyproject, readScriptsLegacy } from "./readPyproject";

import { findPreferredPM } from "./preferred-pm";
import { printChannelOutput } from "./extension";

const enum Constants {
  ConfigKey = "debug.javascript.codelens.npmScripts",
}

const getFreshLensLocation = () =>
  workspace.getConfiguration().get(Constants.ConfigKey);

/**
 * Pdm script lens provider implementation. Can show a "Run script" text above any
 * npm script, or the npm scripts section.
 */
export class PdmScriptLensProvider implements CodeLensProvider, Disposable {
  // private lensLocation = "all";
  private lensLocation = getFreshLensLocation();
  private readonly changeEmitter = new EventEmitter<void>();
  private subscriptions: Disposable[] = [];
  private context: ExtensionContext;
  /**
   * @inheritdoc
   */
  public readonly onDidChangeCodeLenses = this.changeEmitter.event;

  constructor(context: ExtensionContext) {
    this.context = context;
    this.subscriptions.push(
      this.changeEmitter,
      workspace.onDidChangeConfiguration((evt) => {
        if (evt.affectsConfiguration(Constants.ConfigKey)) {
          // this.lensLocation = "all";
          this.lensLocation = getFreshLensLocation();
          this.changeEmitter.fire();
        }
      }),
      languages.registerCodeLensProvider(
        {
          language: "toml",
          pattern: "**/pyproject.toml",
          scheme: "file",
        },
        this
      )
    );
  }

  /**
   * @inheritdoc
   */
  public async provideCodeLenses(document: TextDocument): Promise<CodeLens[]> {
    const codeLenses: CodeLens[] = [];
    if (this.lensLocation === "never") {
      return [];
    }
    const pyproject = readPyproject(document);
    const scripts_tokens = pyproject?.scripts;
    if (!scripts_tokens) {
      return [];
    }
    // const contextExtension
    const title = "$(debug-start) " + "Run script";
    const cwd = path.dirname(document.uri.fsPath);
    if (this.lensLocation === "top") {
      printChannelOutput(workspace.getWorkspaceFolder(document.uri));
      printChannelOutput(document.uri);
      codeLenses.push(
        new CodeLens(scripts_tokens.location.range, {
          title,
          // FIXME this is the command to override
          command: "pdm.runScriptFromFile",
          // command: 'extension.js-debug.npmScript',
          arguments: [document.uri],
        })
      );
    } else if (this.lensLocation === "all") {
      const packageManager = await findPreferredPM(
        Uri.joinPath(document.uri, "..").fsPath
      );
      codeLenses.push(
        ...scripts_tokens.scripts.map(
          ({ name, nameRange }) =>
            new CodeLens(nameRange, {
              title,
              // FIXME won't work
              command: "extension.js-debug.createDebuggerTerminal",
              arguments: [
                `${packageManager.name} run ${name}`,
                workspace.getWorkspaceFolder(document.uri),
                { cwd },
              ],
            })
        )
      );
    }

    if (pyproject?.plugins) {
      codeLenses.push(
        new CodeLens(pyproject.plugins.location.range, {
          // XXX Pluralize
          title: "$(debug-start) " + "Install PDM plugins",
          command: "pdm.runScriptFromFile",
          arguments: [document.uri],
        })
      );
    } else {
      codeLenses.push(
        new CodeLens(new Range(0, 0, 0, 0), {
          // XXX Pluralize
          title: "$(debug-start) " + "Install PDM plugins (fake)",
          command: "pdm.runScriptFromFile",
          arguments: [document.uri],
        })
      );
    }
    if (pyproject?.build) {
      codeLenses.push(
        new CodeLens(pyproject.build.location.range, {
          // XXX Pluralize
          title: "$(debug-start) " + "Build package",
          command: "pdm.runScriptFromFile",
          arguments: [document.uri],
        })
      );
    }

    return codeLenses;
  }

  /**
   * @inheritdoc
   */
  public dispose() {
    this.subscriptions.forEach((s) => s.dispose());
  }
}
