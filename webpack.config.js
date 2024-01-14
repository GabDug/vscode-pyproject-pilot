// From https://github.com/prettier/prettier-vscode/blob/main/webpack.config.js
// Licensed under MIT - Copyright (c) 2017 Esben Petersen

/* eslint-disable @typescript-eslint/no-var-requires */
"use strict";

// eslint-disable-next-line no-undef
const webpack = require("webpack");
// eslint-disable-next-line no-undef
const path = require("path");
// eslint-disable-next-line no-undef
const extensionPackage = require("./package.json");

/**@type {import('webpack').Configuration}*/
const config = {
  target: "node",
  entry: "./src/extension.ts",
  output: {
    // eslint-disable-next-line no-undef
    path: path.resolve(__dirname, "dist"),
    filename: "extension.js",
    libraryTarget: "commonjs2",
    /* cspell: disable-next-line */
    devtoolModuleFilenameTemplate: "../[resource-path]",
  },
  plugins: [
    new webpack.EnvironmentPlugin({
      EXTENSION_NAME: `${extensionPackage.publisher}.${extensionPackage.name}`,
      EXTENSION_VERSION: extensionPackage.version,
    }),
    // new CopyPlugin({
    //   patterns: [{ from: "src/worker", to: "worker" }],
    // }),
  ],
  /* cspell: disable-next-line */
  devtool: "source-map",
  externals: {
    vscode: "commonjs vscode",
    prettier: "commonjs prettier",
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader",
          },
        ],
      },
      {
        // vscode-nls-dev loader:
        // * rewrite nls-calls
        // loader: "vscode-nls-dev/lib/webpack-loader",
        // options: {
        // eslint-disable-next-line no-undef
        //   base: path.join(__dirname, "src"),
        // },
      },
    ],
  },
};

// eslint-disable-next-line no-undef
module.exports = [config];
