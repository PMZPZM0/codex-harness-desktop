/**
 * 像素办公室 · 格式常量与类型（单一真相源）
 *
 * 精灵格式（MetroCity Free Topdown Character Pack，**CC0 1.0** —— itch.io 官方页
 * 标注 Asset license: CC0，作者确认可商用、署名非必须；本项目另在 CREDITS 备案）：
 *   每张 char_N.png = 112×96 = 7 列 × 3 行，每帧 **16×32**。
 *   列：[0]=站立 [1..5]=走路帧 [6]=坐姿（带电脑）
 *   行：[0]=朝下(面向观众) [1]=朝上(背对) [2]=侧面
 *   走路循环取帧 [0,1,0,2]（起步-迈-收-迈另一边）。
 *
 * ⛔ 事件驱动边界：本域**只吃显式 props**（成员运行态由宿主传入，宿主状态本身由引擎
 *   事件流驱动）—— 域内不订阅引擎、不开 IPC、不读 localStorage 之外的全局。
 */

/** 每帧尺寸（精灵原始像素）。 */
export const FRAME_W = 16;
export const FRAME_H = 32;
/** 画布上精灵放大倍数（整数倍才不会把像素拉糊）。3× = 48×96：手脚与打字动作可辨
 *  （09-30 用户：2× 时手脚看不清、看不出事件状态）。⛔ 改它要同步 OfficeCanvas 的锚点。 */
export const SPRITE_SCALE = 3;
/** 逻辑画布尺寸 = 背景 webp 的原生尺寸（960×640，3:2）。 */
export const CANVAS_W = 960;
export const CANVAS_H = 640;

/** 碰撞网格：每格 32 逻辑像素 ⇒ 30 × 20 格。0=可走 1=阻挡。 */
export const TILE = 32;
export const GRID_COLS = CANVAS_W / TILE; // 30
export const GRID_ROWS = CANVAS_H / TILE; // 20

/** 行号（朝向）。 */
export const ROW_DOWN = 0;
export const ROW_UP = 1;
export const ROW_SIDE = 2;
/** 列号：站立 / 走路帧 1-5 / 坐姿（5、6 是两个坐姿变体 —— 交替播放 = 打字微动画）。 */
export const COL_IDLE = 0;
export const COL_SIT = 6;
export const SIT_FRAMES = [5, 6] as const;
/** 走路循环（列索引序列）。 */
export const WALK_CYCLE = [1, 2, 3, 4] as const;

/** 一个工位：座位点（逻辑像素，角色**脚底/椅面**锚点）+ 朝向。 */
export type SeatSpot = { x: number; y: number; facing: "up" | "down" | "left" | "right" };

/**
 * 六个工位 —— ⛔ 用 PIL 从 bg.webp 里**实测量出**的椅子中心（09-30，别目测）：
 * 上排 (264,300) (490,300) (705,300)；下排 (266,470) (491,470) (707,470)。
 * 角色坐进去 = 朝上（ROW_UP）的坐姿列，锚点=椅面。
 */
export const SEATS: SeatSpot[] = [
  { x: 264, y: 300, facing: "up" },
  { x: 490, y: 300, facing: "up" },
  { x: 705, y: 300, facing: "up" },
  { x: 266, y: 470, facing: "up" },
  { x: 491, y: 470, facing: "up" },
  { x: 707, y: 470, facing: "up" },
];

/** 大门落点（新成员从这进）——左下角玻璃门内侧。 */
export const DOOR_SPOT = { x: 64, y: 596 };

/**
 * 椅背重贴矩形（相对席位中心的偏移；PIL 实测整椅 ≈ 60×64，含扶手）。
 * ⛔ 坐姿成员画完后要把它从**背景图**再贴一遍盖回人物身上 —— 人是坐在椅子里的，
 *   椅背必须挡住下半身、椅子要完整凸显出来；不贴就是"人物把椅子挡住"（09-30 用户实测）。
 *   ⛔ 宽度必须 ≥ 人物宽（3× 时 48px），否则人比椅子宽、两侧盖住椅扶手。
 */
export const CHAIR_BACKREST = { dx: -30, dy: -30, w: 60, h: 64 } as const;

/** 成员在办公室里的一条状态（宿主按引擎事件流归约后传入）。 */
export type OfficeMemberState = {
  id: string;
  name: string;
  /** 正在跑任务 ⇒ 坐工位敲键盘 */
  running: boolean;
  /** 有会话但没在跑 ⇒ 坐工位待机 */
  hasThread: boolean;
  profession?: string;
};

/** 气泡（状态切换时的即时反馈，几秒后自己消失）。 */
export type Bubble = { text: string; until: number };
