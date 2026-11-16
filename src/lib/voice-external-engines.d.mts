export type VoiceExternalCategory = { id: string; name: string };

export type VoiceExternalInstall =
  | { kind: "archive"; format: "7z" | "zip"; version: string; url: string; bytes: number }
  | { kind: "source"; zipUrl: string; commit: string; modelRepo: string; modelFiles: string[] }
  | { kind: "external"; url: string }
  | {
      kind: "python";
      adapter: "f5-tts" | "chatterbox" | "qwen3-tts" | "indextts2";
      python: string;
      torchBackend?: string;
      torch?: string;
      pip?: string[];
      zipUrl?: string;
      commit?: string;
      version?: string;
      editable?: boolean;
      models: (
        | { source: "url"; url: string; dest: string; bytes?: number }
        | { source: "modelscope"; repo: string; dest?: string }
      )[];
    };

export type VoiceExternalEngine = {
  id: string;
  name: string;
  category: string;
  recommended: boolean;
  kind: "engine" | "studio" | "webui";
  adapter: "gpt-sovits" | "cosyvoice3" | "f5-tts" | "chatterbox" | "qwen3-tts" | "indextts2" | null;
  repo: string;
  license: string;
  licenseNote: string;
  commercial: "yes" | "no" | "conditional" | "agpl" | "varies";
  commercialLabel: string;
  badge?: string;
  languages: string;
  sizeLabel: string;
  sizeMB: number;
  vram: string;
  demand: "high" | "medium" | "light";
  hardware: string;
  tagline: string;
  pros: string[];
  cons: string[];
  install: VoiceExternalInstall | null;
};

export const VOICE_EXTERNAL_CATEGORIES: VoiceExternalCategory[];
export const VOICE_EXTERNAL_DEFAULT_IDS: string[];
export const VOICE_EXTERNAL_ENGINES: VoiceExternalEngine[];
export function externalEngineById(id: string): VoiceExternalEngine | null;
export function defaultExternalEngines(): VoiceExternalEngine[];
export function enginesInCategory(category: string): VoiceExternalEngine[];
export function isHighDemand(entry: { demand?: "high" | "medium" | "light" } | null | undefined): boolean;
export function isNonCommercial(entry: VoiceExternalEngine | null | undefined): boolean;
