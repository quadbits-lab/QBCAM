/**
 * Integration test: supervisor spawns a hello sidecar (bun script speaking the
 * sidecar JSON-RPC/UDS protocol), authenticates, answers ping, and is
 * restarted after being killed (spec §6.1).
 */
import { describe, expect, test } from "bun:test";
import { SupervisedService } from "../src/main/supervisor";
import { Store } from "../src/main/db";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const HELLO_SIDECAR = join(import.meta.dir, "fixtures", "hello-sidecar.ts");

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "qbcam-test-"));
}

describe("supervisor", () => {
  test("spawns, authenticates, pings, and restarts a killed sidecar", async () => {
    const dir = tmp();
    const states: string[] = [];
    const svc = new SupervisedService(
      { name: "hello", launch: { kind: "bun", scriptPath: HELLO_SIDECAR }, readyTimeoutMs: 8000 },
      dir,
      (_n, s) => states.push(s),
      () => {},
    );
    await svc.start();
    expect(svc.state).toBe("ready");

    const echo = await svc.client!.request<{ echoed: string }>("echo", { msg: "hi" });
    expect(echo.echoed).toBe("hi");

    // kill the sidecar → supervisor restarts it
    const prevPid = (await svc.client!.request<{ pid: number }>("pid")).pid;
    process.kill(prevPid, "SIGKILL");
    // wait for restart cycle
    let restarted = false;
    for (let i = 0; i < 100; i++) {
      await Bun.sleep(100);
      if (svc.state === "ready" && svc.client) {
        try {
          const pid = (await svc.client.request<{ pid: number }>("pid")).pid;
          if (pid !== prevPid) {
            restarted = true;
            break;
          }
        } catch {
          // not ready yet
        }
      }
    }
    expect(restarted).toBe(true);

    await svc.stop();
    expect(svc.state).toBe("stopped");
    rmSync(dir, { recursive: true, force: true });
  }, 30_000);
});

describe("store", () => {
  test("migrations + identity consent gate", () => {
    const dir = tmp();
    const store = new Store(dir);
    store.insertIdentity({
      id: "i1",
      name: "Test",
      embedding: null,
      thumbPath: null,
      tags: [],
      quality: 0.9,
      createdAt: Date.now(),
    });
    // no consent yet → getIdentity.consented false
    expect(store.getIdentity("i1")?.consented).toBe(false);
    store.insertConsent({
      id: "c1",
      identityId: "i1",
      kind: "import",
      statement: "I am the person pictured",
      attestedAt: Date.now(),
      appVersion: "0.1.0",
    });
    expect(store.getIdentity("i1")?.consented).toBe(true);
    // TS-11 wipe
    store.deleteIdentity("i1");
    expect(store.getIdentity("i1")).toBeNull();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
