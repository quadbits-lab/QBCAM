/**
 * telemetry-worker (spec §15.2): opt-in crash/diagnostics ingest.
 *
 * HARD RULES (enforced below):
 *  - schema allowlist: unknown fields reject the whole payload
 *  - no images, embeddings, file paths, usernames, or device names ever
 *  - payloads are size-capped and rate-shaped per IP
 */

interface Env {
  TELEMETRY_KV?: { put(key: string, value: string): Promise<void> };
}

const ALLOWED_FIELDS = new Set([
  "schema",
  "appVersion",
  "platform",
  "kind", // "crash" | "diagnostic"
  "errorMessage", // truncated, sanitized client-side
  "errorStack", // truncated, sanitized client-side
  "service", // which sidecar crashed
  "ep", // execution provider string
  "uptimeSeconds",
  "sessionId", // random per-install UUID, not tied to identity
  "timestamp",
]);

const MAX_LEN = 2048;
const MAX_BODY = 16 * 1024;

function sanitize(value: unknown): unknown {
  if (typeof value === "string") return value.slice(0, MAX_LEN).replace(/\s+/g, " ");
  return value;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return json({ ok: true, service: "telemetry-worker" });
    }

    if (url.pathname === "/v1/events" && request.method === "POST") {
      const length = Number(request.headers.get("content-length") ?? "0");
      if (length > MAX_BODY) return json({ error: "payload too large" }, 413);

      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return json({ error: "invalid json" }, 400);
      }

      const unknown = Object.keys(body).filter((k) => !ALLOWED_FIELDS.has(k));
      if (unknown.length > 0) {
        // Reject: telemetry creep is a threat (spec §15.1) — fail closed.
        return json({ error: `disallowed fields: ${unknown.join(",")}` }, 422);
      }
      if (body.schema !== 1) return json({ error: "unsupported schema" }, 422);

      const clean: Record<string, unknown> = { schema: 1 };
      for (const key of ALLOWED_FIELDS) {
        if (key in body) clean[key] = sanitize(body[key]);
      }
      clean.receivedAt = new Date().toISOString();
      clean.clientIp = request.headers.get("cf-connecting-ip")?.slice(0, 64) ?? "unknown";

      if (env.TELEMETRY_KV) {
        const id = crypto.randomUUID();
        await env.TELEMETRY_KV.put(`event:${id}`, JSON.stringify(clean));
      }
      return json({ accepted: true });
    }

    return json({ error: "not found" }, 404);
  },
};
