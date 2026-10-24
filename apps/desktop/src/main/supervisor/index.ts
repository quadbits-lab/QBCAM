/**
 * Sidecar supervisor (spec §6.1): spawn with per-run token, wait for ready
 * handshake, heartbeat at 1 Hz, restart backoff 0.5/1/2/5s capping 30s.
 *
 * Sidecars are launched exclusively through spawn-safe.ts (argv arrays,
 * shell: false). Executables/arguments come from the static services
 * registry — never from user input.
 */
import { mkdirSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { RpcClient } from "../rpc/client";
import { spawnBunSidecar, spawnInterpSidecar, type SidecarProcess } from "./spawn-safe";

export type ServiceLaunch =
  | { kind: "bun"; scriptPath: string }
  | { kind: "interp"; interpreterPath: string; args: string[] };

export interface ServiceDef {
  name: string;
  launch: ServiceLaunch;
  env?: Record<string, string>;
  readyTimeoutMs?: number;
}

export type ServiceState = "starting" | "ready" | "crashed" | "stopped";

export class SupervisedService {
  state: ServiceState = "stopped";
  client: RpcClient | null = null;
  private proc: SidecarProcess | null = null;
  private token = randomBytes(16).toString("hex");
  private socketPath: string;
  private restarts = 0;
  private stopping = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private missedHeartbeats = 0;

  constructor(
    readonly def: ServiceDef,
    private runDir: string,
    private onState: (name: string, state: ServiceState) => void,
    private onEvent: (name: string, method: string, params: unknown) => void,
  ) {
    this.socketPath = join(runDir, `${def.name}.sock`);
  }

  private setState(s: ServiceState) {
    this.state = s;
    this.onState(this.def.name, s);
  }

  async start(): Promise<void> {
    this.stopping = false;
    this.setState("starting");
    mkdirSync(this.runDir, { recursive: true });
    rmSync(this.socketPath, { force: true });

    const env = {
      ...process.env,
      QB_TOKEN: this.token,
      QB_SOCKET: this.socketPath,
      QB_SERVICE_NAME: this.def.name,
      ...this.def.env,
    };
    const onExit = (code: number | null) => {
      this.stopHeartbeat();
      this.client?.close();
      this.client = null;
      if (this.stopping) {
        this.setState("stopped");
        return;
      }
      this.setState("crashed");
      const delay = Math.min(30_000, 500 * 2 ** Math.min(this.restarts++, 6));
      console.warn(`[supervisor] ${this.def.name} exited (${code}), restart in ${delay}ms`);
      setTimeout(() => {
        if (!this.stopping) void this.start();
      }, delay);
    };

    this.proc =
      this.def.launch.kind === "bun"
        ? spawnBunSidecar({
            scriptPath: this.def.launch.scriptPath,
            extraArgs: [],
            env,
            onExit,
          })
        : spawnInterpSidecar({
            interpreterPath: this.def.launch.interpreterPath,
            extraArgs: this.def.launch.args,
            env,
            onExit,
          });

    const client = new RpcClient(this.socketPath, this.token, (method, params) =>
      this.onEvent(this.def.name, method, params),
    );
    client.setDisconnectHandler(() => {
      if (!this.stopping && this.proc) {
        console.warn(`[supervisor] ${this.def.name} socket dropped`);
      }
    });
    this.client = client;

    const timeout = this.def.readyTimeoutMs ?? 10_000;
    const heartbeat = Promise.race([
      client.connect().then(() => client.request<unknown>("ping")),
      Bun.sleep(timeout).then(() => {
        throw new Error(`ready timeout after ${timeout}ms`);
      }),
    ]);
    try {
      await heartbeat;
    } catch (err) {
      this.proc.kill(9);
      throw err;
    }

    this.missedHeartbeats = 0;
    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.client?.request("ping");
        this.missedHeartbeats = 0;
      } catch {
        this.missedHeartbeats++;
        if (this.missedHeartbeats >= 3 && this.proc) {
          console.error(`[supervisor] ${this.def.name} missed 3 heartbeats, killing`);
          this.proc.kill();
        }
      }
    }, 1000);

    this.setState("ready");
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async stop(timeoutMs = 3000): Promise<void> {
    this.stopping = true;
    this.stopHeartbeat();
    try {
      await this.client?.request("shutdown");
    } catch {
      // already gone
    }
    const proc = this.proc;
    if (proc) {
      const exited = proc.exited;
      proc.kill();
      const winner = await Promise.race([exited, Bun.sleep(timeoutMs).then(() => "timeout")]);
      if (winner === "timeout") proc.kill(9);
      await exited;
    }
    this.proc = null;
    this.client?.close();
    this.client = null;
    rmSync(this.socketPath, { force: true });
    this.setState("stopped");
  }
}
