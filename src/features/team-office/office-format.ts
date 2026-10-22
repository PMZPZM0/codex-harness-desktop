/**
 * 办公室场景 · 基础常量与成员类型（单一真相源）
 *
 * 2026-10-22 重做：用户否掉"一张静态 3D 照片"，要求按腾讯 Marvis 的 workbench
 * **逆向出一模一样的白色简洁办公室**。现行 = 纯白底 + 本仓生成的白色 3D 家具图
 * （桌/椅/设施，白底 multiply）+ 黑猫成员（DOM/SVG，彩色围巾）；
 * 一页 6 个工位（2×3），10 人分页；缩放/平移仍走同一套舞台 transform。
 * ⇒ 本文件只保留画布尺寸、人数上限与成员状态类型。
 */

/** 场景板尺寸（设计坐标；缩放基准 = contain；一页 6 个工位）。 */
export const CANVAS_W = 1500;
export const CANVAS_H = 1360;

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
