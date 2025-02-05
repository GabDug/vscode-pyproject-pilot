/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";

import {
  Event,
  EventEmitter,
  ExtensionContext,
  Location,
  MarkdownString,
  Position,
  Range,
  Selection,
  Task,
  TaskGroup,
  TextDocument,
  TextDocumentShowOptions,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  TreeItemLabel,
  Uri,
  WorkspaceFolder,
  commands,
  tasks,
  window,
  workspace,
} from "vscode";
import { Commands, Configuration, ExplorerCommands, pyprojectName, readConfig, registerCommand } from "./common/common";
import { traceError, traceLog } from "./common/log/logging";
import { IPdmScriptReference, IPoetryScriptReference, IProjectScriptReference, readPyproject } from "./readPyproject";
import { IReferenceBase, ScriptKind } from "./scripts";
import {
  IPdmTaskDefinition,
  ITaskWithLocation,
  PdmTaskProvider,
  createTask,
  getPackageManager,
  getTaskName,
  isAutoDetectionEnabled,
  isWorkspaceFolder,
  startDebugging,
} from "./tasks";

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

export class PyprojectTOML extends TreeItem {
  path: string;
  folder: Folder;
  extensionContext: ExtensionContext;
  tasks_with_kinds: Map<string, KindPdmScripts | KindProjectScripts | KindPoetryScripts>;
  static getLabel(relativePath: string): string {
    if (relativePath.length > 0) {
      return path.join(relativePath, pyprojectName);
    }
    return pyprojectName;
  }

  constructor(folder: Folder, relativePath: string, extension_context: ExtensionContext) {
    super(PyprojectTOML.getLabel(relativePath), TreeItemCollapsibleState.Expanded);
    this.folder = folder;
    this.extensionContext = extension_context;
    this.path = relativePath;
    this.contextValue = "pyprojectTOML";
    if (relativePath) {
      this.resourceUri = Uri.file(path.join(folder.resourceUri!.fsPath, relativePath, pyprojectName));
    } else {
      this.resourceUri = Uri.file(path.join(folder.resourceUri!.fsPath, pyprojectName));
    }
    this.iconPath = ThemeIcon.File;
    this.tasks_with_kinds = new Map<string, KindPdmScripts | KindProjectScripts | KindPoetryScripts>();
  }

  push(script: ITaskWithLocation) {
    const task_kind_str = script?.script?.kind;
    if (!task_kind_str) {
      traceError(`script ${script.task.name} has no kind!?`);
      return;
    }

    interface KindMap {
      [ScriptKind.PdmScript]: typeof KindPdmScripts;
      [ScriptKind.ProjectScript]: typeof KindProjectScripts;
      [ScriptKind.PoetryScript]: typeof KindPoetryScripts;
    }

    const kindMap: KindMap = {
      [ScriptKind.PdmScript]: KindPdmScripts,
      [ScriptKind.ProjectScript]: KindProjectScripts,
      [ScriptKind.PoetryScript]: KindPoetryScripts,
      // Add more entries as needed for other ScriptKind values
    };

    const scriptKind = script.script?.kind;
    if (!scriptKind) {
      traceError(`script ${script.task.name} has no kind!?`);
      return;
    }

    let task_kind = this.tasks_with_kinds.get(task_kind_str);
    if (!task_kind) {
      const TaskKind = kindMap[scriptKind];
      if (TaskKind) {
        task_kind = new TaskKind(this);
      }

      traceLog(script);
      if (!task_kind) {
        traceError(`script ${script.task.name} has no kind!?`);
        return;
      }

      this.tasks_with_kinds.set(task_kind_str, task_kind);
    }

    const TreeKindToTreeItemMap = {
      [ScriptKind.PdmScript]: PdmScript,
      [ScriptKind.ProjectScript]: ProjectScript,
      [ScriptKind.PoetryScript]: PoetryScript,
    };

    const item_constructor = TreeKindToTreeItemMap[scriptKind];

    // if (script.script?.kind == ScriptKind.PdmScript) {
    const script_ti = new item_constructor(
      this.extensionContext,
      this,
      // @ts-ignore
      script as ITaskWithLocation<IReferenceBase<typeof scriptKind>>,
    );
    // const script_ti = new PdmScript(this.extensionContext, this, script as ITaskWithLocation<IPdmScriptReference>);
    traceLog(script_ti);

    task_kind.push(script_ti);
    // }
    // if (script.script?.kind == ScriptKind.PoetryScript) {
    //   const script_ti = new PoetryScript(
    //     this.extensionContext,
    //     this,
    //     script as ITaskWithLocation<IPoetryScriptReference>,
    //   );
    //   traceLog(script_ti);

    //   task_kind.push(script_ti);
    // }
    // if (script.script?.kind == ScriptKind.ProjectScript) {
    //   const script_ti = new ProjectScript(
    //     this.extensionContext,
    //     this,
    //     script as ITaskWithLocation<IProjectScriptReference>,
    //   );

    //   traceLog(script_ti);

    //   task_kind.push(script_ti);
    // }
  }
}

export class PdmScript extends TreeItem {
  task: Task;
  package: PyprojectTOML;
  taskLocation?: Location;

  constructor(_context: ExtensionContext, pyprojectToml: PyprojectTOML, task: ITaskWithLocation<IPdmScriptReference>) {
    const name =
      pyprojectToml.path.length > 0
        ? task.task.name.substring(0, task.task.name.length - pyprojectToml.path.length - 2)
        : task.task.name;
    super(name, TreeItemCollapsibleState.None);
    this.taskLocation = task.location;
    const command: ExplorerCommands = readConfig(workspace, Configuration.scriptExplorerAction) ?? "open";

    const commandList = {
      open: {
        title: "Edit Script",
        command: "vscode.open",
        arguments: [
          this.taskLocation?.uri,
          this.taskLocation
            ? ({
                selection: new Range(this.taskLocation.range.start, this.taskLocation.range.end),
              } as TextDocumentShowOptions)
            : undefined,
        ],
      },
      run: {
        title: "Run",
        command: Commands.runScript,
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

      let md_str = "";
      if (task.script?.help) {
        md_str += `_${task.script?.help}_\n\n`;
      }
      if (task.script?.exec_type) {
        md_str += `${task.script?.exec_type}: `;
      }
      if (task.script?.value) {
        md_str += `\`${task.script?.value}\``;
      }
      if (md_str.length > 0) {
        this.tooltip = new MarkdownString(md_str);
      }
    }
  }

  getFolder(): WorkspaceFolder {
    return this.package.folder.workspaceFolder;
  }
}
export class ProjectScript extends TreeItem {
  task: Task;
  package: PyprojectTOML;
  taskLocation?: Location;

  constructor(
    _context: ExtensionContext,
    pyprojectToml: PyprojectTOML,
    task: ITaskWithLocation<IProjectScriptReference>,
  ) {
    const name =
      pyprojectToml.path.length > 0
        ? task.task.name.substring(0, task.task.name.length - pyprojectToml.path.length - 2)
        : task.task.name;
    super(name, TreeItemCollapsibleState.None);
    this.taskLocation = task.location;
    const command: ExplorerCommands = readConfig(workspace, Configuration.scriptExplorerAction) ?? "open";

    const commandList = {
      open: {
        title: "Edit Script",
        command: "vscode.open",
        arguments: [
          this.taskLocation?.uri,
          this.taskLocation
            ? ({
                selection: new Range(this.taskLocation.range.start, this.taskLocation.range.end),
              } as TextDocumentShowOptions)
            : undefined,
        ],
      },
      run: {
        title: "Run",
        command: Commands.runScript,
        arguments: [this],
        // command: "python.debugInTerminal",
        // arguments: [Uri.file("/Users/gabriel.dugny/Sources/Forks/pdm-task-provider/sampleWorkspace/.venv/bin/sample")],
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
    this.description = task.script?.value ?? this.description;
  }

  getFolder(): WorkspaceFolder {
    return this.package.folder.workspaceFolder;
  }
}

export class PoetryScript extends TreeItem {
  task: Task;
  package: PyprojectTOML;
  taskLocation?: Location;

  constructor(
    _context: ExtensionContext,
    pyprojectToml: PyprojectTOML,
    task: ITaskWithLocation<IPoetryScriptReference>,
  ) {
    const name =
      pyprojectToml.path.length > 0
        ? task.task.name.substring(0, task.task.name.length - pyprojectToml.path.length - 2)
        : task.task.name;
    super(name, TreeItemCollapsibleState.None);
    this.taskLocation = task.location;
    const command: ExplorerCommands = readConfig(workspace, Configuration.scriptExplorerAction) ?? "open";

    const commandList = {
      open: {
        title: "Edit Script",
        command: "vscode.open",
        arguments: [
          this.taskLocation?.uri,
          this.taskLocation
            ? ({
                selection: new Range(this.taskLocation.range.start, this.taskLocation.range.end),
              } as TextDocumentShowOptions)
            : undefined,
        ],
      },
      run: {
        title: "Run",
        command: Commands.runScript,
        arguments: [this],
        // command: "python.debugInTerminal",
        // arguments: [Uri.file("/Users/gabriel.dugny/Sources/Forks/pdm-task-provider/sampleWorkspace/.venv/bin/sample")],
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
    this.description = task.script?.value ?? this.description;
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

class KindPdmScripts extends TreeItem {
  pyprojectToml: PyprojectTOML;
  children: PdmScript[] = [];
  constructor(pyprojectToml: PyprojectTOML) {
    super("PDM scripts", TreeItemCollapsibleState.Expanded);
    this.contextValue = "kind_pdm_scripts";
    this.pyprojectToml = pyprojectToml;
    this.iconPath = new ThemeIcon("list-tree");
    this.tooltip = new MarkdownString(
      "PDM scripts, defined in `[tool.pdm.scripts`].\n\n[Learn more](https://pdm-project.org/latest/usage/scripts/#pdm-scripts)",
    );
  }
  push(script: PdmScript) {
    this.children.push(script);
  }
}

class KindProjectScripts extends TreeItem {
  pyprojectToml: PyprojectTOML;
  children: PdmScript[] = [];
  constructor(pyprojectToml: PyprojectTOML) {
    super("Project scripts", TreeItemCollapsibleState.Expanded);
    this.contextValue = "kind_project_scripts";
    this.pyprojectToml = pyprojectToml;
    this.iconPath = new ThemeIcon("list-tree");
    this.tooltip = new MarkdownString(
      "Executable scripts, defined in `[project.scripts`].\n`[project.gui-scripts]` and `[project.entry-points`] are ignored.\n\n[Learn more](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/#creating-executable-scripts)",
    );
  }
  push(script: ProjectScript) {
    this.children.push(script);
  }
}

class KindPoetryScripts extends TreeItem {
  pyprojectToml: PyprojectTOML;
  children: PoetryScript[] = [];
  constructor(pyprojectToml: PyprojectTOML) {
    super("Poetry scripts", TreeItemCollapsibleState.Expanded);
    this.contextValue = "kind_poetry_scripts";
    this.pyprojectToml = pyprojectToml;
    this.iconPath = new ThemeIcon("list-tree");
    this.tooltip = new MarkdownString(
      "Executable scripts, defined in `[project.scripts`].\n`[project.gui-scripts]` and `[project.entry-points`] are ignored.\n\n[Learn more](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/#creating-executable-scripts)",
    );
  }
  push(script: PoetryScript) {
    this.children.push(script);
  }
}

type TaskTree = Folder[] | PyprojectTOML[] | NoScripts[] | KindPdmScripts[];

export class PdmScriptsTreeDataProvider implements TreeDataProvider<TreeItem> {
  private taskTree: TaskTree | null = null;
  private extensionContext: ExtensionContext;
  private _onDidChangeTreeData: EventEmitter<TreeItem | null> = new EventEmitter<TreeItem | null>();
  readonly onDidChangeTreeData: Event<TreeItem | null> = this._onDidChangeTreeData.event;

  constructor(private context: ExtensionContext, public taskProvider: PdmTaskProvider) {
    this.extensionContext = context;

    context.subscriptions.push(
      registerCommand(commands, Commands.runScript, this.runScript, this),
      registerCommand(commands, Commands.debugScript, this.debugScript, this),
      registerCommand(commands, Commands.openScript, this.openScript, this),
      registerCommand(commands, Commands.runInstall, this.runInstall, this),
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
      script.getFolder(),
    );
  }

  private findScriptPosition(document: TextDocument, script?: PdmScript) {
    const scripts = readPyproject(document)?.scripts;
    if (!scripts) {
      return undefined;
    }

    if (!script) {
      return scripts.location.range.start;
    }

    const found = scripts.scripts.find((s) => getTaskName(s.name, script.task.definition.path) === script.task.name);
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
    // Fixme replace by call to pdm.runCommand
    const task = await createTask(
      await getPackageManager(this.context, selection.folder.workspaceFolder.uri, true),
      "install",
      ["install"],
      selection.folder.workspaceFolder,
      uri,
      undefined,
      [],
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
      this.findScriptPosition(document, selection instanceof PdmScript ? selection : undefined) ?? new Position(0, 0);
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
    if (element instanceof KindPdmScripts) {
      return element.pyprojectToml;
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
          let message = "No scripts found. Make sure you have an explicit `[tool.pdm.scripts]` section.";
          if (!isAutoDetectionEnabled()) {
            message = `The setting "${Configuration.autoDetect}" is "off".`;
          }
          this.taskTree = [new NoScripts(message)];
        }
      }
    }
    if (element instanceof Folder) {
      return element.pyprojects;
    }
    if (element instanceof PyprojectTOML) {
      if (element.tasks_with_kinds.size === 1) {
        // Return the element children directly
        return element.tasks_with_kinds.values().next().value.children;
      }
      // List needed, not iterator
      return [...element.tasks_with_kinds.values()];
    }
    if (element instanceof KindPdmScripts) {
      return element.children;
    }
    if (element instanceof KindProjectScripts) {
      return element.children;
    }
    if (element instanceof KindPoetryScripts) {
      return element.children;
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

  private getTaskTreeItemLabel(taskTreeLabel: string | TreeItemLabel | undefined): string {
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
    const folders = new Map<string, Folder>();
    const pyprojects = new Map<string, PyprojectTOML>();

    let folder = null;
    let pyprojectToml = null;

    const excludeConfig = new Map<string, RegExp[]>();

    tasks.forEach((each) => {
      const location = each.location;
      if (location && !excludeConfig.has(location.uri.toString())) {
        const regularExpressionsSetting =
          readConfig(workspace, Configuration.scriptExplorerExclude, location.uri) ?? [];
        excludeConfig.set(
          location.uri.toString(),
          regularExpressionsSetting?.map((value) => RegExp(value)),
        );
      }
      const regularExpressions =
        location && excludeConfig.has(location.uri.toString()) ? excludeConfig.get(location.uri.toString()) : undefined;

      if (
        regularExpressions &&
        regularExpressions.some((regularExpression) =>
          (each.task.definition as IPdmTaskDefinition).script.match(regularExpression),
        )
      ) {
        return;
      }

      if (isWorkspaceFolder(each.task.scope)) {
        folder = folders.get(each.task.scope.name);
        if (!folder) {
          folder = new Folder(each.task.scope);
          folders.set(each.task.scope.name, folder);
        }
        const definition: IPdmTaskDefinition = each.task.definition as IPdmTaskDefinition;
        const relativePath = definition.path ? definition.path : "";
        const fullPath = path.join(each.task.scope.name, relativePath);
        pyprojectToml = pyprojects.get(fullPath);
        if (!pyprojectToml) {
          pyprojectToml = new PyprojectTOML(folder, relativePath, this.extensionContext);
          folder.addPyproject(pyprojectToml);
          pyprojects.set(fullPath, pyprojectToml);
        }

        pyprojectToml.push(each);
      }
    });

    if (folders.size === 1) {
      return [...pyprojects.values()];
    }
    return [...folders.values()];
  }
}
