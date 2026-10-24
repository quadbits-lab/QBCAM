/**
 * Contracts codegen (spec §10.4).
 * Emits JSON Schema domains, flat method/event tables, and a Pydantic module
 * (via `uvx datamodel-code-generator`) into dist/. Idempotent — CI drift guard
 * re-runs this and fails on any diff.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Events, Methods } from "../src/index.ts";
import { DEFAULT_SETTINGS, SettingsSchema, UiEvents, UiRequests } from "../src/settings.ts";

const dist = join(import.meta.dir, "..", "dist");
mkdirSync(join(dist, "json"), { recursive: true });
mkdirSync(join(dist, "py"), { recursive: true });

function emit(name: string, schema: unknown) {
  const path = join(dist, "json", `${name}.json`);
  writeFileSync(path, `${JSON.stringify(schema, null, 2)}\n`);
}

// method table: { "pipeline.start": { params: {...}, result: {...} } }
const methodTable: Record<string, unknown> = {};
for (const [method, [params, result]] of Object.entries(Methods)) {
  methodTable[method] = { params, result };
}

const eventTable: Record<string, unknown> = { ...Events };

emit("methods", methodTable);
emit("events", eventTable);
emit("settings", SettingsSchema);
emit("ui.requests", UiRequests);
emit("ui.events", UiEvents);

// Flat "all.json" — one document of all defs for datamodel-code-generator
const all = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "QBCAM Contracts",
  definitions: {
    ...((SettingsSchema as { definitions?: Record<string, unknown> }).definitions ?? {}),
    Settings: { ...SettingsSchema, $id: "Settings", definitions: undefined },
    Methods: { type: "object", additionalProperties: false },
    MethodTable: methodTable as unknown,
    EventTable: eventTable as unknown,
    DefaultSettings: { type: "object", title: "DefaultSettings" },
  },
};
emit("all", all);

// JSON schema for JSON-RPC envelope + error object
emit("rpc-envelope", {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "JsonRpcRequest",
  type: "object",
  required: ["jsonrpc", "method"],
  properties: {
    jsonrpc: { const: "2.0" },
    id: { type: ["integer", "string", "null"] },
    method: { type: "string" },
    params: {},
  },
});

writeFileSync(
  join(dist, "py", "README.md"),
  "# Generated Python contracts\n\nRun `bun run contracts:gen` at the repo root to (re)generate via uvx datamodel-code-generator, then `uv sync` in services/ to consume `qbcam-contracts`.\n",
);

// Pydantic v2 module from the settings JSON Schema (drift-guarded like everything else)
const codegen = Bun.spawnSync(
  [
    "uvx",
    "--from",
    "datamodel-code-generator",
    "datamodel-codegen",
    "--input",
    "dist/json/settings.json",
    "--input-file-type",
    "jsonschema",
    "--output",
    "dist/py/qbcam_contracts.py",
    "--class-name",
    "Settings",
    "--output-model-type",
    "pydantic_v2.BaseModel",
    "--target-python-version",
    "3.12",
    "--formatters",
    "black",
  ],
  { cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "inherit" },
);
if (codegen.exitCode !== 0) {
  console.error("pydantic codegen failed");
  process.exit(1);
}

writeFileSync(join(dist, "defaults.json"), `${JSON.stringify(DEFAULT_SETTINGS, null, 2)}\n`);

console.log("contracts:gen OK — emitted JSON schemas + defaults");
console.log(`  methods: ${Object.keys(methodTable).length}`);
console.log(`  events:  ${Object.keys(eventTable).length}`);
