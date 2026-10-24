/** Shared sidecar RPC client for integration scripts (argv/token protocol). */
import { connect } from "bun";

export type SidecarClient = Awaited<ReturnType<typeof rpcClient>>;

export async function rpcClient(sockPath: string, token: string, name: string) {
  let pendingId = 1;
  const pending = new Map<number, (v: any) => void>();
  const events: Array<{ method: string; params: any }> = [];
  let readyResolve!: () => void;
  const ready = new Promise<void>((r) => (readyResolve = r));
  const sock = await connect({
    unix: sockPath,
    socket: {
      open(s) {
        s.write(JSON.stringify({ jsonrpc: "2.0", method: "hello", params: { token } }) + "\n");
      },
      data(_s, chunk) {
        for (const line of new TextDecoder().decode(chunk).trim().split("\n")) {
          if (!line) continue;
          const m = JSON.parse(line);
          if (m.method === "ready") {
            readyResolve();
          } else if (m.method) {
            events.push({ method: m.method, params: m.params });
          } else if (m.id && pending.has(m.id)) {
            pending.get(m.id)!(m);
            pending.delete(m.id);
          }
        }
      },
      close() {},
      error() {},
    },
  });
  await ready;
  return {
    name,
    events,
    async request<T = any>(method: string, params: any = {}): Promise<T> {
      const id = pendingId++;
      const p = new Promise<any>((resolve) => pending.set(id, resolve));
      sock.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      const resp = await Promise.race([
        p,
        Bun.sleep(15_000).then(() => ({ error: { message: "timeout" } })),
      ]);
      if (resp.error) throw new Error(`${name}.${method}: ${resp.error.message}`);
      return resp.result as T;
    },
    close() {
      sock.end();
    },
  };
}
