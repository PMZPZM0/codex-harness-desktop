export type FrontendDesignStyle = {
  id: string;
  label: string;
  desc: string;
  prompt: string;
  swatches: string[];
};

export const FRONTEND_DESIGN_STYLES: FrontendDesignStyle[];
export const DEFAULT_FRONTEND_DESIGN_STYLE: string;
export function normalizeFrontendDesignStyle(value: unknown): string;
export function frontendDesignPrompt(style: unknown, notes: unknown): string;
