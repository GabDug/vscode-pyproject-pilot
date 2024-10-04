import { TOMLBare, TOMLQuoted } from "toml-eslint-parser/lib/ast";
import { Position, Range } from "vscode";

import { AST } from "toml-eslint-parser";

export function getKeyStr(key_node: TOMLBare | TOMLQuoted): string | undefined {
  if (key_node.type === "TOMLBare") {
    return key_node.name;
  } else if (key_node.type === "TOMLQuoted") {
    return key_node.value;
  } else {
    return undefined;
  }
}
/**
 * From an {@link AST.Position}, get a VSCode {@link Position}
 * @param pos AST position
 * @returns VSCode Position
 */
export function getPositionFromAst(pos: AST.Position): Position {
  return new Position(pos.line - 1, pos.column);
}

export function getRangeFromAstLoc(loc: AST.SourceLocation): Range {
  return new Range(getPositionFromAst(loc.start), getPositionFromAst(loc.end));
}
export function getTableSimple(ast: AST.TOMLProgram, keys: string[]) {
  return ast.body[0].body?.find((node) => {
    if (node.type === "TOMLTable") {
      // If resolved key is == ["project","scripts"]
      if (node.resolvedKey.toString() === keys.toString()) {
        return true;
      }
    }
    return false;
  }) as AST.TOMLTable | undefined;
}
export function getTableContent(ast: AST.TOMLProgram, keys: string[]) {
  const topBodyTable = ast.body[0];
  const scriptsNode = topBodyTable.body?.find((node) => {
    if (node.type === "TOMLTable") {
      if (node.resolvedKey.toString() === keys.toString()) {
        return true;
      }
    }
    return false;
  });
  const subScriptsNodes = topBodyTable.body?.filter((node) => {
    if (node.type === "TOMLTable") {
      if (node.resolvedKey.toString().startsWith(keys.toString()) && node.resolvedKey.length > keys.length) {
        return true;
      }
    }
    return false;
  });
  return { scriptsNode, subScriptsNodes };
}
