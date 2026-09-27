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

export const SCENE_W = 960;
export const SCENE_H = 640;

/** 地板四角（屏幕坐标）：后左、后右、前右、前左。
 *  ⛔ v9 按参考画面放宽：后墙 488 → 房间更"宽扁"（参考的办公室接近 2:1），
 *    同时把纵深从 368 拉到 398，给后墙橱柜与三排工位都留出呼吸。
 */
export const FLOOR = {
  bl: [236, 152] as const,
  br: [724, 152] as const,
  fr: [832, 596] as const,
  fl: [128, 596] as const,
};

/** 墙高（屏幕像素）——后墙从地板后边线向上抬这么多。 */
export const WALL_H = 136;

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

/** 地面一块矩形区域 → SVG/Graphics 多边形的扁平点数组。 */
export function floorQuad(u0: number, v0: number, u1: number, v1: number): number[] {
  const [a, b, c, d] = floorCorners(u0, v0, u1, v1);
  return [a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y];
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
 * 工位阵列：2 列 × 3 行（对齐参考画面），返回每个工位的地面坐标。
 * ⛔ 只排**中下部**（v 0.30~0.80）：后墙要留给橱柜那条"地柜带"，
 *    工位贴着墙会与柜子打架（v6 把工位铺到 v=0.14，实测家具全糊在墙上）。
 * @param count 实际工位数（含 CEO；>6 时排 3 列）
 */
export function deskSlots(count: number): Array<FloorSpot & { u: number; v: number }> {
  const cols: number = count > 6 ? 3 : 2;
  const rows = Math.max(1, Math.ceil(count / cols));
  const out: Array<FloorSpot & { u: number; v: number }> = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    // 列：0.35 / 0.65 —— 参考里两列间距约为房间宽的 30%
    const u = cols === 1 ? 0.5 : 0.35 + (col / (cols - 1)) * 0.30;
    // 行：单行落在中段；多行从 0.30 铺到 0.80
    const v = rows === 1 ? 0.52 : 0.20 + (row / (rows - 1)) * 0.66;
    out.push({ ...floorPoint(u, v), u, v });
  }
  return out;
}
