/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  CodeLens,
  CodeLensProvider,
  Disposable,
  EventEmitter,
  ExtensionContext,
  TextDocument,
  languages,
  workspace,
} from "vscode";
import { Commands, Configuration, asCommand, readConfig } from "./common/common";
import { IPyProjectInfo, readPyproject } from "./readPyproject";

const getFreshLensLocation = () => readConfig(workspace, Configuration.ScriptsConfigKey);
const getFreshPluginsLocation = () => readConfig(workspace, Configuration.PluginsConfigKey);
const getFreshBuildLocation = () => readConfig(workspace, Configuration.BuildConfigKey);
/**
 * Pdm script lens provider implementation. Can show a "Run script" text above any
 * pdm script, or the pdm scripts section.
 */
export class PdmScriptLensProvider implements CodeLensProvider, Disposable {
  // private lensLocation = "all";
  private scriptsLensLocation = getFreshLensLocation();
  private buildLens = getFreshBuildLocation();
  private pluginsLens = getFreshPluginsLocation();
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
        if (evt.affectsConfiguration(Configuration.ScriptsConfigKey)) {
          this.scriptsLensLocation = getFreshLensLocation();
          this.changeEmitter.fire();
        } else if (evt.affectsConfiguration(Configuration.PluginsConfigKey)) {
          this.pluginsLens = getFreshPluginsLocation();
          this.changeEmitter.fire();
        } else if (evt.affectsConfiguration(Configuration.BuildConfigKey)) {
          this.buildLens = getFreshBuildLocation();
          this.changeEmitter.fire();
        }
      }),
      languages.registerCodeLensProvider(
        {
          language: "toml",
          pattern: "**/{pyproject.toml,*.pyproject.toml}",
          scheme: "file",
        },
        this,
      ),
    );
  }

  /**
   * @inheritdoc
   */
  public async provideCodeLenses(document: TextDocument): Promise<CodeLens[]> {
    const codeLenses: CodeLens[] = [];

    const pyproject = readPyproject(document);
    if (!pyproject) {
      return [];
    }

    await this.providePdmScriptsCodeLenses(document, codeLenses, pyproject);
    this.providePdmPluginsCodeLenses(codeLenses, pyproject, document);
    this.providePdmBuildCodeLenses(codeLenses, pyproject, document);

    return codeLenses;
  }

  private providePdmBuildCodeLenses(codeLenses: CodeLens[], pyproject: IPyProjectInfo, document: TextDocument) {
    if (!this.buildLens) {
      return;
    }
    if (!pyproject.build) {
      return;
    }
    codeLenses.push(
      new CodeLens(
        pyproject.build.location.range,
        asCommand({
          title: "$(debug-start) " + "Build package",
          command: Commands.runCommand,
          arguments: [document.uri, "build"],
        }),
      ),
    );
  }

  private providePdmPluginsCodeLenses(codeLenses: CodeLens[], pyproject: IPyProjectInfo, document: TextDocument) {
    if (!this.pluginsLens) {
      return;
    }
    if (!pyproject.plugins) {
      return;
    }
    const txt = "Install plugin" + (pyproject.plugins.plugins.length > 1 ? "s" : "");
    codeLenses.push(
      new CodeLens(
        pyproject.plugins.location.range,
        asCommand({
          title: "$(debug-start) " + txt,
          command: Commands.runCommand,
          arguments: [document.uri, "install", ["install", "--plugins"]],
        }),
      ),
    );
  }

  private async providePdmScriptsCodeLenses(document: TextDocument, codeLenses: CodeLens[], project: IPyProjectInfo) {
    if (this.scriptsLensLocation === "never") {
      return [];
    }

    const scripts_tokens = project?.scripts;
    if (!scripts_tokens) {
      return [];
    }

    if (this.scriptsLensLocation === "top") {
      codeLenses.push(
        new CodeLens(
          scripts_tokens.location.range,
          asCommand({
            title: "$(debug-start) Run script...",
            tooltip: "Select a script and run it as a task",
            command: Commands.runScriptFromFile,
            arguments: [document.uri],
          }),
        ),
      );
    } else if (this.scriptsLensLocation === "all") {
      codeLenses.push(
        ...scripts_tokens.scripts.map(
          ({ name, nameRange }) =>
            new CodeLens(
              nameRange,
              asCommand({
                title: "$(debug-start) Run script",
                command: Commands.PdmRunScriptFromHover,
                tooltip: "Run the script as a task",
                arguments: [
                  {
                    documentUri: document.uri,
                    script: name,
                  },
                ],
              }),
            ),
        ),
      );
    }
  }

  /**
   * @inheritdoc
   */
  public dispose() {
    this.subscriptions.forEach((s) => s.dispose());
  }
}
