import * as vscode from "vscode";

import { NeoJoinLanguageClient } from "../lsp";

export type Mode =
    | { type: "full" }
    | { type: "referenced" }
    | { type: "selected"; selection: vscode.Selection };
export type ModeType = Mode["type"];
const MODES: ModeType[] = ["full", "referenced", "selected"];

interface Options {
    orthogonalArrows?: boolean;
    darkMode?: boolean;
}

interface Response {
    // visualization as SVG string
    svg?: string;
    // warning message
    message?: string;
}

/**
 * Wrapper around the NeoJoin language client that provides methods for requesting visualizations.
 */
export default class VisualizationClient {
    #languageClient: NeoJoinLanguageClient;

    constructor(languageClient: NeoJoinLanguageClient) {
        this.#languageClient = languageClient;
    }

    /**
     * Returns whether the visualization client is ready to handle requests.
     */
    get isReady() {
        return this.#languageClient.isRunning;
    }

    /**
     * Returns whether the language server is still starting.
     */
    get isStarting() {
        return this.#languageClient.isStarting;
    }

    /**
     * Shows an error message that offers to restart the language server, see
     * {@link NeoJoinLanguageClient.showServerError}.
     */
    showServerError(message: string) {
        this.#languageClient.showServerError(message);
    }

    #request<T>(method: string, param?: any): Promise<T> {
        if (!this.isReady) {
            throw new Error("The language server is not running.");
        }
        return this.#languageClient.sendRequest(method, param);
    }

    /**
     * Requests a visualization for the given document.
     * @param doc open document
     * @param mode visualization mode
     * @param options options
     * @returns promise that resolves with a visualization response
     */
    getTargetModelVisualization(
        doc: vscode.TextDocument,
        mode: Mode,
        options: Options
    ): Promise<Response> {
        if (!MODES.includes(mode.type)) {
            throw new Error("Invalid mode: " + mode.type);
        }
        return this.#request<Response>("visualization/" + mode.type, {
            textDocument: this.#languageClient.getDocumentId(doc),
            selection: mode.type === "selected" ? mode.selection : undefined,
            options,
        });
    }
}
