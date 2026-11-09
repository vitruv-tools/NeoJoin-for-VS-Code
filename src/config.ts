import { existsSync } from "node:fs";

import * as vscode from "vscode";
import { expandVariables } from "./expand";

class Config {
    #get<T>(key: string, defaultValue: T): T {
        return vscode.workspace
            .getConfiguration("neojoin")
            .get<T>(key, defaultValue);
    }

    /**
     * Path to search for available meta models that can be imported in queries.
     */
    get metaModelSearchPath() {
        return expandVariables(
            this.#get("metaModelSearchPath", "${workspaceFolder}")
        );
    }

    /**
     * Names of directories that the server does not search for queries.
     */
    get excludedDirectories() {
        return this.#get<string[]>("excludedDirectories", [
            "target",
            "bin",
            "build",
            "node_modules",
            ".git",
        ]);
    }

    /**
     * Path to the PlantUML jar that is put on the class path of the language server. Empty if not configured.
     */
    get plantUmlJarPath() {
        return expandVariables(this.#get("plantUmlJarPath", "")).trim();
    }

    /**
     * Path to the configured PlantUML jar, or `undefined` if it is not configured or the file does not exist.
     */
    get plantUmlJar(): string | undefined {
        const jarPath = this.plantUmlJarPath;
        return jarPath !== "" && existsSync(jarPath) ? jarPath : undefined;
    }

    /**
     * Whether debug mode is enabled.
     */
    get debug() {
        return this.#get("debug", false);
    }
}

const instance = new Config();
export default instance;
