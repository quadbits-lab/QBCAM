/**
 * Sidecar-side JSON-RPC server over UDS (reference implementation for TS;
 * Rust and Python sidecars mirror this protocol):
 *   1. bind QB_SOCKET (Unix domain socket, mode 0600)
 *   2. await `hello` with {token} — constant-time compare against QB_TOKEN
 *   3. reply `ready`; then serve requests, emit notifications as
 *      {jsonrpc, method, params} lines.
 */
import { timingSafeEqual } from "node:crypto";

function tokenEquals(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export type Handler = (params: unknown) => unknown | Promise<unknown>;

type Conn = { write: (s: string) => void; authed: boolean };

export class SidecarServer {
  private handlers = new Map<string, Handler>();
  private conns = new Set<Conn>();
  private stopFlag = false;
  private server: { stop(force?: boolean): void } | null = null;

  constructor(
    private socketPath: string,
    private token: string,
  ) {}

  method(name: string, h: Handler) {
    this.handlers.set(name, h);
  }

  async serve(): Promise<void> {
    this.server = Bun.listen({
      unix: this.socketPath,
      socket: {
        open: (sock) => {
          const conn = sock as unknown as Conn;
          conn.authed = false;
          this.conns.add(conn);
        },
        data: (sock, data) => void this.onData(sock as unknown as Conn, data),
        close: (sock) => {
          this.conns.delete(sock as unknown as Conn);
        },
        error: (_sock, err) => console.error("[sidecar] socket error:", err),
      },
    });
    while (!this.stopFlag) await Bun.sleep(100);
  }

  shutdown() {
    this.stopFlag = true;
  }

  private async onData(sock: Conn, data: Uint8Array) {
    const text = new TextDecoder().decode(data);
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let msg: { id?: number | null; method?: string; params?: unknown };
      try {
        msg = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (!msg.method) continue;

      if (msg.method === "hello") {
        const token = (msg.params as { token?: string } | undefined)?.token ?? "";
        if (tokenEquals(token, this.token)) {
          sock.authed = true;
          this.replyOk(sock, msg.id ?? null, { ok: true, service: process.env.QB_SERVICE_NAME });
          this.send(sock, "ready", { service: process.env.QB_SERVICE_NAME });
        } else {
          this.replyErr(sock, msg.id ?? null, -32000, "bad token");
        }
        continue;
      }
      if (!sock.authed) {
        this.replyErr(sock, msg.id ?? null, -32001, "not authenticated");
        continue;
      }
      if (msg.method === "ping") {
        this.replyOk(sock, msg.id ?? null, { pong: Date.now() });
        continue;
      }
      if (msg.method === "shutdown") {
        this.replyOk(sock, msg.id ?? null, { ok: true });
        this.shutdown();
        continue;
      }
      const handler = this.handlers.get(msg.method);
      if (!handler) {
        this.replyErr(sock, msg.id ?? null, -32601, `method not found: ${msg.method}`);
        continue;
      }
      try {
        const result = await handler(msg.params);
        this.replyOk(sock, msg.id ?? null, result ?? null);
      } catch (err) {
        this.replyErr(
          sock,
          msg.id ?? null,
          -32000,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  /** Emit a notification to all authenticated clients (v0: single core client). */
  notify(method: string, params: unknown) {
    for (const sock of this.conns) {
      if (sock.authed) this.send(sock, method, params);
    }
  }

  private replyOk(sock: Conn, id: number | null, result: unknown) {
    this.write(sock, { jsonrpc: "2.0", id, result });
  }

  private replyErr(sock: Conn, id: number | null, code: number, message: string) {
    this.write(sock, { jsonrpc: "2.0", id, error: { code, message } });
  }

  private send(sock: Conn, method: string, params: unknown) {
    this.write(sock, { jsonrpc: "2.0", method, params });
  }

  private write(sock: Conn, payload: unknown) {
    sock.write(`${JSON.stringify(payload)}\n`);
  }
}
