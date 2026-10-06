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
/* ⭐ 显示器内容区（2026-10-04 立，**10-06 第三次重测**）。
 *
 * ⛔⛔ 这个坐标错过**三次**，前两次是"扫错了东西"，第三次是"判据把真边界切掉了"：
 *   · 第 1 版：从**用户截图**反推（截图缩放过的）⇒ y 偏 91px。
 *   · 第 2 版：扫 bg.webp，判据"暗且偏蓝" ⇒ 扫到的是**椅背**（rgb 47,65,95 也满足）。
 *   · 第 3 版（10-05）：改成"亮度 sum<190"，测出 50×34 —— 看着对了，**但还是错的**。
 *   · 第 4 版（10-06，现行）：用户报「**两侧仍有固定展示内容**」⇒ 真因是第 3 版
 *     **把玻璃区测窄了 30%**：判据要求"该列 ≥35% 像素 sum<190"，而**屏幕右半有背景图
 *     里烙死的彩色界面**（亮）⇒ 右半列的暗占比不到阈值 ⇒ 直接被切掉。
 *     ⛔ 这是"参照值与被测对象同源"的又一形态：**判据自己划定了范围，再在范围内测量**，
 *       测出来的当然小于真实值 —— 而且**自洽到看不出来**（六个座位都测出 48~52 宽，很整齐）。
 *
 * ✅ 现行实测值（`.workbuddy/tmp/measure-screen*.py` + 放大 8 倍的网格读数）：
 *     玻璃区 **66 × 32**；上排 top = seat.y − 132；下排 top = seat.y − 104；
 *     左边界 = seat.x − 28（上排）/ − 30（下排）。
 *     六台显示器外观同构（同一张精灵），逐台 x 差 ±2px ⇒ 用统一偏移。
 * ⚠️ 玻璃区**左侧有一列背景烙死的图标**（x 236~250）—— 那正是用户看到的
 *   "两侧仍有固定展示内容" ⇒ 内容区必须**覆盖到 x 236** 才能把它盖住。
 *
 * 🔧 重测方法（本次有效的那套，可复现）：
 *     ① 自动：`mask = sum<300` → `MaxFilter(9)` → `MinFilter(9)` 闭运算填掉屏内彩色内容
 *        → 逐列找暗占比 >45% 的最长连续段（得到 75~78 宽的**上界**，含 bezel）；
 *     ② **人工**：把该区域放大 8 倍 + 画 10px 网格（`zoom-screen.py`）⇒ 读出玻璃精确边界；
 *     ③ 两者对照：自动值比人工值大 5~8px（闭运算膨胀 + bezel）⇒ **以人工读数为准**。
 *     ⛔ 单纯"扫暗像素"一定会偏窄；单纯"向四周扩展直到亮边框"会一路扩到画布边缘
 *       （显示器上方/左侧没有亮边框）—— 两条路都实测失败过。
 *
 * ⛔ 自检：改完把 SCREEN 框画到 bg.webp 上看一眼（框必须**正好套住玻璃**、
 *   左边界要盖住那列图标）。仅"比例看着对"不算数。 */
export const SEATS: (SeatSpot & { backrest: { dx: number; dy: number; w: number; h: number }; screen: { x: number; y: number; w: number; h: number } })[] = [
  // 屏面坐标已换算成**相对座位**的偏移（10-06 实测：玻璃区 66×32，上排 top = y−132、下排 y−104）
  { x: 264, y: 300, facing: "up", backrest: { dx: -30, dy: -62, w: 60, h: 74 }, screen: { x: -28, y: -132, w: 66, h: 32 } },
  { x: 490, y: 300, facing: "up", backrest: { dx: -30, dy: -62, w: 60, h: 74 }, screen: { x: -28, y: -132, w: 66, h: 32 } },
  { x: 705, y: 300, facing: "up", backrest: { dx: -30, dy: -62, w: 60, h: 74 }, screen: { x: -28, y: -132, w: 66, h: 32 } },
  { x: 266, y: 470, facing: "up", backrest: { dx: -30, dy: -37, w: 60, h: 75 }, screen: { x: -30, y: -104, w: 66, h: 32 } },
  { x: 491, y: 470, facing: "up", backrest: { dx: -30, dy: -37, w: 60, h: 75 }, screen: { x: -30, y: -104, w: 66, h: 32 } },
  { x: 707, y: 470, facing: "up", backrest: { dx: -30, dy: -37, w: 60, h: 75 }, screen: { x: -30, y: -104, w: 66, h: 32 } },
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
