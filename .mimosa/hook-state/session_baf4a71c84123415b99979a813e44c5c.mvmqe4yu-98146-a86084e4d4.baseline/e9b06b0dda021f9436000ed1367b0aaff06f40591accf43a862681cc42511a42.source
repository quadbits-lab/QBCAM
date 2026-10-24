import { create } from "zustand";

export type Tab = "studio" | "identities" | "library" | "models" | "settings";

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
}

interface StudioState {
  tab: Tab;
  setTab: (t: Tab) => void;

  pipelineOn: boolean;
  bypass: boolean;
  recording: boolean;
  vcamOn: boolean;
  stats: Stats;
  faces: FaceBox[];
  serviceStates: Record<string, string>;
  previewPort: number | null;
  previewToken: string | null;
  selectedIdentity: string | null;
  identities: Identity[];
  library: LibraryItem[];
  models: ModelState[];
  error: string | null;
  toast: string | null;

  setPipelineOn: (v: boolean) => void;
  setBypass: (v: boolean) => void;
  setRecording: (v: boolean) => void;
  setVcamOn: (v: boolean) => void;
  setStats: (s: Stats) => void;
  setFaces: (f: FaceBox[]) => void;
  setServiceStates: (s: Record<string, string>) => void;
  setPreview: (port: number, token: string) => void;
  setIdentities: (i: Identity[]) => void;
  setLibrary: (l: LibraryItem[]) => void;
  setModels: (m: ModelState[]) => void;
  setSelectedIdentity: (id: string | null) => void;
  setError: (e: string | null) => void;
  setToast: (t: string | null) => void;
}

export const useStudio = create<StudioState>((set) => ({
  tab: "studio",
  setTab: (tab) => set({ tab }),

  pipelineOn: false,
  bypass: false,
  recording: false,
  vcamOn: false,
  stats: { fps: 0, frameMs: 0, faces: 0, executionProvider: "n/a", bypassed: false },
  faces: [],
  serviceStates: {},
  previewPort: null,
  previewToken: null,
  selectedIdentity: null,
  identities: [],
  library: [],
  models: [],
  error: null,
  toast: null,

  setPipelineOn: (pipelineOn) => set({ pipelineOn }),
  setBypass: (bypass) => set({ bypass }),
  setRecording: (recording) => set({ recording }),
  setVcamOn: (vcamOn) => set({ vcamOn }),
  setStats: (stats) => set({ stats }),
  setFaces: (faces) => set({ faces }),
  setServiceStates: (serviceStates) => set({ serviceStates }),
  setPreview: (previewPort, previewToken) => set({ previewPort, previewToken }),
  setIdentities: (identities) => set({ identities }),
  setLibrary: (library) => set({ library }),
  setModels: (models) => set({ models }),
  setSelectedIdentity: (selectedIdentity) => set({ selectedIdentity }),
  setError: (error) => set({ error }),
  setToast: (toast) => set({ toast }),
}));
