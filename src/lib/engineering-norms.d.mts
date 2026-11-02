export type EngineeringNormRef = {
  name: string;
  url: string;
};

export type EngineeringNormPreset = {
  id: string;
  label: string;
  desc: string;
  spec: string;
  refs: EngineeringNormRef[];
};

export const SOFTWARE_DEV_NORMS: EngineeringNormPreset[];
export const APP_ARCHITECTURE_NORMS: EngineeringNormPreset[];
export const DEFAULT_SOFTWARE_DEV_NORM: string;
export const DEFAULT_APP_ARCHITECTURE_NORM: string;
export function normalizeSoftwareDevNorm(value: unknown): string;
export function normalizeAppArchitectureNorm(value: unknown): string;
export function softwareDevNormsPrompt(style: unknown, notes: unknown, enabled?: boolean): string;
export function appArchitectureNormsPrompt(style: unknown, notes: unknown, enabled?: boolean): string;
export function engineeringNormsPrompt(input: {
  softwareDevStyle?: string;
  softwareDevNotes?: string;
  softwareDevEnabled?: boolean;
  appArchitectureStyle?: string;
  appArchitectureNotes?: string;
  appArchitectureEnabled?: boolean;
}): string;
export function personalNormsPrompt(input: {
  frontendDesignStyle?: string;
  frontendDesignNotes?: string;
  frontendDesignEnabled?: boolean;
  softwareDevStyle?: string;
  softwareDevNotes?: string;
  softwareDevEnabled?: boolean;
  appArchitectureStyle?: string;
  appArchitectureNotes?: string;
  appArchitectureEnabled?: boolean;
}): string;
