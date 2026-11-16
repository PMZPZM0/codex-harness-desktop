export type VoiceExternalCategory = { id: string; name: string };

export type VoiceExternalInstall =
  | { kind: "archive"; format: "7z" | "zip"; version: string; url: string; bytes: number }
  | { kind: "source"; zipUrl: string; commit: string; modelRepo: string; modelFiles: string[] }
  | { kind: "external"; url: string };

export type VoiceExternalEngine = {
  id: string;
  name: string;
  category: string;
  recommended: boolean;
  kind: "engine" | "studio" | "webui";
  adapter: "gpt-sovits" | "cosyvoice3" | null;
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
export function isNonCommercial(entry: VoiceExternalEngine | null | undefined): boolean;
