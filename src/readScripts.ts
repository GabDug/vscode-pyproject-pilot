import { Location, Position, Range, TextDocument } from "vscode";
import { getStaticTOMLValue, parseTOML } from "toml-eslint-parser";

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

export interface IPdmScriptInfo {
  location: Location;
  scripts: IPdmScriptReference[];
}

export const readScripts = (
  document: TextDocument,
  buffer = document.getText()
): IPdmScriptInfo | undefined => {
  let start: Position | undefined;
  let end: Position | undefined;
  // let inScripts = false;
  // let buildingScript: { name: string; nameRange: Range } | void;

  const scripts: IPdmScriptReference[] = [];
  const scriptsHash: { [key: string]: Partial<IPdmScriptReference> } = {};
  // Parse the TOML file
  // @ts-ignore
  const ast: AST.TOMLProgram = parseTOML(document.getText());
  console.error("TOML BODY");
  console.error(ast);
  console.error("TOML PARSED")
  const parsed = getStaticTOMLValue(ast);
  console.error(parsed);
  const topBodyTable = ast.body[0];

  // If parsed has tool pdm scripts
  // @ts-ignore
  if (!(parsed?.tool?.pdm?.scripts)) {
    return undefined;
  }

  // Loop over all the scripts
  // @ts-ignore

  const parsedScripts = parsed.tool.pdm.scripts as Map<string, unknown>;
  console.error(parsedScripts)
  // parsedScripts is an object
  // Loop over all the keys in the object
  Object.keys(parsedScripts).forEach((key) => {

    // @ts-ignore
    const value = parsedScripts[key]
    // If string is str
    if (typeof key === "string") {
      // If value is string
      if (typeof value === "string") {
        // @ts-ignore
        scriptsHash[key] = {
          name: key,
          value: value,
          exec_type: "cmd"
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
            exec_type: "cmd"
          };
        }
        else if (value.shell) {
          // @ts-ignore
          scriptsHash[key] = {
            name: key,
            value: value.shell,
            exec_type: "shell"
          };
        } else if (value.composite) {
          // @ts-ignore
          scriptsHash[key] = {
            name: key,
            // As string
            value: String(value.composite),
            exec_type: "composite"
          };
        } else if (value.call) {
          // @ts-ignore
          scriptsHash[key] = {
            name: key,
            value: value.call,
            exec_type: "call"
          };
        }
        if (value.help) {
          // @ts-ignore
          scriptsHash[key].help = value.help;
        }
      }
    }
  });

  console.error(scriptsHash)


  topBodyTable.body?.forEach((node) => {
    if (node.type === "TOMLTable") {
      // If resolved key is == ["tool","pdm",'scripts']
      if (
        node.resolvedKey.toString() === ["tool", "pdm", "scripts"].toString()
      ) {
        console.error("FOUND SCRIPTS");
        start = new Position(node.loc.start.line - 1, node.loc.start.column);
        end = new Position(node.loc.end.line - 1, node.loc.end.column);
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
              new Position(
                script.key.loc.end.line - 1,
                script.key.loc.end.column
              )
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
              new Position(
                script.key.loc.end.line - 1,
                script.key.loc.end.column
              )
            );
          }

          // @ts-ignore
          // const value = script.value?.value;
          // console.error(key, value);

          // @ts-ignore
          // scripts.push({
          //   // name: key,

          //   // value: value,

          // });
        });
      }

      // If we have a sub table
      else if (
        node.resolvedKey.toString().startsWith(["tool", "pdm", "scripts"].toString())
      && node.resolvedKey.length > 3)
      {
        console.warn(node)
        const key = node.resolvedKey[3];
        if (!key || key == "_") {
          return;
        }
        console.warn(key)
        scriptsHash[key].valueRange = new Range(
          new Position(
            node.loc.start.line - 1,
            node.loc.start.column
          ),
          new Position(
            node.loc.end.line - 1,
            node.loc.end.column
          )
        );
        scriptsHash[key].nameRange = new Range(
          new Position(
            node.loc.start.line - 1,
            node.loc.start.column
          ),
          new Position(
            node.loc.end.line - 1,
            node.loc.end.column
          )
        );

      }
    }
  });

  // Get all the scripts from our hash
  Object.keys(scriptsHash).forEach((key) => {
    scripts.push(scriptsHash[key] as IPdmScriptReference);
  });

  // Remove script with key == "_" if it exists
  scripts.forEach((script, index) => {
    if (script.name === "_") {
      scripts.splice(index, 1);
    }
  });

  // Trim each value
  scripts.forEach((script) => {
    script.value = script.value.trim();
  });

  // Return the scripts
  if (start === undefined) {
    return undefined;
  }
  // @ts-ignore
  const x = {
    location: new Location(document.uri, new Range(start, end ?? start)),
    scripts,
  };
  console.error(x);
  return x;
};


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
