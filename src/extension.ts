import * as vscode from "vscode";
import { ExtensionContext } from "vscode";

import * as lsp from "./lsp";
import { delay, getErrorMessage } from "./utils";
import * as viewType from "./viewtype";
import * as visualization from "./visualization";
import VisualizationManager from "./visualization/manager";

/**
 * Restarts the language server with a progress indicator and reports a failure.
 */
function restartServer(
    languageClient: lsp.NeoJoinLanguageClient,
    visualizationManager: VisualizationManager
) {
    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Window,
            title: "Restarting the NeoJoin language server",
            cancellable: false,
        },
        async (progress, _) => {
            try {
                progress.report({
                    increment: 0, // 0%
                    message: "Stopping ...",
                });
                await languageClient.restart(() =>
                    progress.report({
                        increment: 50, // 50%
                        message: "Starting ...",
                    })
                );
                visualizationManager.updateAll(true);
                progress.report({ increment: 49, message: "Done" }); // 99%
                await delay(1000);
            } catch (e) {
                languageClient.showServerError(
                    "Failed to restart the language server: " +
                        getErrorMessage(e)
                );
            }
        }
    );
}

function registerRestartCommand(
    context: ExtensionContext,
    languageClient: lsp.NeoJoinLanguageClient,
    visualizationManager: VisualizationManager
) {
    context.subscriptions.push(
        vscode.commands.registerCommand("neojoin.restart", () => {
            languageClient.allowAutomaticRestart();
            return restartServer(languageClient, visualizationManager);
        })
    );
}

/**
 * The language server reads the settings only when it starts, so a change of them offers a restart.
 */
function offerRestartOnSettingsChange(context: ExtensionContext) {
    // several changes in a row (for example while typing a path) offer the restart only once
    let offerShown = false;
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (!event.affectsConfiguration("neojoin") || offerShown) {
                return;
            }
            offerShown = true;
            void vscode.window
                .showInformationMessage(
                    "NeoJoin: The settings changed. Restart the language server to apply them.",
                    "Restart Server"
                )
                .then((choice) => {
                    offerShown = false;
                    if (choice === "Restart Server") {
                        void vscode.commands.executeCommand("neojoin.restart");
                    }
                });
        })
    );
}

export async function activate(context: ExtensionContext) {
    try {
        const languageClient = lsp.createLanguageClient(context);
        try {
            await languageClient.start();
        } catch (e) {
            // the commands are still registered, so that the server can be restarted
            languageClient.showServerError(
                "Failed to start the language server: " + getErrorMessage(e)
            );
        }
        const visualizationManager = await visualization.activate(
            context,
            languageClient
        );
        viewType.activate(context, languageClient);
        registerRestartCommand(context, languageClient, visualizationManager);
        context.subscriptions.push(
            languageClient.onDidCrash(() =>
                restartServer(languageClient, visualizationManager)
            )
        );
        offerRestartOnSettingsChange(context);

        if (DEV) {
            vscode.window.showInformationMessage(
                "NeoJoin extension initialized in development mode."
            );
        }
    } catch (e) {
        vscode.window.showErrorMessage(
            "Failed to initialize NeoJoin extension: " + getErrorMessage(e)
        );
    }
}

export function deactivate() {
    // everything registered via `context.subscriptions.push(...)` is disposed automatically
}
