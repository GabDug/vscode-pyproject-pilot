/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// import findWorkspaceRoot = require('../node_modules/find-yarn-workspace-root');

// import * as findUp from 'find-up';
import * as path from "path";

import { Uri, workspace } from "vscode";
import { Configuration, readConfig } from "./common";

// import * as whichPM from 'which-pm';

interface PreferredProperties {
  isPreferred: boolean;
  hasLockfile: boolean;
}

async function pathExists(filePath: string) {
  try {
    await workspace.fs.stat(Uri.file(filePath));
  } catch {
    return false;
  }
  return true;
}

async function isPoetryPreffered(pkgPath: string): Promise<PreferredProperties> {
  if (await pathExists(path.join(pkgPath, "poetry.lock"))) {
    return { isPreferred: true, hasLockfile: true };
  }

  return { isPreferred: false, hasLockfile: false };
}

async function isPDMPreferred(pkgPath: string): Promise<PreferredProperties> {
  const lockfileExists = await pathExists(path.join(pkgPath, "pdm.lock"));
  return { isPreferred: lockfileExists, hasLockfile: lockfileExists };
}

export async function findPreferredPM(pkgPath: string): Promise<{ name: string; multipleLockFilesDetected: boolean }> {
  const detectedPackageManagerNames: string[] = [];
  const detectedPackageManagerProperties: PreferredProperties[] = [];

  const pdmPreferred = await isPDMPreferred(pkgPath);
  if (pdmPreferred.isPreferred) {
    detectedPackageManagerNames.push("pdm");
    detectedPackageManagerProperties.push(pdmPreferred);
  }

  const poetryPreffered = await isPoetryPreffered(pkgPath);
  if (poetryPreffered.isPreferred) {
    detectedPackageManagerNames.push("poetry");
    detectedPackageManagerProperties.push(poetryPreffered);
  }

  // const pmUsedForInstallation: { name: string } | null = await whichPM(pkgPath);

  // if (pmUsedForInstallation && !detectedPackageManagerNames.includes(pmUsedForInstallation.name)) {
  // 	detectedPackageManagerNames.push(pmUsedForInstallation.name);
  // 	detectedPackageManagerProperties.push({ isPreferred: true, hasLockfile: false });
  // }

  let lockfilesCount = 0;
  detectedPackageManagerProperties.forEach((detected) => (lockfilesCount += detected.hasLockfile ? 1 : 0));

  return {
    name: detectedPackageManagerNames[0] || "pdm",
    multipleLockFilesDetected: lockfilesCount > 1,
  };
}

export function getPackageManagerPath(packageManager: string) {
  // Check if interpreter path is set
  const pdmPath = readConfig(workspace, Configuration.pdmPath);
  if (pdmPath) {
    return pdmPath;
  }
  return packageManager;
}
