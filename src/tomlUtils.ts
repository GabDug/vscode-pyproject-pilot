import { Position, Range } from "vscode";
import { TOMLBare, TOMLQuoted } from "toml-eslint-parser/lib/ast";

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

export function getPositionFromAst(pos: AST.Position): Position {
  return new Position(pos.line - 1, pos.column);
}

export function getRangeFromAstLoc(loc: AST.SourceLocation): Range {
  return new Range(getPositionFromAst(loc.start), getPositionFromAst(loc.end));
}
