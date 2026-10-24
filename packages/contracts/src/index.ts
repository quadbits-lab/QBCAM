/**
 * QBCAM control-plane contracts — single source of truth (spec §10).
 *
 * Every JSON-RPC method, event, and settings shape is defined here with TypeBox.
 * `bun run contracts:gen` emits:
 *   dist/json/*.json        — JSON Schema per domain (services consume these)
 *   dist/methods.json       — flat method table { method: {params, result} }
 *   dist/events.json        — flat event table { event: schema }
 *   dist/py/qbcam_contracts.py — Pydantic models (via datamodel-code-generator)
 * CI fails if committed output differs (drift guard, spec §10.4).
 */
import { type TSchema, Type } from "@sinclair/typebox";

// ---------- primitives ----------

export const JsonValue = Type.Recursive((self) =>
  Type.Union([
    Type.Null(),
    Type.Boolean(),
    Type.Number(),
    Type.String(),
    Type.Array(self),
    Type.Record(Type.String(), self),
  ]),
);

export const PixelFormat = Type.Union([
  Type.Literal("BGRA"),
  Type.Literal("NV12"),
  Type.Literal("RGB24"),
]);

export const RingName = Type.String({
  description: "Shared-memory ring segment name, e.g. qbcam.7f3a.frames.in",
});

export const Device = Type.Object({
  id: Type.String(),
  name: Type.String(),
  kind: Type.Union([Type.Literal("camera"), Type.Literal("file"), Type.Literal("fake")]),
  modes: Type.Array(
    Type.Object({
      width: Type.Integer({ minimum: 1 }),
      height: Type.Integer({ minimum: 1 }),
      fps: Type.Number({ minimum: 1 }),
      format: Type.String(),
    }),
  ),
});

export const PipelineStats = Type.Object({
  fps: Type.Number(),
  frameMs: Type.Number(),
  frameMsP95: Type.Number(),
  dropped: Type.Integer(),
  faces: Type.Integer(),
  executionProvider: Type.String(),
  preset: Type.String(),
  bypassed: Type.Boolean(),
  degraded: Type.Boolean(),
});

export const QualityPreset = Type.Union([
  Type.Literal("fast"),
  Type.Literal("balanced"),
  Type.Literal("quality"),
]);

export const FaceSelector = Type.Union([
  Type.Object({ mode: Type.Literal("largest") }),
  Type.Object({ mode: Type.Literal("index"), n: Type.Integer({ minimum: 0 }) }),
  Type.Object({ mode: Type.Literal("all") }),
  Type.Object({ mode: Type.Literal("tracked"), trackId: Type.Integer() }),
]);

// ---------- capture (qb-camio) ----------

export const CaptureList = Type.Object({});
export const CaptureListResult = Type.Object({ devices: Type.Array(Device) });

export const CaptureOpen = Type.Object({
  deviceId: Type.String(),
  width: Type.Integer(),
  height: Type.Integer(),
  fps: Type.Number(),
  format: Type.String(),
  ringIn: RingName,
});
export const CaptureOpenResult = Type.Object({ ok: Type.Boolean(), actual: Type.Optional(Device) });

export const CaptureClose = Type.Object({ deviceId: Type.String() });
export const CaptureCloseResult = Type.Object({ ok: Type.Boolean() });

// ---------- pipeline (qb-vision) ----------

export const IdentityBinding = Type.Object({
  selector: FaceSelector,
  identityId: Type.String(),
});

export const PipelineStart = Type.Object({
  ringIn: RingName,
  ringOut: RingName,
  preset: QualityPreset,
  identityBindings: Type.Array(IdentityBinding),
});
export const PipelineStartResult = Type.Object({
  ok: Type.Boolean(),
  executionProvider: Type.String(),
  modelHashes: Type.Array(Type.String()),
});

export const ParamPatch = Type.Object({
  preset: Type.Optional(QualityPreset),
  swapStrength: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  maskFeather: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  colorMatch: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  sharpen: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  keepMouth: Type.Optional(Type.Boolean()),
  keepEyes: Type.Optional(Type.Boolean()),
  enhanceEnabled: Type.Optional(Type.Boolean()),
  enhanceStrength: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  temporalAlpha: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  failSafe: Type.Optional(
    Type.Union([Type.Literal("slate"), Type.Literal("freeze"), Type.Literal("passthrough")]),
  ),
});

export const PipelineSetParams = ParamPatch;
export const PipelineSetParamsResult = Type.Null();

export const PipelineSetSource = Type.Object({ bindings: Type.Array(IdentityBinding) });
export const PipelineSetSourceResult = Type.Null();

export const PipelineBypass = Type.Object({ on: Type.Boolean() });
export const PipelineBypassResult = Type.Null();

export const PipelineStop = Type.Object({});
export const PipelineStopResult = PipelineStats;

export const PipelineStatsRequest = Type.Object({});
export const PipelineStatsResult = PipelineStats;

// ---------- identity ----------

export const IdentityImport = Type.Object({
  paths: Type.Array(Type.String()),
  name: Type.String({ minLength: 1 }),
  consent: Type.Object({
    attested: Type.Literal(true),
    statement: Type.String(),
  }),
});
export const IdentityImportResult = Type.Object({
  identityId: Type.String(),
  quality: Type.Number(),
  detectedFaces: Type.Integer(),
});

export const IdentityList = Type.Object({});
export const IdentityRecord = Type.Object({
  id: Type.String(),
  name: Type.String(),
  thumbPath: Type.Union([Type.String(), Type.Null()]),
  tags: Type.Array(Type.String()),
  quality: Type.Number(),
  createdAt: Type.Integer(),
  consentAttestedAt: Type.Integer(),
});
export const IdentityListResult = Type.Object({ identities: Type.Array(IdentityRecord) });

export const IdentityDelete = Type.Object({ identityId: Type.String() });
export const IdentityDeleteResult = Type.Object({ ok: Type.Boolean(), wipedFiles: Type.Integer() });

// ---------- vcam (spec §8.2) ----------

export const VCamMode = Type.Object({
  w: Type.Integer(),
  h: Type.Integer(),
  fps: Type.Integer(),
  format: Type.String(),
});

export const VCamDescribe = Type.Object({});
export const VCamDescribeResult = Type.Object({
  installed: Type.Boolean(),
  deviceName: Type.String(),
  activeClients: Type.Integer(),
  supported: Type.Array(VCamMode),
  implementation: Type.String(),
});

export const VCamInstall = Type.Object({});
export const VCamInstallResult = Type.Object({
  ok: Type.Boolean(),
  requiresRestart: Type.Boolean(),
  userActionRequired: Type.Optional(Type.String()),
});

export const VCamUninstall = Type.Object({});
export const VCamUninstallResult = VCamInstallResult;

export const VCamStart = Type.Object({
  ringOut: RingName,
  width: Type.Integer(),
  height: Type.Integer(),
  fps: Type.Integer(),
  format: PixelFormat,
});
export const VCamStartResult = Type.Object({ ok: Type.Boolean() });

export const VCamStop = Type.Object({});
export const VCamStopResult = Type.Null();

export const VCamSetSlate = Type.Object({ imagePath: Type.String() });
export const VCamSetSlateResult = Type.Null();

// ---------- recorder ----------

export const RecorderStart = Type.Object({
  ringOut: RingName,
  container: Type.Union([Type.Literal("mp4"), Type.Literal("mkv"), Type.Literal("webm")]),
  codec: Type.Union([Type.Literal("h264"), Type.Literal("hevc"), Type.Literal("vp9")]),
  audio: Type.Union([Type.Literal("aac"), Type.Literal("opus"), Type.Literal("off")]),
  outputDir: Type.String(),
});
export const RecorderStartResult = Type.Object({ recordingId: Type.String(), path: Type.String() });

export const RecorderStop = Type.Object({});
export const RecorderStopResult = Type.Object({
  recordingId: Type.String(),
  path: Type.String(),
  durationMs: Type.Integer(),
  bytes: Type.Integer(),
  signed: Type.Boolean(),
});

export const RecorderStatus = Type.Object({});
export const RecorderStatusResult = Type.Union([
  Type.Null(),
  Type.Object({
    recordingId: Type.String(),
    seconds: Type.Number(),
    bytes: Type.Integer(),
    droppedFrames: Type.Integer(),
    diskFreeBytes: Type.Integer(),
  }),
]);

// ---------- stills ----------

export const StillCapture = Type.Object({
  mode: Type.Union([Type.Literal("single"), Type.Literal("burst"), Type.Literal("timer")]),
  count: Type.Optional(Type.Integer({ minimum: 1 })),
  intervalMs: Type.Optional(Type.Integer({ minimum: 50 })),
  format: Type.Union([Type.Literal("png"), Type.Literal("jpeg"), Type.Literal("webp")]),
  outputDir: Type.String(),
});
export const StillCaptureResult = Type.Object({
  paths: Type.Array(Type.String()),
  signed: Type.Boolean(),
});

// ---------- models ----------

export const ModelsEnsure = Type.Object({ modelIds: Type.Array(Type.String()) });
export const ModelsEnsureResult = Type.Object({ ok: Type.Boolean() });

export const ModelsList = Type.Object({});
export const ModelInfo = Type.Object({
  id: Type.String(),
  kind: Type.String(),
  version: Type.String(),
  installed: Type.Boolean(),
  licenseSpdx: Type.String(),
  commercialUse: Type.Boolean(),
  byo: Type.Boolean(),
});
export const ModelsListResult = Type.Object({ models: Type.Array(ModelInfo) });

export const ModelsSetByoPath = Type.Object({
  modelId: Type.String(),
  path: Type.String(),
  licenseAccepted: Type.Boolean(),
});
export const ModelsSetByoPathResult = Type.Object({ ok: Type.Boolean(), sha256: Type.String() });

// ---------- library ----------

export const LibraryList = Type.Object({});
export const LibraryItem = Type.Object({
  id: Type.String(),
  kind: Type.Union([Type.Literal("recording"), Type.Literal("snapshot")]),
  path: Type.String(),
  bytes: Type.Integer(),
  durationMs: Type.Optional(Type.Integer()),
  createdAt: Type.Integer(),
  provenanceSigned: Type.Boolean(),
});
export const LibraryListResult = Type.Object({ items: Type.Array(LibraryItem) });

export const LibraryDelete = Type.Object({ id: Type.String() });
export const LibraryDeleteResult = Type.Object({ ok: Type.Boolean() });

// ---------- events (server → core → UI) ----------

export const ServiceState = Type.Union([
  Type.Literal("starting"),
  Type.Literal("ready"),
  Type.Literal("crashed"),
  Type.Literal("stopped"),
]);

export const Events = {
  "service.state": Type.Object({ service: Type.String(), state: ServiceState }),
  "pipeline.stats": PipelineStats,
  "pipeline.degraded": Type.Object({ reason: Type.String() }),
  "pipeline.faces": Type.Object({
    faces: Type.Array(
      Type.Object({
        trackId: Type.Integer(),
        x: Type.Number(),
        y: Type.Number(),
        w: Type.Number(),
        h: Type.Number(),
      }),
    ),
  }),
  "recorder.progress": Type.Object({
    recordingId: Type.String(),
    seconds: Type.Number(),
    bytes: Type.Integer(),
    droppedFrames: Type.Integer(),
  }),
  "models.progress": Type.Object({
    modelId: Type.String(),
    stage: Type.Union([Type.Literal("download"), Type.Literal("verify"), Type.Literal("install")]),
    percent: Type.Number(),
  }),
  "vcam.clients": Type.Object({ activeClients: Type.Integer() }),
} as const;

// ---------- method table ----------

/** method → { params, result } — consumed by qb-core dispatcher and service codegen. */
export const Methods = {
  // qb-camio
  "capture.list": [CaptureList, CaptureListResult],
  "capture.open": [CaptureOpen, CaptureOpenResult],
  "capture.close": [CaptureClose, CaptureCloseResult],
  // qb-vision
  "pipeline.start": [PipelineStart, PipelineStartResult],
  "pipeline.setParams": [PipelineSetParams, PipelineSetParamsResult],
  "pipeline.setSource": [PipelineSetSource, PipelineSetSourceResult],
  "pipeline.bypass": [PipelineBypass, PipelineBypassResult],
  "pipeline.stats": [PipelineStatsRequest, PipelineStatsResult],
  "pipeline.stop": [PipelineStop, PipelineStopResult],
  // identity (owned by qb-core DB; embedding via qb-vision "identity.embed")
  "identity.embed": [
    Type.Object({ paths: Type.Array(Type.String()) }),
    Type.Object({
      embedding: Type.Array(Type.Number()),
      quality: Type.Number(),
      detectedFaces: Type.Integer(),
      bestPath: Type.String(),
    }),
  ],
  // qb-vcam
  "vcam.describe": [VCamDescribe, VCamDescribeResult],
  "vcam.install": [VCamInstall, VCamInstallResult],
  "vcam.uninstall": [VCamUninstall, VCamUninstallResult],
  "vcam.start": [VCamStart, VCamStartResult],
  "vcam.stop": [VCamStop, VCamStopResult],
  "vcam.setSlate": [VCamSetSlate, VCamSetSlateResult],
  // qb-recorder
  "recorder.start": [RecorderStart, RecorderStartResult],
  "recorder.stop": [RecorderStop, RecorderStopResult],
  "recorder.status": [RecorderStatus, RecorderStatusResult],
  // qb-media
  "still.capture": [StillCapture, StillCaptureResult],
  "media.sign": [
    Type.Object({
      path: Type.String(),
      kind: Type.Union([Type.Literal("recording"), Type.Literal("snapshot")]),
      faceSwap: Type.Boolean(),
    }),
    Type.Object({ signed: Type.Boolean(), sidecarPath: Type.String() }),
  ],
  "media.thumbnail": [
    Type.Object({ path: Type.String() }),
    Type.Object({ thumbPath: Type.String() }),
  ],
  // models (qb-core model-manager worker)
  "models.ensure": [ModelsEnsure, ModelsEnsureResult],
  "models.list": [ModelsList, ModelsListResult],
  "models.setByoPath": [ModelsSetByoPath, ModelsSetByoPathResult],
  // library (qb-core DB)
  "library.list": [LibraryList, LibraryListResult],
  "library.delete": [LibraryDelete, LibraryDeleteResult],
} as const satisfies Record<string, [TSchema, TSchema]>;

export type MethodName = keyof typeof Methods;
