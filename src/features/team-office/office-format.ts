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
/* ⭐ 显示器内容区（2026-10-04 立，**10-05 重测修正**）。
 *
 * ⛔⛔ 这段坐标错过**两次**，两次都是"扫出来的"却扫错了东西 —— 值得记死：
 *   · 第 1 版：从**用户截图**按 960/792、640/544 反推。⚠️ 那份截图是缩放过的
 *     ⇒ y 偏 91px，黑色内容区直接盖在桌子上。
 *   · 第 2 版（10-04）：改成"直接扫 bg.webp"，看起来方法对了 —— **但还是错的**。
 *     判据 `(r+g+b)<260 and b>r+20 and 30<=r<=90 and 40<=g<=110` 的本意是"暗且偏蓝"，
 *     而**椅背正好是 rgb(47,65,95)**（sum=207，b=95>r+20，全区间命中）⇒ 扫到的是椅子！
 *     实测出的 "y 253 / 447" 全部落在**椅背**上，与真屏面差 ~84px。
 *     ⛔ 更坏的是它**看不出错**：椅背之后会被"重贴"盖回人物身上（见 CHAIR_BACKREST），
 *     于是画上去的动态内容**被椅背整块盖掉** ⇒ 用户看到的是背景图里烙死的静态屏幕。
 *     用户原话「显示器还是固定的、你做的那个显示没对准、没显示」= 这一条的两个面。
 *   · 第 3 版（10-05，现行值）：判据换成**亮度**并**限定 y 带**才定对：
 *     屏幕玻璃 sum≈130（rgb 24,41,65）；椅背 sum≈207；显示器外框 sum≈300。
 *     ⇒ `sum < 190` 可分；**关键是先限定 y 带**（上排 165-205、下排 355-400），
 *     否则椅子仍在同一扫描范围内被一起收进来。
 *
 * ✅ 现行实测值（PIL 逐列判定：该列在 y 带内 ≥35% 像素是玻璃）：
 *     上排 x 246-295 / 471-521 / 686-736，y 169-202
 *     下排 x 246-293 / 470-520 / 685-736，y 362-396
 *     ⚠️ 纵向三排一致（169-202 / 362-396），横向逐台差 1-2px ⇒ 保留实测差异。
 *
 * 🔧 重测方法（PIL，可复现）：
 *     from PIL import Image
 *     im = Image.open('src/features/team-office/assets/bg.webp').convert('RGB'); px = im.load()
 *     is_glass = lambda r,g,b: (r+g+b) < 190 and b >= r and r <= 75
 *     # ⛔ 必须先限定 y 带再逐列判（该列 ≥35% 是玻璃）——不限定就会扫到椅背
 *
 * ⛔ 自检：改完拿 SCREEN 框画到 bg.webp 上看一眼（绿框必须落在**显示器玻璃**上、
 *   且 y 明显小于椅背顶）。仅"比例看着对"不算数。 */
export const SEATS: (SeatSpot & { backrest: { dx: number; dy: number; w: number; h: number }; screen: { x: number; y: number; w: number; h: number } })[] = [
  // 屏面坐标已换算成**相对座位**的偏移（screen.x = 屏面左 - 座位 x，screen.y = 屏面上 - 座位 y）
  { x: 264, y: 300, facing: "up", backrest: { dx: -30, dy: -62, w: 60, h: 74 }, screen: { x: -18, y: -131, w: 50, h: 34 } },
  { x: 490, y: 300, facing: "up", backrest: { dx: -30, dy: -62, w: 60, h: 74 }, screen: { x: -19, y: -131, w: 51, h: 34 } },
  { x: 705, y: 300, facing: "up", backrest: { dx: -30, dy: -62, w: 60, h: 74 }, screen: { x: -19, y: -131, w: 51, h: 34 } },
  { x: 266, y: 470, facing: "up", backrest: { dx: -30, dy: -37, w: 60, h: 75 }, screen: { x: -20, y: -108, w: 48, h: 35 } },
  { x: 491, y: 470, facing: "up", backrest: { dx: -30, dy: -37, w: 60, h: 75 }, screen: { x: -21, y: -108, w: 51, h: 35 } },
  { x: 707, y: 470, facing: "up", backrest: { dx: -30, dy: -37, w: 60, h: 75 }, screen: { x: -22, y: -108, w: 52, h: 35 } },
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
