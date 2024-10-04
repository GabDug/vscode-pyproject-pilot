/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as Mocha from "mocha";

import { join, resolve } from "path";

import { glob } from "glob";
import { MochaOptions } from "mocha";

// import Mocha from "mocha";
require("mocha/mocha");

function setupCoverage() {
  // FIXME(GabDug): Coverage include/exclude + no coverage when launching VS Code with a workspace

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const NYC = require("nyc");
  const nyc = new NYC({
    cwd: join(__dirname, "..", "..", ".."),
    // exclude: ["**/test/**", ".vscode-test/**", "**/node_modules/**"],
    reporter: ["text", "html"],
    extension: [".ts", ".js"],
    all: true,
    instrument: true,
    hookRequire: true,
    hookRunInContext: true,
    hookRunInThisContext: true,
    excludeNodeModules: true,
    sourceMap: true,
    checkCoverage: true,
    // clean: true
    // include: [
    //   "pdm-task-provider/**/*.ts",
    //   "pdm-task-provider/**/*.js",
    //   "**/src/**/*.js",
    //   "**/src/**/*",
    //   "**/src/**/*.ts",
    //   "commands.ts",
    //   "**/commands.ts",
    // ],
  });

  nyc.reset();
  nyc.wrap();

  return nyc;
}

export async function run(): Promise<void> {
  const nyc = process.env.COVERAGE ? setupCoverage() : null;

  const mochaOpts: MochaOptions = {
    timeout: 100 * 1000,
    ui: "tdd",
    color: true,
    ...JSON.parse(process.env.MOCHA_TEST_OPTIONS ?? "{}"),
  };

  const runner = new Mocha(mochaOpts);

  const testsRoot = resolve(__dirname, "..");

  const files = await glob("**/**.test.js", { cwd: testsRoot });
  files.forEach((f) => runner.addFile(resolve(testsRoot, f)));

  try {
    await new Promise((resolve, reject) =>
      runner.run((failures: any) => (failures ? reject(new Error(`${failures} tests failed`)) : resolve(undefined))),
    );
  } finally {
    if (nyc) {
      nyc.writeCoverageFile();
      await nyc.report();
    }
  }
}
