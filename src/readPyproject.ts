import { IInfoBase, IReferenceBase, IWithLocation, ScriptKind } from "./scripts";
import { Location, Position, Range, TextDocument } from "vscode";
import { getKeyStr, getPositionFromAst, getRangeFromAstLoc, getTableContent, getTableSimple } from "./tomlUtils";
import { getStaticTOMLValue, parseTOML } from "toml-eslint-parser";
import { traceError, traceLog } from "./common/log/logging";

import type { AST } from "toml-eslint-parser";

export interface IPdmScriptReference extends IReferenceBase<ScriptKind.PdmScript> {
  help?: string;
  exec_type?: string;
}
export interface IProjectScriptReference extends IReferenceBase<ScriptKind.ProjectScript> {
  sub_kind?: string;
}

export interface IPoetryScriptReference extends IReferenceBase<ScriptKind.PoetryScript> {
  sub_kind?: string;
}

export interface IPdmPluginInfo extends IWithLocation {
  plugins: string[];
}

export type IPdmScriptInfo = IInfoBase<ScriptKind.PdmScript>;
export type IPoetryScriptInfo = IInfoBase<ScriptKind.PoetryScript>;
export type IProjectScriptInfo = IInfoBase<ScriptKind.ProjectScript>;

// Map of ScriptKind to reference
export interface KindToReferenceMap {
  [ScriptKind.PdmScript]: IPdmScriptReference;
  [ScriptKind.ProjectScript]: IProjectScriptReference;
  [ScriptKind.PoetryScript]: IPoetryScriptReference;
}

export interface IPyprojectBuildInfo extends IWithLocation {
  requires?: string[];
  build_backend?: string;
}

export interface IPyProjectInfo {
  scripts?: IPdmScriptInfo | undefined;
  plugins?: IPdmPluginInfo | undefined;
  build?: IPyprojectBuildInfo | undefined;
  projectScripts?: IProjectScriptInfo | undefined;
  poetryScripts?: IPoetryScriptInfo | undefined;
  // deps
  // dev-deps
}

export const readPyproject = (document: TextDocument, buffer = document.getText()): IPyProjectInfo | undefined => {
  traceLog(`Reading file: ${document.uri.toString()}`);

  const ast: AST.TOMLProgram = parseTOML(buffer, {
    filePath: document.uri.toString(),
  });
  const parsed = getStaticTOMLValue(ast);

  traceLog("> Parsed TOML");
  traceLog(parsed);

  return {
    scripts: readPdmScripts(document, ast, parsed),
    plugins: readPdmPlugins(document, ast, parsed),
    build: readBuildSystem(document, ast, parsed),
    projectScripts: readProjectScripts(document, ast, parsed),
    poetryScripts: readPoetryScripts(document, ast, parsed),
  };
};

export function readPdmScripts(document: TextDocument, ast: AST.TOMLProgram, parsed: any): IPdmScriptInfo | undefined {
  // If parsed has no scripts
  if (!parsed?.tool?.pdm?.scripts) {
    traceLog(`No PDM scripts found in ${document.uri.toString()}`);
    return undefined;
  }
  let start: Position | undefined;

  const scripts: IPdmScriptReference[] = [];
  const scriptsHash: Record<string, Partial<IPdmScriptReference>> = {};

  // Loop over all the scripts
  const parsedScripts = parsed.tool.pdm.scripts as Map<string, unknown>;
  traceLog(parsedScripts);

  // Loop over all the keys in the object
  Object.keys(parsedScripts).forEach((key) => {
    // @ts-expect-error: we don't know the type of the value yet
    const value = parsedScripts[key];

    // If value is string
    if (typeof value === "string") {
      scriptsHash[key] = {
        name: key,
        value: value,
        exec_type: "cmd",
      };
    }
    if (typeof value === "object") {
      // Get the str from either cmd, shell, composite, or call, if present
      if (value.cmd) {
        scriptsHash[key] = {
          name: key,
          value: value.cmd,
          exec_type: "cmd",
        };
      } else if (value.shell) {
        scriptsHash[key] = {
          name: key,
          value: value.shell,
          exec_type: "shell",
        };
      } else if (value.composite) {
        scriptsHash[key] = {
          name: key,
          // As string
          value: String(value.composite),
          exec_type: "composite",
        };
      } else if (value.call) {
        scriptsHash[key] = {
          name: key,
          value: value.call,
          exec_type: "call",
        };
      }
      // Add help if present, ignore the rest
      if (value.help) {
        // Check we have an object
        if (!scriptsHash[key]) {
          console.warn(`No script found for script with help ${key}`);
          return;
        }
        scriptsHash[key].help = value.help;
      }
    }
  });

  traceLog(scriptsHash);
  const { scriptsNode, subScriptsNodes } = getTableContent(ast, ["tool", "pdm", "scripts"]);

  if (!scriptsNode || !(scriptsNode.type === "TOMLTable")) {
    traceLog(`No PDM scripts found in ${document.uri.toString()}: node undefined`);
    return undefined;
  }
  start = getPositionFromAst(scriptsNode.loc.start);
  const end = getPositionFromAst(scriptsNode.loc.end);

  // if (scriptsNode.resolvedKey.toString() === ["tool", "pdm", "scripts"].toString()) {
  scriptsNode.body?.forEach((script) => {
    if (script.type !== "TOMLKeyValue") {
      traceError("script is not TOMLKeyValue");
      return;
    }

    const key = getKeyStr(script.key.keys[0]);
    if (!key) {
      return;
    }

    if (!scriptsHash[key]) {
      traceError(`No script found for script ${key}`);
      return;
    }
    // scriptsHash[key].name = key;
    const sub_key_node = script.key.keys[1];
    if (!sub_key_node) {
      scriptsHash[key].valueRange = getRangeFromAstLoc(script.value.loc);
      scriptsHash[key].nameRange = getRangeFromAstLoc(script.key.loc);
      return;
    }

    const sub_key = getKeyStr(script.key.keys[1]);
    if (sub_key === "help" && script.value?.type === "TOMLValue" && script.value.kind === "string") {
      scriptsHash[key].help = script.value?.value;
      return;
    }
    if (sub_key === "shell" || sub_key === "cmd" || sub_key === "composite" || sub_key === "call") {
      scriptsHash[key].exec_type = sub_key;
      scriptsHash[key].valueRange = getRangeFromAstLoc(script.value.loc);
      scriptsHash[key].nameRange = getRangeFromAstLoc(script.key.loc);
      return;
    }
  });
  // }

  // If we have a sub table
  if (subScriptsNodes) {
    subScriptsNodes.forEach((subScriptNode) => {
      console.error(`TOTO ${subScriptNode.type}`);
      if (subScriptNode.type !== "TOMLTable") {
        traceError("script is not TOMLKeyValue");
        return;
      }
      // subScriptNode.body
      const key_node = subScriptNode.key.keys[3];
      const key = getKeyStr(key_node);
      if (!key || key == "_") {
        return;
      }
      if (!start) {
        start = getPositionFromAst(subScriptNode.loc.start);
      }
      if (!scriptsHash[key]) {
        traceError(`No script found for script ${key}`);
        return;
      }
      scriptsHash[key].valueRange = getRangeFromAstLoc(subScriptNode.loc);
      scriptsHash[key].nameRange = getRangeFromAstLoc(subScriptNode.key.loc);
    });
  }

  // Get all the scripts from our hash
  Object.keys(scriptsHash).forEach((key) => {
    scripts.push(scriptsHash[key] as IPdmScriptReference);
  });

  // Remove script with key == "_" if it exists
  // Safety check: remove all tasks without a value
  // XXX(GabDug): Hide all scripts starting with underscore?
  scripts.forEach((script, index) => {
    script.kind = ScriptKind.PdmScript;
    if (script.name === "_" || !script.value) {
      scripts.splice(index, 1);
    }
  });

  // Trim each value
  scripts.forEach((script) => {
    //  Stringify lists in value
    if (typeof script.value !== "string") {
      script.value = JSON.stringify(script.value);
    }
    script.value = script.value.trim();
  });

  // Return the scripts
  if (start === undefined) {
    traceLog(`No PDM scripts found in ${document.uri.toString()}: start undefined`);
    return undefined;
  }

  const scriptData = {
    location: new Location(document.uri, new Range(start, end ?? start)),
    scripts,
  };
  traceLog("PDM scriptData", scriptData);
  return scriptData;
}

export function readPdmPlugins(document: TextDocument, ast: AST.TOMLProgram, parsed: any): IPdmPluginInfo | undefined {
  if (!parsed?.tool?.pdm?.plugins?.length) {
    return undefined;
  }

  const tool_pdm_node = getTableSimple(ast, ["tool", "pdm"]);

  const plugins_node = tool_pdm_node?.body?.find((node) => {
    if (node.type === "TOMLKeyValue") {
      const key = getKeyStr(node.key.keys[0]);
      if (!key) {
        return false;
      }

      if (key === "plugins") {
        return true;
      }
    }
    return false;
  });
  if (plugins_node?.value?.type !== "TOMLArray") {
    return undefined;
  }
  // XXX(GabDug): we cast as string[] but never check the value of the array
  return {
    location: new Location(document.uri, getRangeFromAstLoc(plugins_node.loc)),
    plugins: parsed.tool.pdm.plugins as string[],
  };
}

export function readBuildSystem(
  document: TextDocument,
  ast: AST.TOMLProgram,
  parsed: any,
): undefined | IPyprojectBuildInfo {
  /**
   * Only supports table style build-system
   */
  if (!parsed?.["build-system"]) {
    return undefined;
  }

  const build_backend = parsed["build-system"]["build-backend"] ?? undefined;
  const build_system_node = getTableSimple(ast, ["build-system"]);
  if (!build_system_node) {
    return undefined;
  }

  return {
    location: new Location(document.uri, getRangeFromAstLoc(build_system_node.loc)),
    requires: parsed["build-system"]?.requires,
    build_backend: build_backend,
  };
}

export function readProjectScripts(
  document: TextDocument,
  ast: AST.TOMLProgram,
  parsed: any,
): IProjectScriptInfo | undefined {
  // Return the scripts in pyproject.toml project.scripts if they exists

  if (!parsed?.project?.scripts) {
    console.log(`No project scripts found in ${document.uri.toString()}`);
    return undefined;
  }
  console.log(`project scripts found in ${document.uri.toString()}`);

  const project_scripts_node = getTableSimple(ast, ["project", "scripts"]);
  if (!project_scripts_node || !(project_scripts_node.type === "TOMLTable")) {
    traceLog(`No project scripts found in ${document.uri.toString()}: node undefined or table`);
    return undefined;
  }

  const projectScripts: IProjectScriptReference[] = [];
  project_scripts_node.body?.forEach((script) => {
    if (script.type !== "TOMLKeyValue") {
      traceError("script is not TOMLKeyValue");
      return;
    }

    if (script.value.type !== "TOMLValue") {
      if (script.value.type !== "TOMLInlineTable") {
        traceError("script value is not TOMLValue or TOMLInlineTable");
        return;
      }
      // projectScripts.push({
      //   kind: "project_script",
      //   name: script.value.body.find((node) => node.type === "TOMLKeyValue")?.key.keys[0].value as string,
      //   value: script_value,
      //   sub_kind: "scripts",
      //   nameRange: getRangeFromAstLoc(script_key_node),
      //   valueRange: getRangeFromAstLoc(script_value_node),
      // });
      return;
    }
    if (!script.value) {
      return;
    }
    const script_key = getKeyStr(script.key.keys[0]);
    if (!script_key) {
      return;
    }
    const script_key_node = script.loc;
    if (!script_key_node) {
      return;
    }

    const script_value_node = script.loc;
    if (!script_value_node) {
      return;
    }
    if (script.value.kind !== "string") {
      return;
    }
    const script_value = script.value.value;

    projectScripts.push({
      kind: ScriptKind.ProjectScript,
      name: script_key,
      value: script_value,
      sub_kind: "scripts",
      nameRange: getRangeFromAstLoc(script_key_node),
      valueRange: getRangeFromAstLoc(script_value_node),
    });
  });
  return {
    scripts: projectScripts,
    location: new Location(document.uri, getRangeFromAstLoc(project_scripts_node.loc)),
  };
}

export function readPoetryScripts(
  document: TextDocument,
  ast: AST.TOMLProgram,
  parsed: any,
): IPoetryScriptInfo | undefined {
  // Return the scripts in pyproject.toml project.scripts if they exists
  // They are in `tool.poetry.scripts`
  // Values can be string or object with `reference` string

  if (!parsed?.tool?.poetry?.scripts) {
    console.log(`No poetry scripts found in ${document.uri.toString()}`);
    return undefined;
  }

  const poetry_scripts_node = ast.body[0].body?.find((node) => {
    if (node.type === "TOMLTable") {
      // If resolved key is == ["tool","poetry", "scripts"]
      if (node.resolvedKey.toString() === ["tool", "poetry", "scripts"].toString()) {
        return true;
      }
    }
    return false;
  });

  if (!poetry_scripts_node) {
    console.log(`No poetry scripts found in ${document.uri.toString()} (no node)`);
    return undefined;
  }

  console.log(`poetry scripts found in ${document.uri.toString()}: ${poetry_scripts_node}`);

  if (!poetry_scripts_node || !(poetry_scripts_node.type === "TOMLTable")) {
    traceLog(`No poetry scripts found in ${document.uri.toString()}: node undefined or table`);
    return undefined;
  }

  const poetryScripts: IPoetryScriptReference[] = [];
  poetry_scripts_node.body?.forEach((script) => {
    if (script.type !== "TOMLKeyValue") {
      traceError("script is not TOMLKeyValue");
      return;
    }

    if (script.value.type !== "TOMLValue") {
      traceError("script value is not TOMLValue");
      return;
    }
    if (!script.value) {
      traceError("script value is undefined");
      return;
    }
    const script_key = getKeyStr(script.key.keys[0]);

    if (!script_key) {
      traceError("script key is undefined");
      return;
    }
    const script_key_node = script.loc;
    if (!script_key_node) {
      traceError("script key node is undefined");
      return;
    }

    const script_value_node = script.loc;
    if (!script_value_node) {
      traceError("script value node is undefined");
      return;
    }
    if (script.value.kind !== "string") {
      traceError("script value is not string");
      return;
    }
    const script_value = script.value.value;

    poetryScripts.push({
      kind: ScriptKind.PoetryScript,
      name: script_key,
      value: script_value,
      sub_kind: "scripts",
      nameRange: getRangeFromAstLoc(script_key_node),
      valueRange: getRangeFromAstLoc(script_value_node),
    });
  });

  // If empty add a dummy
  // FIXME Remove before release duh
  if (poetryScripts.length === 0) {
    poetryScripts.push({
      kind: ScriptKind.PoetryScript,
      name: "Dummy",
      value: "DummyValue",
      sub_kind: "scripts",
      nameRange: new Range(new Position(0, 0), new Position(0, 0)),
      valueRange: new Range(new Position(0, 0), new Position(0, 0)),
    });
  }
  traceLog(`Found ${poetryScripts.length} poetry scripts in ${document.uri.toString()}`);

  return {
    scripts: poetryScripts,
    location: new Location(document.uri, getRangeFromAstLoc(poetry_scripts_node.loc)),
  };
}
