import { existsSync } from "node:fs";
import { join } from "node:path";

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
     * Configured path to the `java` program. Empty if not configured.
     */
    get javaPath() {
        return expandVariables(this.#get("javaPath", "")).trim();
    }

    /**
     * Command that starts Java for the language server: the configured path, else `bin/java` of `JAVA_HOME`, else `java`
     * from the `PATH`.
     */
    get javaCommand() {
        if (this.javaPath !== "") {
            return this.javaPath;
        }
        const javaHome = process.env.JAVA_HOME?.trim();
        if (javaHome) {
            return join(
                javaHome,
                "bin",
                process.platform === "win32" ? "java.exe" : "java"
            );
        }
        return "java";
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
