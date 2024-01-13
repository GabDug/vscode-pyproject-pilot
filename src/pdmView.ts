/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import {
  commands,
  Event,
  EventEmitter,
  ExtensionContext,
  Range,
  Selection,
  Task,
  TaskGroup,
  tasks,
  TextDocument,
  TextDocumentShowOptions,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemLabel,
  TreeItemCollapsibleState,
  Uri,
  window,
  workspace,
  WorkspaceFolder,
  Position,
  Location,
  MarkdownString,
} from "vscode";
import { readScriptsLegacy } from "./readPyproject";
import {
  createTask,
  getPackageManager,
  getTaskName,
  isAutoDetectionEnabled,
  isWorkspaceFolder,
  IPdmTaskDefinition,
  PdmTaskProvider,
  startDebugging,
  ITaskWithLocation,
  INSTALL_SCRIPT,
} from "./tasks";
import { printChannelOutput } from "./extension";

class Folder extends TreeItem {
  pyprojects: PyprojectTOML[] = [];
  workspaceFolder: WorkspaceFolder;

  constructor(folder: WorkspaceFolder) {
    super(folder.name, TreeItemCollapsibleState.Expanded);
    this.contextValue = "folder";
    this.resourceUri = folder.uri;
    this.workspaceFolder = folder;
    this.iconPath = ThemeIcon.Folder;
  }

  addPyproject(pyprojectToml: PyprojectTOML) {
    this.pyprojects.push(pyprojectToml);
  }
}

const pyprojectName = "pyproject.toml";

class PyprojectTOML extends TreeItem {
  path: string;
  folder: Folder;
  scripts: PdmScript[] = [];

  static getLabel(relativePath: string): string {
    if (relativePath.length > 0) {
      return path.join(relativePath, pyprojectName);
    }
    return pyprojectName;
  }

  constructor(folder: Folder, relativePath: string) {
    super(
      PyprojectTOML.getLabel(relativePath),
      TreeItemCollapsibleState.Expanded
    );
    this.folder = folder;
    this.path = relativePath;
    this.contextValue = "pyprojectTOML";
    if (relativePath) {
      this.resourceUri = Uri.file(
        path.join(folder!.resourceUri!.fsPath, relativePath, pyprojectName)
      );
    } else {
      this.resourceUri = Uri.file(
        path.join(folder!.resourceUri!.fsPath, pyprojectName)
      );
    }
    this.iconPath = ThemeIcon.File;
  }

  addScript(script: PdmScript) {
    this.scripts.push(script);
  }
}

type ExplorerCommands = "open" | "run";

class PdmScript extends TreeItem {
  task: Task;
  package: PyprojectTOML;
  taskLocation?: Location;

  constructor(
    _context: ExtensionContext,
    pyprojectToml: PyprojectTOML,
    task: ITaskWithLocation
  ) {
    const name =
      pyprojectToml.path.length > 0
        ? task.task.name.substring(
            0,
            task.task.name.length - pyprojectToml.path.length - 2
          )
        : task.task.name;
    super(name, TreeItemCollapsibleState.None);
    this.taskLocation = task.location;
    const command: ExplorerCommands =
      name === `${INSTALL_SCRIPT} `
        ? "run"
        : workspace
            .getConfiguration("pdm")
            .get<ExplorerCommands>("scriptExplorerAction") || "open";

    const commandList = {
      open: {
        title: "Edit Script",
        command: "vscode.open",
        arguments: [
          this.taskLocation?.uri,
          this.taskLocation
            ? <TextDocumentShowOptions>{
                selection: new Range(
                  this.taskLocation.range.start,
                  this.taskLocation.range.end
                ),
              }
            : undefined,
        ],
      },
      run: {
        title: "Run",
        command: "pdm.runScript",
        arguments: [this],
      },
    };
    this.contextValue = "script";
    this.package = pyprojectToml;
    this.task = task.task;
    this.command = commandList[command];

    if (this.task.group && this.task.group === TaskGroup.Clean) {
      this.iconPath = new ThemeIcon("wrench-subaction");
    } else {
      this.iconPath = new ThemeIcon("wrench");
    }
    if (this.task.detail) {
      // Description is inline
      this.description = task.script?.help ?? this.task.detail;
      this.tooltip = new MarkdownString(
        `_${task.script?.help}_\n\n${task.script?.exec_type}: \`${task.script?.value}\``
      );
    }
  }

  getFolder(): WorkspaceFolder {
    return this.package.folder.workspaceFolder;
  }
}

class NoScripts extends TreeItem {
  constructor(message: string) {
    super(message, TreeItemCollapsibleState.None);
    this.contextValue = "noscripts";
    this.tooltip = message;
  }
}

type TaskTree = Folder[] | PyprojectTOML[] | NoScripts[];

export class PdmScriptsTreeDataProvider implements TreeDataProvider<TreeItem> {
  private taskTree: TaskTree | null = null;
  private extensionContext: ExtensionContext;
  private _onDidChangeTreeData: EventEmitter<TreeItem | null> =
    new EventEmitter<TreeItem | null>();
  readonly onDidChangeTreeData: Event<TreeItem | null> =
    this._onDidChangeTreeData.event;

  constructor(
    private context: ExtensionContext,
    public taskProvider: PdmTaskProvider
  ) {
    const subscriptions = context.subscriptions;
    this.extensionContext = context;
    subscriptions.push(
      commands.registerCommand("pdm.runScript", this.runScript, this)
    );
    subscriptions.push(
      commands.registerCommand("pdm.debugScript", this.debugScript, this)
    );
    subscriptions.push(
      commands.registerCommand("pdm.openScript", this.openScript, this)
    );
    subscriptions.push(
      commands.registerCommand("pdm.runInstall", this.runInstall, this)
    );
  }

  private async runScript(script: PdmScript) {
    // Call getPackageManager to trigger the multiple lock files warning.
    await getPackageManager(this.context, script.getFolder().uri);
    tasks.executeTask(script.task);
  }

  private async debugScript(script: PdmScript) {
    startDebugging(
      this.extensionContext,
      script.task.definition.script,
      path.dirname(script.package.resourceUri!.fsPath),
      script.getFolder()
    );
  }

  private findScriptPosition(document: TextDocument, script?: PdmScript) {
    const scripts = readScriptsLegacy(document);
    if (!scripts) {
      return undefined;
    }

    if (!script) {
      return scripts.location.range.start;
    }

    const found = scripts.scripts.find(
      (s) =>
        getTaskName(s.name, script.task.definition.path) === script.task.name
    );
    return found?.nameRange.start;
  }

  private async runInstall(selection: PyprojectTOML) {
    let uri: Uri | undefined = undefined;
    if (selection instanceof PyprojectTOML) {
      uri = selection.resourceUri;
    }
    if (!uri) {
      return;
    }
    const task = await createTask(
      await getPackageManager(
        this.context,
        selection.folder.workspaceFolder.uri,
        true
      ),
      "install",
      ["install"],
      selection.folder.workspaceFolder,
      uri,
      undefined,
      []
    );
    tasks.executeTask(task);
  }

  private async openScript(selection: PyprojectTOML | PdmScript) {
    let uri: Uri | undefined = undefined;
    if (selection instanceof PyprojectTOML) {
      uri = selection.resourceUri!;
    } else if (selection instanceof PdmScript) {
      uri = selection.package.resourceUri;
    }
    if (!uri) {
      return;
    }
    const document: TextDocument = await workspace.openTextDocument(uri);
    const position =
      this.findScriptPosition(
        document,
        selection instanceof PdmScript ? selection : undefined
      ) || new Position(0, 0);
    await window.showTextDocument(document, {
      preserveFocus: true,
      selection: new Selection(position, position),
    });
  }

  public refresh() {
    this.taskTree = null;
    this._onDidChangeTreeData.fire(null);
  }

  getTreeItem(element: TreeItem): TreeItem {
    return element;
  }

  getParent(element: TreeItem): TreeItem | null {
    if (element instanceof Folder) {
      return null;
    }
    if (element instanceof PyprojectTOML) {
      return element.folder;
    }
    if (element instanceof PdmScript) {
      return element.package;
    }
    if (element instanceof NoScripts) {
      return null;
    }
    return null;
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    if (!this.taskTree) {
      const taskItems = await this.taskProvider.tasksWithLocation;
      if (taskItems) {
        const taskTree = this.buildTaskTree(taskItems);
        this.taskTree = this.sortTaskTree(taskTree);
        if (this.taskTree.length === 0) {
          let message =
            "No scripts found. Make sure you have an explicit `[tool.pdm.scripts]` section.";
          if (!isAutoDetectionEnabled()) {
            message = 'The setting "pdm.autoDetect" is "off".';
          }
          this.taskTree = [new NoScripts(message)];
        }
      }
    }
    if (element instanceof Folder) {
      return element.pyprojects;
    }
    if (element instanceof PyprojectTOML) {
      return element.scripts;
    }
    if (element instanceof PdmScript) {
      return [];
    }
    if (element instanceof NoScripts) {
      return [];
    }
    if (!element) {
      if (this.taskTree) {
        return this.taskTree;
      }
    }
    return [];
  }

  private isInstallTask(task: Task): boolean {
    const fullName = getTaskName("install", task.definition.path);
    return fullName === task.name;
  }

  private getTaskTreeItemLabel(
    taskTreeLabel: string | TreeItemLabel | undefined
  ): string {
    if (taskTreeLabel === undefined) {
      return "";
    }

    if (typeof taskTreeLabel === "string") {
      return taskTreeLabel;
    }

    return taskTreeLabel.label;
  }

  private sortTaskTree(taskTree: TaskTree) {
    return taskTree.sort((first: TreeItem, second: TreeItem) => {
      const firstLabel = this.getTaskTreeItemLabel(first.label);
      const secondLabel = this.getTaskTreeItemLabel(second.label);
      return firstLabel.localeCompare(secondLabel);
    });
  }

  private buildTaskTree(tasks: ITaskWithLocation[]): TaskTree {
    const folders: Map<string, Folder> = new Map();
    const packages: Map<string, PyprojectTOML> = new Map();

    let folder = null;
    let pyprojectToml = null;

    const excludeConfig: Map<string, RegExp[]> = new Map();

    tasks.forEach((each) => {
      const location = each.location;
      if (location && !excludeConfig.has(location.uri.toString())) {
        const regularExpressionsSetting = workspace
          .getConfiguration("pdm", location.uri)
          .get<string[]>("scriptExplorerExclude", []);
        excludeConfig.set(
          location.uri.toString(),
          regularExpressionsSetting?.map((value) => RegExp(value))
        );
      }
      const regularExpressions =
        location && excludeConfig.has(location.uri.toString())
          ? excludeConfig.get(location.uri.toString())
          : undefined;

      if (
        regularExpressions &&
        regularExpressions.some((regularExpression) =>
          (<IPdmTaskDefinition>each.task.definition).script.match(
            regularExpression
          )
        )
      ) {
        return;
      }

      if (
        isWorkspaceFolder(each.task.scope) &&
        !this.isInstallTask(each.task)
      ) {
        folder = folders.get(each.task.scope.name);
        if (!folder) {
          folder = new Folder(each.task.scope);
          folders.set(each.task.scope.name, folder);
        }
        const definition: IPdmTaskDefinition = <IPdmTaskDefinition>(
          each.task.definition
        );
        const relativePath = definition.path ? definition.path : "";
        const fullPath = path.join(each.task.scope.name, relativePath);
        pyprojectToml = packages.get(fullPath);
        if (!pyprojectToml) {
          pyprojectToml = new PyprojectTOML(folder, relativePath);
          folder.addPyproject(pyprojectToml);
          packages.set(fullPath, pyprojectToml);
        }
        const script = new PdmScript(
          this.extensionContext,
          pyprojectToml,
          each
        );
        printChannelOutput(script);
        pyprojectToml.addScript(script);
      }
    });
    if (folders.size === 1) {
      return [...packages.values()];
    }
    return [...folders.values()];
  }
}
