import { ChildProcess, execFile, spawn } from "node:child_process";
import * as vscode from "vscode";

import { delay } from "../utils";

const isWindows = process.platform === "win32";

/**
 * Starts a server process and resolves once it runs. Rejects if it cannot be started, for example because the command
 * is not found.
 *
 * On Linux and macOS, the server gets its own process group, so that {@link terminateServer} also reaches the processes
 * that the server starts (Graphviz for the visualization), and so that they can be terminated after the server exited.
 *
 * @param log receives the exit of the process (the language client does not log it for processes it did not start)
 */
export async function spawnServer(
    command: string,
    args: string[],
    cwd: string,
    log: vscode.LogOutputChannel
): Promise<ChildProcess> {
    const server = spawn(command, args, { cwd, detached: !isWindows });
    // without a listener, an error event would crash the extension host
    server.on("error", (error) =>
        log.error(`Server process error: ${error.message}`)
    );
    server.on("exit", (code, signal) => {
        if (code === 0) {
            log.info("Server process exited successfully");
        } else if (code !== null) {
            log.error(`Server process exited with code ${code}.`);
        } else {
            log.error(`Server process exited with signal ${signal}.`);
        }
        // the server terminates its child processes when it exits normally, but not when it crashes
        killProcessGroup(server);
    });
    await new Promise<void>((resolve, reject) => {
        server.once("spawn", resolve);
        server.once("error", reject);
    });
    return server;
}

function hasExited(server: ChildProcess) {
    return server.exitCode !== null || server.signalCode !== null;
}

/**
 * Kills the process group of the server (Linux and macOS), which also contains the processes it started.
 */
function killProcessGroup(server: ChildProcess) {
    if (isWindows || server.pid === undefined) {
        return;
    }
    try {
        process.kill(-server.pid, "SIGKILL");
    } catch {
        // the group has no processes left
    }
}

/**
 * Kills the server and the processes it started.
 */
export async function killServer(server: ChildProcess) {
    if (!isWindows) {
        killProcessGroup(server);
    } else if (server.pid !== undefined) {
        // kills the process tree; a failure (for example, the process exited in the meantime) is handled by the caller
        await new Promise((resolve) =>
            execFile(
                "taskkill",
                ["/T", "/F", "/PID", String(server.pid)],
                resolve
            )
        );
    }
}

/**
 * Waits until the server has exited. A server that has not exited after the grace period is killed together with the
 * processes it started.
 *
 * @param graceMs time the server gets to exit by itself, for example after the exit notification of the language
 *     server protocol; 0 kills it right away
 * @param timeoutMs time to wait for the exit after killing the server
 * @throws if the server did not exit in time
 */
export async function terminateServer(
    server: ChildProcess,
    graceMs: number,
    timeoutMs: number
) {
    if (hasExited(server)) {
        return;
    }
    const exited = new Promise<boolean>((resolve) =>
        server.once("exit", () => resolve(true))
    );
    const timeout = (ms: number) => delay(ms).then(() => false);
    if (graceMs > 0 && (await Promise.race([exited, timeout(graceMs)]))) {
        return;
    }
    await killServer(server);
    if (!(await Promise.race([exited, timeout(timeoutMs)]))) {
        throw new Error("The language server process did not exit.");
    }
}
