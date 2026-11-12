# NeoJoin for VS Code

[![GitHub Action CI](https://github.com/vitruv-tools/NeoJoin-for-VS-Code/actions/workflows/ci.yml/badge.svg)](https://github.com/vitruv-tools/NeoJoin-for-VS-Code/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=vitruv-tools_NeoJoin-for-VS-Code&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=vitruv-tools_NeoJoin-for-VS-Code)
[![Issues](https://img.shields.io/github/issues/vitruv-tools/NeoJoin-for-VS-Code.svg)](https://github.com/vitruv-tools/NeoJoin-for-VS-Code/issues)
[![License](https://img.shields.io/github/license/vitruv-tools/NeoJoin-for-VS-Code.svg)](https://raw.githubusercontent.com/vitruv-tools/NeoJoin-for-VS-Code/main/LICENSE)

This repository contains the [VSCode](https://code.visualstudio.com/) extension for [NeoJoin](https://github.com/vitruv-tools/NeoJoin), a declarative query language for view-based model-driven software development.
The extension starts the language server of NeoJoin (built in the NeoJoin repository) and visualizes the queries.
Other repositories of the project are listed under the [neojoin topic](https://github.com/topics/neojoin) on GitHub.

## Usage

### Requirements

* [VSCode](https://code.visualstudio.com/) 1.91 or newer
* [Graphviz](https://plantuml.com/graphviz-dot) *(for the view type visualization)*
* The [PlantUML](https://plantuml.com/) jar *(for the view type visualization, see [PlantUML Jar](#plantuml-jar))*
* JRE 17+ *(for the language server; the extension uses the setting **Java Path**, else `JAVA_HOME`, else `java` from the `PATH`)*

### VSCode Extension

Provides basic IDE support (syntax highlighting, code-completion, etc.) and a side-by-side live visualization of queries. Can be installed from the `.vsix` file via **Extensions** > 3-dot menu > **Install from VSIX...**. The extension is not published to a marketplace yet; the `.vsix` file can be downloaded from the build results of the last [successful nightly builds](https://github.com/vitruv-tools/NeoJoin-for-VS-Code/actions/workflows/ci.yml?query=branch%3Amain+event%3Aschedule+is%3Asuccess).

#### PlantUML Jar

The query visualization is rendered with PlantUML, which is not part of the language server. To use the visualization:

1. Download `plantuml-<version>.jar` (not the `-mit`, `-epl`, ... variants) from the [PlantUML releases](https://github.com/plantuml/plantuml/releases). The language server is built with version 1.2026.2; other versions may work, but only this one is tested.
2. Place it anywhere on your machine, for example `~/plantuml.jar`.
3. Set the setting `neojoin.plantUmlJarPath` (shown as *Neojoin: Plant Uml Jar Path*) to the path of the file, for example `${userHome}/plantuml.jar`.
4. Restart the language server when the extension offers it after the change of the setting.

Without the jar, everything else works (syntax highlighting, code completion, **Generate View Type**), but **Show Query Visualization** shows an error with a shortcut to the setting.

#### Commands
* **Show Query Visualization** - Show a live visualization of the queries in the currently active text editor.
* **Generate View Type** - Generate the view type resulting from the queries in the currently active text editor and save it as an Ecore file next to the query file.
* **Restart Server** - Restart the language server, for example after changes to the meta-models on disk, or when it stopped or hangs while starting (changed settings offer a restart themselves). A crashed server is restarted automatically once; if it crashes again before a manual restart, the error message offers a restart. A server that is still starting after 60 seconds is reported as unresponsive, also with the option to restart it.

#### Settings
* **Meta Model Search Path** - Semicolon separated list of file URLs to search for source meta models.
* **Java Path** - Path to the `java` program for the language server, if not `bin/java` of `JAVA_HOME` or `java` from the `PATH`.
* **PlantUML Jar Path** - Path to the PlantUML jar that is needed for the visualization (see [PlantUML Jar](#plantuml-jar)).
* **Debug** - Enable debug logging.

## Repository Structure

| Directory | Content                      |
|-----------|------------------------------|
| resources | Icons of the extension       |
| src       | Source code of the extension |

## Build

### Requirements

* Node.js 20.19 or newer (+ NPM)

### VSCode Extension

* Open this repository in VSCode (top-level in a workspace or add it to another workspace)
* Run `npm install` to install dependencies
* Go to `Run and Debug` > Select launch configuration `Launch Client` > Press `Start Debugging`
    * The language server needs a few seconds to start up, so code completion / analysis will not work right at the start.
    * The extension requires that the `.jar` file of the language server has been generated.
    * Debugging starts the language server from `../NeoJoin/frontend/ide/target/tools.vitruv.neojoin.frontend.ide.jar` (the NeoJoin repository placed next to this repository) if that file exists. Otherwise it uses `tools.vitruv.neojoin.frontend.ide.jar` in the root of this repository, which `scripts/download-ide-jar.sh` downloads.
    * The visualization needs a PlantUML jar also while debugging: set `neojoin.plantUmlJarPath` (see [PlantUML Jar](#plantuml-jar)) in your user settings (the extension development host uses them too, unless the launch configuration sets another user data directory).
    * If you cannot find the launch configuration `Launch Client`, ensure that you have opened VSCode with this repository as your workspace.
* If you get the error message `Activating extension 'vitruv-tools.neojoin' failed: Cannot find module` check the build task for potential problems: Bottom Panel > Select tab `Terminal` > Select task `watch` (on the right)

* for manual build do the following:
    ```bash
    npm clean-install                                                               # only required the first time
    scripts/download-ide-jar.sh                                                     # provide lsp for the extension: latest NeoJoin snapshot from Maven Central
    # or: cp ../NeoJoin/frontend/ide/target/tools.vitruv.neojoin.frontend.ide.jar .  # your own build (assumes that the NeoJoin repository lies beside this one)
    npm run package                                                                 # creates neojoin.vsix
    ```

GitHub Actions builds the extension on Linux, macOS and Windows with the latest language server snapshot; nothing is published automatically.
We use [SonarQube](https://sonarcloud.io/project/overview?id=vitruv-tools_NeoJoin-for-VS-Code) to analyze the sources.
Crashes, restarts and hanging servers are tested manually, see [docs/server-lifecycle-tests.md](docs/server-lifecycle-tests.md).

### Structure

* `src/extension.ts` wires the parts together and registers **Restart Server** and the restart offer after setting changes.
* `src/lsp/` is the only part that handles the language client: it starts the language server process, restarts it after crashes, stops it in any state and reports server failures (`NeoJoinLanguageClient`). The rest of the extension uses its methods (`start`, `restart`, `isRunning`, `isStarting`, `sendRequest`, `showServerError`); only `src/lsp/` uses `vscode-languageclient` and the server process.
* Editor support has no code of its own: syntax highlighting and brackets come from `src/language/` (declared in `package.json`), and code completion and error markers come from the language server through `vscode-languageclient`.
* `src/visualization/` renders the queries in a webview panel; it talks to the server only through `VisualizationClient` (`request.ts`).
* `src/viewtype.ts` provides **Generate View Type**.

### Code Style

The formatting is checked with Prettier (`npm run format:check`; `npm run format` rewrites the files) and the code with ESLint (`npm run lint`).

Commits that only change the formatting of the code are listed in `.git-blame-ignore-revs`, so that `git blame` skips them. GitHub applies the file automatically; locally, run `git config blame.ignoreRevsFile .git-blame-ignore-revs` once.

## Used Technology

* [VSCode Extension API](https://code.visualstudio.com/api) and [TypeScript](https://www.typescriptlang.org/)
* [esbuild](https://esbuild.github.io/) for bundling
* [vscode-languageclient](https://github.com/microsoft/vscode-languageserver-node) to communicate with the language server
