// Isolated process fixture: stop() must escalate if graceful termination stalls.
process.on("SIGTERM", () => {});
process.stdin.resume();
console.log(JSON.stringify({ type: "ready", pid: process.pid }));
