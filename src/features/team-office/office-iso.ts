/**
 * 办公室投影几何（team-office 域，09-27 v9「对齐 ai-office-react 白系 3D 观感」）。
 *
 * ⛔ 为什么又改：v6~v8 是「等距房间 + Kenney 卡通贴图家具」，用户实测画面
 *    「家具散落一地、工位和桌椅对不上」（09-27 截图）。根因不是算法，是**素材风格**：
 *    参考实现（workbzw/ai-office-react，MIT）的房间是一张**照片级 3D 渲染底图** +
 *    纯白 3D 桌椅 + Spine 角色，而 Kenney 是**卡通描边风**，两套语言放一起必然违和。
 *    ⛔ 用户 09-27 拍板：**不搬它的素材**（作者自己标注「注意素材版权问题」），
 *       改为**程序化绘制同风格**（PixiJS Graphics 画白系等距房间/桌椅，无描边、靠面明暗分层）。
 *
 * 投影模型：房间 = 后墙正对观众 + 两侧墙向内收（地板后窄前宽），
 * 家具/工位/角色统一走 `floorPoint(u, v)` 的归一化坐标 —— 越靠前（v 越大）越大，
 * 天然有纵深，不会再出现「各自漂移」。
 */

export const SCENE_W = 1000;
export const SCENE_H = 740;

/** 地板四角（屏幕坐标）：后左、后右、前右、前左。
 *  ⛔ v10 两条都是被工位逼出来的：
 *    ① **横向放宽**（后 508 → 前 732）：3 列工位要求「列距 > 桌宽」，否则桌子互相压；
 *    ② **纵深加深**（v9 的 450 → 540）：工位是"深"的（桌 0.235 + 椅 0.058 个 v），
 *       行距必须大于它 —— 450 时实测**下一排的显示器会盖住上一排的人**（显示器比人高，
 *       而且前排纵深缩放更大 ⇒ 显示器的顶比后排更靠上）。
 */
export const FLOOR = {
  bl: [246, 150] as const,
  br: [754, 150] as const,
  fr: [866, 690] as const,
  fl: [134, 690] as const,
};

/** 墙高（屏幕像素）——后墙从地板后边线向上抬这么多。
 *  ⛔ v10 从 136 收到 124：参考画面里房间几乎"退场"，画面主角是工位，
 *    墙太高会把工位挤到下半屏（v9 实测上半屏全是空墙）。
 */
export const WALL_H = 124;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export type FloorSpot = { x: number; y: number; scale: number };
export type Pt = { x: number; y: number };

/**
 * 地面归一化坐标 → 屏幕坐标。
 * @param u 0 = 最左，1 = 最右
 * @param v 0 = 最靠后（贴后墙），1 = 最靠前（贴观众）
 */
export function floorPoint(u: number, v: number): FloorSpot {
  const backX = lerp(FLOOR.bl[0], FLOOR.br[0], u);
  const frontX = lerp(FLOOR.fl[0], FLOOR.fr[0], u);
  const x = lerp(backX, frontX, v);
  const y = lerp(FLOOR.bl[1], FLOOR.fl[1], v);
  return { x, y, scale: depthScale(v) };
}

/**
 * 纵深缩放：后排 0.88 → 前排 1.14。
 * ⛔ 别调太小：0.74 时人物只有 ~78px 高，在 960×640 里显得"人很小、屋很大"（v6 实测）。
 */
export function depthScale(v: number): number {
  return 0.88 + 0.26 * Math.max(0, Math.min(1, v));
}

/** 地面一块矩形区域 → 屏幕四角（后左 / 后右 / 前右 / 前左）。家具"占地面积"用。 */
export function floorCorners(u0: number, v0: number, u1: number, v1: number): [Pt, Pt, Pt, Pt] {
  return [
    floorPoint(u0, v0),
    floorPoint(u1, v0),
    floorPoint(u1, v1),
    floorPoint(u0, v1),
  ];
}

/** 后墙上的点（贴墙装饰用）：u 左→右，up 距地板后边线的高度。 */
export function wallPoint(u: number, up: number): Pt {
  return { x: lerp(FLOOR.bl[0], FLOOR.br[0], u), y: FLOOR.bl[1] - up };
}

/** 两侧墙：沿 v 的屏幕轨迹（贴侧墙的家具用）。 */
export function sideWallPoint(side: "left" | "right", v: number, up: number): Pt {
  const [backX, backY] = side === "left" ? FLOOR.bl : FLOOR.br;
  const [frontX, frontY] = side === "left" ? FLOOR.fl : FLOOR.fr;
  return { x: lerp(backX, frontX, v), y: lerp(backY, frontY, v) - up };
}

/**
 * 工位阵列：最多 3 列 × 3 行（照参考的「一格一个工位」）。
 * ⛔ v10 为什么改：v9 用「2 列 × 3 行」，列距 0.30、桌宽 0.196 —— 看着够，实际
 *    桌子的**屏幕宽**还要乘上 u→x 的横向伸缩（后 508 / 前 732），实测两张桌子压在一起。
 *    现在列距 0.27 而桌半宽 0.115（桌宽 ≈ 0.23 个 u）⇒ 桌间必留缝。
 * ⛔ 最后一行不满时**居中**，否则 4 个人会出现「右下角孤零零一个工位」。
 */
const COL_U: Record<number, number[]> = {
  1: [0.5],
  2: [0.34, 0.66],
  3: [0.23, 0.5, 0.77],
};
/** 行位置（v）：0 = 贴后墙，1 = 贴观众。
 *  ⛔ 行距必须 > 「桌纵深 0.235 + 椅 0.058」，而且还要留出**显示器的高度** ——
 *     下一排的显示器顶会伸到上一排的人胸口高度，行距不够就直接把人盖住（实测）。 */
const ROW_V: Record<number, number[]> = {
  1: [0.56],
  2: [0.36, 0.8],
  3: [0.3, 0.61, 0.92],
};

/**
 * @param count 实际工位数（含 CEO）
 */
export function deskSlots(count: number): Array<FloorSpot & { u: number; v: number }> {
  const n = Math.max(1, Math.min(9, count));
  const cols = Math.min(3, n);
  const rows = Math.ceil(n / cols);
  const xs = COL_U[cols];
  const ys = ROW_V[rows];
  const gap = cols > 1 ? xs[1] - xs[0] : 0;
  const out: Array<FloorSpot & { u: number; v: number }> = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const inRow = Math.min(cols, n - row * cols);
    // 不满的一行：整行按列距居中
    const u = inRow === cols
      ? xs[col]
      : 0.5 - ((inRow - 1) * gap) / 2 + col * gap;
    const v = ys[row];
    out.push({ ...floorPoint(u, v), u, v });
  }
  return out;
}
