/**
 * 斜俯视（等距）投影几何（team-office 域 09-26 v6「复刻 ai-office-react」）。
 *
 * ⛔ 为什么要换投影：v3~v5 都是**正视平铺**（墙是背景、家具排成一行），用户看了
 *    workbzw/ai-office-react（PixiJS + Spine 的 Q 版办公室）后要求「复刻过来」。
 *    它那套画面的关键不是 3D —— 而是**斜俯视的房间**（地板是梯形、两侧墙向内收）
 *    + **人物近、桌子远**的工位朝向 + 头顶状态标签。这些用 SVG 的多边形完全能做。
 *
 * 做法：把房间建模成「一个长方体从斜上方看」，地板是四边形（后窄前宽），
 * 家具用**双线性插值**按地面归一化坐标 (u, v) 落位（u 左→右、v 后→前），
 * 越靠前（v 越大）画得越大 ⇒ 自然形成纵深。所有家具/工位/角色都走这套坐标，
 * 就不会出现早先那种「家具各自漂移」的问题。
 */

export const SCENE_W = 960;
export const SCENE_H = 640;

/** 地板四角（屏幕坐标）：后左、后右、前右、前左。 */
export const FLOOR = {
  bl: [178, 206] as const,
  br: [782, 206] as const,
  fr: [908, 574] as const,
  fl: [52, 574] as const,
};

/** 墙高（屏幕像素）——后墙从地板后边线向上抬这么多。 */
export const WALL_H = 168;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export type FloorSpot = { x: number; y: number; scale: number };

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
 * 纵深缩放：后排 0.86 → 前排 1.16。
 * ⛔ 下限别调太小：0.74 时人物只有 ~78px 高，在 960×640 的画面里显得"人很小、屋很大"
 *    （v6 首版实测），整体抬到 0.86~1.16 才接近参考实现的人物占比。
 */
export function depthScale(v: number): number {
  return 0.86 + 0.3 * Math.max(0, Math.min(1, v));
}

/** 地面一块矩形区域 → SVG polygon 的 points（家具"占地面积"用）。 */
export function floorQuad(u0: number, v0: number, u1: number, v1: number): string {
  const a = floorPoint(u0, v0);
  const b = floorPoint(u1, v0);
  const c = floorPoint(u1, v1);
  const d = floorPoint(u0, v1);
  return `${a.x.toFixed(1)},${a.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)} ${c.x.toFixed(1)},${c.y.toFixed(1)} ${d.x.toFixed(1)},${d.y.toFixed(1)}`;
}

/** 后墙上的点（贴墙装饰用）：u 左→右，up 距地板后边线的高度。 */
export function wallPoint(u: number, up: number): { x: number; y: number } {
  return { x: lerp(FLOOR.bl[0], FLOOR.br[0], u), y: FLOOR.bl[1] - up };
}

/** 两侧墙：左墙沿 v 的屏幕轨迹（贴侧墙的家具用）。 */
export function sideWallPoint(side: "left" | "right", v: number, up: number): { x: number; y: number } {
  const [backX, backY] = side === "left" ? FLOOR.bl : FLOOR.br;
  const [frontX, frontY] = side === "left" ? FLOOR.fl : FLOOR.fr;
  return { x: lerp(backX, frontX, v), y: lerp(backY, frontY, v) - up };
}

/**
 * 工位阵列：2 列 × 3 行（对齐参考实现的排布），返回每个工位的地面坐标。
 * @param count 实际成员数（最多 6，超出时按 3 列排布）
 */
export function deskSlots(count: number): Array<FloorSpot & { u: number; v: number }> {
  const cols = count > 6 ? 3 : 2;
  const rows = Math.max(1, Math.ceil(count / cols));
  const out: Array<FloorSpot & { u: number; v: number }> = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    // u/v 在 [0.2, 0.8] 内均匀分布，行自上而下铺开（近处的行更靠前）
    // ⛔ 列距别拉太开：参考实现的工位几乎相连，0.27~0.73 会让两个人之间空出一大块（实测）。
    const u = count === 1 ? 0.5 : 0.36 + (col / (cols - 1)) * 0.28;
    const v = rows === 1 ? 0.58 : 0.18 + (row / (rows - 1)) * 0.64;
    out.push({ ...floorPoint(u, v), u, v });
  }
  return out;
}
