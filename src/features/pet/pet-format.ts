/**
 * 桌面宠物 · 格式常量与取图（纯函数，无 React / 无 Electron）。
 *
 * 官方 Codex 宠物格式（实测自引擎二进制 + petdex 公开规范，两者逐字吻合）：
 *   · 宠物包 = `pet.json` + 图集（`spritesheet.png` / `.webp`）
 *   · 图集 = 8 列 × N 行，每帧默认 **192×208**；v1 九行、v2 十一行
 *   · 九态行名（**顺序即行序**，⛔ 不可重排/增删 —— 引擎与各客户端都按行号取图）：
 *       idle / running-right / running-left / waving / jumping / failed / waiting / running / review
 *
 * 本文件是渲染层对该格式的**唯一解读处**：行号换算、帧换算、取图 URL 都在这里，
 * 视图组件不自己算（避免同一套算术散落多处、各算各的）。
 */

/** 官方 v1 九态行名（顺序即行序）。 */
export const PET_STATES = [
  "idle",
  "running-right",
  "running-left",
  "waving",
  "jumping",
  "failed",
  "waiting",
  "running",
  "review",
] as const;

export type PetStateId = (typeof PET_STATES)[number];

/** pet.json 未声明时的官方默认几何。 */
export const PET_DEFAULT_COLUMNS = 8;
export const PET_DEFAULT_ROWS = 9;
export const PET_DEFAULT_FRAME = { width: 192, height: 208 };

/** 每帧停留时长（8 帧 ≈ 0.9s 一轮）。官方没规定帧率，这个值在"看得出在动"与"不闹腾"之间。 */
export const PET_FRAME_MS = 110;

/**
 * 取图 URL：走主进程注册的**窄口径** `pet://` 协议
 * （白名单 = 宠物目录，见 electron/features/pet-ipc.ts 的 petRoots；不放宽 harness-image 的可信根）。
 */
export function petAssetUrl(absPath: string): string {
  return `pet://asset/?path=${encodeURIComponent(absPath)}`;
}

/** 状态名 → 行号。包里没声明该行时回落 0（idle），⛔ 不抛错 —— 缺行也要能显示。 */
export function petRowOf(states: readonly string[], state: string): number {
  const index = states.indexOf(state);
  return index >= 0 ? index : 0;
}

/**
 * 一帧的 `background-size` / `background-position`。
 * 渲染尺寸按「窗口高度的 ratio 倍」给整帧高度 —— 窗口尺寸本身已随 scale 变，
 * 所以这里只负责把 192×208 的原始帧等比放到目标框内。
 */
export function petFrameStyle(
  pkg: { columns: number; rows: number; frameWidth: number; frameHeight: number },
  row: number,
  column: number,
  renderedFrameHeight: number,
) {
  const k = renderedFrameHeight / pkg.frameHeight;
  return {
    width: `${pkg.frameWidth * k}px`,
    height: `${renderedFrameHeight}px`,
    backgroundSize: `${pkg.columns * pkg.frameWidth * k}px ${pkg.rows * pkg.frameHeight * k}px`,
    backgroundPosition: `${-column * pkg.frameWidth * k}px ${-row * pkg.frameHeight * k}px`,
  };
}
