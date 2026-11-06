/** 群菜单（纯函数，见 team-menu.mjs） */

export interface MenuItem {
  key: string;
  label: string;
  prompt: string;
  disabled: boolean;
  tag: string;
  children: MenuItem[];
}

export interface MenuLeaf {
  key: string;
  label: string;
  fullLabel: string;
  prompt: string;
  tag: string;
  disabled: boolean;
  parentLabel: string;
}

export const MENU_MAX_DEPTH: number;
export const MENU_MAX_ITEMS: number;
export const MENU_MAX_PROMPT_CHARS: number;
export const MENU_PLACEMENTS: readonly MenuPlacement[];
export const MENU_PLACEMENT_LABELS: Record<MenuPlacement, string>;
export type MenuPlacement = "input" | "float";
export function normalizeMenuPlacement(value: unknown): MenuPlacement;
export const DEFAULT_GROUP_MENU: readonly MenuItem[];
export function normalizeMenuItem(entry: unknown, depth?: number): MenuItem | null;
export function normalizeMenu(items: unknown): MenuItem[];
export function shouldShowMenuButton(group: unknown): boolean;
export function flattenMenu(items: unknown): MenuLeaf[];
export function findMenuLeaf(items: unknown, key: string): MenuLeaf | null;
export function addMenuLeaf(items: unknown, leaf: { label: string; prompt: string }): MenuItem[];
export function removeMenuLeaf(items: unknown, key: string): MenuItem[];
export function menuPickResult(items: unknown, key: string): { ok: boolean; prompt: string; message: string };
export const STOP_MENU_ITEM: { key: string; label: string; prompt: string };
