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
  c: { top: number; front: number; side: number },
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
  // ⛔ **不画底面**：相机在上前方俯视，底面永远被自己的顶面遮住；而它的屏幕位置只比顶面低
  //    (z1−z0)·k，画在最后会**盖住顶面上半部分** —— 桌面因此变成一大片灰（v10 打磨时实测：
  //    把 alpha 从 0.019 调到 0.005 都不见效，根因根本不是渐变，是这块底面）。
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

/**
 * 柔阴影：**多层同心椭圆**堆出衰减。
 * ⛔ 单层实心椭圆有硬边 —— 画出来是"地上一摊灰"，而不是"物件落在光里"（实测观感）。
 *    PixiJS Graphics 没有模糊，叠层是最省的做法；层数别多（每层一次绘制）。
 */
export function softShadow(g: Graphics, x: number, y: number, rx: number, ry: number, strength: number): void {
  const layers = 5;
  const a = strength / layers;
  for (let i = layers; i >= 1; i--) {
    const t = i / layers;
    g.ellipse(x, y, rx * t, ry * t).fill({ color: SKIN.shadow, alpha: a });
  }
}

/**
 * 后墙柜体**顶面**的屏幕 y —— 放在柜面上的物件（咖啡机 / 水槽 / 杯子 / 墙上置物架）
 * 必须用它定位。
 * ⛔ 别用 `wallPoint(u, up)`：那是**2D 墙面**坐标（基线恒在 FLOOR 后边线），而柜子是
 *    3D 方块、顶面要按自身纵深抬高 —— 用墙坐标定位会让咖啡机**浮在柜子上方 39px**
 *    （09-27 v10 放大截图实测，肉眼一眼假）。
 */
function counterTopY(u: number, vFront: number, h: number): number {
  const p = floorPoint(u, vFront);
  return p.y - h * p.scale;
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

/* ── 后墙陈设（矮柜 + 置物架 + 公告板 + 相框 + 木色橱柜 + 吊架 + 冰箱）──────
   ⛔ 布置原则（v10 打磨）：**柜面上的东西一律用 counterTopY 定位**（见上），
      **墙面挂件**才用 wallPoint。混用会让家具浮在半空（实测过）。 */

export function drawBackWall(layer: Container): void {
  const g = new Graphics();
  g.zIndex = -9e5;

  // ① 左下矮柜（贴墙）
  const CAB1 = { u0: 0.09, u1: 0.28, vFront: 0.062, h: 40 };
  isoBox(g, CAB1.u0, 0.01, CAB1.u1, CAB1.vFront, CAB1.h, { top: SKIN.whiteTop, front: SKIN.woodFront, side: SKIN.woodSide });
  // 柜门缝 + 两个抽屉拉手（白柜面上一道浅线就够分层，别加黑描边）
  const cab1Front = floorPoint((CAB1.u0 + CAB1.u1) / 2, CAB1.vFront);
  const cab1W = floorPoint(CAB1.u1, CAB1.vFront).x - floorPoint(CAB1.u0, CAB1.vFront).x;
  g.rect(cab1Front.x - cab1W * 0.42, cab1Front.y - CAB1.h * 0.52 * cab1Front.scale, cab1W * 0.84, 1.6)
    .fill({ color: SKIN.woodSide, alpha: 0.5 });
  // ② 柜面上方的壁挂置物架（离柜面 56 —— 贴着柜子才读成"柜 + 架"，拉高就变浮空）
  const shelf1Y = counterTopY((CAB1.u0 + CAB1.u1) / 2, CAB1.vFront, CAB1.h) - 56;
  const [sa, sb] = [wallPoint(CAB1.u0, 0), wallPoint(CAB1.u1, 0)];
  g.rect(sa.x, shelf1Y, sb.x - sa.x, 6).fill(SKIN.woodFront);
  g.rect(sa.x, shelf1Y, sb.x - sa.x, 2.5).fill(SKIN.woodTop);
  g.rect(sa.x, shelf1Y, 5, -50).fill({ color: SKIN.woodSide, alpha: 0.45 });
  g.rect(sb.x - 5, shelf1Y, 5, -50).fill({ color: SKIN.woodSide, alpha: 0.45 });
  for (let i = 0; i < 3; i++) {
    const a = wallPoint(CAB1.u0 + 0.022 + i * 0.024, 0);
    g.rect(a.x, shelf1Y - 25, 10, 25).fill(SKIN.paper);
    g.rect(a.x, shelf1Y - 25, 10, 2.5).fill(hex("#ebe9e3"));
    g.rect(a.x + 4.5, shelf1Y - 19, 1.2, 12).fill({ color: hex("#dcd9d3"), alpha: 0.8 });
  }

  // ③ 公告板（补上"下半墙空一片"的洞；软木板 + 三张便签）
  const nb = wallPoint(0.31, 116);
  g.roundRect(nb.x, nb.y, 74, 66, 4).fill(hex("#e2d3bb"));
  g.roundRect(nb.x + 3, nb.y + 3, 68, 60, 3).fill(hex("#f0e6d5"));
  const notes = [hex("#f3e08a"), hex("#a9d6f2"), hex("#f2b3c4")];
  notes.forEach((col, i) => {
    const nx = nb.x + 8 + i * 21;
    const ny = nb.y + 10 + (i % 2) * 12;
    g.roundRect(nx, ny, 17, 17, 2).fill(col);
    g.rect(nx, ny, 17, 2.5).fill({ color: 0xffffff, alpha: 0.5 });
    g.rect(nx + 3, ny + 7, 11, 1.2).fill({ color: 0x000000, alpha: 0.07 });
    g.rect(nx + 3, ny + 11, 8, 1.2).fill({ color: 0x000000, alpha: 0.07 });
  });

  // ④ 吊植（从墙上垂下来的一小串叶，给"大面白墙"一点层次）
  //    ⛔ 相框已删：这段墙（矮柜 388 → 橱柜 550）只有 162px，硬塞"公告板 + 相框 + 挂钟"
  //       必然互相压（实测三者两两重叠），留两件才排得开。
  const hang = wallPoint(0.556, 106);
  g.rect(hang.x - 6, hang.y, 12, 8).fill(SKIN.pot);
  for (let i = 0; i < 6; i++) {
    const a = hang.x + Math.sin(i * 1.1) * 7;
    const b = hang.y + 12 + i * 11;
    g.ellipse(a, b, 5.5, 7.5).fill(i % 2 ? SKIN.plant : SKIN.plantDark);
  }

  // ⑤ 右侧木色橱柜 + 柜面物件（⛔ 一律用 counterTopY 落位，别用 wallPoint）
  const CAB2 = { u0: 0.6, u1: 0.86, vFront: 0.062, h: 42 };
  isoBox(g, CAB2.u0, 0.01, CAB2.u1, CAB2.vFront, CAB2.h, { top: SKIN.whiteTop, front: SKIN.woodFront, side: SKIN.woodSide });
  const top2 = (uu: number) => counterTopY(uu, CAB2.vFront, CAB2.h);
  // 咖啡机（机身 + 出水口 + 杯）
  const cmx = wallPoint(0.632, 0).x;
  const cmy = top2(0.632);
  g.roundRect(cmx, cmy - 22, 15, 22, 3).fill(hex("#5f656d"));
  g.roundRect(cmx, cmy - 22, 15, 5, 2.5).fill(hex("#4c5158"));
  g.rect(cmx + 3.5, cmy - 15, 8, 5).fill(hex("#9aa1a8"));
  g.roundRect(cmx + 4, cmy - 8, 7, 8, 1.6).fill(SKIN.paper);
  // 水槽 + 龙头
  const skx = wallPoint(0.775, 0).x;
  const sky = top2(0.775);
  g.roundRect(skx - 18, sky - 7, 34, 9, 3).fill(hex("#e3e7ec"));
  g.roundRect(skx - 16, sky - 5.5, 30, 6, 2.4).fill(hex("#cfd5db"));
  g.moveTo(skx + 10, sky - 6).lineTo(skx + 10, sky - 20).lineTo(skx + 2, sky - 20)
    .stroke({ color: hex("#b6bcc3"), width: 2.4 });
  // 杯子两个
  for (let i = 0; i < 2; i++) {
    const cx2 = wallPoint(0.70 + i * 0.028, 0).x;
    g.roundRect(cx2, cmy - 10, 7.5, 10, 2).fill(SKIN.paper);
  }
  // ⑥ 吊架（离柜面 64，读成"柜 + 上架"）+ 罐子 + 小绿植
  const shelf2Y = top2(0.73) - 64;
  const [ua, ub] = [wallPoint(CAB2.u0, 0), wallPoint(CAB2.u1, 0)];
  g.rect(ua.x, shelf2Y, ub.x - ua.x, 6).fill(SKIN.woodFront);
  g.rect(ua.x, shelf2Y, ub.x - ua.x, 2.5).fill(SKIN.woodTop);
  for (let i = 0; i < 4; i++) {
    const jar = wallPoint(0.62 + i * 0.032, 0);
    g.roundRect(jar.x, shelf2Y - 15, 8.5, 15, 2).fill(SKIN.paper);
    g.roundRect(jar.x, shelf2Y - 15, 8.5, 3, 1.5).fill(hex("#e6e3dd"));
  }
  leaf(g, wallPoint(0.83, 0).x + 7, shelf2Y, 0.45);

  // ⑦ 冰箱（右端，白色高柜：上下门缝 + 竖向拉手 + 顶部散热缝）
  //    ⛔ 门缝/拉手要按**柜体前面**（v = vFront）算，用墙面基线会画到柜顶上方去（浮空）。
  isoBox(g, 0.885, 0.008, 0.945, 0.07, 92, { top: SKIN.whiteTop, front: SKIN.fridge, side: SKIN.fridgeDark });
  const frL = floorPoint(0.885, 0.07).x;
  const frR = floorPoint(0.945, 0.07).x;
  const frBase = floorPoint(0.915, 0.07);
  const frTop = frBase.y - 92 * frBase.scale;
  const frW = frR - frL;
  g.rect(frL + 1.5, frTop + 2, frW - 3, 1.6).fill({ color: SKIN.fridgeDark, alpha: 0.9 });
  g.rect(frL + 1.5, frTop + 34 * frBase.scale, frW - 3, 1.4).fill({ color: SKIN.fridgeDark, alpha: 0.85 });
  g.roundRect(frL + frW * 0.85, frTop + 6, 3.2, 24 * frBase.scale, 1.6).fill(SKIN.fridgeDark);
  g.roundRect(frL + frW * 0.85, frTop + 42 * frBase.scale, 3.2, 22 * frBase.scale, 1.6).fill(SKIN.fridgeDark);

  // ⑧ 左下角盆栽（⛔ 站在矮柜**左侧**的墙角：放到矮柜正后方会被柜子切掉，看着像"植物长在柜顶上"）
  const pot = floorPoint(0.042, 0.075);
  potted(g, pot.x, pot.y, pot.scale);

  layer.addChild(g);
}

/* ── 两侧陈设（左墙花箱 + 角落盆栽 + 右墙窗）────────────────────────────── */

export function drawSideProps(layer: Container): void {
  const g = new Graphics();
  g.zIndex = -8e5;

  // 左墙长条花箱（沿左墙纵深铺开）
  // ⛔ 只堆一排同尺寸灌木会读成"绿梯子"（实测）⇒ 盆体加厚到 32 + 土色盆口 + 灌木大小/高度错开。
  const boxA = sideWallPoint("left", 0.30, 0);
  const boxB = sideWallPoint("left", 0.74, 0);
  const TH = 32;
  g.poly([boxA.x - 7, boxA.y - TH, boxA.x + 21, boxA.y - TH, boxB.x + 21, boxB.y - TH, boxB.x - 7, boxB.y - TH]).fill(SKIN.woodTop);
  g.poly([boxA.x - 7, boxA.y - TH, boxA.x + 21, boxA.y - TH, boxA.x + 21, boxA.y, boxA.x - 7, boxA.y]).fill(SKIN.woodFront);
  g.poly([boxA.x - 7, boxA.y - TH, boxB.x - 7, boxB.y - TH, boxB.x - 7, boxB.y, boxA.x - 7, boxA.y]).fill(SKIN.woodSide);
  g.poly([boxA.x - 4, boxA.y - TH + 3, boxA.x + 18, boxA.y - TH + 3, boxB.x + 18, boxB.y - TH + 3, boxB.x - 4, boxB.y - TH + 3])
    .fill(hex("#cdb99b"));
  for (let i = 0; i <= 9; i++) {
    const p = sideWallPoint("left", 0.305 + (i / 9) * 0.43, 0);
    const bk = 0.72 + ((i * 37) % 5) * 0.13;
    bush(g, p.x + 7, p.y - TH - 5 * bk, bk);
  }
  // 下垂到盆前的一片叶（破掉"整齐一排"的机械感）
  for (let i = 0; i < 3; i++) {
    const p = sideWallPoint("left", 0.40 + i * 0.10, 0);
    g.ellipse(p.x + 16, p.y - 12 - i * 3, 5, 9).fill(i % 2 ? SKIN.plantDark : SKIN.plant);
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

/** 屏幕底色（只有打盹那台是暗的）。 */
function screenBg(kind: ScreenKind): number {
  return kind === "sleep" ? hex("#232a35") : hex("#f8fafd");
}

/**
 * 画一台显示器的**屏幕**（含逐帧动画），返回驱动它的 ticker。
 *
 * ⛔ 三条纪律：
 *   ① 动的部件一律是**独立 Graphics + 每帧只改 transform / alpha**，⛔ 不许每帧 clear + 重画
 *      （9 个工位 × 十几块图形，重建几何会把顶点缓冲刷爆；动画就该只动变换）。
 *   ② 屏幕要挂在 host 上（**桌子那个 Graphics 之后**），否则被显示器外壳盖住。
 *   ③ 每种屏的动画要和它"在干什么"对得上：代码在逐行敲、图表在长、表格有选中框在走、
 *      邮件有未读点在闪、打盹的机器是暗屏 + 缓慢呼吸（见 OfficeCanvas 的 screenKindOf）。
 */
function drawScreen(host: Container, kind: ScreenKind, monX: number, shellTop: number, mw: number, mh: number): PropTicker {
  const x = monX - mw * 0.45;
  const y = shellTop + mh * 0.11;
  const w = mw * 0.9;
  const h = mh * 0.9;
  const box = new Container();
  host.addChild(box);

  const bg = new Graphics();
  bg.rect(x, y, w, h).fill(screenBg(kind));
  box.addChild(bg);

  const jobs: Array<(t: number) => void> = [];
  /** 一块会动的图形：`draw` 只跑一次，`apply` 每帧只改 transform / alpha。 */
  const part = (draw: (g: Graphics) => void, apply: (g: Graphics, t: number) => void): Graphics => {
    const gg = new Graphics();
    draw(gg);
    box.addChild(gg);
    jobs.push((t) => apply(gg, t));
    return gg;
  };
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const cyc = (t: number, period: number, offset = 0) => ((t / period + offset) % 1);
  const pad = w * 0.09;

  if (kind === "code") {
    const gut = new Graphics();
    gut.rect(x, y, w * 0.14, h).fill(hex("#e9eef5"));
    box.addChild(gut);
    const cols = [hex("#4f9e6b"), hex("#3f7fcf"), hex("#c9922f"), hex("#8a5fd0")];
    const lh = h * 0.126;
    const lens: number[] = [];
    // 逐行"敲"出来：每行按进度把宽度从左边长出来（scale.x），⛔ 不改几何
    for (let i = 0; i < 6; i++) {
      const len = w * 0.62 * (0.5 + ((i * 7) % 5) * 0.12);
      lens.push(len);
      part(
        (gg) => { gg.roundRect(0, 0, len, Math.max(1.6, h * 0.07), 1).fill(cols[i % 4]); },
        (gg, t) => {
          gg.position.set(x + w * 0.19, y + h * 0.085 + i * lh);
          gg.scale.x = clamp01((cyc(t, 3.2) * 1.45 - i * 0.19) / 0.19);
        },
      );
    }
    // 光标：跟在"最新一行"末尾闪
    part(
      (gg) => { gg.rect(0, 0, Math.max(1.8, w * 0.028), Math.max(3.4, h * 0.11)).fill(hex("#3f7fcf")); },
      (gg, t) => {
        const prog = cyc(t, 3.2) * 1.45;
        const row = Math.min(5, Math.max(0, Math.floor(prog / 0.19)));
        const grown = clamp01((prog - row * 0.19) / 0.19);
        gg.position.set(x + w * 0.19 + lens[row] * grown + 1.5, y + h * 0.075 + row * lh);
        gg.alpha = Math.sin(t * 7) > -0.2 ? 0.85 : 0.15;
      },
    );
  } else if (kind === "sheet") {
    const head = new Graphics();
    head.rect(x + pad * 0.6, y + pad * 0.7, w - pad * 1.2, h * 0.12).fill(hex("#4a86cf"));
    box.addChild(head);
    for (let i = 0; i < 4; i++) {
      const row = new Graphics();
      row.rect(x + pad * 0.6, y + pad * 0.7 + h * 0.18 + i * h * 0.16, w - pad * 1.2, h * 0.11)
        .fill(i % 2 ? hex("#dfe9f4") : hex("#eef3f9"));
      box.addChild(row);
    }
    // 选中的行：一个浅蓝框在四行之间走一圈（"有人在翻表格"）
    part(
      (gg) => {
        gg.roundRect(x + pad * 0.5, y + pad * 0.6 + h * 0.17, w - pad, h * 0.135, 1.5)
          .stroke({ color: hex("#4a86cf"), width: 1.4 });
      },
      (gg, t) => {
        gg.position.y = Math.floor(cyc(t, 4.6) * 4) * h * 0.16;
        gg.alpha = 0.85;
      },
    );
    // 单元格里一个闪烁的编辑光标
    part(
      (gg) => { gg.rect(0, 0, 1.4, Math.max(3, h * 0.095)).fill(hex("#2f6bdd")); },
      (gg, t) => {
        gg.position.set(x + w * 0.55, y + pad * 0.8 + h * 0.19 + Math.floor(cyc(t, 4.6) * 4) * h * 0.16);
        gg.alpha = Math.sin(t * 6.5) > 0 ? 0.9 : 0.1;
      },
    );
  } else if (kind === "chart") {
    const base = new Graphics();
    base.rect(x + pad, y + h - pad, w - pad * 2, 1.6).fill(hex("#b9c8d8"));
    box.addChild(base);
    const statics = [0.42, 0.72, 0.56, 0.9, 0.66];
    const bw = (w - pad * 2) / 6.2;
    statics.forEach((bh, i) => {
      const full = Math.max(3, bh * (h - pad * 2) * 0.92);
      part(
        (gg) => { gg.roundRect(0, 0, bw, full, 1.2).fill(i === 3 ? hex("#4a86cf") : hex("#9dc0e6")); },
        (gg, t) => {
          gg.position.set(x + pad + i * bw * 1.24, y + h - pad - 1.6);
          // 柱子上下"呼吸"（像实时数据在刷新）；中点对齐免得基线漂
          gg.pivot.set(0, full);
          gg.scale.y = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(t * 1.1 + i * 0.7));
        },
      );
    });
  } else if (kind === "design") {
    part((gg) => { gg.roundRect(0, 0, w * 0.44, h * 0.56, 1.5).fill(hex("#cfd9e6")); },
      (gg, t) => { gg.position.set(x + pad * 0.7 + Math.sin(t * 0.5) * w * 0.02, y + pad * 0.7); });
    const blk2 = new Graphics();
    blk2.roundRect(x + w * 0.56, y + pad * 0.7, w * 0.32, h * 0.26, 1.5).fill(hex("#e3c48b"));
    const blk3 = new Graphics();
    blk3.roundRect(x + w * 0.56, y + pad * 0.7 + h * 0.32, w * 0.32, h * 0.22, 1.5).fill(hex("#a9cfe0"));
    box.addChild(blk2, blk3);
    // 在画布上拖动的选区框
    part((gg) => { gg.rect(0, 0, w * 0.30, h * 0.20).stroke({ color: hex("#2f6bdd"), width: 1.4 }); },
      (gg, t) => {
        const p = cyc(t, 6.5);
        gg.position.set(x + pad * 0.7 + p * w * 0.36, y + pad * 0.8 + p * h * 0.34);
        gg.alpha = p < 0.85 ? 0.9 : 0;
      });
  } else if (kind === "mail") {
    for (let i = 0; i < 3; i++) {
      const row = new Graphics();
      row.rect(x + pad * 0.7, y + pad * 0.8 + i * h * 0.27, w - pad * 1.4, h * 0.21).fill(i === 0 ? hex("#e8eff8") : hex("#f1f5fa"));
      row.circle(x + pad * 1.15, y + pad * 0.8 + i * h * 0.27 + h * 0.105, h * 0.055).fill(i === 0 ? hex("#4a86cf") : hex("#b6c3d2"));
      box.addChild(row);
    }
    // 未读点：呼吸式脉冲（"有新消息一直没点开"）
    part((gg) => { gg.circle(0, 0, Math.max(1.8, h * 0.055)).fill(hex("#e0453c")); },
      (gg, t) => {
        gg.position.set(x + w * 0.90, y + pad * 0.8 + h * 0.105);
        gg.alpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 3.4));
        const s = 1 + 0.35 * (0.5 + 0.5 * Math.sin(t * 3.4));
        gg.scale.set(s);
      });
  } else {
    // 打盹：暗屏 + 两个大小不同的圆 + 极缓慢的亮度呼吸（像屏保）
    const halo = new Graphics();
    halo.rect(x, y, w, h).fill({ color: hex("#8fb6e8"), alpha: 0.06 });
    box.addChild(halo);
    part((gg) => { gg.circle(0, 0, Math.max(3, h * 0.09)).stroke({ color: hex("#7f8ea3"), width: 1.4 }); },
      (gg, t) => {
        const c = cyc(t, 3.6);
        gg.position.set(x + w * 0.32, y + h * 0.40 - c * h * 0.18);
        gg.alpha = c < 0.15 ? c / 0.15 : Math.max(0, 1 - (c - 0.15) / 0.85) * 0.9;
      });
    part((gg) => { gg.circle(0, 0, Math.max(4, h * 0.12)).stroke({ color: hex("#68758a"), width: 1.4 }); },
      (gg, t) => {
        const c = cyc(t, 3.6, 0.45);
        gg.position.set(x + w * 0.62, y + h * 0.58 - c * h * 0.18);
        gg.alpha = c < 0.15 ? c / 0.15 : Math.max(0, 1 - (c - 0.15) / 0.85) * 0.8;
      });
    jobs.push((t) => { halo.alpha = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(t * 0.8)); });
  }

  // 玻璃反光（静态，斜着一条）—— 有它屏幕才"像一块玻璃"而不是一张贴纸
  if (kind !== "sleep") {
    const gl = new Graphics();
    gl.poly([x + w * 0.08, y + h, x + w * 0.30, y, x + w * 0.46, y, x + w * 0.24, y + h])
      .fill({ color: 0xffffff, alpha: 0.34 });
    box.addChild(gl);
  }

  return { update: (t) => { for (const j of jobs) j(t); } };
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
export function drawDeskStation(g: Graphics, u: number, v: number, screen: ScreenKind, host?: Container): PropTicker | null {
  const seat = floorPoint(u, v);
  const k = seat.scale;
  const cx = seat.x;
  const u0 = u - DESK_HALF_U;
  const u1 = u + DESK_HALF_U;
  const vFar = v - DESK_DV;

  // ① 柔阴影：桌面下那一大片（家具"落"在地上而不是浮着）
  softShadow(g, cx - 12 * k, seat.y + 12 * k, 104 * k, 26 * k, 0.13);

  // ② 桌面：悬空白板（厚 9）
  isoPrism(g, u0, vFar, u1, v, DESK_H - 9, DESK_H, {
    top: SKIN.deskTop, front: SKIN.deskFront, side: SKIN.deskEdge,
  });
  // ⛔ 桌面纯白 + 地板纯白 ⇒ 不叠层次的话桌子在白底上等于隐形（第一版实测"工位看不出桌子"）。
  //    ⛔ 但**别铺满整个桌面**（会把白桌变成"灰垫子"），也**别用单一一档**（硬边像桌上贴了条灰胶带）：
  //    靠后 7 档逐级压暗、每档极淡（合计约 0.035）：够表达面在往后收，又不会把白桌变灰。
  const topPt = (uu: number, vv: number) => {
    const p = floorPoint(uu, vv);
    return [p.x, p.y - DESK_H * k] as const;
  };
  for (let i = 0; i < 7; i++) {
    const vm = vFar + DESK_DV * (1 - i * 0.13);
    g.poly([...topPt(u0, vFar), ...topPt(u1, vFar), ...topPt(u1, vm), ...topPt(u0, vm)])
      .fill({ color: SKIN.shadow, alpha: 0.009 });
  }
  const [fa, fb] = [floorPoint(u0, v), floorPoint(u1, v)];
  // 前挡边：桌沿内侧压一道浅影 + 桌沿一条亮线，"板厚"才看得出来
  g.rect(fa.x, fa.y - DESK_H * k, fb.x - fa.x, 2.6 * k).fill({ color: SKIN.shadow, alpha: 0.055 });
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

  // ⑤ 显示器：屏后光晕 + 浅色外壳 + 深色内圈（屏幕"嵌"进去）+ 支架 + 亮唇 + 电源点
  const deskW = floorPoint(u1, v).x - floorPoint(u0, v).x;
  // ⛔ 宽度**封顶**：前排的桌宽是后排的 1.25 倍，不封顶的话前排显示器会长到上一排人的胸口，
  //    把上一排的项圈/椅子盖掉（实测过一次）。
  const mw = Math.min(deskW * 0.54, 82);
  const mh = mw * 0.62;
  const mon = floorPoint(u, vFar + DESK_DV * 0.30);
  const baseY = mon.y - (DESK_H + MONITOR_LIFT) * k;
  const shellTop = baseY - mh * 1.14;
  // 屏后一层很淡的光晕：屏幕是画面里最亮的东西，光会"洒"到显示器外的白墙上
  const lit = screen !== "sleep";
  if (lit) {
    g.roundRect(mon.x - mw * 0.60, shellTop - mh * 0.08, mw * 1.20, mh * 1.30, mw * 0.10)
      .fill({ color: hex("#cfe2f5"), alpha: 0.3 });
  }
  g.ellipse(mon.x, baseY + MONITOR_LIFT * k, mw * 0.19, 3.6 * k).fill(SKIN.monitorStand);
  g.rect(mon.x - mw * 0.05, baseY, mw * 0.10, MONITOR_LIFT * k).fill(SKIN.monitorStand);
  g.roundRect(mon.x - mw / 2, shellTop, mw, mh * 1.14, mw * 0.035).fill(SKIN.monitorShell);
  g.roundRect(mon.x - mw * 0.47, shellTop + mh * 0.09, mw * 0.94, mh * 0.94, mw * 0.02).fill(hex("#3a4048"));
  // 屏幕本体（含逐帧动画）挂在 host 上 —— ⛔ 必须在桌子这个 Graphics **之后**，否则被外壳盖住
  const screenAnim = host ? drawScreen(host, screen, mon.x, shellTop, mw, mh) : null;
  // 底部亮唇 + 电源指示灯（几像素的细节，但"像不像一台显示器"全在这；熄屏时灯转灰）
  g.roundRect(mon.x - mw * 0.09, baseY - mh * 0.075, mw * 0.18, 2.2, 1.1).fill(hex("#cdd2d9"));
  g.circle(mon.x + mw * 0.37, baseY - mh * 0.05, 1.5).fill(lit ? hex("#8fd6a4") : hex("#a9b0b8"));
  g.roundRect(mon.x - mw / 2, shellTop, mw, mh * 1.14, mw * 0.035).stroke({ color: SKIN.monitorEdge, width: 1.3 });

  // ⑥ 键鼠（贴桌沿）。⛔ 键盘**不居中**：人坐在正中、躯干会把居中的键盘整个挡住
  //    （放大实测只剩两条白边），挪到人的左手侧才读得出来；鼠标垫贴键盘右侧。
  const kb = floorPoint(u - 0.042, v - 0.045);
  const ky = kb.y - DESK_H * k;
  const kbW = deskW * 0.32;
  const kbH = deskW * 0.05;
  const kbX = kb.x - kbW / 2;
  const kbY = ky - kbH;
  // 键盘底盘（投影 + 底盘 + 键区）
  g.ellipse(kb.x, ky + 1.2 * k, kbW * 0.56, 2.6 * k).fill({ color: SKIN.shadow, alpha: 0.07 });
  g.roundRect(kbX, kbY, kbW, kbH, 2).fill(hex("#e8e5df"));
  g.roundRect(kbX + 1.2, kbY + 1.2, kbW - 2.4, kbH - 2.4, 1.5).fill(hex("#f2efe9"));
  // 三行键位：细暗线（放大能看出是按键行，缩小就是纹理）
  for (let i = 1; i <= 3; i++) {
    g.moveTo(kbX + kbW * 0.08, kbY + (kbH * i) / 4).lineTo(kbX + kbW * 0.92, kbY + (kbH * i) / 4)
      .stroke({ color: hex("#cfcac2"), width: 0.8 });
  }
  // 空格键 + 回车键（两个"大键"，一眼是键盘）
  g.roundRect(kbX + kbW * 0.26, kbY + kbH * 0.78, kbW * 0.4, kbH * 0.14, 1).fill(hex("#d8d3ca"));
  g.roundRect(kbX + kbW * 0.78, kbY + kbH * 0.1, kbW * 0.12, kbH * 0.5, 1).fill(hex("#d8d3ca"));

  // 鼠标垫 + 鼠标（滚轮 + 受光高光；⛔ 高光别太亮，浅灰就够）
  const mpX = kbX + kbW + deskW * 0.045;
  g.roundRect(mpX - deskW * 0.048, ky - deskW * 0.06, deskW * 0.096, deskW * 0.07, 2)
    .fill(hex("#dfe3e8"));
  g.ellipse(mpX, ky - deskW * 0.028, deskW * 0.021, deskW * 0.019).fill(hex("#f4f2ee"));
  g.ellipse(mpX, ky - deskW * 0.028, deskW * 0.021, deskW * 0.019).stroke({ color: hex("#cfcbc3"), width: 0.9 });
  g.moveTo(mpX, ky - deskW * 0.042).lineTo(mpX, ky - deskW * 0.021)
    .stroke({ color: hex("#b9b3a9"), width: 0.9 });
  g.circle(mpX - deskW * 0.007, ky - deskW * 0.034, deskW * 0.0038).fill({ color: 0xffffff, alpha: 0.8 });

  // ⑦ 桌面小物：笔筒（右后角）+ 便签（左前角）+ 显示器线缆
  const penBase = floorPoint(u + DESK_HALF_U * 0.72, vFar + DESK_DV * 0.16);
  const penY = penBase.y - DESK_H * k;
  g.roundRect(penBase.x - 4 * k, penY - 9 * k, 8 * k, 9 * k, 2).fill(SKIN.paper);
  g.roundRect(penBase.x - 4 * k, penY - 9 * k, 8 * k, 9 * k, 2).stroke({ color: SKIN.deskEdge, width: 1 });
  g.moveTo(penBase.x - 2 * k, penY - 9 * k).lineTo(penBase.x - 3.4 * k, penY - 16 * k)
    .stroke({ color: hex("#4f9e6b"), width: 1.5 });
  g.moveTo(penBase.x + 1 * k, penY - 9 * k).lineTo(penBase.x + 2.6 * k, penY - 15 * k)
    .stroke({ color: hex("#3f7fcf"), width: 1.5 });
  const note = floorPoint(u - DESK_HALF_U * 0.55, v - DESK_DV * 0.30);
  const noteY = note.y - DESK_H * k;
  g.roundRect(note.x - 5 * k, noteY - 7 * k, 10 * k, 7 * k, 1).fill(hex("#f3e08a"));
  g.roundRect(note.x - 5 * k, noteY - 10 * k, 10 * k, 7 * k, 1).fill(hex("#f8ecab"));
  // 显示器线缆：支架底 → 桌沿后侧垂下（一条细弧，别太抢）
  g.moveTo(mon.x + mw * 0.06, baseY).quadraticCurveTo(mon.x + mw * 0.10, baseY + MONITOR_LIFT * k * 0.5, mon.x + mw * 0.05, baseY + MONITOR_LIFT * k)
    .stroke({ color: hex("#b7bcc3"), width: 1.1 });

  return screenAnim;
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
  // ⛔ 0.42 会让椅背和角色肩宽一样（放大看像"人卡在一张大椅子里"）⇒ 收到 0.38
  const w = deskW * 0.38;

  // ⛔ 椅子是**白椅落在白地板上** —— 不给它柔阴影 + 一圈浅描边，画出来等于没画（第一版实测：
  //    整排工位看着"人悬在桌沿上"）。⛔ 描边用浅灰而不是黑：黑描边会退回卡通线稿风。
  softShadow(g, x, y + 2 * k, w * 0.92, 9 * k, 0.13);
  // 五星脚 + 滚轮（滚轮加深色轮毂：全同色的小圆看着像"五个脚印"）
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
    const px = x + Math.cos(a) * w * 0.46;
    const py = y + Math.sin(a) * w * 0.46 * 0.34 + 1 * k;
    g.moveTo(x, y - 4 * k).lineTo(px, py).stroke({ color: SKIN.chairLeg, width: 3.4 * k });
    g.circle(px, py, 2.8 * k).fill(SKIN.chairLeg);
    g.circle(px, py, 1.2 * k).fill(hex("#b6b2ab"));
  }
  // 气压杆 + 座（座面加一条前缘亮线 + 一条缝线，"软垫"才读得出来）
  g.rect(x - 2.4 * k, y - 40 * k, 4.8 * k, 38 * k).fill(SKIN.chairLeg);
  g.roundRect(x - w / 2, y - 50 * k, w, 12 * k, 5).fill(SKIN.chairSeat);
  g.roundRect(x - w / 2, y - 50 * k, w, 12 * k, 5).stroke({ color: SKIN.chairBackDark, width: 1.2 });
  g.moveTo(x - w * 0.38, y - 44 * k).lineTo(x + w * 0.38, y - 44 * k)
    .stroke({ color: SKIN.chairBackDark, width: 1 });
  // 扶手：左右各一支（立柱 + 端板），别高过座面太多
  [-1, 1].forEach((s) => {
    const ax = x + s * w * 0.52;
    g.rect(ax - 1.6 * k, y - 42 * k, 3.2 * k, 14 * k).fill(SKIN.chairLeg);
    g.roundRect(ax - 5 * k, y - 46 * k, 10 * k, 4 * k, 2).fill(SKIN.chairSeat);
    g.roundRect(ax - 5 * k, y - 46 * k, 10 * k, 4 * k, 2).stroke({ color: SKIN.chairBackDark, width: 0.9 });
  });
  // 靠背（圆角竖板 + 顶部暗边 + 腰托 + 浅描边，靠明暗分层而不是黑描边）
  const backH = CHAIR_BACK_TOP - 46;
  g.roundRect(x - w * 0.54, y - CHAIR_BACK_TOP * k, w * 1.08, backH * k, w * 0.2)
    .fill(SKIN.chairBack).stroke({ color: SKIN.chairBackDark, width: 1.4 });
  g.roundRect(x - w * 0.54, y - CHAIR_BACK_TOP * k, w * 1.08, 7 * k, w * 0.16).fill(SKIN.chairBackDark);
  g.roundRect(x - w * 0.4, y - (CHAIR_BACK_TOP - 13) * k, w * 0.8, 4 * k, 2).fill(SKIN.chairBackDark);
  // 头枕（小一块、接在靠背顶上，与靠背之间留 1px 缝——"两件套"才看得出来）
  g.roundRect(x - w * 0.34, y - (CHAIR_BACK_TOP + 13) * k, w * 0.68, 12 * k, w * 0.1)
    .fill(SKIN.chairBack).stroke({ color: SKIN.chairBackDark, width: 1.2 });
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
    // 顶部标识牌（男女双色小人 + 占用指示灯）—— 牌面要够大，否则放大看只是"三个飘着的点"
    g.roundRect(x - 15 * k, y - h - 19 * k, 30 * k, 15 * k, 3).fill(hex("#ffffff"));
    g.roundRect(x - 15 * k, y - h - 19 * k, 30 * k, 15 * k, 3).stroke({ color: hex("#e2e6ea"), width: 1 });
    g.circle(x - 5.5 * k, y - h - 11.5 * k, 3.4 * k).fill(hex("#5b7cba"));
    g.circle(x + 5.5 * k, y - h - 11.5 * k, 3.4 * k).fill(hex("#cf7594"));
    const lamp = new Graphics();
    lamp.circle(0, 0, 3.2 * k).fill(hex("#4dbf6a"));
    lamp.zIndex = -7e5 + 1;
    lamp.position.set(x + w / 2 + 9 * k, y - h - 11.5 * k);
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
