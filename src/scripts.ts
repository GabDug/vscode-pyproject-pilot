import { Location, Range } from "vscode";

export const enum ScriptKind {
  PdmScript = "pdm_script",
  ProjectScript = "project_script",
  PoetryScript = "poetry_script",
}
// T Is a scriptkind
export interface IReferenceBase<T extends ScriptKind> {
  kind: T;
  name: string;
  value: string;
  nameRange: Range;
  valueRange: Range;
}

export interface IWithLocation {
  location: Location;
}

export interface IInfoBase<T extends ScriptKind> extends IWithLocation {
  scripts: IReferenceBase<T>[];
}
