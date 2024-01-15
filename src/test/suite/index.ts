/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import * as Mocha from "mocha";
import * as path from "path";

import { glob } from "glob";
// import "./testHooks";
// @ts-ignore
// import LoggingReporter from "./reporters/logTestReporter";
//@ts-ignore
import { join } from "path";

// import Mocha from "mocha";
require("mocha/mocha");

function setupCoverage() {
  const NYC = require("nyc");
  const nyc = new NYC({
    cwd: join(__dirname, "..", "..", ".."),
    // cwd: "/Users/gabriel.dugny/Sources/Forks/pdm-task-provider", //join(__dirname, "..", "..", ".."),
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
  const nyc = setupCoverage();
  // const nyc = process.env.COVERAGE ? setupCoverage() : null;

  const mochaOpts: Mocha.MochaOptions = {
    timeout: 100 * 1000,
    ui: "tdd",
    color: true,
    ...JSON.parse(process.env.MOCHA_TEST_OPTIONS || "{}"),
  };

  // const grep = mochaOpts.grep || (mochaOpts as Record<string, unknown>).g;
  // if (grep) {
  //   mochaOpts.grep = new RegExp(String(grep), "i");
  // }

  // mochaOpts.reporter = LoggingReporter;

  const runner = new Mocha(mochaOpts);
  const addFile = async (file: string, doImport: () => Promise<unknown>) => {
    runner.suite.emit(Mocha.Suite.constants.EVENT_FILE_PRE_REQUIRE, globalThis, file, runner);
    const m = await doImport();
    runner.suite.emit(Mocha.Suite.constants.EVENT_FILE_REQUIRE, m, file, runner);
    runner.suite.emit(Mocha.Suite.constants.EVENT_FILE_POST_REQUIRE, globalThis, file, runner);
  };

  // todo: retry failing tests https://github.com/microsoft/vscode-pwa/issues/28
  if (process.env.RETRY_TESTS) {
    runner.retries(Number(process.env.RETRY_TESTS));
  }
  const testsRoot = path.resolve(__dirname, "..");

  const rel = (f: string) => join(__dirname, `${f}.ts`);
  // Bundles all files in the current directory matching `*.test`
  // const importAll = (r: __WebpackModuleApi.RequireContext) =>
  //   r.keys().forEach(r);
  // importAll(require.context("../..", true, /\.test$/));
  // addFile("extension.test.ts");

  const files = await glob("**/**.test.js", { cwd: testsRoot });
  files.forEach((f) => runner.addFile(path.resolve(testsRoot, f)));

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
  // @ts-ignore
}
