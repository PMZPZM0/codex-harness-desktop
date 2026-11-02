export type FrontendDesignRef = {
  name: string;
  url: string;
};

export type FrontendDesignStyle = {
  id: string;
  label: string;
  desc: string;
  prompt: string;
  spec: string;
  swatches: string[];
  refs: FrontendDesignRef[];
  materials: FrontendDesignRef[];
};

export const FRONTEND_DESIGN_STYLES: FrontendDesignStyle[];
export const FRONTEND_REFERENCE_SYSTEMS: FrontendDesignRef[];
export const DEFAULT_FRONTEND_DESIGN_STYLE: string;
export function normalizeFrontendDesignStyle(value: unknown): string;
export function frontendDesignPrompt(style: unknown, notes: unknown, enabled?: boolean): string;
