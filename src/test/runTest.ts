import * as cp from "child_process";
import * as path from "path";

import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from "@vscode/test-electron";

async function main() {
  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");

    // The path to the extension test script
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");

    const launchArgs: string[] = [
      "/Users/gabriel.dugny/Sources/Forks/pdm-task-provider/pdm-task-provider.code-workspace",
      // "--install-extension",
      // "tamasfe.even-better-toml",
      // path.resolve(__dirname, "../.."),
      // https://github.com/microsoft/vscode/issues/84238
      "--no-sandbox",
      // https://github.com/microsoft/vscode-test/issues/221
      "--disable-gpu-sandbox",
      // https://github.com/microsoft/vscode-test/issues/120
      "--disable-updates",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-workspace-trust",
    ];
    // const launchArg= ['--no-sandbox', '--disable-updates', '--skip-welcome', '--skip-release-notes', `--extensions-dir=${extensionsDir}`, `--user-data-dir=${userDir}`, '--disable-workspace-trust']

    // Download VS Code, unzip it and run the integration test
    const vscodeExecutablePath = await downloadAndUnzipVSCode("insiders");
    const [cli, ...args] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
    cp.spawnSync(cli, [...args, "--install-extension", "tamasfe.even-better-toml"], {
      encoding: "utf-8",
      stdio: "inherit",
    });
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs,
      // version: "insiders",
    });
  } catch (err) {
    console.error("Failed to run tests");
    process.exit(1);
  }
}

main();
