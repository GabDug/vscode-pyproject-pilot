import { Location, Position, Range, TextDocument } from "vscode";
import { getStaticTOMLValue, parseTOML } from "toml-eslint-parser";

import type { AST } from "toml-eslint-parser";
import { printChannelOutput } from "./extension";

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
  build: string[];
}

export interface IPyProjectInfo {
  scripts?: IPdmScriptInfo | undefined;
  plugins?: IPdmPluginInfo | undefined;
  build?: IPyprojectBuildInfo | undefined;
  // deps
  // dev-deps
}

export const readPyproject = (
  document: TextDocument,
  buffer = document.getText()
): IPyProjectInfo | undefined => {
  printChannelOutput(`Reading file: ${document.uri.toString()}`);

  // @ts-ignore
  const ast: AST.TOMLProgram = parseTOML(buffer);
  const parsed = getStaticTOMLValue(ast);

  printChannelOutput("> Parsed TOML");
  printChannelOutput(parsed);

  return {
    scripts: readScripts(document, ast, parsed),
    // plugins: readPdmPlugins(document, ast, parsed),
    // build: readBuildSystem(document, ast, parsed),
  };
};

export function readPdmPlugins(
  document: TextDocument,
  ast: AST.TOMLProgram,
  parsed: any
): IPdmPluginInfo | undefined {
  // @ts-ignore
  if (!parsed?.tool?.pdm?.plugins) {
    return undefined;
  }

  // Get the location of the key in the ast body
  // @ts-ignore
  const topBodyTable = ast.body[0];
  console.info(topBodyTable);

  const node = topBodyTable.body?.find((node) => {
    if (node.type === "TOMLTable") {
      // If resolved key is == ["tool","pdm"]
      if (node.resolvedKey.toString() === ["tool", "pdm"].toString()) {
        return true;
      }
    }
    return false;
  });
  if (!node) {
    return undefined;
  }
  let start: Position | undefined;
  let end: Position | undefined;
  const plugins: string[] = [];
  console.warn("FOUND tool.pdm");
  // Loop over all the body to look for plugins key
  // @ts-ignore
  node.body?.forEach((plugin) => {
    // @ts-ignore
    const key = plugin.key.keys[0]?.name;
    if (!key) {
      return;
    }
    // @ts-ignore
    const value = plugin.value?.value;
    if (key === "plugins") {
      start = new Position(plugin.loc.start.line - 1, plugin.loc.start.column);
      end = new Position(plugin.loc.end.line - 1, plugin.loc.end.column);
      plugins.push(value);
    }
  });

  // Return the plugins
  if (start === undefined) {
    return undefined;
  }

  return {
    location: new Location(document.uri, new Range(start, end ?? start)),
    // @ts-ignore
    plugins: parsed.tool.pdm.plugins as string[],
  };
}

export function readScripts(
  document: TextDocument,
  ast: AST.TOMLProgram,
  parsed: any
): IPdmScriptInfo | undefined {
  let start: Position | undefined;
  let end: Position | undefined;
  // let inScripts = false;
  // let buildingScript: { name: string; nameRange: Range } | void;

  const scripts: IPdmScriptReference[] = [];
  const scriptsHash: { [key: string]: Partial<IPdmScriptReference> } = {};

  const topBodyTable = ast.body[0];

  // If parsed has tool pdm scripts
  // @ts-ignore
  if (!parsed?.tool?.pdm?.scripts) {
    console.debug(`No scripts found in ${document.uri.toString()}`);
    return undefined;
  }

  // Loop over all the scripts
  // @ts-ignore

  const parsedScripts = parsed.tool.pdm.scripts as Map<string, unknown>;
  printChannelOutput(parsedScripts);
  // parsedScripts is an object
  // Loop over all the keys in the object
  Object.keys(parsedScripts).forEach((key) => {
    // @ts-ignore
    const value = parsedScripts[key];
    // If string is str
    if (typeof key === "string") {
      // If value is string
      if (typeof value === "string") {
        // @ts-ignore
        scriptsHash[key] = {
          name: key,
          value: value,
          exec_type: "cmd",
        };
      }
      if (typeof value === "object") {
        // Get the str from either cmd, shell, composite, or call, if present
        // @ts-ignore
        if (value.cmd) {
          // @ts-ignore
          scriptsHash[key] = {
            name: key,
            value: value.cmd,
            exec_type: "cmd",
          };
        } else if (value.shell) {
          // @ts-ignore
          scriptsHash[key] = {
            name: key,
            value: value.shell,
            exec_type: "shell",
          };
        } else if (value.composite) {
          // @ts-ignore
          scriptsHash[key] = {
            name: key,
            // As string
            value: String(value.composite),
            exec_type: "composite",
          };
        } else if (value.call) {
          // @ts-ignore
          scriptsHash[key] = {
            name: key,
            value: value.call,
            exec_type: "call",
          };
        }
        if (value.help) {
          if (!scriptsHash[key]) {
            scriptsHash[key] = {};
          }
          scriptsHash[key].help = value.help;
        }
      }
    }
  });

  printChannelOutput(scriptsHash);
  const node = topBodyTable.body?.find((node) => {
    if (node.type === "TOMLTable") {
      // If resolved key is == ["tool","pdm"]
      if (
        node.resolvedKey.toString() === ["tool", "pdm", "scripts"].toString()
      ) {
        return true;
      }
    }
    return false;
  });
  if (!node || !(node.type === "TOMLTable")) {
    console.debug(
      `No scripts found in ${document.uri.toString()}: node undefined`
    );
    return undefined;
  }
  console.error(node);
  start = new Position(node.loc.start.line - 1, node.loc.start.column);
  end = new Position(node.loc.end.line - 1, node.loc.end.column);

  if (node.resolvedKey.toString() === ["tool", "pdm", "scripts"].toString()) {
    printChannelOutput("FOUND SCRIPTS");
    // @ts-ignore
    node.body?.forEach((script) => {
      // console.debug(script);

      if (script.type !== "TOMLKeyValue") {
        return;
      }

      // FIXME Support TOMLInlineTables as well
      // @ts-ignore
      const key = script.key.keys[0]?.name;
      if (!key) {
        return;
      }
      const valueTOML = script.value;

      if (!scriptsHash[key]) {
        scriptsHash[key] = {};
      }
      scriptsHash[key].name = key;
      // @ts-ignore
      const sub_key = script.key.keys[1]?.name;
      if (sub_key === "help") {
        // @ts-ignore
        scriptsHash[key].help = script.value?.value;
        return;
      }
      if (
        sub_key === "shell" ||
        sub_key === "cmd" ||
        sub_key === "composite" ||
        sub_key === "call"
      ) {
        // @ts-ignore
        scriptsHash[key].exec_type = sub_key;
        // @ts-ignore
        // scriptsHash[key].value = script.value?.value;
        scriptsHash[key].valueRange = new Range(
          new Position(
            script.value.loc.start.line - 1,
            script.value.loc.start.column
          ),
          new Position(
            script.value.loc.end.line - 1,
            script.value.loc.end.column
          )
        );
        scriptsHash[key].nameRange = new Range(
          new Position(
            script.key.loc.start.line - 1,
            script.key.loc.start.column
          ),
          new Position(script.key.loc.end.line - 1, script.key.loc.end.column)
        );
        return;
      }
      if (!sub_key) {
        // @ts-ignore
        // scriptsHash[key].value = script.value?.value;
        scriptsHash[key].valueRange = new Range(
          new Position(
            script.value.loc.start.line - 1,
            script.value.loc.start.column
          ),
          new Position(
            script.value.loc.end.line - 1,
            script.value.loc.end.column
          )
        );
        scriptsHash[key].nameRange = new Range(
          new Position(
            script.key.loc.start.line - 1,
            script.key.loc.start.column
          ),
          new Position(script.key.loc.end.line - 1, script.key.loc.end.column)
        );
      }

      // @ts-ignore
      // const value = script.value?.value;
      // printChannelOutput(key, value);

      // @ts-ignore
      // scripts.push({
      //   // name: key,

      //   // value: value,

      // });
    });
  }

  // If we have a sub table
  else if (
    node.resolvedKey
      .toString()
      .startsWith(["tool", "pdm", "scripts"].toString()) &&
    node.resolvedKey.length > 3
  ) {
    printChannelOutput(node);
    start = new Position(node.loc.start.line - 1, node.loc.start.column);
    const key = node.resolvedKey[3];
    if (!key || key == "_") {
      return;
    }
    printChannelOutput(key);
    scriptsHash[key].valueRange = new Range(
      new Position(node.loc.start.line - 1, node.loc.start.column),
      new Position(node.loc.end.line - 1, node.loc.end.column)
    );
    scriptsHash[key].nameRange = new Range(
      new Position(node.loc.start.line - 1, node.loc.start.column),
      new Position(node.loc.end.line - 1, node.loc.end.column)
    );
  }

  // Get all the scripts from our hash
  Object.keys(scriptsHash).forEach((key) => {
    scripts.push(scriptsHash[key] as IPdmScriptReference);
  });
  const allScriptsListValues = Object.values(
    scriptsHash
  ) as IPdmScriptReference[];

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
    //  Stringify list
    if (typeof script.value !== "string") {
      script.value = JSON.stringify(script.value);
    }
    script.value = script.value.trim();
  });

  // Return the scripts
  if (start === undefined) {
    console.debug(
      `No scripts found in ${document.uri.toString()}: start undefined`
    );
    return undefined;
  }

  const scriptData = {
    location: new Location(document.uri, new Range(start, end ?? start)),
    scripts,
  };
  console.debug("PDM scriptData", scriptData);
  return scriptData;
}

export const readScriptsLegacy = (
  document: TextDocument,
  buffer = document.getText()
): IPdmScriptInfo | undefined => {
  const ast = parseTOML(buffer);
  const parsed = getStaticTOMLValue(ast);
  return readScripts(document, ast, parsed);
};

// printChannelOutput(`Reading file: ${document.uri.toString()}`);
// export const readPlugins = (

//   document: TextDocument,
//   buffer = document.getText()
// ) => {
//   // We want to return an object with the location of [tool.pdm] plugins key if present, or undefined otherwise
//   let start: Position | undefined;
//   let end: Position | undefined;
//   let plugins: string[] = [];
//   // Parse the TOML file
//   // @ts-ignore
//   const ast: AST.TOMLProgram = parseTOML(document.getText());
//   const parsed = getStaticTOMLValue(ast);
//   if (!(parsed?.tool?.pdm?.plugins)) {
//     return undefined;
//   }

//   // Get the location of the key in the ast body
//   // @ts-ignore
//   const topBodyTable = ast.body[0];
//   topBodyTable.body?.forEach((node) => {
//     if (node.type === "TOMLTable") {
//       // If resolved key is == ["tool","pdm",'plugins']
//       if (
//         node.resolvedKey.toString() === ["tool", "pdm", "plugins"].toString()
//       ) {
//         start = new Position(node.loc.start.line - 1, node.loc.start.column);
//         end = new Position(node.loc.end.line - 1, node.loc.end.column);
//         // @ts-ignore
//         node.body?.forEach((plugin) => {
//           // @ts-ignore
//           const key = plugin.key.keys[0]?.name;
//           if (!key) {
//             return;
//           }
//           // @ts-ignore
//           const value = plugin.value?.value;
//           plugins.push(value);
//         });
//       }
//     }
//   });

// }

export function readBuildSystem(
  document: TextDocument,
  ast: AST.TOMLProgram,
  parsed: any
): undefined | IPyprojectBuildInfo {
  // If parsed has key "build-system"
  if (!parsed || !parsed["build-system"]) {
    return undefined;
  }
  // Loop over body to check "build-system" key
  // @ts-ignore
  const topBodyTable = ast.body[0];
  let start: Position | undefined;
  let end: Position | undefined;
  const build: string[] = [];
  topBodyTable.body?.forEach((node) => {
    if (node.type === "TOMLTable") {
      // If resolved key is == ["build-system"]
      if (node.resolvedKey.toString() === ["build-system"].toString()) {
        start = new Position(node.loc.start.line - 1, node.loc.start.column);
        end = new Position(node.loc.end.line - 1, node.loc.end.column);
        // @ts-ignore
        node.body?.forEach((buildSystem) => {
          // @ts-ignore
          const key = buildSystem.key.keys[0]?.name;
          if (!key) {
            return;
          }
          // @ts-ignore
          const value = buildSystem.value?.value;
          build.push(value);
        });
      }
    }
  });

  return undefined;
}
