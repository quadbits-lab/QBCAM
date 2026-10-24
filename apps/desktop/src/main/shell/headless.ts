/**
 * Headless shell — same UI, same RPC surface, served over localhost HTTP+WS.
 * Used for development and CI so nothing blocks on desktop-shell APIs (R3).
 * Binds 127.0.0.1 only, with a per-session token (spec §6.1).
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { PickFilesOptions, Shell, UiRequestContext } from ".";

export class HeadlessShell implements Shell {
  readonly kind = "headless" as const;
  private handler: ((ctx: UiRequestContext) => Promise<unknown>) | null = null;
  private sockets = new Set<{ send: (data: string | Uint8Array) => void }>();
  private token = randomBytes(12).toString("hex");
  private server: ReturnType<typeof Bun.serve> | null = null;
  private uiRoot: string;

  constructor(uiRoot?: string) {
    this.uiRoot = uiRoot ?? join(import.meta.dir, "..", "..", "views", "studio", "dist");
  }

  sendToUi(method: string, params: unknown) {
    const frame = JSON.stringify({ jsonrpc: "2.0", method, params });
    for (const ws of this.sockets) ws.send(frame);
  }

  /** Push a binary preview frame to connected UI sockets. */
  sendPreview(jpeg: Uint8Array) {
    for (const ws of this.sockets) ws.send(jpeg);
  }

  onRequest(handler: (ctx: UiRequestContext) => Promise<unknown>) {
    this.handler = handler;
  }

  async openExternal(url: string): Promise<boolean> {
    return runDetached(openerFor(url), [url]);
  }

  async showItemInFolder(path: string): Promise<boolean> {
    if (process.platform === "darwin") return runDetached("open", ["-R", path]);
    return runDetached(openerFor(path), [path]);
  }

  async pickFiles(_options?: PickFilesOptions): Promise<string[]> {
    // Browser dev has no native dialog; the UI falls back to a path field.
    return [];
  }

  async start(): Promise<void> {
    const handler = () => this.handler;
    const sockets = this.sockets;
    const token = this.token;
    const uiRoot = this.uiRoot;
    this.server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0, // ephemeral
      async fetch(req, server) {
        const url = new URL(req.url);
        if (url.pathname === "/ws") {
          if (url.searchParams.get("token") !== token) {
            return new Response("forbidden", { status: 403 });
          }
          if (server.upgrade(req, { data: undefined })) return;
          return new Response("upgrade failed", { status: 500 });
        }
        if (url.pathname === "/ui/rpc" && req.method === "POST") {
          if (req.headers.get("x-qbcam-token") !== token) {
            return Response.json(
              { error: { code: -32000, message: "bad token" } },
              { status: 403 },
            );
          }
          const body = (await req.json()) as { method?: string; params?: unknown };
          if (!body.method) {
            return Response.json(
              { error: { code: -32602, message: "missing method" } },
              { status: 400 },
            );
          }
          try {
            const fn = handler();
            const result = await fn?.({ method: body.method, params: body.params });
            return Response.json({ jsonrpc: "2.0", id: null, result: result ?? null });
          } catch (err) {
            return Response.json({
              jsonrpc: "2.0",
              id: null,
              error: {
                code: -32000,
                message: err instanceof Error ? err.message : String(err),
              },
            });
          }
        }
        if (url.pathname === "/config") {
          return Response.json({ token });
        }
        // static UI (explicit content-type: module scripts require strict MIME)
        const path = url.pathname === "/" ? "/index.html" : url.pathname;
        if (url.pathname === "/__trap.js") {
          return new Response(
            "window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message)+' @'+String(e.filename).split('/').pop()+':'+e.lineno)});window.addEventListener('unhandledrejection',function(e){window.__errs.push('rejection: '+String(e.reason))});",
            { headers: { "content-type": "text/javascript; charset=utf-8" } },
          );
        }
        try {
          const file = Bun.file(join(uiRoot, path));
          if (await file.exists()) {
            let html: string | null = null;
            if (path.endsWith(".html")) {
              html = await file.text();
              // inject same-origin error trap before any module script (CSP-safe)
              html = html.replace("<head>", '<head><script src="/__trap.js"></script>');
              return new Response(html, {
                headers: { "content-type": "text/html; charset=utf-8" },
              });
            }
            const types: Record<string, string> = {
              ".js": "text/javascript; charset=utf-8",
              ".css": "text/css; charset=utf-8",
              ".svg": "image/svg+xml",
              ".png": "image/png",
              ".ico": "image/x-icon",
              ".json": "application/json",
              ".woff2": "font/woff2",
            };
            const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
            return new Response(file, {
              headers: { "content-type": types[ext] ?? "application/octet-stream" },
            });
          }
        } catch {
          // fallthrough
        }
        return new Response("not found", { status: 404 });
      },
      websocket: {
        open(ws) {
          sockets.add(ws as unknown as { send: (d: string | Uint8Array) => void });
        },
        message(_ws, message) {
          // UI→core messages over WS are not used in v0 (HTTP POST /ui/rpc)
          void message;
        },
        close(ws) {
          sockets.delete(ws as unknown as { send: (d: string | Uint8Array) => void });
        },
      },
    });
    console.log(`[headless] UI: http://127.0.0.1:${this.server.port} (token: ${token})`);
  }

  url(): string | null {
    if (!this.server) return null;
    return `http://127.0.0.1:${this.server.port}`;
  }

  port(): number | null {
    return this.server?.port ?? null;
  }

  tokenValue(): string {
    return this.token;
  }

  async stop(): Promise<void> {
    this.server?.stop(true);
    this.server = null;
  }
}

function openerFor(target: string): string {
  if (target.startsWith("http") || target.startsWith("x-apple.")) {
    if (process.platform === "darwin") return "open";
    if (process.platform === "win32") return "cmd";
    return "xdg-open";
  }
  if (process.platform === "darwin") return "open";
  if (process.platform === "win32") return "explorer";
  return "xdg-open";
}

function runDetached(command: string, args: string[]): boolean {
  try {
    const actual = command === "cmd" ? ["/c", "start", "", ...args] : args;
    Bun.spawn([command, ...actual], { stdout: "ignore", stderr: "ignore" });
    return true;
  } catch {
    return false;
  }
}
