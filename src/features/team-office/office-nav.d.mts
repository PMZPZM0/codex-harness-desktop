/** 办公室地面寻路（实现见 ./office-nav.mjs；⛔ 只声明导出面，别把实现抄过来） */
export type UV = { u: number; v: number };
export type NavGrid = { cols: number; rows: number; blocked: Uint8Array };

export const NAV_COLS: number;
export const NAV_ROWS: number;

export function cellOf(u: number, v: number, grid: NavGrid): { cx: number; cy: number };
export function uvOf(cx: number, cy: number, grid: NavGrid): UV;
export function isBlocked(grid: NavGrid, cx: number, cy: number): boolean;
export function buildWalkGrid(deskUV: UV[], cols?: number, rows?: number): NavGrid;
export function nearestFree(
  grid: NavGrid,
  cx: number,
  cy: number,
  maxRing?: number,
): { cx: number; cy: number } | null;
export function simplify(points: UV[]): UV[];
export function findPath(from: UV, to: UV, grid: NavGrid): UV[] | null;
export function pathLength(points: Array<{ x: number; y: number }>): number;
