# NeoJoin for VS Code

[![Issues](https://img.shields.io/github/issues/vitruv-tools/NeoJoin-for-VS-Code.svg)](https://github.com/vitruv-tools/NeoJoin-for-VS-Code/issues)
[![License](https://img.shields.io/github/license/vitruv-tools/NeoJoin-for-VS-Code.svg)](https://raw.githubusercontent.com/vitruv-tools/NeoJoin-for-VS-Code/main/LICENSE)

This repository contains the [VSCode](https://code.visualstudio.com/) extension for [NeoJoin](https://github.com/vitruv-tools/NeoJoin), a declarative query language for view-based model-driven software development.
The extension starts the language server of NeoJoin (built in the NeoJoin repository) and visualizes the queries.

## Usage

### Requirements

* [VSCode](https://code.visualstudio.com/)
* [Graphviz](https://plantuml.com/graphviz-dot) *(for the view type visualization)*
* JRE 17+ *(for the language server)*

### VSCode Extension

Provides basic IDE support (syntax highlighting, code-completion, etc.) and a side-by-side live visualization of queries. Can be installed from the `.vsix` file via **Extensions** > 3-dot menu > **Install from VSIX...**.

#### Commands
* **Show Query Visualization** - Show a live visualization of the queries in the currently active text editor.
* **Generate View Type** - Generate the view type resulting from the queries in the currently active text editor and save it as an Ecore file next to the query file.
* **Restart Server** - Restart the language server after configuration changes.

#### Settings
* **Meta Model Search Path** - Semicolon separated list of file URLs to search for source meta models.
* **Debug** - Enable debug logging.

## Repository Structure

| Directory | Content                      |
|-----------|------------------------------|
| resources | Icons of the extension       |
| src       | Source code of the extension |

## Build

### Requirements

* Node.js 20 (+ NPM)
* JDK 21+ *(to build the language server in the [NeoJoin](https://github.com/vitruv-tools/NeoJoin) repository)*

### VSCode Extension

* Open this repository in VSCode (top-level in a workspace or add it to another workspace)
* Run `npm install` to install dependencies
* Go to `Run and Debug` > Select launch configuration `Launch Client` > Press `Start Debugging`
    * The language server needs a few seconds to start up, so code completion / analysis will not work right at the start.
    * The extension requires that the `.jar` file of the language server has been generated.
    * Debugging assumes that the NeoJoin repository is placed next to this repository (`../NeoJoin`), because the extension starts the language server from `../NeoJoin/frontend/ide/target/tools.vitruv.neojoin.frontend.ide.jar`.
    * If you cannot find the launch configuration `Launch Client`, ensure that you have opened VSCode with this repository as your workspace.
* If you get the error message `Activating extension 'vitruv-tools.neojoin' failed: Cannot find module` check the build task for potential problems: Bottom Panel > Select tab `Terminal` > Select task `watch` (on the right)

* for manual build do the following:
    ```bash
    npm clean-install                                                               # only required the first time
    cp ../NeoJoin/frontend/ide/target/tools.vitruv.neojoin.frontend.ide.jar .  # provide lsp for the extension (this assumes that the NeoJoin repository lies beside this one)
    npx @vscode/vsce package
    ```

## Used Technology

* [VSCode Extension API](https://code.visualstudio.com/api) and [TypeScript](https://www.typescriptlang.org/)
* [esbuild](https://esbuild.github.io/) for bundling
* [vscode-languageclient](https://github.com/microsoft/vscode-languageserver-node) to communicate with the language server
