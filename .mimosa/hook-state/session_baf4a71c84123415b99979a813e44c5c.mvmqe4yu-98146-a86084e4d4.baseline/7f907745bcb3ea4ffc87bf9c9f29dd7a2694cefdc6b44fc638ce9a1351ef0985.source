/** Typed RPC bridge to qb-core. In headless mode: HTTP POST /ui/rpc +
 * WebSocket events. In Electrobun mode the Shell adapter swaps this out. */

let token = "";

export async function initApi(): Promise<void> {
  const res = await fetch("/config");
  token = (await res.json()).token;
}

export async function rpc<T = unknown>(method: string, params: unknown = {}): Promise<T> {
  const res = await fetch("/ui/rpc", {
    method: "POST",
    headers: { "content-type": "application/json", "x-qbcam-token": token },
    body: JSON.stringify({ method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message ?? "rpc error");
  return body.result as T;
}

/** Subscribe to core events over the UI WebSocket. */
export async function connectEvents(
  handlers: Record<string, (params: any) => void>,
): Promise<() => void> {
  if (!token) await initApi();
  const ws = new WebSocket(`ws://${location.host}/ws?token=${token}`);
  ws.onmessage = (ev) => {
    if (typeof ev.data !== "string") return;
    try {
      const msg = JSON.parse(ev.data);
      if (msg.method && handlers[msg.method]) handlers[msg.method](msg.params);
    } catch {
      // ignore malformed frames
    }
  };
  return () => ws.close();
}

/** Live preview frames come straight from qb-vision's WS (binary JPEG). */
export function connectPreview(
  port: number,
  tokenPreview: string,
  onFrame: (jpeg: ArrayBuffer) => void,
): () => void {
  const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${tokenPreview}`);
  ws.binaryType = "arraybuffer";
  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) onFrame(ev.data);
  };
  return () => ws.close();
}
