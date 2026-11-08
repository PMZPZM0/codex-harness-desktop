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

/** 取当前功能菜单配置（`useSyncExternalStore` 的快照读点，只读）。 */
export function getFunctionMenuConfig(): FunctionMenuConfig {
  return config;
}

/** 订阅菜单配置变化，返回退订函数（外部 store 形态，供 React 与命令式调用共用）。 */
export function subscribeFunctionMenu(listener: () => void): () => void {
  configListeners.add(listener);
  return () => { configListeners.delete(listener); };
}

/** React 侧读菜单配置：走 `useSyncExternalStore`，配置一变组件即重渲。 */
export function useFunctionMenuConfig(): FunctionMenuConfig {
  return useSyncExternalStore(subscribeFunctionMenu, getFunctionMenuConfig, getFunctionMenuConfig);
}

function update(next: FunctionMenuConfig) {
  config = next;
  persist();
  emit();
}

/** 切换菜单的挂载位置（侧栏 / 对话框上方等，取值由 `menu-model.mjs` 归一化）。 */
export function setFunctionMenuLocation(location: FunctionMenuLocation) {
  update(withLocation(config, location));
}

/** 把一个条目挪到「可见区 / 更多区」；`beforeId` 给插队目标，null = 追加到末尾。 */
export function moveFunctionMenuItemInMenu(id: FunctionMenuEntryId, target: "visible" | "overflow", beforeId?: FunctionMenuEntryId | null) {
  update(moveFunctionMenuItem(config, id, target, beforeId ?? null));
}

/** 按布尔值把条目收进或放出「更多」（编辑器的开关一行的唯一入口）。 */
export function toggleFunctionMenuItemOverflow(id: FunctionMenuEntryId, inOverflow: boolean) {
  update(setFunctionMenuItemOverflow(config, id, inOverflow));
}

/** 在当前区内上下微调条目次序；`delta` 正数往后、负数往前，越界由模型层钳制。 */
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

/** 恢复出厂菜单布局（用户点「恢复默认」；只重置 order/overflow，不动已存的自定义入口）。 */
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

/** 打开「编辑菜单」弹窗（全局一份状态，侧栏与设置页共用）。 */
export function openFunctionMenuEditor() {
  editorOpen = true;
  emitEditor();
}

/** 关闭「编辑菜单」弹窗。 */
export function closeFunctionMenuEditor() {
  editorOpen = false;
  emitEditor();
}

/** 订阅编辑器开合状态，返回退订函数。 */
export function subscribeFunctionMenuEditor(listener: () => void): () => void {
  editorListeners.add(listener);
  return () => { editorListeners.delete(listener); };
}

/** React 侧读「编辑器是否打开」（服务端快照给 false，SSR 安全）。 */
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

/** 订阅新手引导（首次悬停教程）的变化，返回退订函数。 */
export function subscribeFunctionMenuTour(listener: () => void): () => void {
  tourListeners.add(listener);
  return () => { tourListeners.delete(listener); };
}

/** 取当前待展示的引导请求；没有则 null（已展示过 / 还没触发）。 */
export function getFunctionMenuTour(): FunctionMenuTourRequest | null {
  return tourRequest;
}

/** 按位置**每处只播一次**地触发引导（已看过直接返回）；`anchor` 为空（菜单没挂上）时什么都不做。 */
export function maybeShowFunctionMenuTour(location: FunctionMenuLocation, anchor: HTMLElement | null) {
  if (!anchor) return;
  try {
    if (localStorage.getItem(TOUR_SEEN_KEY(location)) === "1") return;
    localStorage.setItem(TOUR_SEEN_KEY(location), "1");
  } catch { /* 隐私模式：每次都显示一次，不拦 */ }
  tourRequest = { location, anchor };
  emitTour();
}

/** 用户看完或跳过引导：清掉待展示请求并通知订阅者。 */
export function dismissFunctionMenuTour() {
  if (!tourRequest) return;
  tourRequest = null;
  emitTour();
}

/* ── 入口动作（侧栏壳注册；对话框上方的菜单也能触发同一套弹窗/设置页）────────── */
let actionHandler: ((id: FunctionMenuItemId) => void) | null = null;

/** 注册「点条目」的执行器；由宿主（侧栏壳）注入，⛔ 本模块不反向依赖业务组件。 */
export function setFunctionMenuActionHandler(fn: ((id: FunctionMenuItemId) => void) | null) {
  actionHandler = fn;
}

/** 执行某个菜单条目的动作；没注册执行器或执行抛错都静默（不连累其余入口）。 */
export function runFunctionMenuAction(id: FunctionMenuItemId) {
  try { actionHandler?.(id); } catch { /* 单个入口失败不影响其它 */ }
}

/* ── 自定义设置页入口（10-29 用户：「功能入口里面的菜单加个自定义添加功能，设置界面里面的每个选项都可以加到这里来」）──
   两件事分开注册，谁拥有数据谁提供：侧栏壳（AppView）按 settingsNav 注册**可选项**与**跳转**；
   功能菜单只消费，不反向 import AppView（域边界）。 */
export type FunctionMenuSettingsTarget = { page: string; label: string; group: string };

let settingsTargets: FunctionMenuSettingsTarget[] = [];
let settingsOpener: ((page: string) => void) | null = null;

/** 登记「可加进菜单的设置页」清单（数据源是宿主的 settingsNav，本模块只存快照并广播）。 */
export function setFunctionMenuSettingsTargets(list: FunctionMenuSettingsTarget[]) {
  settingsTargets = Array.isArray(list) ? list : [];
  emitCustomMenu();
}

/** 读已登记的可选设置页清单（快照读点）。 */
export function getFunctionMenuSettingsTargets(): FunctionMenuSettingsTarget[] {
  return settingsTargets;
}

/** React 侧读可选设置页清单（随自定义菜单版本号变化）。 */
export function useFunctionMenuSettingsTargets(): FunctionMenuSettingsTarget[] {
  return useSyncExternalStore(subscribeCustomMenu, getFunctionMenuSettingsTargets, getFunctionMenuSettingsTargets);
}

/** 注册「打开设置页」的回调（宿主注入；域边界原因同上）。 */
export function setFunctionMenuSettingsOpener(fn: ((page: string) => void) | null) {
  settingsOpener = fn;
}

/** 从菜单跳到某个设置页；回调缺失或抛错都静默。 */
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

/** 订阅「自定义入口目录」版本号变化，返回退订函数。 */
export function subscribeCustomMenu(listener: () => void): () => void {
  customMenuListeners.add(listener);
  return () => { customMenuListeners.delete(listener); };
}

/** 手动把版本号加一（保存/删除自定义入口后调用，菜单与编辑器据此重拉 catalog）。 */
export function bumpCustomMenuRevision() {
  emitCustomMenu();
}

/** React 侧读自定义菜单版本号（服务端快照 0，SSR 安全）。 */
export function useCustomMenuRevision(): number {
  return useSyncExternalStore(subscribeCustomMenu, () => customMenuRevision, () => 0);
}
