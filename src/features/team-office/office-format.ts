/**
 * 办公室场景 · 基础常量与成员类型（单一真相源）
 *
 * 2026-10-22 重做：预览从"代码绘制的像素小人模拟"改成**交互式 3D 场景**
 * （`assets/office-bg.webp`，1792×960，参考图风格）：场景是静态的，
 * 办公室成员在场景里有固定热点（人物/椅子），点击进入会话 —— 类似安居客漫游。
 * ⇒ 本文件只保留画布尺寸、人数上限与成员状态类型；工位/网格/寻路已随模拟层删除。
 */

/** 场景图画布尺寸（= 底图原生尺寸；底部 64px 水印已裁掉）。 */
export const CANVAS_W = 1792;
export const CANVAS_H = 960;

/** 场景里的人数上限（= 场景热点数；渲染层与宿主共用）。 */
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