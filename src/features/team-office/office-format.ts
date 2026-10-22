/**
 * 办公室场景 · 基础常量与成员类型（单一真相源）
 *
 * 2026-10-22 重做：用户否掉"一张静态 3D 照片"，要求按腾讯 Marvis 的 workbench
 * **逆向出一模一样的白色简洁办公室**。场景不再是位图，而是纯白底 +
 * 白色办公桌/显示器/椅子 + 黑猫成员（彩色围巾），全部由 DOM/SVG 绘制：
 * 桌子/椅子/猫都能跟着真实状态动，缩放/平移仍走同一套舞台 transform。
 * ⇒ 本文件只保留画布尺寸、人数上限与成员状态类型。
 */

/** 场景板尺寸（设计坐标；缩放基准 = contain）。 */
export const CANVAS_W = 1560;
export const CANVAS_H = 1270;

/** 工位上限（用户 10-22 要求从 6 加到 10）。 */
export const TEAM_OFFICE_LIMIT = 10;

/** 成员在办公室里的状态（宿主按引擎事件流归约后传入）。 */
export type OfficeMemberState = {
  id: string;
  name: string;
  /** 正在跑任务 */
  running: boolean;
  /** 有会话但没在跑 */
  hasThread: boolean;
  profession?: string;
};
