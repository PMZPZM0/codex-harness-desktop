/**
 * 办公室程序化绘制（team-office 域，09-27 v10「照参考：工位产品图式构图」）。
 *
 * ⛔ 全部用 PixiJS Graphics 画，**不使用任何贴图素材**（用户 09-27 拍板：参考项目的 3D
 *    素材作者自己标注「注意素材版权问题」，我们只复刻**风格**，不搬素材）。
 *
 * ⛔ v10 的构图学自参考画面（用户 09-27 第二次贴图：「看看这种布局效果」）。参考镜头
 *    在工位**正前方**、略高，于是每个工位自远而近是：
 *      ① 显示器（最远，屏幕**朝观众**，一眼能看出在跑什么）
 *      ② 桌面（往后收的白板 + 前沿 + 四条细腿 + 桌下侧柜）
 *      ③ 角色（坐在桌子**近侧**、背对观众 ⇒ 头肩叠在桌面上）
 *      ④ 椅子（最近，椅背正好挡住角色下半身，只留头 / 项圈 / 两只爪子）
 *    ⇒ 纵深顺序 = 显示器 → 桌 → 人 → 椅。**椅子的 zIndex 必须大于人物**（v9 之前反过来，
 *      人是被家具压住只露头顶的）。
 *
 * ⛔ 风格三原则（照参考的 3D 渲染观感）：① **不用黑描边**（面与面靠明暗差区分）；
 *    ② **柔阴影**（工位脚下铺一大片低透明度椭圆，物件是"落"在地上不是浮着）；
 *    ③ **近白低饱和**（地板纯白、墙极浅灰、家具纯白，颜色只出现在角色项圈与绿植上）。
 *
 * 坐标：全部走 office-iso 的归一化地面坐标（u/v），家具自带纵深缩放，不会各自漂移。
 */
import { Container, Graphics } from "pixi.js";
import { FLOOR, WALL_H, floorCorners, floorPoint, sideWallPoint, wallPoint, type Pt } from "./office-iso";

const hex = (h: string) => parseInt(h.replace("#", ""), 16);

/** 参考观感色板（白系 3D）：顶面 > 前面 > 侧面 的明度阶梯。 */
export const SKIN = {
  floor: hex("#ffffff"),
  floorBack: hex("#fafaf9"),
  wallBack: hex("#f4f3f0"),
  wallSide: hex("#eceae5"),
  wallTop: hex("#fbfaf8"),
  baseboard: hex("#e6e3dd"),
  shadow: hex("#4a5260"),

  deskTop: hex("#ffffff"),
  deskEdge: hex("#d8d4cc"),
  deskFront: hex("#e9e6e0"),
  deskSide: hex("#dcd8d1"),
  deskLeg: hex("#cfcbc4"),
  cabinet: hex("#f6f4f0"),

  monitorShell: hex("#eceff3"),
  monitorEdge: hex("#c9ced5"),
  monitorStand: hex("#c8ccd2"),

  chairBack: hex("#ffffff"),
  chairBackDark: hex("#e6e2da"),
  chairSeat: hex("#f4f1ec"),
  chairLeg: hex("#cbc7c0"),

  woodTop: hex("#e7d3b5"),
  woodFront: hex("#d9c09c"),
  woodSide: hex("#c9ae88"),
  whiteTop: hex("#ffffff"),
  fridge: hex("#f3f5f7"),
  fridgeDark: hex("#dee2e6"),

  plant: hex("#7cbd86"),
  plantDark: hex("#5da169"),
  plantLight: hex("#a6d4ab"),
  pot: hex("#f3f1ed"),
  potDark: hex("#e1ded8"),

  paper: hex("#ffffff"),
  frame: hex("#d9c09c"),
} as const;

/* ── 等距体块 ───────────────────────────────────────────────────────────── */

/**
 * 带高度的等距长方体：`z0`~`z1` 是**离地高度**（单位与 h 同，内部乘纵深缩放）。
 * ⛔ 拆出 z0 是为了画「悬空平板」（桌面）：只传 0~h 会让桌子变成实心柜子。
 */
function isoPrism(
  g: Graphics,
  u0: number, v0: number, u1: number, v1: number,
  z0: number, z1: number,
  c: { top: number; front: number; side: number; bottom?: number },
): void {
  const [a, b, cc, d] = floorCorners(u0, v0, u1, v1); // 后左 / 后右 / 前右 / 前左
  const k = floorPoint((u0 + u1) / 2, (v0 + v1) / 2).scale;
  const lo = z0 * k;
  const hi = z1 * k;
  const up = (p: Pt, dy: number) => [p.x, p.y - dy] as const;

  // 两侧面
  g.poly([a.x, a.y - lo, d.x, d.y - lo, ...up(d, hi), ...up(a, hi)]).fill(c.side);
  g.poly([b.x, b.y - lo, cc.x, cc.y - lo, ...up(cc, hi), ...up(b, hi)]).fill(c.side);
  // 前面
  g.poly([d.x, d.y - lo, cc.x, cc.y - lo, ...up(cc, hi), ...up(d, hi)]).fill(c.front);
  // 顶面
  g.poly([...up(a, hi), ...up(b, hi), ...up(cc, hi), ...up(d, hi)]).fill(c.top);
  // 悬空件的底面（贴地的块不画）
  if (z0 > 0.01) {
    g.poly([...up(a, lo), ...up(b, lo), ...up(cc, lo), ...up(d, lo)]).fill(c.bottom ?? c.side);
  }
}

/** 落地块 = isoPrism(z0 = 0)。 */
function isoBox(
  g: Graphics,
  u0: number, v0: number, u1: number, v1: number,
  h: number,
  c: { top: number; front: number; side: number },
): void {
  isoPrism(g, u0, v0, u1, v1, 0, h, c);
}

/* ── 房间 ───────────────────────────────────────────────────────────────── */

export function drawRoom(layer: Container): void {
  const { bl, br, fr, fl } = FLOOR;
  const g = new Graphics();
  g.zIndex = -1e6;

  // 后墙（v10 提亮：参考画面里墙几乎退场，只剩地板与阴影在讲故事）
  g.rect(bl[0], bl[1] - WALL_H, br[0] - bl[0], WALL_H).fill(SKIN.wallBack);
  g.rect(bl[0], bl[1] - WALL_H * 0.26, br[0] - bl[0], WALL_H * 0.26).fill(SKIN.wallTop);
  // 左右侧墙（向后收的斜面）
  g.poly([bl[0], bl[1] - WALL_H, bl[0], bl[1], fl[0], fl[1], fl[0], fl[1] - WALL_H]).fill(SKIN.wallSide);
  g.poly([br[0], br[1] - WALL_H, br[0], br[1], fr[0], fr[1], fr[0], fr[1] - WALL_H]).fill(SKIN.wallSide);
  // 墙顶剖切边（参考是"掀掉天花板的房间"，露出墙的厚度）
  g.poly([bl[0], bl[1] - WALL_H, br[0], br[1] - WALL_H, br[0] + 24, br[1] - WALL_H - 14, bl[0] - 24, bl[1] - WALL_H - 14]).fill(SKIN.wallTop);

  // 地板
  g.poly([bl[0], bl[1], br[0], br[1], fr[0], fr[1], fl[0], fl[1]]).fill(SKIN.floor);
  // 地板靠后一档的柔和过渡（模拟环境光遮蔽）
  g.poly([bl[0], bl[1], br[0], br[1], br[0] + 24, br[1] + 42, bl[0] - 24, bl[1] + 42])
    .fill({ color: SKIN.floorBack, alpha: 0.8 });

  // 墙脚线
  g.moveTo(bl[0], bl[1]).lineTo(br[0], br[1]).stroke({ color: SKIN.baseboard, width: 2.5 });
  g.moveTo(bl[0], bl[1]).lineTo(fl[0], fl[1]).stroke({ color: SKIN.baseboard, width: 2 });
  g.moveTo(br[0], br[1]).lineTo(fr[0], fr[1]).stroke({ color: SKIN.baseboard, width: 2 });

  // 地板外沿厚度（让房间"有底"）
  g.poly([fl[0], fl[1], fr[0], fr[1], fr[0] + 11, fr[1] + 13, fl[0] - 11, fl[1] + 13]).fill(SKIN.wallSide);

  layer.addChild(g);
}

/* ── 后墙陈设（矮柜 + 置物架 + 相框 + 木色橱柜 + 冰箱）────────────────── */

export function drawBackWall(layer: Container): void {
  const g = new Graphics();
  g.zIndex = -9e5;

  // ① 左下矮柜（带上层置物架）
  isoBox(g, 0.09, 0.012, 0.28, 0.068, 40, { top: SKIN.whiteTop, front: SKIN.woodFront, side: SKIN.woodSide });
  const shelfTop = 40 + 50;
  const [sa, sb] = [wallPoint(0.09, shelfTop), wallPoint(0.28, shelfTop)];
  g.rect(sa.x, sa.y, sb.x - sa.x, 6).fill(SKIN.woodFront);
  g.rect(sa.x, sa.y, sb.x - sa.x, 2.5).fill(SKIN.woodTop);
  g.rect(sa.x, sa.y, 5, -50).fill(SKIN.woodSide);
  g.rect(sb.x - 5, sb.y, 5, -50).fill(SKIN.woodSide);
  for (let i = 0; i < 3; i++) {
    const a = wallPoint(0.105 + i * 0.022, shelfTop - 1);
    g.rect(a.x, a.y - 24, 9, 24).fill(SKIN.paper);
    g.rect(a.x, a.y - 24, 9, 2.5).fill(hex("#eae8e2"));
  }

  // ② 墙面相框
  const f0 = wallPoint(0.40, 56);
  g.rect(f0.x, f0.y, 56, 68).fill(SKIN.frame);
  g.rect(f0.x + 4, f0.y + 4, 48, 60).fill(hex("#f6f4f0"));
  g.rect(f0.x + 9, f0.y + 11, 38, 27).fill(hex("#eae7e0"));

  // ③ 右侧木色橱柜 + 白台面
  isoBox(g, 0.60, 0.012, 0.86, 0.068, 42, { top: SKIN.whiteTop, front: SKIN.woodFront, side: SKIN.woodSide });
  const counter = (uu: number) => wallPoint(uu, 42);
  const cm = counter(0.635);
  g.roundRect(cm.x, cm.y - 19, 13, 19, 3).fill(hex("#6b7078"));
  g.rect(cm.x + 3, cm.y - 13, 7, 7).fill(hex("#949aa1"));
  const sink = counter(0.78);
  g.roundRect(sink.x - 19, sink.y - 6, 32, 9, 3).fill(hex("#dfe3e8"));
  for (let i = 0; i < 3; i++) {
    const cup = counter(0.695 + i * 0.026);
    g.roundRect(cup.x, cup.y - 10, 7.5, 10, 2).fill(SKIN.paper);
  }
  // 上层吊架
  const [ua, ub] = [wallPoint(0.60, 42 + 50), wallPoint(0.86, 42 + 50)];
  g.rect(ua.x, ua.y, ub.x - ua.x, 6).fill(SKIN.woodFront);
  g.rect(ua.x, ua.y, ub.x - ua.x, 2.5).fill(SKIN.woodTop);
  for (let i = 0; i < 4; i++) {
    const jar = wallPoint(0.62 + i * 0.032, 42 + 49);
    g.roundRect(jar.x, jar.y - 14, 8.5, 14, 2).fill(SKIN.paper);
  }
  const sp = wallPoint(0.612, 42 + 43);
  leaf(g, sp.x + 6, sp.y, 0.45);

  // ④ 冰箱（右端，白色高柜）
  isoBox(g, 0.885, 0.01, 0.945, 0.075, 92, { top: SKIN.whiteTop, front: SKIN.fridge, side: SKIN.fridgeDark });
  const fr0 = wallPoint(0.887, 92);
  g.rect(fr0.x + 1, fr0.y + 32, 3.5, 38).fill(SKIN.fridgeDark);

  // ⑤ 左下角盆栽
  const pot = floorPoint(0.05, 0.13);
  potted(g, pot.x, pot.y, pot.scale);

  layer.addChild(g);
}

/* ── 两侧陈设（左墙花箱 + 角落盆栽 + 右墙窗）────────────────────────────── */

export function drawSideProps(layer: Container): void {
  const g = new Graphics();
  g.zIndex = -8e5;

  // 左墙长条花箱（沿左墙纵深铺开）
  const boxA = sideWallPoint("left", 0.30, 0);
  const boxB = sideWallPoint("left", 0.72, 0);
  g.poly([boxA.x - 6, boxA.y - 24, boxA.x + 19, boxA.y - 24, boxB.x + 19, boxB.y - 24, boxB.x - 6, boxB.y - 24]).fill(SKIN.woodTop);
  g.poly([boxA.x - 6, boxA.y - 24, boxA.x + 19, boxA.y - 24, boxA.x + 19, boxA.y, boxA.x - 6, boxA.y]).fill(SKIN.woodFront);
  g.poly([boxA.x - 6, boxA.y - 24, boxB.x - 6, boxB.y - 24, boxB.x - 6, boxB.y, boxA.x - 6, boxA.y]).fill(SKIN.woodSide);
  for (let i = 0; i <= 7; i++) {
    const p = sideWallPoint("left", 0.31 + (i / 7) * 0.38, 0);
    bush(g, p.x + 8, p.y - 27, 0.85 + (i % 2) * 0.12);
  }

  const p1 = floorPoint(0.035, 0.55);
  potted(g, p1.x, p1.y, p1.scale * 0.9);

  // 右侧大盆栽
  const p2 = floorPoint(0.955, 0.34);
  potted(g, p2.x, p2.y, p2.scale * 1.15);

  // 右墙两扇窗（带窗外绿意）
  [0.26, 0.56].forEach((v) => {
    const a = sideWallPoint("right", v, 16);
    const b = sideWallPoint("right", v + 0.18, 16);
    const dx = b.x - a.x;
    g.poly([a.x, a.y - 120, a.x + dx * 0.55, a.y - 120 + (b.y - a.y) * 0.55, a.x + dx * 0.55, a.y - 20 + (b.y - a.y) * 0.55, a.x, a.y - 20])
      .fill(hex("#eef3f7"));
    g.poly([a.x, a.y - 120, a.x + dx * 0.55, a.y - 120 + (b.y - a.y) * 0.55, a.x + dx * 0.55, a.y - 20 + (b.y - a.y) * 0.55, a.x, a.y - 20])
      .stroke({ color: hex("#f7f5f1"), width: 3 });
    const mid = { x: a.x + dx * 0.28, y: a.y - 88 + (b.y - a.y) * 0.28 };
    g.ellipse(mid.x + 6, mid.y + 38, 20, 27).fill({ color: SKIN.plantDark, alpha: 0.5 });
    g.ellipse(mid.x - 4, mid.y + 49, 14, 20).fill({ color: SKIN.plant, alpha: 0.4 });
  });

  layer.addChild(g);
}

/* ── 植物零件 ───────────────────────────────────────────────────────────── */

function leaf(g: Graphics, x: number, y: number, k: number): void {
  g.ellipse(x, y - 10 * k, 9 * k, 12 * k).fill(SKIN.plant);
  g.ellipse(x - 7 * k, y - 4 * k, 6 * k, 9 * k).fill(SKIN.plantDark);
  g.ellipse(x + 7 * k, y - 5 * k, 6 * k, 9 * k).fill(SKIN.plantLight);
}

function bush(g: Graphics, x: number, y: number, k: number): void {
  g.circle(x, y, 12 * k).fill(SKIN.plantDark);
  g.circle(x - 7 * k, y + 4 * k, 9 * k).fill(SKIN.plant);
  g.circle(x + 7 * k, y + 3 * k, 9 * k).fill(SKIN.plant);
  g.circle(x + 1 * k, y - 6 * k, 9 * k).fill(SKIN.plantLight);
}

/** 盆栽（花盆 + 叶丛）。 */
function potted(g: Graphics, x: number, y: number, k: number): void {
  const kk = k * 0.9;
  g.poly([x - 15 * kk, y - 28 * kk, x + 15 * kk, y - 28 * kk, x + 10 * kk, y, x - 10 * kk, y]).fill(SKIN.pot);
  g.poly([x + 6 * kk, y - 28 * kk, x + 15 * kk, y - 28 * kk, x + 10 * kk, y, x + 3 * kk, y]).fill(SKIN.potDark);
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + (i - 3) * 0.34;
    const rr = 24 * kk;
    g.ellipse(x + Math.cos(a) * rr, y - 32 * kk + Math.sin(a) * rr * 0.62, 8.5 * kk, 14 * kk)
      .fill(i % 2 ? SKIN.plant : SKIN.plantDark);
  }
  g.circle(x, y - 41 * kk, 7.5 * kk).fill(SKIN.plantLight);
}

/* ── 工位：桌子 + 显示器 + 桌下侧柜（⛔ 不含椅子）───────────────────────── */

/** 桌面纵深（归一化 v）：从座位点**向后**铺这么多。行距必须大于它 + 椅距。 */
export const DESK_DV = 0.235;
/** 桌半宽（归一化 u）。⛔ 必须小于列距的一半，否则相邻工位的桌子会压在一起。 */
export const DESK_HALF_U = 0.115;
/** 桌面离地高（屏幕像素，再乘纵深缩放）。 */
export const DESK_H = 32;
/**
 * 显示器抬离桌面的高度（屏幕像素）。
 * ⛔ 这个值是被角色**逼出来的**：角色头顶 + 耳朵顶到显示器下沿就会糊在一起。
 *    抬到 26 之后，最高的耳朵（猫）刚好从显示器下沿让开。
 */
export const MONITOR_LIFT = 34;
/** 椅子相对座位点的纵深偏移（越大越靠观众）。 */
export const CHAIR_DV = 0.058;
/**
 * 椅背顶离地高（屏幕像素）。
 * ⛔ 决定角色露多少：太低 → 角色整条 torso 压在桌沿上（黑块糊住桌子）；
 *    太高 → 项圈被椅背吃掉（第一版 94 就是这样，角色只剩一个黑头）。
 */
export const CHAIR_BACK_TOP = 74;

/** 屏幕内容变体（照参考：每个工位屏幕上是不同的东西，一眼能看出"在跑什么"）。 */
export type ScreenKind = "code" | "sheet" | "chart" | "design" | "mail" | "sleep";

function drawScreen(g: Graphics, kind: ScreenKind, x: number, y: number, w: number, h: number): void {
  // ⛔ 屏幕一律**亮底**（只有打盹那台是暗的）：参考里屏幕是画面里最亮的东西，
  //    上"深色代码编辑器"会让整排工位看着像显示器没开机（第一版实测）。
  g.rect(x, y, w, h).fill(kind === "sleep" ? hex("#232a35") : hex("#f7fafd"));
  const pad = w * 0.09;
  const line = (row: number, len: number, color: number, lh = h * 0.09) => {
    g.rect(x + pad, y + pad * 0.9 + row * lh, len, Math.max(1.4, h * 0.055)).fill(color);
  };
  if (kind === "code") {
    // 左边一条工具栏 + 彩色"语法"行（亮底，但一眼看出是代码）
    g.rect(x, y, w * 0.14, h).fill(hex("#e9eef5"));
    const cols = [hex("#4f9e6b"), hex("#3f7fcf"), hex("#c9922f"), hex("#8a5fd0")];
    for (let i = 0; i < 6; i++) line(i, w * (0.28 + ((i * 7) % 5) * 0.1), cols[i % 4]);
  } else if (kind === "sheet") {
    g.rect(x + pad * 0.6, y + pad * 0.7, w - pad * 1.2, h * 0.12).fill(hex("#4a86cf"));
    for (let i = 0; i < 4; i++) {
      g.rect(x + pad * 0.6, y + pad * 0.7 + h * 0.18 + i * h * 0.16, w - pad * 1.2, h * 0.11)
        .fill(i % 2 ? hex("#dfe9f4") : hex("#eef3f9"));
    }
  } else if (kind === "chart") {
    const bars = [0.4, 0.72, 0.55, 0.9, 0.66];
    bars.forEach((bh, i) => {
      const bw = (w - pad * 2) / 6.2;
      g.rect(x + pad + i * bw * 1.24, y + h - pad - bh * (h - pad * 2) * 0.9, bw, bh * (h - pad * 2) * 0.9)
        .fill(i === 3 ? hex("#4a86cf") : hex("#9dc0e6"));
    });
    g.rect(x + pad, y + h - pad, w - pad * 2, 1.6).fill(hex("#b9c8d8"));
  } else if (kind === "design") {
    g.rect(x + pad * 0.7, y + pad * 0.7, (w - pad * 1.8) * 0.52, (h - pad * 1.6) * 0.6).fill(hex("#cfd9e6"));
    g.rect(x + w * 0.56, y + pad * 0.7, (w - pad * 1.8) * 0.36, (h - pad * 1.6) * 0.28).fill(hex("#e3c48b"));
    g.rect(x + w * 0.56, y + pad * 0.7 + (h - pad * 1.6) * 0.36, (w - pad * 1.8) * 0.36, (h - pad * 1.6) * 0.24).fill(hex("#a9cfe0"));
  } else if (kind === "mail") {
    for (let i = 0; i < 3; i++) {
      g.rect(x + pad * 0.7, y + pad * 0.8 + i * h * 0.27, w - pad * 1.4, h * 0.21).fill(i === 0 ? hex("#e8eff8") : hex("#f1f5fa"));
      g.circle(x + pad * 1.15, y + pad * 0.8 + i * h * 0.27 + h * 0.105, h * 0.055).fill(i === 0 ? hex("#4a86cf") : hex("#b6c3d2"));
    }
  } else {
    // 打盹：暗屏 + 两个大小不同的圆（屏幕保护）；底色已在函数开头铺过
    g.circle(x + w * 0.32, y + h * 0.42, h * 0.075).stroke({ color: hex("#7f8ea3"), width: 1.4 });
    g.circle(x + w * 0.62, y + h * 0.62, h * 0.095).stroke({ color: hex("#68758a"), width: 1.4 });
  }
}

/**
 * 与成员绑定的屏幕内容（稳定派生，⛔ 不是每拍随机）。
 * ⛔ 打盹时必须走 "sleep"：屏幕亮着而人在睡觉会自相矛盾（一眼看出是假动画）。
 */
export function screenKindOf(index: number, running: boolean, dozing: boolean): ScreenKind {
  if (dozing) return "sleep";
  const pool: ScreenKind[] = ["code", "sheet", "chart", "design", "mail"];
  if (running) return index % 3 === 1 ? "sheet" : "code";
  return pool[((index % pool.length) + pool.length) % pool.length];
}

/**
 * 画一个工位的**家具**：桌 + 显示器 + 桌下侧柜 + 柔阴影。锚点 (u, v) = **座位地面点**。
 * ⛔ 桌子往**远侧**（v 减小）铺 —— 角色坐近侧、背对观众，桌椅才不会压在人身上。
 * ⛔ 椅子**不在这里**：它要盖在角色之上（见 drawChair），画进同一个 Graphics 会把人挡住。
 */
export function drawDeskStation(g: Graphics, u: number, v: number, screen: ScreenKind): void {
  const seat = floorPoint(u, v);
  const k = seat.scale;
  const cx = seat.x;
  const u0 = u - DESK_HALF_U;
  const u1 = u + DESK_HALF_U;
  const vFar = v - DESK_DV;

  // ① 柔阴影：参考里工位左下角一大片（家具"落"在地上而不是浮着）
  g.ellipse(cx - 14 * k, seat.y + 16 * k, 104 * k, 26 * k).fill({ color: SKIN.shadow, alpha: 0.085 });
  g.ellipse(cx - 16 * k, seat.y + 6 * k, 66 * k, 16 * k).fill({ color: SKIN.shadow, alpha: 0.07 });

  // ② 桌面：悬空白板（厚 9）
  isoPrism(g, u0, vFar, u1, v, DESK_H - 9, DESK_H, {
    top: SKIN.deskTop, front: SKIN.deskFront, side: SKIN.deskEdge, bottom: SKIN.deskEdge,
  });
  // ⛔ 桌面纯白 + 地板纯白 ⇒ 不叠层次的话桌子在白底上等于隐形（第一版实测"工位看不出桌子"）。
  //    靠后叠一道很淡的过渡（模拟环境光遮蔽）+ 近边一条细暗线（桌沿厚度）把桌面框出来。
  const topPt = (uu: number, vv: number) => {
    const p = floorPoint(uu, vv);
    return [p.x, p.y - DESK_H * k] as const;
  };
  const vMid = vFar + DESK_DV * 0.40;
  g.poly([...topPt(u0, vFar), ...topPt(u1, vFar), ...topPt(u1, vMid), ...topPt(u0, vMid)])
    .fill({ color: SKIN.shadow, alpha: 0.05 });
  const [fa, fb] = [floorPoint(u0, v), floorPoint(u1, v)];
  g.moveTo(fa.x, fa.y - DESK_H * k).lineTo(fb.x, fb.y - DESK_H * k).stroke({ color: SKIN.deskEdge, width: 1.6 });

  // ③ 四条细腿
  floorCorners(u0 + 0.008, vFar + 0.006, u1 - 0.008, v - 0.006).forEach((p) => {
    g.rect(p.x - 2.6 * k, p.y - (DESK_H - 7) * k, 5.2 * k, (DESK_H - 7) * k).fill(SKIN.deskLeg);
  });

  // ④ 桌下侧柜（贴右端）
  isoBox(g, u + 0.028, vFar + 0.028, u1 - 0.008, v - 0.030, DESK_H * 0.78, {
    top: SKIN.whiteTop, front: SKIN.cabinet, side: SKIN.deskSide,
  });
  const drawer = floorPoint(u + 0.075, v - 0.034);
  g.rect(drawer.x - 9 * k, drawer.y - DESK_H * 0.68 * k, 18 * k, 2 * k).fill(SKIN.deskEdge);
  g.rect(drawer.x - 9 * k, drawer.y - DESK_H * 0.42 * k, 18 * k, 2 * k).fill(SKIN.deskEdge);

  // ⑤ 显示器：浅色外壳 + 大屏（屏幕朝观众）+ 立柱支架（抬起来，让开角色头顶）
  const deskW = floorPoint(u1, v).x - floorPoint(u0, v).x;
  // ⛔ 宽度**封顶**：前排的桌宽是后排的 1.25 倍，不封顶的话前排显示器会长到上一排人的胸口，
  //    把上一排的项圈/椅子盖掉（实测过一次）。
  const mw = Math.min(deskW * 0.54, 82);
  const mh = mw * 0.62;
  const mon = floorPoint(u, vFar + DESK_DV * 0.30);
  const baseY = mon.y - (DESK_H + MONITOR_LIFT) * k;
  g.ellipse(mon.x, baseY + MONITOR_LIFT * k, mw * 0.19, 3.6 * k).fill(SKIN.monitorStand);
  g.rect(mon.x - mw * 0.05, baseY, mw * 0.10, MONITOR_LIFT * k).fill(SKIN.monitorStand);
  g.roundRect(mon.x - mw / 2, baseY - mh - mh * 0.12, mw, mh * 1.12, mw * 0.035).fill(SKIN.monitorShell);
  g.roundRect(mon.x - mw / 2, baseY - mh - mh * 0.12, mw, mh * 1.12, mw * 0.035).stroke({ color: SKIN.monitorEdge, width: 1.3 });
  drawScreen(g, screen, mon.x - mw * 0.45, baseY - mh * 1.02, mw * 0.90, mh * 0.92);

  // ⑥ 键鼠（贴桌沿，人侧）
  const kb = floorPoint(u, v - 0.045);
  const ky = kb.y - DESK_H * k;
  g.roundRect(kb.x - deskW * 0.19, ky - deskW * 0.055, deskW * 0.38, deskW * 0.028, 2).fill(hex("#f1efea"));
  g.ellipse(kb.x + deskW * 0.26, ky - deskW * 0.032, deskW * 0.026, deskW * 0.019).fill(hex("#f1efea"));
}

/**
 * 画椅子（白色办公椅，**背对观众**）。⛔ 必须单独一层、zIndex **大于人物** ——
 * 参考里椅背正好挡住角色下半身；画在人物之前会让人整个盖住椅子（v9 的老毛病）。
 */
export function drawChair(g: Graphics, u: number, v: number): void {
  const c = floorPoint(u, v + CHAIR_DV);
  const k = c.scale;
  const x = c.x;
  const y = c.y;
  const deskW = floorPoint(u + DESK_HALF_U, v).x - floorPoint(u - DESK_HALF_U, v).x;
  const w = deskW * 0.42;

  // ⛔ 椅子是**白椅落在白地板上** —— 不给它一圈浅描边 + 投影，画出来等于没画（第一版实测：
  //    整排工位看着"人悬在桌沿上"）。⛔ 描边用浅灰而不是黑：黑描边会退回卡通线稿风。
  g.ellipse(x, y + 2 * k, w * 0.92, 8 * k).fill({ color: SKIN.shadow, alpha: 0.1 });
  // 五星脚 + 滚轮
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
    const px = x + Math.cos(a) * w * 0.46;
    const py = y + Math.sin(a) * w * 0.46 * 0.34 + 1 * k;
    g.moveTo(x, y - 4 * k).lineTo(px, py).stroke({ color: SKIN.chairLeg, width: 3.4 * k });
    g.circle(px, py, 2.8 * k).fill(SKIN.chairLeg);
  }
  // 气压杆 + 座
  g.rect(x - 2.4 * k, y - 40 * k, 4.8 * k, 38 * k).fill(SKIN.chairLeg);
  g.roundRect(x - w / 2, y - 50 * k, w, 12 * k, 5).fill(SKIN.chairSeat);
  g.roundRect(x - w / 2, y - 50 * k, w, 12 * k, 5).stroke({ color: SKIN.chairBackDark, width: 1.2 });
  // 靠背（圆角竖板 + 顶部暗边 + 腰托 + 浅描边，靠明暗分层而不是黑描边）
  const backH = CHAIR_BACK_TOP - 46;
  g.roundRect(x - w * 0.54, y - CHAIR_BACK_TOP * k, w * 1.08, backH * k, w * 0.2)
    .fill(SKIN.chairBack).stroke({ color: SKIN.chairBackDark, width: 1.4 });
  g.roundRect(x - w * 0.54, y - CHAIR_BACK_TOP * k, w * 1.08, 7 * k, w * 0.16).fill(SKIN.chairBackDark);
  g.roundRect(x - w * 0.4, y - (CHAIR_BACK_TOP - 13) * k, w * 0.8, 4 * k, 2).fill(SKIN.chairBackDark);
}

/* ── 办公设施（饮水机 / 打印机 / 资料架 / 挂钟 / 洗手间 / 咖啡蒸汽）────────
   ⛔ 位置必须与 office-director 的跑腿目标**同源**（OfficeCanvas 的 ERRAND_SPOT_UV）：
      「去接水」的人要真的站在饮水机旁、「去打印」站在打印机旁。
      设施只是画在那个目标点上 —— ⛔ 不要在渲染层另定一套坐标（两边一漂移就穿帮）。 */

/** 逐帧动画部件：t 是场景时钟（秒·缩放后）。 */
export type PropTicker = { update: (t: number) => void };

export function drawAmenities(layer: Container): PropTicker[] {
  const tickers: PropTicker[] = [];
  const g = new Graphics();
  g.zIndex = -7e5;

  /* ① 饮水机（水桶里的气泡持续上升）—— 对应 errand「去接水」 */
  {
    const p = floorPoint(0.955, 0.62);
    const k = p.scale, x = p.x, y = p.y;
    g.ellipse(x, y + 3 * k, 24 * k, 8 * k).fill({ color: SKIN.shadow, alpha: 0.07 });
    g.roundRect(x - 15 * k, y - 42 * k, 30 * k, 42 * k, 4).fill(hex("#f1f4f7"));
    g.roundRect(x - 15 * k, y - 42 * k, 30 * k, 4 * k, 2).fill(hex("#e3e7ec"));
    g.roundRect(x - 11 * k, y - 72 * k, 22 * k, 31 * k, 5).fill({ color: hex("#c9e6f8"), alpha: 0.94 });
    g.roundRect(x - 11 * k, y - 72 * k, 22 * k, 5 * k, 3).fill({ color: hex("#dcf0fc"), alpha: 0.96 });
    g.rect(x - 5 * k, y - 30 * k, 10 * k, 5 * k).fill(hex("#a4adb6"));
    g.roundRect(x - 11 * k, y - 18 * k, 22 * k, 4.5 * k, 2).fill(hex("#d3d9df"));
    for (let i = 0; i < 3; i++) {
      const bubble = new Graphics();
      bubble.circle(0, 0, 2.2 * k).fill({ color: 0xffffff, alpha: 0.9 });
      bubble.zIndex = -7e5 + 1;
      bubble.position.set(x + (i - 1) * 4.5 * k, y - 46 * k);
      layer.addChild(bubble);
      const phase = i / 3;
      tickers.push({ update: (t) => {
        const c = (t * 0.2 + phase) % 1;
        bubble.position.y = y - 44 * k - c * 26 * k;
        bubble.alpha = c < 0.16 ? c / 0.16 : Math.max(0, 1 - (c - 0.16) / 0.84);
      } });
    }
  }

  /* ② 打印机（出纸口往复吐纸）—— 对应 errand「去打印」 */
  {
    const p = floorPoint(0.90, 0.13);
    const k = p.scale, x = p.x, y = p.y;
    g.ellipse(x, y + 3 * k, 28 * k, 8 * k).fill({ color: SKIN.shadow, alpha: 0.07 });
    g.roundRect(x - 22 * k, y - 32 * k, 44 * k, 32 * k, 4).fill(hex("#f2f5f8"));
    g.roundRect(x - 19 * k, y - 56 * k, 38 * k, 24 * k, 4).fill(hex("#5a6069"));
    g.roundRect(x - 19 * k, y - 56 * k, 38 * k, 5.5 * k, 3).fill(hex("#4b515a"));
    g.roundRect(x - 7 * k, y - 45 * k, 14 * k, 3 * k, 1.5).fill(hex("#9fd7a8"));
    const paper = new Graphics();
    paper.roundRect(-12 * k, 0, 24 * k, 16 * k, 1.5).fill(SKIN.paper);
    paper.rect(-8 * k, 3 * k, 16 * k, 1.3 * k).fill({ color: hex("#ccd5dd") });
    paper.rect(-8 * k, 6 * k, 12 * k, 1.3 * k).fill({ color: hex("#ccd5dd") });
    paper.zIndex = -7e5 + 1;
    paper.position.set(x, y - 35 * k);
    layer.addChild(paper);
    tickers.push({ update: (t) => {
      const c = (t * 0.16) % 1;
      paper.position.y = y - 35 * k + Math.min(1, Math.max(0, (c - 0.15) / 0.5)) * 12 * k;
    } });
  }

  /* ③ 资料架（矮书架 + 书脊）—— 对应 errand「去翻资料架」 */
  {
    const p = floorPoint(0.055, 0.21);
    const k = p.scale, x = p.x, y = p.y;
    g.ellipse(x, y + 3 * k, 30 * k, 8 * k).fill({ color: SKIN.shadow, alpha: 0.07 });
    g.roundRect(x - 24 * k, y - 52 * k, 48 * k, 52 * k, 4).fill(SKIN.woodFront);
    g.roundRect(x - 24 * k, y - 52 * k, 48 * k, 4.5 * k, 2).fill(SKIN.woodTop);
    g.rect(x - 20 * k, y - 30 * k, 40 * k, 2.6 * k).fill(SKIN.woodSide);
    const spine = [hex("#e09275"), hex("#7aa3dd"), hex("#95c785"), hex("#e5c877"), hex("#bd97dd")];
    for (let i = 0; i < 5; i++) g.rect(x - 18 * k + i * 7.4 * k, y - 50 * k, 5.6 * k, 19 * k).fill(spine[i]);
    for (let i = 0; i < 4; i++) g.rect(x - 18 * k + i * 8.4 * k, y - 27 * k, 6.4 * k, 24 * k).fill(spine[(i + 2) % 5]);
  }

  /* ④ 墙上挂钟（秒针真的在走） */
  {
    const c = wallPoint(0.5, 96);
    g.circle(c.x, c.y, 15).fill(hex("#ffffff"));
    g.circle(c.x, c.y, 15).stroke({ color: hex("#e0ddd7"), width: 2.2 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.circle(c.x + Math.sin(a) * 11.5, c.y - Math.cos(a) * 11.5, 1).fill(hex("#c2bfb9"));
    }
    const hour = new Graphics();
    hour.roundRect(-1.7, -8, 3.4, 10, 1.7).fill(hex("#4b5057"));
    hour.position.set(c.x, c.y);
    const minute = new Graphics();
    minute.roundRect(-1.3, -12.5, 2.6, 14.5, 1.3).fill(hex("#666c74"));
    minute.position.set(c.x, c.y);
    const dot = new Graphics();
    dot.circle(c.x, c.y, 2).fill(hex("#4b5057"));
    hour.zIndex = -7e5 + 2; minute.zIndex = -7e5 + 2; dot.zIndex = -7e5 + 2;
    layer.addChild(hour, minute, dot);
    tickers.push({ update: (t) => {
      minute.rotation = (t * 0.06) % (Math.PI * 2);
      hour.rotation = (t * 0.005) % (Math.PI * 2);
    } });
  }

  /* ⑤ 卫生间隔间（左下角）—— 对应 errand「去洗手间」 */
  {
    const p = floorPoint(0.055, 0.90);
    const k = p.scale, x = p.x, y = p.y;
    const w = 44 * k, h = 74 * k;
    g.ellipse(x, y + 3 * k, 32 * k, 9 * k).fill({ color: SKIN.shadow, alpha: 0.08 });
    g.rect(x - w / 2, y - h, w, h).fill(hex("#eef1f4"));
    g.poly([x - w / 2, y - h, x - w / 2 - 24 * k, y - h + 12 * k, x - w / 2 - 24 * k, y + 12 * k, x - w / 2, y])
      .fill(hex("#dbdfe4"));
    g.rect(x - w / 2 + 3 * k, y - h + 5 * k, w - 6 * k, h - 8 * k).fill(hex("#dcc0a0"));
    g.rect(x - w / 2 + 3 * k, y - h + 5 * k, w - 6 * k, 3.2 * k).fill(hex("#c7a582"));
    g.circle(x + w / 2 - 10 * k, y - h * 0.5, 2.8 * k).fill(hex("#9c7c56"));
    g.roundRect(x - 11 * k, y - h - 16 * k, 22 * k, 12 * k, 3).fill(hex("#ffffff"));
    g.circle(x - 4.5 * k, y - h - 10 * k, 2.4 * k).fill(hex("#5b7cba"));
    g.circle(x + 4.5 * k, y - h - 10 * k, 2.4 * k).fill(hex("#cf7594"));
    const lamp = new Graphics();
    lamp.circle(0, 0, 3.2 * k).fill(hex("#4dbf6a"));
    lamp.zIndex = -7e5 + 1;
    lamp.position.set(x + w / 2 + 8 * k, y - h - 10 * k);
    layer.addChild(lamp);
    tickers.push({ update: (t) => { lamp.alpha = 0.5 + 0.5 * Math.abs(Math.sin(t * 0.5)); } });
  }

  /* ⑥ 咖啡机蒸汽（后墙台面的咖啡机上方）—— 对应「喝咖啡」 */
  {
    const c = wallPoint(0.635, 42 + 21);
    for (let i = 0; i < 3; i++) {
      const s = new Graphics();
      s.circle(0, 0, 3.4).fill({ color: 0xffffff, alpha: 0.8 });
      s.zIndex = -7e5 + 1;
      s.position.set(c.x + 6, c.y);
      layer.addChild(s);
      const phase = i / 3;
      tickers.push({ update: (t) => {
        const cyc = (t * 0.32 + phase) % 1;
        s.position.y = c.y - cyc * 30;
        s.alpha = (cyc < 0.2 ? cyc / 0.2 : Math.max(0, 1 - (cyc - 0.2) / 0.8)) * 0.75;
        s.scale.set(0.55 + cyc * 0.95);
      } });
    }
  }

  layer.addChild(g);
  return tickers;
}
