/**
 * sign-manifest — ed25519-sign models/registry.json for edge distribution
 * (spec §13.2). Keys live in .keys/ (gitignored) — generated on first run.
 *
 *   bun run tools/scripts/sign-manifest.ts gen       # generate keypair
 *   bun run tools/scripts/sign-manifest.ts sign      # → models/manifest.signed.json
 *   bun run tools/scripts/sign-manifest.ts verify    # verify signed manifest
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const KEYS_DIR = join(ROOT, ".keys");
const PRIV = join(KEYS_DIR, "manifest-ed25519.pem");
const PUB = join(KEYS_DIR, "manifest-ed25519.pub");
const REGISTRY = join(ROOT, "models", "registry.json");
const SIGNED = join(ROOT, "models", "manifest.signed.json");

function ensureKeys() {
  if (existsSync(PRIV) && existsSync(PUB)) return;
  mkdirSync(KEYS_DIR, { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  writeFileSync(PRIV, privateKey.export({ type: "pkcs8", format: "pem" }));
  writeFileSync(PUB, publicKey.export({ type: "spki", format: "pem" }));
  console.log("generated keypair in .keys/ — public key goes into wrangler.toml at deploy");
}

const cmd = process.argv[2] ?? "verify";

if (cmd === "gen") {
  ensureKeys();
} else if (cmd === "sign") {
  ensureKeys();
  const registryBody = readFileSync(REGISTRY, "utf8");
  const manifest = JSON.parse(registryBody);
  // canonical payload: registry body + build timestamp
  const payload = JSON.stringify({
    schema: manifest.schema,
    models: manifest.models,
    builtAt: new Date().toISOString(),
  });
  const signature = cryptoSign(null, Buffer.from(payload), createPrivateKey(readFileSync(PRIV)));
  writeFileSync(
    SIGNED,
    `${JSON.stringify({ payload: JSON.parse(payload), signature: signature.toString("base64") }, null, 2)}\n`,
  );
  const pub = createPublicKey(readFileSync(PUB));
  const pubHex = pub.export({ type: "spki", format: "der" }).toString("hex");
  console.log(`signed manifest → models/manifest.signed.json`);
  console.log(`public key (hex, set as MANIFEST_PUBLIC_KEY):\n${pubHex}`);
} else {
  // verify
  const signed = JSON.parse(readFileSync(SIGNED, "utf8"));
  const pub = createPublicKey(readFileSync(PUB));
  const payload = JSON.stringify({
    schema: signed.payload.schema,
    models: signed.payload.models,
    builtAt: signed.payload.builtAt,
  });
  const ok = cryptoVerify(
    null,
    Buffer.from(payload),
    pub,
    Buffer.from(signed.signature, "base64"),
  );
  if (!ok) {
    console.error("MANIFEST SIGNATURE INVALID");
    process.exit(1);
  }
  console.log(`manifest signature valid (builtAt ${signed.payload.builtAt})`);
}
