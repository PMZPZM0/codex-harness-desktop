/**
 * 办公室程序化绘制（team-office 域，09-27 v9）。
 *
 * ⛔ 全部用 PixiJS Graphics 画，**不使用任何贴图素材**（用户 09-27 拍板：参考项目的 3D
 *    素材作者自己标注「注意素材版权问题」，我们只复刻**风格**，不搬素材）。
 * ⛔ 风格三原则（照参考的 3D 渲染观感，与 v5 的卡通描边是两套语言）：
 *      ① **不用黑描边** —— 面与面靠**明暗差**区分（顶面最亮、前面中、侧面暗）；
 *      ② **柔阴影** —— 家具/人物脚下铺低透明度椭圆，让物件"落"在地上而不是浮着；
 *      ③ **近白低饱和** —— 地板纯白、墙浅灰、家具纯白，只有木柜与绿植带颜色。
 *
 * 坐标：全部走 office-iso 的归一化地面坐标（u/v），家具自带纵深缩放，
 * 不会出现「各自漂移」（v6 的老毛病）。
 */
import { Container, Graphics } from "pixi.js";
import { FLOOR, WALL_H, floorCorners, floorPoint, sideWallPoint, wallPoint, type Pt } from "./office-iso";

const hex = (h: string) => parseInt(h.replace("#", ""), 16);

/** 参考观感色板（白系 3D）：顶面 > 前面 > 侧面 的明度阶梯。 */
export const SKIN = {
  floor: hex("#ffffff"),
  floorBack: hex("#f4f4f5"),
  wallBack: hex("#f0efec"),
  wallSide: hex("#e4e2dc"),
  wallTop: hex("#f7f6f3"),
  baseboard: hex("#d9d6cf"),
  shadow: hex("#5c6472"),

  deskTop: hex("#ffffff"),
  deskFront: hex("#eceae4"),
  deskSide: hex("#ddd9d1"),
  deskLeg: hex("#d4d1ca"),
  cabinet: hex("#f6f5f2"),

  monitorBack: hex("#3b3d41"),
  monitorScreen: hex("#dfeaf6"),
  monitorScreenDim: hex("#c9d6e4"),
  monitorStand: hex("#b9b7b1"),

  chairBack: hex("#f3f2ee"),
  chairBackDark: hex("#dcd9d3"),
  chairSeat: hex("#e6e4de"),
  chairLeg: hex("#c9c6c0"),

  woodTop: hex("#d9b784"),
  woodFront: hex("#c9a471"),
  woodSide: hex("#b18c5c"),
  whiteTop: hex("#fbfaf8"),
  fridge: hex("#e9ebed"),
  fridgeDark: hex("#c8ccd1"),

  plant: hex("#5aa364"),
  plantDark: hex("#3f7f49"),
  plantLight: hex("#7cbd80"),
  pot: hex("#eceae5"),
  potDark: hex("#d3d0c9"),

  paper: hex("#ffffff"),
  frame: hex("#c9a471"),
} as const;

/** 带高度的等距长方体（顶面 + 前面 + 两侧露边）。 */
function isoBox(
  g: Graphics,
  u0: number, v0: number, u1: number, v1: number,
  h: number,
  c: { top: number; front: number; side: number },
): void {
  const [a, b, cc, d] = floorCorners(u0, v0, u1, v1); // 后左 / 后右 / 前右 / 前左
  const k = floorPoint((u0 + u1) / 2, (v0 + v1) / 2).scale;
  const H = h * k;
  const lift = (p: Pt, dy: number) => [p.x, p.y - dy] as const;

  // 左侧面（后左 → 前左）
  g.poly([a.x, a.y, d.x, d.y, ...lift(d, H), ...lift(a, H)]).fill(c.side);
  // 右侧面（后右 → 前右）
  g.poly([b.x, b.y, cc.x, cc.y, ...lift(cc, H), ...lift(b, H)]).fill(c.side);
  // 前面（前左 → 前右）
  g.poly([d.x, d.y, cc.x, cc.y, ...lift(cc, H), ...lift(d, H)]).fill(c.front);
  // 顶面（后左 → 后右 → 前右 → 前左）
  g.poly([...lift(a, H), ...lift(b, H), ...lift(cc, H), ...lift(d, H)]).fill(c.top);
}

/* ── 房间 ───────────────────────────────────────────────────────────────── */

export function drawRoom(layer: Container): void {
  const { bl, br, fr, fl } = FLOOR;
  const g = new Graphics();
  g.zIndex = -1e6;

  // 后墙
  g.rect(bl[0], bl[1] - WALL_H, br[0] - bl[0], WALL_H).fill(SKIN.wallBack);
  // 左右侧墙（向后收的斜面）
  g.poly([bl[0], bl[1] - WALL_H, bl[0], bl[1], fl[0], fl[1], fl[0], fl[1] - WALL_H]).fill(SKIN.wallSide);
  g.poly([br[0], br[1] - WALL_H, br[0], br[1], fr[0], fr[1], fr[0], fr[1] - WALL_H]).fill(SKIN.wallSide);
  // 墙顶剖切边（参考是"掀掉天花板的房间"，露出墙的厚度）
  g.poly([bl[0], bl[1] - WALL_H, br[0], br[1] - WALL_H, br[0] + 26, br[1] - WALL_H - 16, bl[0] - 26, bl[1] - WALL_H - 16]).fill(SKIN.wallTop);

  // 地板
  g.poly([bl[0], bl[1], br[0], br[1], fr[0], fr[1], fl[0], fl[1]]).fill(SKIN.floor);
  // 地板靠后一档的柔和过渡（模拟 3D 渲染的环境光遮蔽）
  g.poly([bl[0], bl[1], br[0], br[1], br[0] + 26, br[1] + 46, bl[0] - 26, bl[1] + 46])
    .fill({ color: SKIN.floorBack, alpha: 0.75 });

  // 墙脚线
  g.moveTo(bl[0], bl[1]).lineTo(br[0], br[1]).stroke({ color: SKIN.baseboard, width: 3 });
  g.moveTo(bl[0], bl[1]).lineTo(fl[0], fl[1]).stroke({ color: SKIN.baseboard, width: 2.5 });
  g.moveTo(br[0], br[1]).lineTo(fr[0], fr[1]).stroke({ color: SKIN.baseboard, width: 2.5 });

  // 地板外沿厚度（让房间"有底"）
  g.poly([fl[0], fl[1], fr[0], fr[1], fr[0] + 12, fr[1] + 14, fl[0] - 12, fl[1] + 14]).fill(SKIN.wallSide);

  layer.addChild(g);
}

/* ── 后墙陈设（照参考：矮柜 + 上层置物架 + 相框 + 木色橱柜 + 冰箱）────────── */

export function drawBackWall(layer: Container): void {
  const g = new Graphics();
  g.zIndex = -9e5;

  // ① 左下矮柜（带上层置物架）
  isoBox(g, 0.10, 0.02, 0.30, 0.085, 42, { top: SKIN.whiteTop, front: SKIN.woodFront, side: SKIN.woodSide });
  // 上层置物架（悬空薄板 + 两侧支板）
  const shelfTop = 42 + 52;
  const [sa, sb] = [wallPoint(0.10, shelfTop), wallPoint(0.30, shelfTop)];
  g.rect(sa.x, sa.y, sb.x - sa.x, 7).fill(SKIN.woodFront);
  g.rect(sa.x, sa.y, sb.x - sa.x, 3).fill(SKIN.woodTop);
  g.rect(sa.x, sa.y, 6, -52).fill(SKIN.woodSide);
  g.rect(sb.x - 6, sb.y, 6, -52).fill(SKIN.woodSide);
  // 架上文件（白纸盒）
  for (let i = 0; i < 3; i++) {
    const a = wallPoint(0.115 + i * 0.022, shelfTop - 1);
    g.rect(a.x, a.y - 26, 10, 26).fill(SKIN.paper);
    g.rect(a.x, a.y - 26, 10, 3).fill(hex("#e7e5df"));
  }

  // ② 墙面相框
  const f0 = wallPoint(0.395, 62);
  g.rect(f0.x, f0.y, 62, 74).fill(SKIN.frame);
  g.rect(f0.x + 4, f0.y + 4, 54, 66).fill(hex("#f3f1ec"));
  g.rect(f0.x + 10, f0.y + 12, 42, 30).fill(hex("#e6e3dc"));

  // ③ 右侧木色橱柜 + 白台面
  isoBox(g, 0.62, 0.02, 0.86, 0.085, 44, { top: SKIN.whiteTop, front: SKIN.woodFront, side: SKIN.woodSide });
  // 台面上：咖啡机 / 水槽 / 杯子（极简剪影）
  const counter = (uu: number) => wallPoint(uu, 44);
  const cm = counter(0.655);
  g.roundRect(cm.x, cm.y - 20, 14, 20, 3).fill(hex("#5b5f66"));
  g.rect(cm.x + 3, cm.y - 14, 8, 8).fill(hex("#8d9298"));
  const sink = counter(0.80);
  g.roundRect(sink.x - 20, sink.y - 7, 34, 10, 3).fill(hex("#d9dde2"));
  for (let i = 0; i < 3; i++) {
    const cup = counter(0.715 + i * 0.026);
    g.roundRect(cup.x, cup.y - 11, 8, 11, 2).fill(SKIN.paper);
  }
  // 上层吊架
  const [ua, ub] = [wallPoint(0.62, 44 + 54), wallPoint(0.86, 44 + 54)];
  g.rect(ua.x, ua.y, ub.x - ua.x, 7).fill(SKIN.woodFront);
  g.rect(ua.x, ua.y, ub.x - ua.x, 3).fill(SKIN.woodTop);
  for (let i = 0; i < 4; i++) {
    const jar = wallPoint(0.64 + i * 0.032, 44 + 53);
    g.roundRect(jar.x, jar.y - 15, 9, 15, 2).fill(SKIN.paper);
  }
  // 吊架上的绿植
  const sp = wallPoint(0.632, 44 + 46);
  leaf(g, sp.x + 6, sp.y, 0.5);

  // ④ 冰箱（右端，白色高柜）
  isoBox(g, 0.885, 0.015, 0.945, 0.10, 96, { top: SKIN.whiteTop, front: SKIN.fridge, side: SKIN.fridgeDark });
  const fr0 = wallPoint(0.887, 96);
  g.rect(fr0.x + 1, fr0.y + 34, 4, 40).fill(SKIN.fridgeDark);

  // ⑤ 左下角盆栽
  const pot = floorPoint(0.055, 0.16);
  potted(g, pot.x, pot.y, pot.scale);

  layer.addChild(g);
}

/* ── 两侧陈设（照参考：左墙花箱 + 右下大盆栽 + 右墙窗）────────────────────── */

export function drawSideProps(layer: Container): void {
  const g = new Graphics();
  g.zIndex = -8e5;

  // 左墙长条花箱（沿左墙纵深铺开）
  const boxA = sideWallPoint("left", 0.32, 0);
  const boxB = sideWallPoint("left", 0.74, 0);
  g.poly([boxA.x - 6, boxA.y - 26, boxA.x + 20, boxA.y - 26, boxB.x + 20, boxB.y - 26, boxB.x - 6, boxB.y - 26]).fill(SKIN.woodTop);
  g.poly([boxA.x - 6, boxA.y - 26, boxA.x + 20, boxA.y - 26, boxA.x + 20, boxA.y, boxA.x - 6, boxA.y]).fill(SKIN.woodFront);
  g.poly([boxA.x - 6, boxA.y - 26, boxB.x - 6, boxB.y - 26, boxB.x - 6, boxB.y, boxA.x - 6, boxA.y]).fill(SKIN.woodSide);
  // 箱内灌木（一排圆叶）
  for (let i = 0; i <= 7; i++) {
    const p = sideWallPoint("left", 0.33 + (i / 7) * 0.40, 0);
    bush(g, p.x + 8, p.y - 30, 0.9 + (i % 2) * 0.12);
  }

  // 左墙角落两盆
  const p1 = floorPoint(0.035, 0.92);
  potted(g, p1.x, p1.y, p1.scale);

  // 右侧大盆栽
  const p2 = floorPoint(0.93, 0.52);
  potted(g, p2.x, p2.y, p2.scale * 1.25);

  // 右墙两扇窗（带窗外绿意）
  [0.30, 0.62].forEach((v) => {
    const a = sideWallPoint("right", v, 18);
    const b = sideWallPoint("right", v + 0.20, 18);
    const dx = b.x - a.x;
    g.poly([a.x, a.y - 132, a.x + dx * 0.55, a.y - 132 + (b.y - a.y) * 0.55, a.x + dx * 0.55, a.y - 22 + (b.y - a.y) * 0.55, a.x, a.y - 22])
      .fill(hex("#e7edf2"));
    g.poly([a.x, a.y - 132, a.x + dx * 0.55, a.y - 132 + (b.y - a.y) * 0.55, a.x + dx * 0.55, a.y - 22 + (b.y - a.y) * 0.55, a.x, a.y - 22])
      .stroke({ color: hex("#f2f0ec"), width: 3 });
    // 窗外绿植剪影
    const mid = { x: a.x + dx * 0.28, y: a.y - 96 + (b.y - a.y) * 0.28 };
    g.ellipse(mid.x + 6, mid.y + 42, 22, 30).fill({ color: SKIN.plantDark, alpha: 0.55 });
    g.ellipse(mid.x - 4, mid.y + 54, 16, 22).fill({ color: SKIN.plant, alpha: 0.45 });
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
  g.circle(x, y, 13 * k).fill(SKIN.plantDark);
  g.circle(x - 8 * k, y + 4 * k, 10 * k).fill(SKIN.plant);
  g.circle(x + 8 * k, y + 3 * k, 10 * k).fill(SKIN.plant);
  g.circle(x + 1 * k, y - 7 * k, 10 * k).fill(SKIN.plantLight);
}

/** 盆栽（花盆 + 叶丛）。 */
function potted(g: Graphics, x: number, y: number, k: number): void {
  const kk = k * 0.9;
  g.poly([x - 16 * kk, y - 30 * kk, x + 16 * kk, y - 30 * kk, x + 11 * kk, y, x - 11 * kk, y]).fill(SKIN.pot);
  g.poly([x + 6 * kk, y - 30 * kk, x + 16 * kk, y - 30 * kk, x + 11 * kk, y, x + 3 * kk, y]).fill(SKIN.potDark);
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + (i - 3) * 0.34;
    const rr = 26 * kk;
    g.ellipse(x + Math.cos(a) * rr, y - 34 * kk + Math.sin(a) * rr * 0.62, 9 * kk, 15 * kk)
      .fill(i % 2 ? SKIN.plant : SKIN.plantDark);
  }
  g.circle(x, y - 44 * kk, 8 * kk).fill(SKIN.plantLight);
}

/* ── 工位桌椅（照参考：白桌 + 桌下侧柜 + 显示器 + 键盘鼠标 + 白椅）──────── */

/** 画一个工位的全部家具。锚点 (cx, cy) = 工位地面中心，scale = 纵深缩放。 */
export function drawDeskStation(g: Graphics, u: number, v: number): void {
  const c = floorPoint(u, v);
  const k = c.scale;
  const cx = c.x;

  // 占地：桌子在**远侧**（人背对观众面向它），椅子在近侧
  // ⛔ 09-27：桌子改画到锚点**近侧**（观众侧），人坐远侧 —— 两者屏幕区域不重叠，
  //    人才能被完整画出来（此前桌子压在锚点上，人只露头肩）。改动要与人物的 SEAT_LIFT
  //    和 zIndex 一起看（OfficeCanvas 的 PERSON_K/SEAT_LIFT）。
  const dv = 0.085;                  // 桌面纵深（归一化）
  const vDesk0 = v + 0.014;          // 桌子（近侧）
  const vDesk1 = v + 0.014 + dv;
  const vChair = v + 0.050;          // 椅子（桌下靠人侧）

  // 阴影（桌椅各一块）
  const sd = floorPoint(u, vDesk1);
  g.ellipse(cx, sd.y + 12 * k, 62 * k, 15 * k).fill({ color: SKIN.shadow, alpha: 0.075 });
  const sc = floorPoint(u, vChair);
  g.ellipse(cx, sc.y + 10 * k, 36 * k, 11 * k).fill({ color: SKIN.shadow, alpha: 0.06 });

  // 桌子（桌面 40px 高 + 四条腿 + 桌下侧柜）
  const deskH = 38;
  isoBox(g, u - 0.098, vDesk0, u + 0.098, vDesk1, deskH, {
    top: SKIN.deskTop, front: SKIN.deskFront, side: SKIN.deskSide,
  });
  // 桌腿（前面两条，细柱）
  const [la, , lc, ld] = floorCorners(u - 0.094, vDesk0, u + 0.094, vDesk1);
  [ld, lc].forEach((p) => {
    g.rect(p.x - 3 * k, p.y - deskH * k, 6 * k, deskH * k).fill(SKIN.deskLeg);
  });
  // 桌下侧柜（右侧 1/3，用 isoBox 保证前后角的纵深正确）
  isoBox(g, u + 0.030, vDesk0 + 0.008, u + 0.090, vDesk1 - 0.006, deskH * 0.74, {
    top: SKIN.whiteTop, front: SKIN.cabinet, side: SKIN.deskSide,
  });

  // 桌面上的物件（沿桌面法向摆放：显示器在远侧、键盘靠人侧）
  const surf = (uu: number, vv: number) => floorPoint(uu, vv);
  // 显示器：底座 + 支架 + 屏（屏幕朝观众/人）
  const mon = surf(u, vDesk0 + dv * 0.20);
  const my = mon.y - deskH * k;
  g.roundRect(mon.x - 14 * k, my - 4 * k, 28 * k, 4 * k, 2).fill(SKIN.monitorStand);
  g.rect(mon.x - 3 * k, my - 14 * k, 6 * k, 10 * k).fill(SKIN.monitorStand);
  g.roundRect(mon.x - 22 * k, my - 30 * k, 44 * k, 22 * k, 3).fill(SKIN.monitorBack);
  g.roundRect(mon.x - 18 * k, my - 27 * k, 36 * k, 17 * k, 2).fill(SKIN.monitorScreen);
  // 屏上内容（几行文字条，纯装饰）
  g.rect(mon.x - 14 * k, my - 23 * k, 17 * k, 2.2 * k).fill({ color: hex("#9fb4c8"), alpha: 0.9 });
  g.rect(mon.x - 14 * k, my - 19 * k, 24 * k, 2.2 * k).fill({ color: hex("#b6c7d6"), alpha: 0.85 });
  g.rect(mon.x - 14 * k, my - 15 * k, 13 * k, 2.2 * k).fill({ color: hex("#b6c7d6"), alpha: 0.85 });
  // 键盘 + 鼠标
  const kb = surf(u, vDesk0 + dv * 0.72);
  const ky = kb.y - deskH * k;
  g.poly([kb.x - 24 * k, ky, kb.x + 24 * k, ky, kb.x + 20 * k, ky + 8 * k, kb.x - 20 * k, ky + 8 * k]).fill(hex("#f4f3f0"));
  g.ellipse(kb.x + 32 * k, ky + 3 * k, 5 * k, 3.5 * k).fill(hex("#f4f3f0"));

  // 椅子（白色办公椅：靠背 + 座 + 支柱 + 五星脚）
  const ch = surf(u, vChair);
  const cy = ch.y;
  g.ellipse(ch.x, cy - 2 * k, 26 * k, 8 * k).fill(SKIN.chairLeg);
  g.rect(ch.x - 2.5 * k, cy - 22 * k, 5 * k, 20 * k).fill(SKIN.chairLeg);
  g.roundRect(ch.x - 22 * k, cy - 30 * k, 44 * k, 12 * k, 5).fill(SKIN.chairSeat);
  g.roundRect(ch.x - 22 * k, cy - 62 * k, 44 * k, 34 * k, 10).fill(SKIN.chairBack);
  g.roundRect(ch.x - 22 * k, cy - 62 * k, 44 * k, 8 * k, 6).fill(SKIN.chairBackDark);
}


/* ── 办公设施（饮水机 / 打印机 / 资料架 / 挂钟）—— 全部带动画 ──────────────
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
    const p = floorPoint(0.84, 0.62);
    const k = p.scale, x = p.x, y = p.y;
    g.ellipse(x, y + 3 * k, 26 * k, 9 * k).fill({ color: SKIN.shadow, alpha: 0.08 });
    g.roundRect(x - 17 * k, y - 46 * k, 34 * k, 46 * k, 4).fill(hex("#edf0f3"));
    g.roundRect(x - 17 * k, y - 46 * k, 34 * k, 5 * k, 2).fill(hex("#dee3e8"));
    g.roundRect(x - 13 * k, y - 78 * k, 26 * k, 33 * k, 5).fill({ color: hex("#c2e2f6"), alpha: 0.93 });
    g.roundRect(x - 13 * k, y - 78 * k, 26 * k, 6 * k, 3).fill({ color: hex("#d9eefb"), alpha: 0.95 });
    g.rect(x - 6 * k, y - 33 * k, 12 * k, 6 * k).fill(hex("#9aa3ad"));
    g.roundRect(x - 12 * k, y - 20 * k, 24 * k, 5 * k, 2).fill({ color: hex("#ccd2d8") });
    // 水泡：3 个循环上升 + 淡出
    for (let i = 0; i < 3; i++) {
      const bubble = new Graphics();
      bubble.circle(0, 0, 2.3 * k).fill({ color: 0xffffff, alpha: 0.9 });
      bubble.zIndex = -7e5 + 1;
      bubble.position.set(x + (i - 1) * 5 * k, y - 50 * k);
      layer.addChild(bubble);
      const phase = i / 3;
      tickers.push({ update: (t) => {
        const c = (t * 0.2 + phase) % 1;
        bubble.position.y = y - 48 * k - c * 28 * k;
        bubble.alpha = c < 0.16 ? c / 0.16 : Math.max(0, 1 - (c - 0.16) / 0.84);
      } });
    }
  }

  /* ② 打印机（出纸口往复吐纸）—— 对应 errand「去打印」 */
  {
    const p = floorPoint(0.80, 0.16);
    const k = p.scale, x = p.x, y = p.y;
    g.ellipse(x, y + 3 * k, 30 * k, 9 * k).fill({ color: SKIN.shadow, alpha: 0.08 });
    // 柜体 + 机器
    g.roundRect(x - 24 * k, y - 34 * k, 48 * k, 34 * k, 4).fill(hex("#eef1f4"));
    g.roundRect(x - 21 * k, y - 60 * k, 42 * k, 26 * k, 4).fill(hex("#4a4f57"));
    g.roundRect(x - 21 * k, y - 60 * k, 42 * k, 6 * k, 3).fill(hex("#3c4148"));
    g.roundRect(x - 8 * k, y - 48 * k, 16 * k, 3 * k, 1.5).fill(hex("#9fd7a8"));
    // 纸（从出纸口来回吐）
    const paper = new Graphics();
    paper.roundRect(-13 * k, 0, 26 * k, 17 * k, 1.5).fill(SKIN.paper);
    paper.rect(-9 * k, 3 * k, 18 * k, 1.4 * k).fill({ color: hex("#c9d2da") });
    paper.rect(-9 * k, 6.5 * k, 13 * k, 1.4 * k).fill({ color: hex("#c9d2da") });
    paper.zIndex = -7e5 + 1;
    paper.position.set(x, y - 38 * k);
    layer.addChild(paper);
    tickers.push({ update: (t) => {
      const c = (t * 0.16) % 1;
      paper.position.y = y - 38 * k + Math.min(1, Math.max(0, (c - 0.15) / 0.5)) * 13 * k;
    } });
  }

  /* ③ 资料架（矮书架 + 书脊；书页轻微呼吸）—— 对应 errand「去翻资料架」 */
  {
    const p = floorPoint(0.18, 0.13);
    const k = p.scale, x = p.x, y = p.y;
    g.ellipse(x, y + 3 * k, 32 * k, 9 * k).fill({ color: SKIN.shadow, alpha: 0.08 });
    g.roundRect(x - 26 * k, y - 56 * k, 52 * k, 56 * k, 4).fill(SKIN.woodFront);
    g.roundRect(x - 26 * k, y - 56 * k, 52 * k, 5 * k, 2).fill(SKIN.woodTop);
    g.rect(x - 22 * k, y - 32 * k, 44 * k, 3 * k).fill(SKIN.woodSide);
    const spine = [hex("#d98b6a"), hex("#6a9bd9"), hex("#8ec07c"), hex("#e0c063"), hex("#b48ad9")];
    for (let i = 0; i < 5; i++) {
      g.rect(x - 20 * k + i * 8 * k, y - 54 * k, 6 * k, 21 * k).fill(spine[i]);
    }
    for (let i = 0; i < 4; i++) {
      g.rect(x - 20 * k + i * 9 * k, y - 29 * k, 7 * k, 26 * k).fill(spine[(i + 2) % 5]);
    }
  }

  /* ④ 墙上挂钟（秒针真的在走） */
  {
    const c = wallPoint(0.508, 104);
    g.circle(c.x, c.y, 17).fill(hex("#ffffff"));
    g.circle(c.x, c.y, 17).stroke({ color: hex("#d7d4ce"), width: 2.5 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.circle(c.x + Math.sin(a) * 13, c.y - Math.cos(a) * 13, 1.1).fill(hex("#b9b6b0"));
    }
    const hour = new Graphics();
    hour.roundRect(-1.8, -9, 3.6, 11, 1.8).fill(hex("#41454b"));
    hour.pivot.set(0, 0);
    hour.position.set(c.x, c.y);
    const minute = new Graphics();
    minute.roundRect(-1.4, -14, 2.8, 16, 1.4).fill(hex("#5c6169"));
    minute.pivot.set(0, 0);
    minute.position.set(c.x, c.y);
    const dot = new Graphics();
    dot.circle(c.x, c.y, 2.2).fill(hex("#41454b"));
    hour.zIndex = -7e5 + 2; minute.zIndex = -7e5 + 2; dot.zIndex = -7e5 + 2;
    layer.addChild(hour, minute, dot);
    tickers.push({ update: (t) => {
      minute.rotation = (t * 0.06) % (Math.PI * 2);
      hour.rotation = (t * 0.005) % (Math.PI * 2);
    } });
  }

  layer.addChild(g);
  return tickers;
}
