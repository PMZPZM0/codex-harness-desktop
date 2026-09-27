/**
 * drama-canvas 域的对外面（**唯一入口**）。
 *
 * 跨域引用只许 `from "../drama-canvas"`；⛔ 不许深链域内文件
 * （域内文件也不得对外 export 别的符号 —— 见 docs/ARCHITECTURE-RULES.md §4.2）。
 */
export { DramaCanvas } from "./DramaCanvas";
export type { DramaCanvasProps } from "./DramaCanvas";
