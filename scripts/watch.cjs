// Development watch mode: bundles with esbuild and type-checks with tsc, both in watch mode, in one terminal
// (replaces npm-run-all). Stops both processes when one of them ends or when this script is interrupted.
const { spawn } = require("node:child_process");

const commands = [
    [process.execPath, "esbuild.cjs", "--watch"],
    [
        process.execPath,
        require.resolve("typescript/bin/tsc"),
        "--noEmit",
        "--watch",
        "--project",
        "tsconfig.json",
    ],
];

const children = commands.map(([command, ...args]) =>
    spawn(command, args, { stdio: "inherit" })
);

function stopAll(exitCode) {
    for (const child of children) {
        child.kill();
    }
    process.exit(exitCode);
}

for (const child of children) {
    child.on("exit", (code) => stopAll(code ?? 1));
}
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
