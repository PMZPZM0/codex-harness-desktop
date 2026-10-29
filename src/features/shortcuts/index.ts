/**
 * shortcuts barrel（10-29）：域间只经 barrel，禁深链内部文件（预检【130】）。
 * 对外三样：useShortcuts（读写绑定）、ShortcutsDialog（快捷键弹窗）、ShortcutBindings 类型。
 */
export { useShortcuts, type ShortcutBindings } from "./use-shortcuts";
export { ShortcutsDialog } from "./ShortcutsDialog";
