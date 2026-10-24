/**
 * JSON-RPC 2.0 client over Unix domain socket (ADR-004): newline-delimited
 * JSON framing, per-run token auth, notification events.
 */
import { connect, type Socket } from "bun";

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class RpcClient {
  private socket: Socket | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buf = "";
  private onClose: (() => void) | null = null;
  private connectedResolve!: () => void;
  private connectedReject!: (e: Error) => void;
  private connected: Promise<void>;
  private sawReady = false;

  constructor(
    readonly path: string,
    private token: string,
    private onEvent: (method: string, params: unknown) => void,
  ) {
    this.connected = new Promise<void>((res, rej) => {
      this.connectedResolve = res;
      this.connectedReject = rej;
    });
  }

  /**
   * Connect with retries while the sidecar binds its socket, authenticate,
   * and wait for the ready ack.
   */
  async connect(retries = 60, delayMs = 100): Promise<void> {
    let lastErr: unknown = null;
    for (let i = 0; i < retries; i++) {
      try {
        await connect({
          unix: this.path,
          socket: {
            open: (sock) => {
              this.socket = sock;
              sock.write(
                `${JSON.stringify({ jsonrpc: "2.0", method: "hello", params: { token: this.token } })}\n`,
              );
            },
            data: (_sock, chunk) => this.onData(chunk),
            close: () => {
              this.socket = null;
              this.onClose?.();
            },
            error: (_sock, err) => {
              console.error(`[rpc ${this.path}] socket error:`, err);
            },
          },
        });
        // connected + hello sent; ready ack resolves `connected`
        const timeout = Bun.sleep(10_000).then(() => {
          throw new Error("ready ack timeout");
        });
        await Promise.race([this.connected, timeout]);
        if (!this.sawReady) throw new Error("ready ack not received");
        return;
      } catch (err) {
        lastErr = err;
        this.socket = null;
        await Bun.sleep(delayMs);
      }
    }
    this.connectedReject(new Error(`cannot connect to sidecar socket ${this.path}: ${lastErr}`));
    throw lastErr;
  }

  private onData(chunk: Uint8Array) {
    this.buf += new TextDecoder().decode(chunk);
    for (let idx = this.buf.indexOf("\n"); idx !== -1; idx = this.buf.indexOf("\n")) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (line) this.handleLine(line);
    }
  }

  private handleLine(line: string) {
    let msg: {
      id?: number | string | null;
      result?: unknown;
      error?: JsonRpcError;
      method?: string;
      params?: unknown;
    };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.method) {
      if (msg.method === "ready") {
        this.sawReady = true;
        this.connectedResolve();
        return;
      }
      this.onEvent(msg.method, msg.params);
      return;
    }
    if (msg.id !== undefined && msg.id !== null) {
      const p = this.pending.get(msg.id as number);
      if (!p) return;
      this.pending.delete(msg.id as number);
      if (msg.error) p.reject(new Error(`${msg.error.message} (code ${msg.error.code})`));
      else p.resolve(msg.result);
    } else if (msg.id === null && (msg.result as { ok?: boolean } | undefined)?.ok === true) {
      // hello ack (id null) — ready notification usually follows
    }
  }

  async request<T>(method: string, params: unknown = {}): Promise<T> {
    await this.connected;
    const id = this.nextId++;
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    });
    this.socket?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return promise;
  }

  setDisconnectHandler(fn: () => void) {
    this.onClose = fn;
  }

  async close() {
    this.socket?.end();
  }
}
