# Manual Tests of the Language Server Lifecycle

The extension starts, restarts and stops the language server, also when the server crashes, hangs or stops answering, and it must not leave server or Graphviz processes behind.
There are no automated tests for this.
Run the scenarios below by hand after changes to `src/lsp/` or to the restart handling in `src/extension.ts`.

## Preparation

### A Language Server That Fails on Purpose

The scenarios need a language server that crashes, hangs or misbehaves on request.
Make the following temporary changes in your local checkout of the NeoJoin repository (do not commit them, revert them when you are done).
The server checks for marker files in a directory; create an empty directory for them, for example `~/neojoin-markers`, and write its absolute path instead of `<MARKERS>`.

In `frontend/ide/src/main/java/tools/vitruv/neojoin/ide/NeoJoinIdeServer.java`, add this method (imports: `java.nio.file.Files`, `java.nio.file.Path`, `java.io.IOException`, `org.eclipse.lsp4j.InitializeParams`, `org.eclipse.lsp4j.InitializeResult`):

```java
@Override
public CompletableFuture<InitializeResult> initialize(InitializeParams params) {
    // the server crashes during its start
    if (Files.exists(Path.of("<MARKERS>/crash-on-start"))) {
        Runtime.getRuntime().halt(2);
    }
    // the server hangs during its start (only once: the marker is deleted)
    try {
        if (Files.deleteIfExists(Path.of("<MARKERS>/hang-on-start"))) {
            while (true) { Thread.sleep(1000); }
        }
    } catch (IOException | InterruptedException e) { throw new RuntimeException(e); }
    // the server answers the initialization with an error and keeps running
    if (Files.exists(Path.of("<MARKERS>/init-error"))) {
        return CompletableFuture.failedFuture(new RuntimeException("initialize failed on purpose"));
    }
    return super.initialize(params);
}
```

At the start of `generateViewType` in the same class (runs for the command **NeoJoin: Generate View Type**; imports: `java.io.FileDescriptor`, `java.io.FileOutputStream`):

```java
try {
    // the server writes junk to its protocol output (connection errors)
    if (Files.exists(Path.of("<MARKERS>/garbage"))) {
        var out = new FileOutputStream(FileDescriptor.out);
        for (int i = 0; i < 6; i++) {
            out.write("garbage without header\r\n\r\n".getBytes());
        }
        out.flush();
        return CompletableFuture.completedFuture(null);
    }
    // the server blocks and does not answer the shutdown request (only once: the marker is deleted)
    if (Files.deleteIfExists(Path.of("<MARKERS>/busy"))) {
        while (true) { Thread.sleep(1000); }
    }
} catch (IOException | InterruptedException e) { throw new RuntimeException(e); }
// without a marker, the server crashes
Runtime.getRuntime().halt(1);
```

Build the server with `./mvnw package -DskipTests -pl frontend/ide -am`.
With the NeoJoin repository next to this one, the launch configuration **Launch Client** uses the built jar.

Create and delete markers in a terminal, for example `touch ~/neojoin-markers/crash-on-start` and `rm ~/neojoin-markers/crash-on-start`.

### A Graphviz That Hangs

For the Graphviz scenarios, save this script as `fake-dot` and make it executable (`chmod +x fake-dot`, Linux and macOS).
It answers the version check of PlantUML and then hangs instead of rendering:

```sh
#!/bin/sh
if [ "$1" = "-V" ]; then
    echo "dot - graphviz version 12.2.1 (20241206.2353)" >&2
    exit 0
fi
exec sleep 297
```

PlantUML uses it when the environment variable `GRAPHVIZ_DOT` points to it.
Start VS Code from a terminal with this variable (`GRAPHVIZ_DOT=/path/to/fake-dot code .` in this repository), so that the extension development host inherits it.

### Test Workspace

In the extension development host (the window that **Launch Client** opens), open a folder with a query and its meta-model, for example `pizza2.nj` from `frontend/cli/src/test/resources/queries` and `restaurant.ecore` from `test-resources/src/main/resources/models` of the NeoJoin repository.
Set `neojoin.plantUmlJarPath` (see the readme) for the visualization scenarios.
Open `pizza2.nj` in an editor; **Generate View Type** needs the query editor to be the active editor.

Run commands from the Command Palette (`Ctrl+Shift+P`, `Cmd+Shift+P` on macOS), for example **NeoJoin: Restart Server**.

## What to Look At

- **Notifications**: message boxes in the lower right corner of the window, with their text and buttons (for example **Restart Server** and **Show Output**). A box that disappears is still listed under the bell icon in the status bar. Count the boxes: each failure shows one message (a failed command may add its own).
- **Status bar**: while the server restarts, the status bar shows "Restarting the NeoJoin language server" with "Stopping ..." and "Starting ...".
- **Output**: **View > Output**, then choose *NeoJoin Language Server* in the drop-down list on the right. It shows the error output of the server and its end, for example "Server process exited with code 1.". The list contains this entry only once, also after many restarts.
- **Visualization panel**: errors appear as text in the panel, for example "Error: The language server is not running.".
- **Processes**: in a terminal, `pgrep -fl tools.vitruv.neojoin` lists the running language servers (Linux and macOS; on Windows, look for `java.exe` in the Task Manager), and `pgrep -fl "sleep 297"` lists the hanging Graphviz stand-ins. At most one server runs after each scenario, and none after you close the extension development host.

The unresponsive warning appears after 60 seconds (`UNRESPONSIVE_START_WARNING_MS` in `src/lsp/index.ts`).

## Scenarios

Run them in this order; scenario 2 relies on the manual restart at the end of scenario 1.

### Crashes

1. **Crash, and the automatic restart crashes too** (issue #7)
    1. Create the marker `crash-on-start`.
    2. Run **NeoJoin: Generate View Type**.
    3. Expected: "The language server stopped before it answered the request." and one error box "Failed to restart the language server: The language server stopped during its start. ..." with **Restart Server** and **Show Output**.
    4. Delete the marker and click **Restart Server** in the box (or run the command).
    5. Expected: the status bar shows the restart, no error box; `pgrep` lists one server.
2. **Crash after a manual restart**
    1. Run **Generate View Type**.
    2. Expected: "The language server stopped before it answered the request."; the server restarts by itself (status bar), no further error box.
3. **Second crash**
    1. Run **Generate View Type** again.
    2. Expected: an error box "The language server crashed again after an automatic restart. ..."; the server stays stopped (no restart in the status bar; `pgrep` lists no server).
    3. Run **Restart Server**, then **Generate View Type** once more.
    4. Expected: the server restarts by itself again (the manual restart allows one automatic restart).
4. **Crash during a manual restart**
    1. Create `crash-on-start` and run **Restart Server**.
    2. Expected: one error box "Failed to restart the language server: ...".
    3. Delete the marker and run **Restart Server**.
    4. Expected: the server runs again.

### Start Problems

5. **Server hangs during its start**
    1. Create `hang-on-start` and run **Restart Server**.
    2. Wait 60 seconds.
    3. Expected: a warning box "The language server is unresponsive: it is still starting after 60 seconds. ..." with **Restart Server** and **Show Output**; the server is not restarted by itself.
    4. Click **Restart Server**.
    5. Expected: the hanging server ends (`pgrep` lists only the new one), and the new server runs.
6. **Initialization error**
    1. Create `init-error` and run **Restart Server**.
    2. Expected: one error box "Failed to restart the language server: Internal error."; no restart by itself; after a few seconds, `pgrep` lists no server.
    3. Delete the marker and run **Restart Server**.
    4. Expected: the server runs again.
7. **First start fails**
    1. Create `crash-on-start`, close the extension development host, and start it again with **Launch Client**.
    2. Expected: one error box "Failed to start the language server: ..." with **Restart Server**.
    3. Delete the marker and click **Restart Server**.
    4. Expected: the server runs; all NeoJoin commands are available.
8. **Java missing**
    1. In `src/lsp/index.ts`, change the command `"java"` temporarily to a name that does not exist, and start **Launch Client**.
    2. Expected: one error box "Failed to start the language server: Java could not be started (...): ... ENOENT. Install Java 17 or later and make sure that it is on the PATH." Revert the change afterwards.

### Restarts and Stopping

9. **Two restarts at once**
    1. Run **Restart Server** twice in quick succession.
    2. Expected: no error box; afterwards `pgrep` lists exactly one server.
10. **Busy server**
    1. Create `busy` and run **Generate View Type** (the command does not finish).
    2. Run **Restart Server**, and right after it finished, run it again.
    3. Expected: no error box (no "Stopping the server timed out"); the busy server ends after about 2 seconds; afterwards exactly one server runs. In development mode (debug agent on port 8000), the Output shows no "Address already in use".
11. **Connection errors**
    1. Create `garbage` and run **Generate View Type**.
    2. Expected: one error box "The connection to the language server failed repeatedly, so the server was stopped."; after a few seconds, `pgrep` lists no server.
    3. Delete the marker and run **Restart Server**.
12. **Window closes while the server hangs**
    1. Create `hang-on-start` and run **Restart Server**.
    2. Close the extension development host while the server is still starting.
    3. Expected: `pgrep` lists no server.
13. **Settings change**
    1. Change two `neojoin.*` settings one after the other (for example add and remove a directory in *Excluded Directories*).
    2. Expected: one information box "The settings changed. Restart the language server to apply them." with **Restart Server**.

### Graphviz Processes

For these scenarios, start VS Code with `GRAPHVIZ_DOT` (see above) and open the visualization with **NeoJoin: Show Query Visualization**.
After 10 seconds, the panel shows "Timeout while rendering. ...", and `pgrep -fl "sleep 297"` lists one hanging Graphviz stand-in; note its process ID.

14. **Restart**: run **Restart Server**. Expected: the noted process is gone. A new one may appear, because the new server renders the open panel again.
15. **Crash**: run **Generate View Type** (crash without marker). Expected: the noted process is gone (Linux and macOS).
16. **Window closes**: close the extension development host. Expected: `pgrep` lists no Graphviz stand-in. This needs a language server that ends its child processes when it exits (NeoJoin with the shutdown hook in `ide.Main`).

## Development Mode and Packaged Extension

**Launch Client** starts the server with a debug agent on port 8000 (development mode).
Run scenarios 1 to 5 and 10 also with the packaged extension: build it with the test server in the root of this repository (`npm run package`), install `neojoin.vsix` (Extensions view, **...** menu, **Install from VSIX...**), and uninstall it afterwards.

## Platform Notes

- Linux and macOS: the server runs in its own process group; killing the group also ends Graphviz, also after a crash of the server.
- Windows: only the server process is killed. Graphviz processes of a killed or crashed server keep running until they finish (Node.js cannot kill a process tree on Windows).
- The server ends its child processes when it exits normally (also when VS Code closes the connection), but not when it is killed.
