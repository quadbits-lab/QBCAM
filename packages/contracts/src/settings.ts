/** App settings — reference shape from spec Appendix B. */
import { Type, type Static } from "@sinclair/typebox";

export const SettingsSchema = Type.Object({
  schema: Type.Integer(),
  camera: Type.Object({
    deviceId: Type.String({ default: "auto" }),
    width: Type.Integer({ default: 1280 }),
    height: Type.Integer({ default: 720 }),
    fps: Type.Number({ default: 30 }),
    format: Type.String({ default: "MJPG" }),
  }),
  pipeline: Type.Object({
    preset: Type.Union([
      Type.Literal("fast"),
      Type.Literal("balanced"),
      Type.Literal("quality"),
    ], { default: "balanced" }),
    executionProvider: Type.String({ default: "auto" }),
    failSafe: Type.Union([
      Type.Literal("slate"),
      Type.Literal("freeze"),
      Type.Literal("passthrough"),
    ], { default: "slate" }),
    adaptiveQuality: Type.Boolean({ default: true }),
    multiFace: Type.Object({
      mode: Type.Union([
        Type.Literal("largest"),
        Type.Literal("index"),
        Type.Literal("all"),
        Type.Literal("tracked"),
      ], { default: "largest" }),
      max: Type.Integer({ minimum: 1, maximum: 4, default: 2 }),
    }),
  }),
  blend: Type.Object({
    feather: Type.Number({ minimum: 0, maximum: 1, default: 0.6 }),
    colorMatch: Type.Number({ minimum: 0, maximum: 1, default: 0.5 }),
    sharpen: Type.Number({ minimum: 0, maximum: 1, default: 0.2 }),
    keepMouth: Type.Boolean({ default: true }),
    keepEyes: Type.Boolean({ default: false }),
  }),
  enhance: Type.Object({
    enabled: Type.Boolean({ default: false }),
    strength: Type.Number({ minimum: 0, maximum: 1, default: 0.5 }),
    everyN: Type.Integer({ minimum: 1, default: 2 }),
  }),
  vcam: Type.Object({
    enabled: Type.Boolean({ default: false }),
    name: Type.String({ default: "QBCAM Virtual Camera" }),
    width: Type.Integer({ default: 1280 }),
    height: Type.Integer({ default: 720 }),
    fps: Type.Integer({ default: 30 }),
    mirror: Type.Boolean({ default: false }),
  }),
  record: Type.Object({
    container: Type.Union([
      Type.Literal("mp4"),
      Type.Literal("mkv"),
      Type.Literal("webm"),
    ], { default: "mp4" }),
    codec: Type.Union([
      Type.Literal("h264"),
      Type.Literal("hevc"),
      Type.Literal("vp9"),
    ], { default: "h264" }),
    quality: Type.String({ default: "cq20" }),
    audio: Type.Union([
      Type.Literal("aac"),
      Type.Literal("opus"),
      Type.Literal("off"),
    ], { default: "aac" }),
    dualTrack: Type.Boolean({ default: false }),
    dir: Type.String({ default: "~/QBCAM/Recordings" }),
  }),
  trust: Type.Object({
    invisibleWatermark: Type.Boolean({ default: true }),
    visibleWatermark: Type.Boolean({ default: false }),
    c2pa: Type.Boolean({ default: true }),
  }),
  privacy: Type.Object({
    telemetry: Type.Boolean({ default: false }),
    crashReports: Type.Boolean({ default: false }),
  }),
  hotkeys: Type.Object({
    toggleSwap: Type.String({ default: "Ctrl+Shift+S" }),
    bypass: Type.String({ default: "F9" }),
    record: Type.String({ default: "Ctrl+Shift+R" }),
    snapshot: Type.String({ default: "Ctrl+Shift+P" }),
    vcam: Type.String({ default: "Ctrl+Shift+V" }),
  }),
});

export type Settings = Static<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  schema: 1,
  camera: { deviceId: "auto", width: 1280, height: 720, fps: 30, format: "MJPG" },
  pipeline: {
    preset: "balanced",
    executionProvider: "auto",
    failSafe: "slate",
    adaptiveQuality: true,
    multiFace: { mode: "largest", max: 2 },
  },
  blend: { feather: 0.6, colorMatch: 0.5, sharpen: 0.2, keepMouth: true, keepEyes: false },
  enhance: { enabled: false, strength: 0.5, everyN: 2 },
  vcam: {
    enabled: false,
    name: "QBCAM Virtual Camera",
    width: 1280,
    height: 720,
    fps: 30,
    mirror: false,
  },
  record: {
    container: "mp4",
    codec: "h264",
    quality: "cq20",
    audio: "aac",
    dualTrack: false,
    dir: "~/QBCAM/Recordings",
  },
  trust: { invisibleWatermark: true, visibleWatermark: false, c2pa: true },
  privacy: { telemetry: false, crashReports: false },
  hotkeys: {
    toggleSwap: "Ctrl+Shift+S",
    bypass: "F9",
    record: "Ctrl+Shift+R",
    snapshot: "Ctrl+Shift+P",
    vcam: "Ctrl+Shift+V",
  },
};

/** UI ↔ core RPC (Electrobun defineRPC surface, spec §10.1). */
export const UiRequests = {
  getSettings: Type.Object({}),
  setSettings: Type.Object({ patch: Type.Unknown() }),
  listIdentities: Type.Object({}),
  importIdentity: Type.Object({
    paths: Type.Array(Type.String()),
    name: Type.String(),
    consentStatement: Type.String(),
  }),
  deleteIdentity: Type.Object({ identityId: Type.String() }),
  listLibrary: Type.Object({}),
  startPipeline: Type.Object({ identityId: Type.Union([Type.String(), Type.Null()]) }),
  stopPipeline: Type.Object({}),
  setPreset: Type.Object({ preset: Type.String() }),
  setBlend: Type.Object({ patch: Type.Unknown() }),
  bypass: Type.Object({ on: Type.Boolean() }),
  startRecording: Type.Object({}),
  stopRecording: Type.Object({}),
  captureStill: Type.Object({ format: Type.String() }),
  toggleVcam: Type.Object({ on: Type.Boolean() }),
  listCameras: Type.Object({}),
  listModels: Type.Object({}),
  ensureModels: Type.Object({ modelIds: Type.Array(Type.String()) }),
  setByoModel: Type.Object({
    modelId: Type.String(),
    path: Type.String(),
    licenseAccepted: Type.Boolean(),
  }),
  getServiceStates: Type.Object({}),
} as const;

export const UiEvents = {
  "pipeline.stats": Type.Object({ fps: Type.Number(), frameMs: Type.Number(), faces: Type.Integer(), executionProvider: Type.String(), bypassed: Type.Boolean() }),
  "pipeline.faces": Type.Array(Type.Object({ trackId: Type.Integer(), x: Type.Number(), y: Type.Number(), w: Type.Number(), h: Type.Number() })),
  "recorder.progress": Type.Object({ seconds: Type.Number(), bytes: Type.Integer() }),
  "service.state": Type.Object({ service: Type.String(), state: Type.String() }),
  "models.progress": Type.Object({ modelId: Type.String(), stage: Type.String(), percent: Type.Number() }),
  "vcam.state": Type.Object({ on: Type.Boolean(), activeClients: Type.Integer() }),
} as const;
