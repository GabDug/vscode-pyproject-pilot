/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as vscode from "vscode";

import {
  CancellationTokenSource,
  ExtensionContext,
  Location,
  Position,
  QuickPickItem,
  RelativePattern,
  ShellExecution,
  ShellQuotedString,
  ShellQuoting,
  Task,
  TaskDefinition,
  TaskGroup,
  TaskProvider,
  TaskScope,
  TextDocument,
  Uri,
  WorkspaceFolder,
  commands,
  tasks,
  window,
  workspace,
} from "vscode";
import { Configuration, readConfig } from "./enums";
import { findPreferredPM, getPackageManagerPath } from "./preferred-pm";
import { IPdmScriptReference, readPyproject } from "./readPyproject";

import { minimatch } from "minimatch";
import { Utils } from "vscode-uri";

const excludeRegex = new RegExp("^(node_modules|.vscode-test)$", "i");

export interface IPdmTaskDefinition extends TaskDefinition {
  script: string;
  path?: string;
}

export interface IFolderTaskItem extends QuickPickItem {
  label: string;
  task: Task;
  script?: IPdmScriptReference;
  iconPath?: vscode.ThemeIcon;
  description?: string;
  detail?: string;
}

let cachedTasks: ITaskWithLocation[] | undefined = undefined;

export const INSTALL_SCRIPT = "install";

export interface ITaskLocation {
  document: Uri;
  line: Position;
}

export interface ITaskWithLocation {
  task: Task;
  location?: Location;
  script?: IPdmScriptReference;
}

export class PdmTaskProvider implements TaskProvider {
  constructor(private context: ExtensionContext) {}

  get tasksWithLocation(): Promise<ITaskWithLocation[]> {
    return providePdmScripts(this.context, false);
  }

  public async provideTasks() {
    const tasks = await providePdmScripts(this.context, true);
    return tasks.map((task) => task.task);
  }

  public async resolveTask(_task: Task): Promise<Task | undefined> {
    const pdmTask = (_task.definition as any).script;
    if (pdmTask) {
      const kind: IPdmTaskDefinition = _task.definition as any;
      let pyprojectTomlUri: Uri;
      if (
        _task.scope === undefined ||
        _task.scope === TaskScope.Global ||
        _task.scope === TaskScope.Workspace
      ) {
        // scope is required to be a WorkspaceFolder for resolveTask
        return undefined;
      }
      if (kind.path) {
        pyprojectTomlUri = _task.scope.uri.with({
          path:
            _task.scope.uri.path +
            "/" +
            kind.path +
            `${kind.path.endsWith("/") ? "" : "/"}` +
            "pyproject.toml",
        });
      } else {
        pyprojectTomlUri = _task.scope.uri.with({
          path: _task.scope.uri.path + "/pyproject.toml",
        });
      }
      const cmd = [kind.script];
      if (kind.script !== INSTALL_SCRIPT && kind.script !== "build") {
        cmd.unshift("run");
      }
      return createTask(
        await getPackageManager(this.context, _task.scope.uri),
        kind,
        cmd,
        _task.scope,
        pyprojectTomlUri
      );
    }
    return undefined;
  }
}

export function invalidateTasksCache() {
  cachedTasks = undefined;
}

const buildNames: string[] = ["build", "compile", "watch"];
function isBuildTask(name: string): boolean {
  for (const buildName of buildNames) {
    if (name.indexOf(buildName) !== -1) {
      return true;
    }
  }
  return false;
}

const testNames: string[] = ["test"];
function isTestTask(name: string): boolean {
  for (const testName of testNames) {
    if (name === testName) {
      return true;
    }
  }
  return false;
}

function isPrePostScript(name: string): boolean {
  // From https://pdm-project.org/latest/usage/scripts/#hook-scripts
  const prePostScripts = new Set<string>([
    "post_init",
    "pre_install",
    "post_install",
    "post_lock",
    "pre_build",
    "post_build",
    "pre_publish",
    "post_publish",
    "pre_script",
    "post_script",
    "pre_run",
    "post_run",
  ]);

  const prepost = ["pre_" + name, "post_" + name];
  for (const knownScript of prePostScripts) {
    if (knownScript === prepost[0] || knownScript === prepost[1]) {
      return true;
    }
  }
  return false;
}

export function isWorkspaceFolder(value: any): value is WorkspaceFolder {
  return value && typeof value !== "number";
}

export async function getPackageManager(
  extensionContext: ExtensionContext,
  folder: Uri,
  showWarning = true
): Promise<string> {
  let packageManagerName =
    readConfig(workspace, Configuration.packageManager, folder) ||
    ("auto" as string);
  if (packageManagerName === "auto") {
    const { name, multipleLockFilesDetected: multiplePMDetected } =
      await findPreferredPM(folder.fsPath);
    packageManagerName = name;
    const neverShowWarning = "pdm.multiplePMWarning.neverShow";
    if (
      showWarning &&
      multiplePMDetected &&
      !extensionContext.globalState.get<boolean>(neverShowWarning)
    ) {
      const multiplePMWarning = `Using ${packageManagerName} as the preferred package manager. Found multiple lockfiles for ${folder.fsPath}.  To resolve this issue, delete the lockfiles that don't match your preferred package manager or change the setting "pdm.packageManager" to a value other than "auto".`;
      const neverShowAgain = "Do not show again";
      window
        .showInformationMessage(multiplePMWarning, neverShowAgain)
        .then((result) => {
          switch (result) {
            case neverShowAgain:
              extensionContext.globalState.update(neverShowWarning, true);
              break;
          }
        });
    }
  }

  return packageManagerName;
}

export async function hasPdmScripts(): Promise<boolean> {
  const folders = workspace.workspaceFolders;
  if (!folders) {
    return false;
  }
  try {
    for (const folder of folders) {
      if (
        isAutoDetectionEnabled(folder) &&
        !excludeRegex.test(Utils.basename(folder.uri))
      ) {
        const relativePattern = new RelativePattern(
          folder,
          "**/pyproject.toml"
        );
        const paths = await workspace.findFiles(relativePattern, "**/.venv/**");
        if (paths.length > 0) {
          return true;
        }
      }
    }
    return false;
  } catch (error) {
    return Promise.reject(error);
  }
}

async function detectPdmScripts(
  context: ExtensionContext,
  showWarning: boolean
): Promise<ITaskWithLocation[]> {
  const emptyTasks: ITaskWithLocation[] = [];
  const allTasks: ITaskWithLocation[] = [];
  const visitedPyprojecttTomlFiles = new Set<string>();

  const folders = workspace.workspaceFolders;
  if (!folders) {
    return emptyTasks;
  }
  try {
    for (const folder of folders) {
      if (
        isAutoDetectionEnabled(folder) &&
        !excludeRegex.test(Utils.basename(folder.uri))
      ) {
        const relativePattern = new RelativePattern(
          folder,
          "**/pyproject.toml"
        );
        const paths = await workspace.findFiles(
          relativePattern,
          "**/{.venv,venv}/**"
        );
        for (const path of paths) {
          if (
            !isExcluded(folder, path) &&
            !visitedPyprojecttTomlFiles.has(path.fsPath)
          ) {
            const tasks = await providePdmScriptsForPyprojectToml(
              context,
              path,
              showWarning
            );
            visitedPyprojecttTomlFiles.add(path.fsPath);
            allTasks.push(...tasks);
          }
        }
      }
    }
    return allTasks;
  } catch (error) {
    return Promise.reject(error);
  }
}

export async function detectPdmScriptsForFolder(
  context: ExtensionContext,
  folder: Uri
): Promise<IFolderTaskItem[]> {
  const folderTasks: IFolderTaskItem[] = [];

  try {
    if (excludeRegex.test(Utils.basename(folder))) {
      return folderTasks;
    }
    const relativePattern = new RelativePattern(
      folder.fsPath,
      "**/pyproject.toml"
    );
    const paths = await workspace.findFiles(relativePattern, "**/.venv/**");

    const visitedPackageJsonFiles = new Set<string>();
    for (const path of paths) {
      if (!visitedPackageJsonFiles.has(path.fsPath)) {
        const tasks = await providePdmScriptsForPyprojectToml(
          context,
          path,
          true
        );
        visitedPackageJsonFiles.add(path.fsPath);
        folderTasks.push(
          ...tasks.map((t) => ({ label: t.task.name, task: t.task }))
        );
      }
    }
    return folderTasks;
  } catch (error) {
    return Promise.reject(error);
  }
}

export async function providePdmScripts(
  context: ExtensionContext,
  showWarning: boolean
): Promise<ITaskWithLocation[]> {
  if (!cachedTasks) {
    cachedTasks = await detectPdmScripts(context, showWarning);
  }
  return cachedTasks;
}

export function isAutoDetectionEnabled(folder?: WorkspaceFolder): boolean {
  return readConfig(workspace, Configuration.autoDetect, folder?.uri) === "on";
}

function isExcluded(folder: WorkspaceFolder, pyprojectTomlUri: Uri) {
  function testForExclusionPattern(path: string, pattern: string): boolean {
    return minimatch(path, pattern, { dot: true });
  }

  const exclude = readConfig(workspace, Configuration.exclude, folder.uri);
  const pyprojectTomlFolder = path.dirname(pyprojectTomlUri.fsPath);

  if (exclude) {
    if (Array.isArray(exclude)) {
      for (const pattern of exclude) {
        if (testForExclusionPattern(pyprojectTomlFolder, pattern)) {
          return true;
        }
      }
    } else if (testForExclusionPattern(pyprojectTomlFolder, exclude)) {
      return true;
    }
  }
  return false;
}

function isDebugScript(script: string): boolean {
  const match = script.match(
    /--(inspect|debug)(-brk)?(=((\[[0-9a-fA-F:]*\]|[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+|[a-zA-Z0-9.]*):)?(\d+))?/
  );
  return match !== null;
}
export async function providePdmScriptsForPyprojectToml(
  context: ExtensionContext,
  pyprojectTomlUri: Uri,
  showWarning: boolean
): Promise<ITaskWithLocation[]> {
  const emptyTasks: ITaskWithLocation[] = [];

  const folder = workspace.getWorkspaceFolder(pyprojectTomlUri);
  if (!folder) {
    return emptyTasks;
  }
  const scripts = await getScripts(pyprojectTomlUri);
  if (!scripts) {
    return emptyTasks;
  }

  const result: ITaskWithLocation[] = [];

  const packageManager = await getPackageManager(
    context,
    folder.uri,
    showWarning
  );

  for (const script of scripts.scripts) {
    const { name, value, nameRange } = script;
    const task = await createTask(
      packageManager,
      name,
      ["run", name],
      folder!,
      pyprojectTomlUri,
      value,
      undefined
    );
    result.push({
      task,
      location: new Location(pyprojectTomlUri, nameRange),
      script,
    });
  }

  if (
    !(
      readConfig(workspace, Configuration.scriptExplorerExclude, folder) || []
    ).find((e) => e.includes(INSTALL_SCRIPT))
  ) {
    result.push({
      task: await createTask(
        packageManager,
        INSTALL_SCRIPT,
        [INSTALL_SCRIPT],
        folder,
        pyprojectTomlUri,
        "install dependencies from package",
        []
      ),
    });
    result.push({
      task: await createTask(
        packageManager,
        "build",
        ["build"],
        folder,
        pyprojectTomlUri,
        "build package",
        []
      ),
    });
  }
  return result;
}

export function getTaskName(script: string, relativePath: string | undefined) {
  if (relativePath && relativePath.length) {
    return `${script} - ${relativePath.substring(0, relativePath.length - 1)}`;
  }
  return script;
}

export async function createTask(
  packageManager: string,
  script: IPdmTaskDefinition | string,
  cmd: string[],
  folder: WorkspaceFolder,
  pyprojectTomlUri: Uri,
  scriptValue?: string,
  matcher?: string | string[]
): Promise<Task> {
  let kind: IPdmTaskDefinition;
  if (typeof script === "string") {
    kind = { type: "pdm", script: script };
  } else {
    kind = script;
  }

  function getCommandLine(cmd: string[]): (string | ShellQuotedString)[] {
    const result: (string | ShellQuotedString)[] = new Array(cmd.length);
    for (let i = 0; i < cmd.length; i++) {
      if (/\s/.test(cmd[i])) {
        result[i] = {
          value: cmd[i],
          quoting: cmd[i].includes("--")
            ? ShellQuoting.Weak
            : ShellQuoting.Strong,
        };
      } else {
        result[i] = cmd[i];
      }
    }
    if (readConfig(workspace, Configuration.runQuiet, folder.uri)) {
      result.unshift("--silent");
    }
    return result;
  }

  function getRelativePath(pyprojectTomlUri: Uri): string {
    const rootUri = folder.uri;
    const absolutePath = pyprojectTomlUri.path.substring(
      0,
      pyprojectTomlUri.path.length - "pyproject.toml".length
    );
    return absolutePath.substring(rootUri.path.length + 1);
  }

  const relativePyprojectToml = getRelativePath(pyprojectTomlUri);
  if (relativePyprojectToml.length && !kind.path) {
    kind.path = relativePyprojectToml.substring(
      0,
      relativePyprojectToml.length - 1
    );
  }
  const taskName = getTaskName(kind.script, relativePyprojectToml);
  const cwd = path.dirname(pyprojectTomlUri.fsPath);
  const task = new Task(
    kind,
    folder,
    taskName,
    "pdm",
    new ShellExecution(
      getPackageManagerPath(packageManager),
      getCommandLine(cmd),
      { cwd: cwd }
    ),
    matcher
  );
  task.detail = scriptValue;

  const lowerCaseTaskName = kind.script.toLowerCase();
  if (isBuildTask(lowerCaseTaskName)) {
    task.group = TaskGroup.Build;
  } else if (isTestTask(lowerCaseTaskName)) {
    task.group = TaskGroup.Test;
  } else if (isPrePostScript(lowerCaseTaskName)) {
    task.group = TaskGroup.Clean; // hack: use Clean group to tag pre/post scripts
  } else if (scriptValue && isDebugScript(scriptValue)) {
    // todo@connor4312: all scripts are now debuggable, what is a 'debug script'?
    task.group = TaskGroup.Rebuild; // hack: use Rebuild group to tag debug scripts
  }
  return task;
}

export function getPyprojectTomlUriFromTask(task: Task): Uri | null {
  if (isWorkspaceFolder(task.scope)) {
    if (task.definition.path) {
      return Uri.file(
        path.join(task.scope.uri.fsPath, task.definition.path, "pyproject.toml")
      );
    } else {
      return Uri.file(path.join(task.scope.uri.fsPath, "pyproject.toml"));
    }
  }
  return null;
}

export async function hasPyprojectToml(): Promise<boolean> {
  const token = new CancellationTokenSource();
  // Search for files for max 1 second.
  const timeout = setTimeout(() => token.cancel(), 1000);
  const files = await workspace.findFiles(
    "**/pyproject.toml",
    undefined,
    1,
    token.token
  );
  clearTimeout(timeout);
  return files.length > 0 || (await hasRootPackageToml());
}

async function hasRootPackageToml(): Promise<boolean> {
  const folders = workspace.workspaceFolders;
  if (!folders) {
    return false;
  }
  for (const folder of folders) {
    if (folder.uri.scheme === "file") {
      const pyprojectToml = path.join(folder.uri.fsPath, "pyproject.toml");
      if (await exists(pyprojectToml)) {
        return true;
      }
    }
  }
  return false;
}

async function exists(file: string): Promise<boolean> {
  return new Promise<boolean>((resolve, _reject) => {
    vscode.workspace.fs.stat(Uri.file(file)).then(
      () => resolve(true),
      () => resolve(false)
    );
  });
}

export async function runScript(
  context: ExtensionContext,
  script: string,
  document: TextDocument
) {
  const uri = document.uri;
  const folder = workspace.getWorkspaceFolder(uri);
  if (folder) {
    const task = await createTask(
      await getPackageManager(context, folder.uri),
      script,
      ["run", script],
      folder,
      uri
    );
    tasks.executeTask(task);
  }
}

export async function startDebugging(
  context: ExtensionContext,
  scriptName: string,
  cwd: string,
  folder: WorkspaceFolder
) {
  commands.executeCommand(
    "extension.js-debug.createDebuggerTerminal",
    `${await getPackageManager(context, folder.uri)} run ${scriptName}`,
    folder,
    { cwd }
  );
}

export type StringMap = Record<string, string>;

export function findScriptAtPosition(
  document: TextDocument,
  buffer: string,
  position: Position
): string | undefined {
  const read = readPyproject(document, buffer)?.scripts;
  if (!read) {
    return undefined;
  }

  for (const script of read.scripts) {
    if (
      script.nameRange.start.isBeforeOrEqual(position) &&
      script.valueRange.end.isAfterOrEqual(position)
    ) {
      return script.name;
    }
  }

  return undefined;
}

export async function getScripts(pyprojectTomlUri: Uri) {
  if (pyprojectTomlUri.scheme !== "file") {
    return undefined;
  }

  const pyprojectToml = pyprojectTomlUri.fsPath;
  if (!(await exists(pyprojectToml))) {
    return undefined;
  }
  // try {
  //   const document: TextDocument = await workspace.openTextDocument(
  //     pyprojectTomlUri
  //   );
  //   return readPyproject(document)?.scripts;
  // } catch (e) {
  //   const parseError = `Pdm task detection: failed to parse the file ${pyprojectTomlUri.fsPath}`;
  //   printChannelOutput(parseError);
  //   printChannelOutput(e);
  //   throw new Error(parseError);
  // }
  const document: TextDocument = await workspace.openTextDocument(
    pyprojectTomlUri
  );
  return readPyproject(document)?.scripts;
}
