/**
 * Freely inspired by vscode-js-debug
 * Copyright Microsoft Corporations, released under MIT license
 */

import { Command, ConfigurationScope, Uri, commands, workspace } from "vscode";
import type { PdmScript, PyprojectTOML } from "./pdmView";

export const pyprojectName = "pyproject.toml";

export const enum Commands {
  // Extension
  runCommand = "pdm.runCommand",
  runSelectedScript = "pdm.runSelectedScript",
  runScriptFromFolder = "pdm.runScriptFromFolder",
  runScriptFromFile = "pdm.runScriptFromFile",
  PdmRefresh = "pdm.refresh",
  PdmPackageManager = "pdm.packageManager",
  // PDM View
  runScript = "pdm.runScript",
  debugScript = "pdm.debugScript",
  openScript = "pdm.openScript",
  runInstall = "pdm.runInstall",
  // Script hover
  PdmRunScriptFromHover = "pdm.runScriptFromHover",
  PdmDebugScriptFromHover = "pdm.DebugScriptFromHover",
}

export interface ICommandTypes {
  [Commands.PdmRunScriptFromHover](args: { script: string; documentUri: Uri }): void;
  [Commands.PdmDebugScriptFromHover](args: { script: string; documentUri: Uri }): void;
  [Commands.runScript](script: PdmScript): void;
  [Commands.debugScript](script: PdmScript): void;
  [Commands.openScript](selection: PdmScript | PyprojectTOML): void;
  [Commands.runInstall](selection: PyprojectTOML): void;
  [Commands.PdmPackageManager](args: any): string;
  [Commands.PdmRefresh](echo?: boolean): void;
  [Commands.runScriptFromFile](args: any): void;
  [Commands.runScriptFromFolder](args: any): void;
  [Commands.runSelectedScript](): void;
  [Commands.runCommand](pyprojectTomlUri: Uri, command: string, args?: string[]): void;
}

export const enum Configuration {
  // CodeLens
  ScriptsConfigKey = "pdm.codelens.pdmScripts",
  PluginsConfigKey = "pdm.codelens.pdmPlugins",
  BuildConfigKey = "pdm.codelens.pdmBuild",
  // Misc
  pdmPath = "pdm.pdmPath",
  exclude = "pdm.exclude",
  // XXX: Make sure exclude work
  packageManager = "pdm.packageManager",
  runQuiet = "pdm.runQuiet",
  autoDetect = "pdm.autoDetect",
  // Hover
  scriptHover = "pdm.scriptHover",
  // Scripts Explorer
  scriptExplorerExclude = "pdm.scriptExplorerExclude",
  scriptExplorerAction = "pdm.scriptExplorerAction",
  // File Explorer
  enableRunFromFolder = "pdm.enableRunFromFolder",
}
export type ExplorerCommands = "open" | "run";
export type AutoDetect = "on" | "off";
/**
 * Type map for {@link Configuration} properties.
 */
export interface IConfigurationTypes {
  [Configuration.ScriptsConfigKey]: "all" | "top" | "never";
  [Configuration.PluginsConfigKey]: boolean;
  [Configuration.BuildConfigKey]: boolean;
  [Configuration.pdmPath]: string;
  // [Configuration.exclude]: ,

  [Configuration.packageManager]: "auto" | "pdm";
  [Configuration.autoDetect]: AutoDetect;
  [Configuration.scriptHover]: boolean;
  [Configuration.scriptExplorerExclude]: string[];
  [Configuration.exclude]: string[];
  [Configuration.scriptExplorerAction]: ExplorerCommands;
  [Configuration.enableRunFromFolder]: boolean;
  [Configuration.runQuiet]: boolean;
}

export const enum ContextKey {
  showScriptExplorer = "pdm:showScriptExplorer",
}

export interface IContextKeyTypes {
  [ContextKey.showScriptExplorer]: boolean;
}
export const readConfig = <K extends keyof IConfigurationTypes>(
  wsp: typeof workspace,
  key: K,
  folder?: ConfigurationScope,
) => wsp.getConfiguration(undefined, folder).get<IConfigurationTypes[K]>(key);

export const setContextKey = async <K extends keyof IContextKeyTypes>(
  ns: typeof commands,
  key: K,
  value: IContextKeyTypes[K] | null,
) => await ns.executeCommand("setContext", key, value);

/**
 * Typed guard for registering a command.
 */
export const registerCommand = <K extends keyof ICommandTypes>(
  ns: typeof commands,
  key: K,
  fn: (...args: Parameters<ICommandTypes[K]>) => Thenable<ReturnType<ICommandTypes[K]>>,
  thisArg?: any,
) => ns.registerCommand(key, fn, thisArg);

/**
 * Typed guard for running a command.
 */
export const runCommand = async <K extends keyof ICommandTypes>(
  ns: typeof commands,
  key: K,
  ...args: Parameters<ICommandTypes[K]>
): Promise<ReturnType<ICommandTypes[K]>> => await ns.executeCommand(key, ...args);

export const asCommand = <K extends keyof ICommandTypes>(command: {
  title: string;
  command: K;
  tooltip?: string;
  arguments: Parameters<ICommandTypes[K]>;
}): Command => command;
