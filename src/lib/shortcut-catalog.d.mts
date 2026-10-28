/**
 * shortcut-catalog.mjs 的类型面（主进程与渲染层共用同一份运行时代码，声明只此一份）。
 * ⛔ 改 catalog 的字段就同步这里，否则调用方拿到的形状会与实现漂移（TS 不会替你发现 .mjs）。
 */
export type ShortcutOwner = "renderer" | "screenshot" | "voice";
export type ShortcutScope = "app" | "global" | "fixed";

export type ShortcutEntry = {
  id: string;
  group: string;
  label: string;
  desc?: string;
  owner: ShortcutOwner;
  scope: ShortcutScope;
  defaultKeys: string[];
  editable: boolean;
};

export type ShortcutBindings = Record<string, string[]>;

export const SHORTCUT_GROUPS: Array<{ id: string; label: string }>;
export const SHORTCUT_CATALOG: ShortcutEntry[];

export function normalizeBinding(input: string): string;
export function normalizeBindings(keys: string[] | string): string[];
export function bindingLabel(keys: string[] | string, isMac: boolean): string;
export function bindingMatches(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }, binding: string, isMac: boolean): boolean;
export function findConflicts(bindings?: ShortcutBindings): string[][];
export function defaultBindings(): ShortcutBindings;
export function editableShortcutIds(): string[];
