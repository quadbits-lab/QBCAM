/**
 * manifest-worker (spec §13.2): serves the signed app/model manifest and
 * version pointers. Static-host agnostic — swap KV/R2 bindings freely; the
 * desktop app depends only on HTTPS + ed25519-signed JSON.
 *
 * Routes:
 *   GET /models/manifest.json  → signed model manifest (from MANIFEST body or KV)
 *   GET /app/latest?channel=   → latest app version pointer
 *   GET /healthz
 */

interface Env {
  MANIFEST_PUBLIC_KEY?: string;
  MANIFEST_KV?: { get(key: string): Promise<string | null> };
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return json({ ok: true, service: "manifest-worker" });
    }

    if (url.pathname === "/models/manifest.json") {
      // The signed manifest is uploaded to KV at release time
      // (tools/scripts/sign-manifest.ts sign → deploy uploads). Without the
      // binding there is nothing to serve — fail clearly rather than serving
      // unsigned data.
      if (env.MANIFEST_KV) {
        const signed = await env.MANIFEST_KV.get("models.manifest.signed");
        if (signed) {
          return new Response(signed, {
            headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
          });
        }
      }
      return json({ error: "manifest not configured on this deployment" }, 503);
    }

    if (url.pathname === "/app/latest") {
      const channel = url.searchParams.get("channel") ?? "stable";
      return json({ channel, version: "0.1.0", notes: "development", url: null });
    }

    return json({ error: "not found" }, 404);
  },
};
