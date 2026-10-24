import { create } from "zustand";

export type Tab = "studio" | "identities" | "library" | "models" | "settings";
export type AppMode = "loading" | "onboarding" | "app";
export type PermissionState = "granted" | "denied" | "unknown";

export interface Stats {
  fps: number;
  frameMs: number;
  faces: number;
  executionProvider: string;
  bypassed: boolean;
}

export interface FaceBox {
  trackId: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Identity {
  id: string;
  name: string;
  thumbPath: string | null;
  tags: string[];
  quality: number;
  createdAt: number;
  consentAttestedAt: number | null;
}

export interface LibraryItem {
  id: string;
  kind: "recording" | "snapshot";
  path: string;
  bytes: number;
  durationMs?: number;
  createdAt: number;
  provenanceSigned: boolean;
}

export interface ModelState {
  id: string;
  kind: string;
  version: string;
  installed: boolean;
  licenseSpdx: string;
  commercialUse: boolean;
  byo: boolean;
  byoPath?: string | null;
  installedPath?: string | null;
}

export interface DeviceInfo {
  id: string;
  name: string;
  kind: "camera" | "screen" | "audio" | "fake" | "file" | string;
}

export interface OnboardingState {
  schema: number;
  completedAt: number | null;
  cameraMode: "device" | "synthetic";
  cameraPermission: PermissionState;
  microphonePermission: PermissionState;
  microphoneDeviceId: string | null;
  detectorReadyAt: number | null;
}

export interface CameraSettings {
  deviceId: string;
  width: number;
  height: number;
  fps: number;
  format: string;
}

export interface SetupStatus {
  onboarding: OnboardingState;
  camera: CameraSettings;
  cameras: DeviceInfo[];
  audio: DeviceInfo[];
  ffmpeg: boolean;
  detector: { installed: boolean; path: string | null };
  models: ModelState[];
  services: Array<{ name: string; state: string }>;
}

export interface DegradedState {
  reason: string;
  error?: string;
}

export interface Toast {
  message: string;
  kind?: "info" | "success" | "error";
}

interface StudioState {
  tab: Tab;
  setTab: (t: Tab) => void;

  appMode: AppMode;
  setAppMode: (m: AppMode) => void;
  setup: SetupStatus | null;
  setSetup: (s: SetupStatus | null) => void;
  setupError: string | null;
  setSetupError: (e: string | null) => void;

  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;

  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  pipelineOn: boolean;
  activeDeviceId: string | null;
  synthetic: boolean;
  bypass: boolean;
  recording: boolean;
  vcamOn: boolean;
  stats: Stats;
  faces: FaceBox[];
  degraded: DegradedState | null;
  recorderSeconds: number;
  serviceStates: Record<string, string>;
  previewPort: number | null;
  previewToken: string | null;
  selectedIdentity: string | null;
  identities: Identity[];
  library: LibraryItem[];
  models: ModelState[];
  modelProgress: Record<string, { stage: string; percent: number }>;
  error: string | null;
  toast: Toast | null;

  setPipelineOn: (v: boolean) => void;
  setActiveDevice: (id: string | null, synthetic: boolean) => void;
  setBypass: (v: boolean) => void;
  setRecording: (v: boolean) => void;
  setVcamOn: (v: boolean) => void;
  setStats: (s: Stats) => void;
  setFaces: (f: FaceBox[]) => void;
  setDegraded: (d: DegradedState | null) => void;
  setRecorderSeconds: (s: number) => void;
  setServiceStates: (s: Record<string, string>) => void;
  setPreview: (port: number, token: string) => void;
  setIdentities: (i: Identity[]) => void;
  setLibrary: (l: LibraryItem[]) => void;
  setModels: (m: ModelState[]) => void;
  setModelProgress: (id: string, progress: { stage: string; percent: number } | null) => void;
  setSelectedIdentity: (id: string | null) => void;
  setError: (e: string | null) => void;
  setToast: (t: Toast | null) => void;
}

export const useStudio = create<StudioState>((set) => ({
  tab: "studio",
  setTab: (tab) => set({ tab }),

  appMode: "loading",
  setAppMode: (appMode) => set({ appMode }),
  setup: null,
  setSetup: (setup) => set({ setup }),
  setupError: null,
  setSetupError: (setupError) => set({ setupError }),

  theme: (localStorage.getItem("qbcam.theme") as "dark" | "light") ?? "dark",
  setTheme: (theme) => {
    localStorage.setItem("qbcam.theme", theme);
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.classList.toggle("dark", theme === "dark");
    set({ theme });
  },

  sidebarCollapsed: localStorage.getItem("qbcam.sidebar") === "collapsed",
  toggleSidebar: () =>
    set((s) => {
      const sidebarCollapsed = !s.sidebarCollapsed;
      localStorage.setItem("qbcam.sidebar", sidebarCollapsed ? "collapsed" : "open");
      return { sidebarCollapsed };
    }),

  pipelineOn: false,
  activeDeviceId: null,
  synthetic: false,
  bypass: false,
  recording: false,
  vcamOn: false,
  stats: { fps: 0, frameMs: 0, faces: 0, executionProvider: "n/a", bypassed: false },
  faces: [],
  degraded: null,
  recorderSeconds: 0,
  serviceStates: {},
  previewPort: null,
  previewToken: null,
  selectedIdentity: null,
  identities: [],
  library: [],
  models: [],
  modelProgress: {},
  error: null,
  toast: null,

  setPipelineOn: (pipelineOn) => set({ pipelineOn }),
  setActiveDevice: (activeDeviceId, synthetic) => set({ activeDeviceId, synthetic }),
  setBypass: (bypass) => set({ bypass }),
  setRecording: (recording) => set({ recording, recorderSeconds: 0 }),
  setVcamOn: (vcamOn) => set({ vcamOn }),
  setStats: (stats) => set({ stats }),
  setFaces: (faces) => set({ faces }),
  setDegraded: (degraded) => set({ degraded }),
  setRecorderSeconds: (recorderSeconds) => set({ recorderSeconds }),
  setServiceStates: (serviceStates) => set({ serviceStates }),
  setPreview: (previewPort, previewToken) => set({ previewPort, previewToken }),
  setIdentities: (identities) => set({ identities }),
  setLibrary: (library) => set({ library }),
  setModels: (models) => set({ models }),
  setModelProgress: (id, progress) =>
    set((s) => {
      const next = { ...s.modelProgress };
      if (progress) next[id] = progress;
      else delete next[id];
      return { modelProgress: next };
    }),
  setSelectedIdentity: (selectedIdentity) => set({ selectedIdentity }),
  setError: (error) => set({ error }),
  setToast: (toast) => set({ toast }),
}));
