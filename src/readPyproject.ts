import { getStaticTOMLValue, parseTOML } from "toml-eslint-parser";
import { Location, Position, Range, TextDocument } from "vscode";
import { traceError, traceLog } from "./common/log/logging";
import { getKeyStr, getPositionFromAst, getRangeFromAstLoc } from "./tomlUtils";

import type { AST } from "toml-eslint-parser";

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IPdmScriptReference {
  name: string;
  value: string;
  nameRange: Range;
  valueRange: Range;
  help?: string;
  exec_type?: string;
}

export interface IPdmPluginInfo {
  location: Location;
  plugins: string[];
}

export interface IPdmScriptInfo {
  location: Location;
  scripts: IPdmScriptReference[];
}

export interface IPyprojectBuildInfo {
  location: Location;
  requires?: string[];
  build_backend?: string;
}

export interface IPyProjectInfo {
  scripts?: IPdmScriptInfo | undefined;
  plugins?: IPdmPluginInfo | undefined;
  build?: IPyprojectBuildInfo | undefined;
  // deps
  // dev-deps
}

export const readPyproject = (document: TextDocument, buffer = document.getText()): IPyProjectInfo | undefined => {
  printChannelOutput(`Reading file: ${document.uri.toString()}`);

  const ast: AST.TOMLProgram = parseTOML(buffer, {
    filePath: document.uri.toString(),
  });
  const parsed = getStaticTOMLValue(ast);
  console.error(parsed);

  printChannelOutput("> Parsed TOML");
  printChannelOutput(parsed);

  return {
    scripts: readPdmScripts(document, ast, parsed),
    plugins: readPdmPlugins(document, ast, parsed),
    build: readBuildSystem(document, ast, parsed),
  };
};

export function readPdmScripts(document: TextDocument, ast: AST.TOMLProgram, parsed: any): IPdmScriptInfo | undefined {
  // If parsed has no scripts
  if (!parsed?.tool?.pdm?.scripts) {
    console.debug(`No scripts found in ${document.uri.toString()}`);
    return undefined;
  }
  let start: Position | undefined;

  const scripts: IPdmScriptReference[] = [];
  const scriptsHash: Record<string, Partial<IPdmScriptReference>> = {};

  const topBodyTable = ast.body[0];

  // Loop over all the scripts
  const parsedScripts = parsed.tool.pdm.scripts as Map<string, unknown>;
  printChannelOutput(parsedScripts);

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
          console.error(`No script found for script with help ${key}`);
          return;
        }
        scriptsHash[key].help = value.help;
      }
    }
  });

  printChannelOutput(scriptsHash);
  const scriptsNode = topBodyTable.body?.find((node) => {
    if (node.type === "TOMLTable") {
      // If resolved key is == ["tool","pdm"]
      if (node.resolvedKey.toString() === ["tool", "pdm", "scripts"].toString()) {
        return true;
      }
    }
    return false;
  });
  const subScriptsNodes = topBodyTable.body?.filter((node) => {
    if (node.type === "TOMLTable") {
      // If resolved key is == ["tool","pdm", "scripts", *]
      if (
        node.resolvedKey.toString().startsWith(["tool", "pdm", "scripts"].toString()) &&
        node.resolvedKey.length > 3
      ) {
        return true;
      }
    }
    return false;
  });

  if (!scriptsNode || !(scriptsNode.type === "TOMLTable")) {
    console.debug(`No scripts found in ${document.uri.toString()}: node undefined`);
    return undefined;
  }
  console.error(scriptsNode);
  start = getPositionFromAst(scriptsNode.loc.start);
  const end = getPositionFromAst(scriptsNode.loc.end);

  if (scriptsNode.resolvedKey.toString() === ["tool", "pdm", "scripts"].toString()) {
    console.error("FOUND SCRIPTS");
    console.error(scriptsNode);
    scriptsNode.body?.forEach((script) => {
      if (script.type !== "TOMLKeyValue") {
        console.error("script is not TOMLKeyValue");
        console.error(script);
        return;
      }

      const key = getKeyStr(script.key.keys[0]);
      if (!key) {
        return;
      }

      if (!scriptsHash[key]) {
        console.error(`No script found for script ${key}`);
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
  }

  // If we have a sub table
  if (subScriptsNodes) {
    subScriptsNodes.forEach((subScriptNode) => {
      console.debug("FOUND SUBSCRIPTS");
      console.error(subScriptNode);

      const key_node = subScriptNode.key.keys[3];
      const key = getKeyStr(key_node);
      if (!key || key == "_") {
        return;
      }
      printChannelOutput(key);
      if (!start) {
        start = getPositionFromAst(subScriptNode.loc.start);
      }
      if (!scriptsHash[key]) {
        console.error(`No script found for script ${key}`);
        return;
      }
      scriptsHash[key].valueRange = getRangeFromAstLoc(subScriptNode.loc);
      scriptsHash[key].nameRange = getRangeFromAstLoc(subScriptNode.key.loc);
    });
  }
  console.error("DDDSDD FSDHFSDFHJDF");
  console.warn(scriptsHash);
  // Get all the scripts from our hash
  Object.keys(scriptsHash).forEach((key) => {
    scripts.push(scriptsHash[key] as IPdmScriptReference);
  });

  // Remove script with key == "_" if it exists
  // Safety check: remove all tasks without a value
  // XXX(GabDug): Hide all scripts starting with underscore?
  scripts.forEach((script, index) => {
    if (script.name === "_") {
      scripts.splice(index, 1);
    } else if (!script.value) {
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
    console.debug(`No scripts found in ${document.uri.toString()}: start undefined`);
    return undefined;
  }

  const scriptData = {
    location: new Location(document.uri, new Range(start, end ?? start)),
    scripts,
  };
  console.debug("PDM scriptData", scriptData);
  return scriptData;
}

export function readPdmPlugins(document: TextDocument, ast: AST.TOMLProgram, parsed: any): IPdmPluginInfo | undefined {
  if (!parsed?.tool?.pdm?.plugins?.length) {
    return undefined;
  }

  const tool_pdm_node = ast.body[0].body?.find((node) => {
    if (node.type === "TOMLTable") {
      // If resolved key is == ["tool","pdm"]
      if (node.resolvedKey.toString() === ["tool", "pdm"].toString()) {
        return true;
      }
    }
    return false;
  }) as AST.TOMLTable | undefined;

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
  const build_system_node = ast.body[0].body?.find((node) => {
    if (node.type === "TOMLTable") {
      if (node.resolvedKey.toString() === ["build-system"].toString()) {
        return true;
      }
    }
    return false;
  });
  if (!build_system_node) {
    return undefined;
  }

  return {
    location: new Location(document.uri, getRangeFromAstLoc(build_system_node.loc)),
    requires: parsed["build-system"]?.requires,
    build_backend: build_backend,
  };
}
