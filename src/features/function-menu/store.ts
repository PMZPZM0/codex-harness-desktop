import { useSyncExternalStore } from "react";
import {
  moveFunctionMenuItem,
  normalizeFunctionMenu,
  nudgeFunctionMenuItem,
  resetFunctionMenuLayout,
  setFunctionMenuItemOverflow,
  setFunctionMenuLocation as withLocation,
  type FunctionMenuConfig,
  type FunctionMenuEntryId,
  type FunctionMenuItemId,
  type FunctionMenuLocation,
} from "./menu-model.mjs";

const CONFIG_KEY = "function-menu-v1";
const TOUR_SEEN_KEY = (location: FunctionMenuLocation) => `function-menu-tour-seen-v1-${location}`;

function readConfig(): FunctionMenuConfig {
  try {
    return normalizeFunctionMenu(JSON.parse(localStorage.getItem(CONFIG_KEY) || "null"));
  } catch {
    return normalizeFunctionMenu(null);
  }
}

let config: FunctionMenuConfig = readConfig();
const configListeners = new Set<() => void>();

function persist() {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); } catch { /* 隐私模式：本次仍生效 */ }
  /* 主进程 app-settings.json 才是重启回灌源：强杀进程时 localStorage 最后一次写入可能没落盘。 */
  try {
    void window.codex?.saveAppSettings?.({
      functionMenu: { location: config.location, order: [...config.order], overflow: [...config.overflow] },
    })?.catch(() => undefined);
  } catch { /* 桥不可用时只保留 localStorage */ }
}

function emit() {
  for (const listener of configListeners) {
    try { listener(); } catch { /* 单个订阅者失败不影响其它 */ }
  }
}

export function getFunctionMenuConfig(): FunctionMenuConfig {
  return config;
}

export function subscribeFunctionMenu(listener: () => void): () => void {
  configListeners.add(listener);
  return () => { configListeners.delete(listener); };
}

export function useFunctionMenuConfig(): FunctionMenuConfig {
  return useSyncExternalStore(subscribeFunctionMenu, getFunctionMenuConfig, getFunctionMenuConfig);
}

function update(next: FunctionMenuConfig) {
  config = next;
  persist();
  emit();
}

export function setFunctionMenuLocation(location: FunctionMenuLocation) {
  update(withLocation(config, location));
}

export function moveFunctionMenuItemInMenu(id: FunctionMenuEntryId, target: "visible" | "overflow", beforeId?: FunctionMenuEntryId | null) {
  update(moveFunctionMenuItem(config, id, target, beforeId ?? null));
}

export function toggleFunctionMenuItemOverflow(id: FunctionMenuEntryId, inOverflow: boolean) {
  update(setFunctionMenuItemOverflow(config, id, inOverflow));
}

export function nudgeFunctionMenuItemInMenu(id: FunctionMenuEntryId, delta: number) {
  update(nudgeFunctionMenuItem(config, id, delta));
}

/** 新增自定义入口后把它们并进主列表（可见组末尾）—— ⛔ 不再渲染成独立区块。 */
export function appendFunctionMenuItems(ids: FunctionMenuEntryId[]) {
  let next = config;
  for (const id of ids) next = moveFunctionMenuItem(next, id, "visible", null);
  update(next);
}

/** 删除自定义入口时从 order / overflow 一起摘掉（设置页那边保存由调用方负责）。 */
export function removeFunctionMenuItems(ids: FunctionMenuEntryId[]) {
  const drop = new Set(ids.map(String));
  update(normalizeFunctionMenu({
    ...config,
    order: config.order.filter((id) => !drop.has(String(id))),
    overflow: config.overflow.filter((id) => !drop.has(String(id))),
  }));
}

export function resetFunctionMenuLayoutToDefault() {
  update(resetFunctionMenuLayout(config));
}

/* 启动回灌：主进程保存过 → 以它为准（覆盖 localStorage 的旧值/丢失值）。 */
if (typeof window !== "undefined") {
  try {
    void window.codex?.readAppSettings?.().then((settings) => {
      if (settings?.functionMenu) update(normalizeFunctionMenu(settings.functionMenu));
    }).catch(() => undefined);
  } catch { /* 桥不可用时沿用 localStorage */ }
}

/* ── 编辑菜单弹窗（全局一份，侧栏 / 对话框上方 / 设置页都能打开）────────────── */
let editorOpen = false;
const editorListeners = new Set<() => void>();
function emitEditor() {
  for (const listener of editorListeners) {
    try { listener(); } catch { /* 忽略 */ }
  }
}

export function openFunctionMenuEditor() {
  editorOpen = true;
  emitEditor();
}

export function closeFunctionMenuEditor() {
  editorOpen = false;
  emitEditor();
}

export function subscribeFunctionMenuEditor(listener: () => void): () => void {
  editorListeners.add(listener);
  return () => { editorListeners.delete(listener); };
}

export function useFunctionMenuEditorOpen(): boolean {
  return useSyncExternalStore(subscribeFunctionMenuEditor, () => editorOpen, () => false);
}

/* ── 首次悬停教程（每个位置各一次，落 localStorage）─────────────────────────── */
export type FunctionMenuTourRequest = { location: FunctionMenuLocation; anchor: HTMLElement };
let tourRequest: FunctionMenuTourRequest | null = null;
const tourListeners = new Set<() => void>();

function emitTour() {
  for (const listener of tourListeners) {
    try { listener(); } catch { /* 忽略 */ }
  }
}

export function subscribeFunctionMenuTour(listener: () => void): () => void {
  tourListeners.add(listener);
  return () => { tourListeners.delete(listener); };
}

export function getFunctionMenuTour(): FunctionMenuTourRequest | null {
  return tourRequest;
}

export function maybeShowFunctionMenuTour(location: FunctionMenuLocation, anchor: HTMLElement | null) {
  if (!anchor) return;
  try {
    if (localStorage.getItem(TOUR_SEEN_KEY(location)) === "1") return;
    localStorage.setItem(TOUR_SEEN_KEY(location), "1");
  } catch { /* 隐私模式：每次都显示一次，不拦 */ }
  tourRequest = { location, anchor };
  emitTour();
}

export function dismissFunctionMenuTour() {
  if (!tourRequest) return;
  tourRequest = null;
  emitTour();
}

/* ── 入口动作（侧栏壳注册；对话框上方的菜单也能触发同一套弹窗/设置页）────────── */
let actionHandler: ((id: FunctionMenuItemId) => void) | null = null;

export function setFunctionMenuActionHandler(fn: ((id: FunctionMenuItemId) => void) | null) {
  actionHandler = fn;
}

export function runFunctionMenuAction(id: FunctionMenuItemId) {
  try { actionHandler?.(id); } catch { /* 单个入口失败不影响其它 */ }
}

/* ── 自定义设置页入口（10-29 用户：「功能入口里面的菜单加个自定义添加功能，设置界面里面的每个选项都可以加到这里来」）──
   两件事分开注册，谁拥有数据谁提供：侧栏壳（AppView）按 settingsNav 注册**可选项**与**跳转**；
   功能菜单只消费，不反向 import AppView（域边界）。 */
export type FunctionMenuSettingsTarget = { page: string; label: string; group: string };

let settingsTargets: FunctionMenuSettingsTarget[] = [];
let settingsOpener: ((page: string) => void) | null = null;

export function setFunctionMenuSettingsTargets(list: FunctionMenuSettingsTarget[]) {
  settingsTargets = Array.isArray(list) ? list : [];
  emitCustomMenu();
}

export function getFunctionMenuSettingsTargets(): FunctionMenuSettingsTarget[] {
  return settingsTargets;
}

export function useFunctionMenuSettingsTargets(): FunctionMenuSettingsTarget[] {
  return useSyncExternalStore(subscribeCustomMenu, getFunctionMenuSettingsTargets, getFunctionMenuSettingsTargets);
}

export function setFunctionMenuSettingsOpener(fn: ((page: string) => void) | null) {
  settingsOpener = fn;
}

export function openSettingsFromFunctionMenu(page: string) {
  try { settingsOpener?.(page); } catch { /* 单次跳转失败不影响菜单 */ }
}

/* 扩展项变更（保存 / 删除）后递增一次，菜单与编辑器据此重新拉 extensions:catalog。
   ⛔ 不缓存镜像：目录的唯一真相源是主进程的 extensions.json。 */
let customMenuRevision = 0;
const customMenuListeners = new Set<() => void>();

function emitCustomMenu() {
  customMenuRevision += 1;
  for (const listener of customMenuListeners) {
    try { listener(); } catch { /* 单个订阅者失败不影响其它 */ }
  }
}

export function subscribeCustomMenu(listener: () => void): () => void {
  customMenuListeners.add(listener);
  return () => { customMenuListeners.delete(listener); };
}

export function bumpCustomMenuRevision() {
  emitCustomMenu();
}

export function useCustomMenuRevision(): number {
  return useSyncExternalStore(subscribeCustomMenu, () => customMenuRevision, () => 0);
}
