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
 * 六个工位 —— ⛔ 用 PIL 从 bg.webp 里**实测量出**（10-01 逐列采样颜色精测，别目测）：
 * 上排 (264,300) (490,300) (705,300)；下排 (266,470) (491,470) (707,470)。
 * 角色坐进去 = 朝上（ROW_UP）的坐姿列。
 *
 * backrest = 该座位**椅背在背景里的实测矩形**（绝对 y 由 seat.y+dy 推出）：
 *   上排椅背 y≈238-312（顶 = seat.y-62）；下排 y≈433-508（顶 = seat.y-37）。
 *   ⛔⛔ 两排椅子相对座位**高度不同**（差 25px）——共用一个矩形/锚点公式必然弄错一排
 *   （10-01 用户报「上排不自然」的真因：椅背重贴偏下 25px，人物被「拦腰截断」）。
 *   渲染端从 backrest 推导一切：人物顶 = 椅背顶 - 31（露头肩 31px，与下排自然态一致）；
 *   手部动画 y = 椅背顶 - 28（键盘面，两排一致）。
 */
/* ⭐ 显示器内容区（2026-10-04 用户报「显示器内容像一张图、没有动画」）。
 * ⛔⚠️ 这组坐标是**从用户 792×544 截图按 960/792、640/544 换算量出来的**（红框标注 + 像素分析），
 *   **不是猜的**。改这里之前请用量测脚本重测，别凭"看起来差不多"调 ——
 *   屏幕画错位置比不画更难看（会在桌面上飘一个错位的黑框）。
 *   量法：解码 PNG → 找纯红标注像素（R>200 且 G<90 且 B<90）→ 分 x 段得到每个红框
 *        → 逐行数红像素找纵向范围 → ×(960/w) 与 ×(640/h) 换算到画布坐标。
 *   截图中上排框 = 画布 x 417-533 / y 145-207（座位 x=490）⇒ 相对座位 dx=-15 dy=-124。
 *   下排按 y 差 170 平移 ⇒ dy = -124 + 170 = +46。
 *   屏幕内容区 116×62（比红框略小，红框含了显示器外壳）。 */
export const SEATS: (SeatSpot & { backrest: { dx: number; dy: number; w: number; h: number }; screen: { x: number; y: number; w: number; h: number } })[] = [
  { x: 264, y: 300, facing: "up", backrest: { dx: -30, dy: -62, w: 60, h: 74 }, screen: { x: -15, y: -124, w: 116, h: 62 } },
  { x: 490, y: 300, facing: "up", backrest: { dx: -30, dy: -62, w: 60, h: 74 }, screen: { x: -15, y: -124, w: 116, h: 62 } },
  { x: 705, y: 300, facing: "up", backrest: { dx: -30, dy: -62, w: 60, h: 74 }, screen: { x: -15, y: -124, w: 116, h: 62 } },
  { x: 266, y: 470, facing: "up", backrest: { dx: -30, dy: -37, w: 60, h: 75 }, screen: { x: -15, y: 46, w: 116, h: 62 } },
  { x: 491, y: 470, facing: "up", backrest: { dx: -30, dy: -37, w: 60, h: 75 }, screen: { x: -15, y: 46, w: 116, h: 62 } },
  { x: 707, y: 470, facing: "up", backrest: { dx: -30, dy: -37, w: 60, h: 75 }, screen: { x: -15, y: 46, w: 116, h: 62 } },
];

/** 大门落点（新成员从这进）——左下角玻璃门内侧。 */
export const DOOR_SPOT = { x: 64, y: 596 };

/**
 * 椅背重贴矩形（兼容导出：Canvas 里按**每个座位自己的 backrest** 重贴 —— 见 SEATS 注释。
 * 这个常量只保留给「重贴逻辑的默认形状」参考，⛔ 渲染路径读 seat.backrest。）
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
