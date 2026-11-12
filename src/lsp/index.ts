import { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, resolve as resolvePath } from "node:path";
import * as vscode from "vscode";
import { ExtensionContext } from "vscode";
import {
    CloseAction,
    ErrorAction,
    ErrorCodes,
    ErrorHandler,
    LanguageClient,
    LanguageClientOptions,
    ResponseError,
    State,
    TextDocumentIdentifier,
} from "vscode-languageclient/node";

import config from "../config";
import { getErrorMessage } from "../utils";
import { killServer, spawnServer, terminateServer } from "./process";

/**
 * Creates the language client. The server is not started yet, see {@link NeoJoinLanguageClient.start}.
 */
export function createLanguageClient(context: ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel(
        "NeoJoin Language Server",
        { log: true }
    );
    context.subscriptions.push(outputChannel);
    const client = new NeoJoinLanguageClient(
        context.extensionPath,
        outputChannel
    );
    context.subscriptions.push(client);
    return client;
}

function debugLogFilePath(): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
        return resolvePath(workspaceFolder.uri.fsPath, "neojoin-debug.log");
    } else {
        return resolvePath(homedir(), "neojoin-debug.log");
    }
}

const EXEC_OPTIONS = (() => {
    if (DEV) {
        return {
            // the first existing jar is used: a local NeoJoin build next to this repository, or the snapshot
            // downloaded with scripts/download-ide-jar.sh
            jarFiles: [
                "../NeoJoin/frontend/ide/target/tools.vitruv.neojoin.frontend.ide.jar",
                "tools.vitruv.neojoin.frontend.ide.jar",
            ],
            jvmOpts: [
                "-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,quiet=y,address=*:8000", // set suspend=y to wait for debugger on launch
            ],
            programOpts: ["--trace", "--log", "neojoin-debug.log"], // log is placed in /path/to/NeoJoin-for-VS-Code/neojoin-debug.log
        };
    } else {
        return {
            jarFiles: ["tools.vitruv.neojoin.frontend.ide.jar"],
            jvmOpts: [],
            programOpts: config.debug
                ? ["--trace", "--log", debugLogFilePath()]
                : [],
        };
    }
})();

const MAIN_CLASS = "tools.vitruv.neojoin.ide.Main";

const CLIENT_OPTIONS: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "neojoin" }],
    // a failed initialization rejects start(), and its caller reports the failure
    initializationFailedHandler: () => false,
};

const RESTART_COMMAND = "neojoin.restart";

/**
 * After this time, a server that is still starting is reported as unresponsive, with the option to restart it. It is
 * not restarted automatically: loading large meta-models can take long, and a debugger may hold the server.
 */
const UNRESPONSIVE_START_WARNING_MS = 60 * 1000;

/**
 * How long to wait for a state change of the language client or for the exit of a killed server process.
 */
const STATE_CHANGE_TIMEOUT_MS = 10 * 1000;

/**
 * Time a stopped server gets to exit by itself before it is killed. It has to exit before a new server starts:
 * otherwise both would run (in development mode, the old one would still hold the debug port).
 */
const SERVER_EXIT_GRACE_MS = 2000;

/**
 * Language client that only logs the errors for which {@link LanguageClient} forces a notification: start failures,
 * crashes and connection errors. {@link NeoJoinLanguageClient} reports these itself with a single message that offers
 * a restart; otherwise each failure would show several notifications without one.
 */
class QuietLanguageClient extends LanguageClient {
    override error(
        message: string,
        data?: any,
        showNotification?: boolean | "force"
    ) {
        super.error(
            message,
            data,
            showNotification === "force" ? false : showNotification
        );
    }
}

/**
 * Waits until the state of the client is accepted.
 *
 * @returns whether the state was accepted before the timeout
 */
function waitForState(
    client: LanguageClient,
    accept: (state: State) => boolean,
    timeoutMs: number
): Promise<boolean> {
    if (accept(client.state)) {
        return Promise.resolve(true);
    }
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            listener.dispose();
            resolve(false);
        }, timeoutMs);
        const listener = client.onDidChangeState(({ newState }) => {
            if (accept(newState)) {
                clearTimeout(timeout);
                listener.dispose();
                resolve(true);
            }
        });
    });
}

/**
 * Whether the request failed because the connection to the server closed, for example because the server crashed.
 */
function isConnectionLost(error: unknown) {
    return (
        error instanceof ResponseError &&
        (error.code === ErrorCodes.PendingResponseRejected ||
            error.code === ErrorCodes.ConnectionInactive)
    );
}

/**
 * Wrapper around a {@link LanguageClient} that allows restarting after startup failures and crashes. A crashed server
 * is restarted automatically once (see {@link onDidCrash}); failures are reported with a single message that offers a
 * restart.
 */
export class NeoJoinLanguageClient {
    /**
     * Directory where the extension is located.
     */
    #extensionDir: string;

    /**
     * Wrapped language client instance.
     */
    #client: LanguageClient | null = null;

    /**
     * Output channel shared by all client instances, so that the log of a crashed server survives a restart.
     */
    #outputChannel: vscode.LogOutputChannel;

    /**
     * Clients stopped on request. Their server exit is neither a crash nor a start failure, and they must not start a
     * server process anymore.
     */
    #stoppedClients = new WeakSet<LanguageClient>();

    /**
     * Server processes of the clients. The wrapper starts them itself, so that it can terminate them in any state:
     * the language client only terminates a server that it can stop, and not one that is still starting.
     */
    #serverProcesses = new WeakMap<LanguageClient, ChildProcess>();

    /**
     * Whether the next crash of a running server may restart it automatically. Only one automatic restart is allowed
     * until the next manual restart, so that a server that crashes repeatedly does not restart endlessly.
     */
    #automaticRestartAllowed = true;

    #onDidCrash = new vscode.EventEmitter<void>();

    /**
     * Resolves when the stop phase of the last restart is done, see {@link restart}.
     */
    #restartLock: Promise<void> = Promise.resolve();

    /**
     * Fires when a running server crashed and should be restarted automatically.
     */
    readonly onDidCrash = this.#onDidCrash.event;

    constructor(extensionDir: string, outputChannel: vscode.LogOutputChannel) {
        this.#extensionDir = extensionDir;
        this.#outputChannel = outputChannel;
    }

    /**
     * Builds the class path of the language server. The server jar does not contain PlantUML, so the configured
     * PlantUML jar (needed for the visualization) is appended. Without it, the server still starts, but visualization
     * requests fail.
     */
    #buildClassPath() {
        const candidates = EXEC_OPTIONS.jarFiles.map((file) =>
            resolvePath(this.#extensionDir, file)
        );
        const jars = [
            candidates.find((file) => existsSync(file)) ?? candidates[0],
        ];
        const plantUmlJar = config.plantUmlJar;
        if (plantUmlJar !== undefined) {
            jars.push(plantUmlJar);
        }
        return jars.join(delimiter);
    }

    /**
     * Builds the command line of the language server.
     */
    #buildServerCommand() {
        return {
            command: "java",
            args: [
                ...EXEC_OPTIONS.jvmOpts,
                "-cp",
                this.#buildClassPath(),
                MAIN_CLASS,
                "--meta-model-path",
                config.metaModelSearchPath,
                ...(config.excludedDirectories.length > 0
                    ? [
                          "--excluded-directories",
                          config.excludedDirectories.join(";"),
                      ]
                    : []),
                ...EXEC_OPTIONS.programOpts,
            ],
        };
    }

    /**
     * Starts the server process of a client, unless the client was stopped in the meantime.
     */
    async #startServerProcess(client: LanguageClient) {
        const stoppedError = () =>
            new Error("The language server was stopped before it started.");
        if (this.#stoppedClients.has(client)) {
            throw stoppedError();
        }
        const { command, args } = this.#buildServerCommand();
        let server: ChildProcess;
        try {
            server = await spawnServer(
                command,
                args,
                this.#extensionDir,
                this.#outputChannel
            );
        } catch (error) {
            const hint =
                (error as NodeJS.ErrnoException).code === "ENOENT"
                    ? " Install Java 17 or later and make sure that it is on the PATH."
                    : "";
            throw new Error(
                `Java could not be started ('${command}'): ${getErrorMessage(error)}.${hint}`,
                { cause: error }
            );
        }
        this.#serverProcesses.set(client, server);
        if (this.#stoppedClients.has(client)) {
            await terminateServer(server, 0, STATE_CHANGE_TIMEOUT_MS);
            throw stoppedError();
        }
        return server;
    }

    /**
     * Whether the server is running and can answer requests.
     */
    get isRunning() {
        return this.#client?.state === State.Running;
    }

    /**
     * Whether the server is starting.
     */
    get isStarting() {
        return this.#client?.state === State.Starting;
    }

    #createClient() {
        const client: LanguageClient = new QuietLanguageClient(
            "neojoin-lsp",
            "NeoJoin Language Server",
            () => this.#startServerProcess(client),
            {
                ...CLIENT_OPTIONS,
                outputChannel: this.#outputChannel,
                errorHandler: this.#createErrorHandler(() => client),
            }
        );
        // The language client also stops by itself, for example after repeated connection errors or a failed
        // initialization. It does not terminate a server process it did not start, so a server that is still alive
        // would keep running.
        client.onDidChangeState(({ newState }) => {
            if (newState === State.Stopped || newState === State.StartFailed) {
                this.#terminateServerProcess(
                    client,
                    SERVER_EXIT_GRACE_MS
                ).catch((error) =>
                    this.#outputChannel.error(getErrorMessage(error))
                );
            }
        });
        return client;
    }

    /**
     * Creates the error handler of a client. The language client must not restart the server itself: a failed
     * automatic restart would only be logged (see {@link QuietLanguageClient}).
     */
    #createErrorHandler(client: () => LanguageClient): ErrorHandler {
        // every further error after the limit asks again for a shutdown, but it is reported only once
        let shutdownReported = false;
        return {
            error: (_error, _message, count) => {
                if (count !== undefined && count <= 3) {
                    return { action: ErrorAction.Continue };
                }
                if (!shutdownReported) {
                    shutdownReported = true;
                    this.showServerError(
                        "The connection to the language server failed repeatedly, so the server was stopped."
                    );
                }
                return { action: ErrorAction.Shutdown, handled: true };
            },
            closed: () => {
                if (
                    this.#stoppedClients.has(client()) ||
                    client() !== this.#client
                ) {
                    return { action: CloseAction.DoNotRestart, handled: true };
                }
                if (client().state !== State.Running) {
                    // the server stopped during its start (start() rejects, and its caller reports the failure), or
                    // after a failed start, when its process is terminated
                    return {
                        action: CloseAction.DoNotRestart,
                        message:
                            "The language server stopped during its start.",
                        handled: true,
                    };
                }
                // restart once the language client has finished stopping
                void waitForState(
                    client(),
                    (state) => state === State.Stopped,
                    STATE_CHANGE_TIMEOUT_MS
                ).then(() => this.#handleCrash());
                return {
                    action: CloseAction.DoNotRestart,
                    message: "The language server crashed.",
                    handled: true,
                };
            },
        };
    }

    #handleCrash() {
        if (this.#automaticRestartAllowed) {
            this.#automaticRestartAllowed = false;
            this.#onDidCrash.fire();
        } else {
            this.showServerError(
                "The language server crashed again after an automatic restart. It is not restarted automatically until it is restarted manually."
            );
        }
    }

    /**
     * Allows one automatic restart after a crash again. Called for manual restarts.
     */
    public allowAutomaticRestart() {
        this.#automaticRestartAllowed = true;
    }

    /**
     * Reports a server that is still starting after {@link UNRESPONSIVE_START_WARNING_MS}, with the option to restart
     * it.
     */
    #showUnresponsiveStartWarning(client: LanguageClient) {
        this.#showWithServerActions(
            vscode.window.showWarningMessage,
            `The language server is unresponsive: it is still starting after ${UNRESPONSIVE_START_WARNING_MS / 1000} seconds. Loading large meta-models can take this long.`,
            // the server may have finished starting while the message was shown
            () => client !== this.#client || client.state !== State.Running
        );
    }

    /**
     * Shows an error message that offers to restart the server or to show its output.
     */
    public showServerError(message: string) {
        this.#showWithServerActions(
            vscode.window.showErrorMessage,
            message,
            () => true
        );
    }

    /**
     * Shows a message with the actions "Restart Server" and "Show Output".
     *
     * @param isRestartNeeded checked when the user chooses the restart
     */
    #showWithServerActions(
        show: typeof vscode.window.showErrorMessage,
        message: string,
        isRestartNeeded: () => boolean
    ) {
        void show(`NeoJoin: ${message}`, "Restart Server", "Show Output").then(
            (choice) => {
                if (choice === "Restart Server" && isRestartNeeded()) {
                    void vscode.commands.executeCommand(RESTART_COMMAND);
                } else if (choice === "Show Output") {
                    this.#outputChannel.show(true);
                }
            }
        );
    }

    /**
     * Starts the server with the current configuration. Resolves without starting it if {@link #stop} is called before
     * the start finishes.
     */
    public async start() {
        if (this.#client === null) {
            this.#client = this.#createClient();
        }

        const client = this.#client;
        const unresponsiveWarning = setTimeout(
            () => this.#showUnresponsiveStartWarning(client),
            UNRESPONSIVE_START_WARNING_MS
        );
        try {
            await client.start();
        } catch (error) {
            if (this.#stoppedClients.has(client) || client !== this.#client) {
                return;
            }
            if (isConnectionLost(error)) {
                throw new Error(
                    "The language server stopped during its start. See the output for details.",
                    { cause: error }
                );
            }
            throw error;
        } finally {
            clearTimeout(unresponsiveWarning);
        }
    }

    /**
     * Stops the server, also while it is starting, and drops the client, so that the next start creates a new one.
     */
    async #stop() {
        const client = this.#client;
        if (client === null) {
            return;
        }

        this.#stoppedClients.add(client);
        if (client.state === State.Starting) {
            await this.#stopStartingClient(client);
        } else if (client.state === State.Running) {
            await this.#stopRunningClient(client);
        }
        this.#client = null;
    }

    /**
     * {@link LanguageClient.stop} rejects if the server does not answer the shutdown request in time (for example, a busy
     * server) or if it exited in the meantime. The client is stopped anyway; a server that is still alive is killed.
     */
    async #stopRunningClient(client: LanguageClient) {
        try {
            await client.stop();
        } catch (error) {
            if (client.state !== State.Stopped) {
                throw error;
            }
        }
        await this.#terminateServerProcess(client, SERVER_EXIT_GRACE_MS);
    }

    /**
     * {@link LanguageClient.stop} rejects a client that is still starting, for example one whose server hangs in its
     * initialization. Killing the server process closes the connection, which ends the start; a process that is not
     * started yet is not started anymore (see {@link #startServerProcess}).
     */
    async #stopStartingClient(client: LanguageClient) {
        await this.#terminateServerProcess(client, 0);
        const stopped = await waitForState(
            client,
            (state) => state !== State.Starting,
            STATE_CHANGE_TIMEOUT_MS
        );
        if (!stopped) {
            throw new Error("The language server did not stop.");
        }
    }

    async #terminateServerProcess(client: LanguageClient, graceMs: number) {
        const server = this.#serverProcesses.get(client);
        if (server !== undefined) {
            await terminateServer(server, graceMs, STATE_CHANGE_TIMEOUT_MS);
        }
    }

    public dispose() {
        this.#onDidCrash.dispose();
        const client = this.#client;
        if (client === null) {
            return;
        }
        this.#stoppedClients.add(client);
        if (client.state !== State.Running) {
            // a starting server would otherwise outlive VS Code until it reads the end of its input
            const server = this.#serverProcesses.get(client);
            if (server !== undefined) {
                killServer(server);
            }
        }
        // stopping fails for a client that is not running; there is nothing left to report on deactivation
        return client.dispose().catch(() => {});
    }

    /**
     * Restarts the server with the current configuration. Concurrent restarts run their stop phases one after the other:
     * otherwise a restart could recreate the client while another one stops it. A restart that arrives while another
     * one is starting the server stops that server (see {@link #stop}).
     *
     * @param onStarting called when the server is started
     */
    public async restart(onStarting: () => void) {
        const previousRestart = this.#restartLock;
        let releaseLock!: () => void;
        this.#restartLock = new Promise((resolve) => (releaseLock = resolve));
        let started: Promise<void>;
        try {
            await previousRestart;
            await this.#stop();
            onStarting();
            // start() creates the client synchronously, so the next restart sees and stops it
            started = this.start();
        } finally {
            releaseLock();
        }
        await started;
    }

    public async sendRequest<T>(method: string, param?: any): Promise<T> {
        if (this.#client === null) {
            throw new Error("Language client not started");
        }
        try {
            return await this.#client.sendRequest<T>(method, param);
        } catch (error) {
            if (isConnectionLost(error)) {
                throw new Error(
                    "The language server stopped before it answered the request.",
                    { cause: error }
                );
            }
            throw error;
        }
    }

    public getDocumentId(doc: vscode.TextDocument): TextDocumentIdentifier {
        if (this.#client === null) {
            throw new Error("Language client not started");
        }

        return this.#client.code2ProtocolConverter.asTextDocumentIdentifier(
            doc
        );
    }
}
