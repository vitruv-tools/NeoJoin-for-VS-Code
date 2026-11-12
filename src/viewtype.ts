import * as vscode from "vscode";
import { ExtensionContext } from "vscode";

import { NeoJoinLanguageClient } from "./lsp";

/**
 * Activates the view type generation: the command that saves the view type of the query in the active editor as an
 * Ecore file next to it.
 */
export function activate(
    context: ExtensionContext,
    languageClient: NeoJoinLanguageClient
) {
    context.subscriptions.push(
        vscode.commands.registerCommand("neojoin.generate-viewtype", () =>
            generateViewType(languageClient)
        )
    );
}

function generateViewType(languageClient: NeoJoinLanguageClient) {
    if (languageClient.isStarting) {
        vscode.window.showErrorMessage(
            "NeoJoin: The language server is still starting."
        );
        return;
    }
    if (!languageClient.isRunning) {
        languageClient.showServerError("The language server is not running.");
        return;
    }

    const currentEditor = vscode.window.activeTextEditor;
    if (!currentEditor) {
        vscode.window.showErrorMessage("NeoJoin: No active editor.");
        return;
    }

    if (currentEditor.document.languageId !== "neojoin") {
        vscode.window.showErrorMessage("NeoJoin: Not a NeoJoin query file.");
        return;
    }

    languageClient
        .sendRequest<void>("viewtype", {
            textDocument: languageClient.getDocumentId(currentEditor.document),
        })
        .catch((reason) => {
            vscode.window.showErrorMessage("NeoJoin: " + reason.message);
        });
}
