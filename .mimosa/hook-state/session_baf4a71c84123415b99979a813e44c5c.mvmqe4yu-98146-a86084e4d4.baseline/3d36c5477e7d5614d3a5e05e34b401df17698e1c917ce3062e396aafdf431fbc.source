/**
 * Minimal sidecar speaking the QBCAM sidecar protocol — used by integration
 * tests to validate the supervisor end-to-end without native dependencies.
 */
import { SidecarServer } from "../../src/main/rpc/sidecar-server";

const socketPath = process.env.QB_SOCKET;
const token = process.env.QB_TOKEN;
if (!socketPath || !token) {
  console.error("hello-sidecar: QB_SOCKET/QB_TOKEN not set");
  process.exit(1);
}

const server = new SidecarServer(socketPath, token);
server.method("echo", (params) => ({ echoed: (params as { msg: string }).msg }));
server.method("pid", () => ({ pid: process.pid }));
void server.serve();

process.on("SIGTERM", () => {
  server.shutdown();
  process.exit(0);
});
