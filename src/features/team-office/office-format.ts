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
 * ⛔⚠️⛔ 这组坐标**第一版是错的**（从用户 792×544 截图按 960/792、640/544 换算量出来的）——
 *   **那份截图是缩放过的**，换算出的 y 偏了 **91px** ⇒ 屏幕画在 y≈176，
 *   而真屏面在 y≈267 ⇒ **黑色内容区直接盖在桌子上**（用户截图里三个大黑块）。
 *   ⓘ 教训：**不要从"用户的截图"反推画布坐标** —— 截图可能经过缩放/留白。
 *     有原始素材就直接在**素材本身**上量。
 *
 * ✅ 现在的值是**直接扫背景图 `assets/bg.webp`（960×640，与画布 1:1）** 得到的屏面矩形：
 *     上排：x 241-293/y 253-282 · x 460-517/y 253-282 · x 677-734/y 253-283
 *     下排：x 240-292/y 447-476 · x 464-518/y 447-478 · x 677-729/y 447-478
 *   识别屏面的判据：像素 `rgb(36,50,75)` 一带（暗且 B > R+20）。
 *
 * 🔧 重测方法（PIL，可复现）：
 *     from PIL import Image
 *     im = Image.open('src/features/team-office/assets/bg.webp').convert('RGB'); px = im.load()
 *     isScreen = lambda r,g,b: (r+g+b) < 260 and b > r+20 and 30 <= r <= 90 and 40 <= g <= 110
 *     # 逐行取长度 > 30 的连续段 → 按「相邻 y 且 x 范围相近」聚成矩形
 *
 * ⚠️ 屏面尺寸**逐个不同**（53/58/58/53/55/53 宽、30-32 高）—— 背景图是手绘像素风，
 *   显示器尺寸本来就不齐。⛔ 不要图省事写一个统一值，会有一两个错位。
 *   这里给的是**各屏面的实测值**，另留 1px 内缩（w-2/h-2）避免压到屏幕边框高光上。 */
export const SEATS: (SeatSpot & { backrest: { dx: number; dy: number; w: number; h: number }; screen: { x: number; y: number; w: number; h: number } })[] = [
  // 屏面坐标已换算成**相对座位**的偏移（screen.x = 屏面左 - 座位 x，screen.y = 屏面上 - 座位 y）
  { x: 264, y: 300, facing: "up", backrest: { dx: -30, dy: -62, w: 60, h: 74 }, screen: { x: -23, y: -47, w: 53, h: 30 } },
  { x: 490, y: 300, facing: "up", backrest: { dx: -30, dy: -62, w: 60, h: 74 }, screen: { x: -30, y: -47, w: 58, h: 30 } },
  { x: 705, y: 300, facing: "up", backrest: { dx: -30, dy: -62, w: 60, h: 74 }, screen: { x: -28, y: -47, w: 58, h: 31 } },
  { x: 266, y: 470, facing: "up", backrest: { dx: -30, dy: -37, w: 60, h: 75 }, screen: { x: -26, y: -23, w: 53, h: 30 } },
  { x: 491, y: 470, facing: "up", backrest: { dx: -30, dy: -37, w: 60, h: 75 }, screen: { x: -27, y: -23, w: 55, h: 32 } },
  { x: 707, y: 470, facing: "up", backrest: { dx: -30, dy: -37, w: 60, h: 75 }, screen: { x: -30, y: -23, w: 53, h: 32 } },
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
