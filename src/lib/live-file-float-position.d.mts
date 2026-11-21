/** 实时文件浮窗落位（.mjs）的类型声明；⛔ 与 .mjs 导出保持同步。 */
export declare function placeLiveFileFloat(input: {
  vw: number;
  vh: number;
  height: number;
  anchor?: { top: number; bottom: number } | null;
  composer?: { top: number; bottom: number; left: number; width: number } | null;
}): { left: number; width: number; top: number; maxHeight: number };
