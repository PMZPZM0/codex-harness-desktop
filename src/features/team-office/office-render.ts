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
import { Container, Graphics, Sprite } from "pixi.js";
import { FLOOR, WALL_H, floorCorners, floorPoint, sideWallPoint, wallPoint, type Pt } from "./office-iso";
import { artTexture, propArtOf, screenArtOf, type PropId } from "./office-art";
import type { ErrandSpot } from "./office-director";

const hex = (h: string) => parseInt(h.replace("#", ""), 16);

/**
 * 材质色板（09-30 v13「贴参考：全白 3D 渲染感」）。
 *
 * ⛔ v13 为什么回白：用户 09-30 贴了目标参考图（Marvis 办公室）问「这种能不能逆向出来」，
 *    并选定 **① 贴参考：全白 3D 渲染感**。v12 那套暖木写实（木地板/木桌板/深色显示器）
 *    与参考不是一种东西 —— 参考是**近白房间 + 白桌白椅 + 浅边框显示器**，
 *    立体感全靠**柔阴影 + 环境光遮蔽**，不靠材质色。
 * ⛔ 所以这里的规矩与 v10 的区别只有一条：**明暗层次要做足**（v10 做薄了 ⇒ 看着像线稿）。
 *    地板/墙/家具全白，但桌下 AO、落地柔阴影、墙脚压暗、椅背分层一个都不能少。
 * ⛔ 规矩不变：不用黑描边、零贴图（全 Graphics）、明度阶梯 顶面 > 前面 > 侧面。
 */
export const SKIN = {
  // 地板 / 墙 / 踢脚：近白，明暗交给柔阴影与环境光遮蔽
  floor: hex("#ffffff"),
  floorAlt: hex("#fcfcfb"),
  floorSeam: hex("#f1f1f0"),
  floorAO: hex("#5b6472"),
  floorSun: hex("#ffffff"),

  wallBack: hex("#f7f7f6"),
  wallLight: hex("#fefefd"),
  wainscot: hex("#f3f3f1"),
  wainscotLine: hex("#eaeae8"),
  rail: hex("#eaeae8"),
  baseboard: hex("#e5e5e2"),
  wallSide: hex("#f1f1ef"),
  wallSideDark: hex("#ebebe9"),
  wallTop: hex("#fcfcfb"),
  shadow: hex("#6b7280"),

  // 矮柜 / 橱柜 / 资料架：参考里也是白的（只有台面下沿一条灰）
  woodTop: hex("#fcfcfb"),
  woodFront: hex("#f1f1ef"),
  woodSide: hex("#e5e5e2"),
  woodLine: hex("#d9d9d6"),

  // 桌面：白台面 + 浅灰侧面（细白腿，照参考）
  // ⛔ 桌沿的 deskEdge 必须比地板深一档：白桌落在白地上，**只有这条边线**能说明"这里有块板"
  deskTop: hex("#ffffff"),
  deskFront: hex("#efefed"),
  deskSide: hex("#e4e4e1"),
  deskEdge: hex("#c9c9c6"),
  deskLeg: hex("#e4e4e1"),
  deskLegDark: hex("#d0d0cc"),
  cabinet: hex("#fcfcfb"),
  cabinetEdge: hex("#e7e7e4"),

  // 显示器：**浅色窄边框 + 深色屏**（参考就是这样）
  monitorShell: hex("#f1f2f4"),
  monitorShellTop: hex("#fbfcfd"),
  monitorEdge: hex("#d3d7db"),
  monitorStand: hex("#e3e6e9"),
  monitorBase: hex("#d7dbdf"),
  screenGlow: hex("#cfe2f5"),

  // 椅子：白框 + **明显压灰的网面** + 深色脚轮。
  // ⛔ 网面不能跟地面一样白：椅背是画面里最容易被"白吃白"吃掉的一块（v10 变线稿就是这么来的）
  chairBack: hex("#e2e8ee"),
  chairBackLit: hex("#f6f9fc"),
  chairBackDark: hex("#c9d2db"),
  chairSeat: hex("#eeeff0"),
  chairFrame: hex("#d8d8d6"),
  chairLeg: hex("#e8e8e6"),
  caster: hex("#3f4247"),

  whiteTop: hex("#ffffff"),
  fridge: hex("#f8f9fa"),
  fridgeDark: hex("#e3e7ea"),
  fridgeLine: hex("#b9c0c6"),

  // 绿植：画面里唯一的大块颜色
  plant: hex("#7cbd86"),
  plantDark: hex("#5da169"),
  plantLight: hex("#a6d4ab"),
  pot: hex("#f4f2ee"),
  potDark: hex("#e3e0da"),
  potRim: hex("#fbf9f6"),

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

  /* ── 后墙：近白（顶部更亮＝天光）＋ 极淡的竖向分板缝 ── */
  g.rect(bl[0], bl[1] - WALL_H, br[0] - bl[0], WALL_H).fill(SKIN.wallBack);
  g.rect(bl[0], bl[1] - WALL_H, br[0] - bl[0], WALL_H * 0.34).fill({ color: SKIN.wallLight, alpha: 0.8 });
  for (let x = bl[0] + 46; x < br[0] - 8; x += 46) {
    g.rect(x, bl[1] - WALL_H + 6, 1, WALL_H - 12).fill({ color: SKIN.wainscotLine, alpha: 0.5 });
  }

  /* ── 两侧墙：左亮右暗（光从右窗进来）＋ 墙顶剖切面 ── */
  g.poly([bl[0], bl[1] - WALL_H, bl[0], bl[1], fl[0], fl[1], fl[0], fl[1] - WALL_H]).fill(SKIN.wallSide);
  g.poly([br[0], br[1] - WALL_H, br[0], br[1], fr[0], fr[1], fr[0], fr[1] - WALL_H]).fill(SKIN.wallSideDark);
  g.poly([bl[0], bl[1] - WALL_H, br[0], br[1] - WALL_H, br[0] + 26, br[1] - WALL_H - 15, bl[0] - 26, bl[1] - WALL_H - 15]).fill(SKIN.wallTop);

  /* ── 地板：纯白（立体感全靠柔阴影 + AO，参考就是这么做的）── */
  g.poly([bl[0], bl[1], br[0], br[1], fr[0], fr[1], fl[0], fl[1]]).fill(SKIN.floor);
  // 大尺度斑驳：三层极淡椭圆，暗示"光在地面上流动"（⛔ 不是纹理，别加线）
  for (let i = 0; i < 3; i++) {
    const p = floorPoint(0.26 + i * 0.24, 0.28 + (i % 2) * 0.34);
    g.ellipse(p.x, p.y, 155 * p.scale, 46 * p.scale).fill({ color: hex("#e9edf3"), alpha: 0.18 });
  }
  // 右窗的光：地面已经是白的，所以用**窗框的影子**（斜长条 + 两道窗棂）表达
  for (const uu of [0.68, 0.84]) {
    const p0 = floorPoint(uu, 0.16);
    const p1 = floorPoint(uu - 0.07, 0.56);
    g.moveTo(p0.x, p0.y).lineTo(p1.x, p1.y).stroke({ color: SKIN.floorAO, width: 4, alpha: 0.06 });
  }
  // 墙脚环境光遮蔽：贴后墙一圈逐层压暗（三层，极淡 —— 白系房间全靠它把墙"立"起来）
  for (let i = 1; i <= 3; i++) {
    const t = i / 3;
    g.poly([bl[0], bl[1], br[0], br[1], br[0] + 26 * t, br[1] + 44 * t, bl[0] - 26 * t, bl[1] + 44 * t])
      .fill({ color: SKIN.floorAO, alpha: 0.06 });
  }
  // 两侧墙脚的暗带（把房间"压"进地面）
  g.poly([bl[0], bl[1], fl[0], fl[1], fl[0] + 32, fl[1], bl[0] + 24, bl[1]]).fill({ color: SKIN.floorAO, alpha: 0.07 });
  g.poly([br[0], br[1], fr[0], fr[1], fr[0] - 32, fr[1], br[0] - 24, br[1]]).fill({ color: SKIN.floorAO, alpha: 0.09 });

  /* ── 踢脚线（有厚度、有投影，墙才"立"在地板上）── */
  g.rect(bl[0], bl[1] - 7, br[0] - bl[0], 7).fill(SKIN.baseboard);
  g.rect(bl[0], bl[1] - 7.5, br[0] - bl[0], 1.6).fill({ color: 0xffffff, alpha: 0.5 });
  g.rect(bl[0], bl[1] - 1, br[0] - bl[0], 1.2).fill({ color: SKIN.floorAO, alpha: 0.08 });
  g.poly([bl[0], bl[1] - 7, fl[0], fl[1] - 7, fl[0], fl[1], bl[0], bl[1]]).fill({ color: SKIN.baseboard, alpha: 0.95 });
  g.poly([br[0], br[1] - 7, fr[0], fr[1] - 7, fr[0], fr[1], br[0], br[1]]).fill({ color: SKIN.baseboard, alpha: 0.85 });

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

/** 桌面纵深（归一化 v）：从座位点**向后**铺这么多。行距必须大于它 + 椅距。
 *  ⛔ 09-30 从 0.235 收到 0.17（用户：「办公桌你搞那么长该干嘛」）；
 *  ⛔ 09-30 二次收到 **0.135**（用户：「渲染整体可以小一点……有限的场景可以多放一些配套设施」
 *     —— 人物/桌凳整体缩小 ~20%，四周边缘腾出跑道/贩卖机/茶水台的位置）。
 *     ⛔ 行距关系（行距 > 桌纵深 + 椅距）由守卫【169】按真值算，改这个数它自己会重算。 */
export const DESK_DV = 0.135;
/** 显示器所在的纵深偏移（从**座位点**往前数）。⛔ 独立于 DESK_DV：桌深变短时显示器
 *  不能跟着往人脸上贴（MONITOR_LIFT 与耳朵高度是夹死的），所以它按自己的偏移定位。 */
export const MONITOR_DV = 0.121;
/** 桌半宽（归一化 u）。⛔ 必须小于列距的一半，否则相邻工位的桌子会压在一起。 */
export const DESK_HALF_U = 0.092;
/** 桌面离地高（屏幕像素，再乘纵深缩放）。 */
export const DESK_H = 26;
/**
 * 显示器抬离桌面的高度（屏幕像素）。
 * ⛔ 这个值是被角色**逼出来的**：角色头顶 + 耳朵顶到显示器下沿就会糊在一起。
 *    抬到 26 之后，最高的耳朵（猫）刚好从显示器下沿让开。人物缩小后同步收到 29。
 */
export const MONITOR_LIFT = 29;
/** 椅子相对座位点的纵深偏移（越大越靠观众）。 */
export const CHAIR_DV = 0.047;
/**
 * 椅背顶离地高（屏幕像素）。
 * ⛔ 决定角色露多少：太低 → 角色整条 torso 压在桌沿上（黑块糊住桌子）；
 *    太高 → 项圈被椅背吃掉（第一版 94 就是这样，角色只剩一个黑头）。
 */
export const CHAIR_BACK_TOP = 59;

/**
 * 把一张家具素材按**底边中心落在某个地面点 (u,v)** 画出来（素材路线专用）。
 * ⛔ 落位一律走 floorPoint 的坐标：素材透视再准，也不能靠"目测偏移"去贴 —— 一漂移就会和
 *    走动路径、遮挡顺序打架（那是这套场景的命根子）。
 * @returns 画上了返回 true；没素材 / 贴图没加载到返回 false（调用方回落程序化绘制）
 */
function propSprite(layer: Container, id: PropId, u: number, v: number, extraW = 1, dyPx = 0): Sprite | null {
  const art = propArtOf(id);
  const tex = art ? artTexture(art.url) : null;
  if (!art || !tex) return null;
  const p = floorPoint(u, v);
  const sp = new Sprite(tex);
  sp.anchor.set(0.5, 1);
  sp.width = art.w * extraW * p.scale;         // 越靠前越大：与家具/人物同一套纵深缩放
  sp.height = (tex.height / tex.width) * sp.width;
  sp.position.set(p.x, p.y + dyPx * p.scale);
  layer.addChild(sp);
  if (layer.sortableChildren) sp.zIndex = p.y;  // 与桌 / 人 / 椅同一条深度排序
  return sp;
}

/**
 * 屏幕内容变体（照参考：每个工位屏幕上是不同的东西，一眼能看出"在跑什么"）。
 * ⛔ 09-30 扩了 6 种（game / browser / video / files / apps / risk）—— 素材已出
 *    （assets/screens/gen2-*.webp），动画叠加见 drawScreen 的素材路线。 */
export type ScreenKind = "code" | "sheet" | "chart" | "design" | "mail" | "sleep" | "game" | "browser" | "video" | "files" | "apps" | "risk";

/** 屏幕底色（打盹与游戏/视频/风控是暗色调）。 */
function screenBg(kind: ScreenKind): number {
  if (kind === "sleep") return hex("#232a35");
  if (kind === "game" || kind === "video") return hex("#1a1f2a");
  if (kind === "risk") return hex("#20242e");
  return hex("#f8fafd");
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
  // ⛔ 屏幕占机身的 95%（细边框）：v10 那套"白外壳 + 5% 黑边"远看像相框（09-30 用户截图点名）
  const x = monX - mw * 0.475;
  const y = shellTop + mh * 0.045;
  const w = mw * 0.95;
  const h = mh * 0.91;
  const box = new Container();
  host.addChild(box);

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

  /* ── 素材路线（09-30）：屏幕内容 = 生图出的**真实界面截图**（代码/表格/行情/邮件/设计/锁屏
     及 09-30 新增的游戏/网页/短视频/文件/应用网格/风控盘）──
     ⛔ 与角色同一套规矩：贴图取不到就回落下面的程序化版本（绝不画白方块）。 */
  const shot = artTexture(screenArtOf(kind));
  if (shot) {
    const sp = new Sprite(shot);
    sp.position.set(x, y);
    sp.width = w;
    sp.height = h;
    box.addChild(sp);
    // 极淡的刷新扫描线：屏幕"活着"，而不是贴了张纸（只改 y，不重画）
    const scan = new Graphics();
    scan.rect(0, 0, w, h * 0.07).fill({ color: 0xffffff, alpha: 0.07 });
    box.addChild(scan);
    const gl = new Graphics();
    gl.poly([x + w * 0.06, y + h, x + w * 0.28, y, x + w * 0.44, y, x + w * 0.22, y + h])
      .fill({ color: 0xffffff, alpha: 0.1 });
    box.addChild(gl);
    jobs.push((t) => { scan.position.y = y - h * 0.07 + ((t * 0.32) % 1) * h * 1.14; });

    /* ── 09-30：每种新屏幕的**专属动画层**（⛔ 只动 transform / alpha，不重画）── */
    if (kind === "game") {
      // 游戏：全屏亮度呼吸（爆炸/技能闪光的感觉）+ 底部一条缓慢右移的血条
      const flash = new Graphics();
      flash.rect(x, y, w, h).fill({ color: 0xffffff, alpha: 0 });
      box.addChild(flash);
      const bar = new Graphics();
      bar.roundRect(x + w * 0.06, y + h * 0.9, w * 0.5, h * 0.045, 2).fill({ color: 0x7bd88a, alpha: 0.85 });
      box.addChild(bar);
      jobs.push((t) => {
        flash.alpha = 0.05 + 0.07 * Math.abs(Math.sin(t * 1.7));
        const c = (t * 0.05) % 1;
        bar.width = w * (0.25 + 0.25 * (0.5 + 0.5 * Math.sin(c * Math.PI * 2)));
      });
    } else if (kind === "browser") {
      // 网页：一条缓慢下滑的阅读滚动条
      const bar = new Graphics();
      bar.roundRect(x + w * 0.965, y + h * 0.12, w * 0.012, h * 0.2, 2).fill({ color: 0xb9c4d4, alpha: 0.8 });
      box.addChild(bar);
      jobs.push((t) => { bar.position.y = ((t * 0.03) % 1) * h * 0.62; });
    } else if (kind === "video") {
      // 短视频：底部进度条匀速推进 + 右下角红点闪（播放中）
      const prog = new Graphics();
      prog.rect(x, y + h - h * 0.035, w, h * 0.035).fill({ color: 0xffffff, alpha: 0.18 });
      const head = new Graphics();
      head.rect(x, y + h - h * 0.035, w * 0.3, h * 0.035).fill({ color: 0xff5a5f, alpha: 0.9 });
      const dot = new Graphics();
      dot.circle(x + w * 0.94, y + h * 0.1, Math.max(1.6, h * 0.02)).fill({ color: 0xff5a5f });
      box.addChild(prog, head, dot);
      jobs.push((t) => {
        const c = (t * 0.045) % 1;
        head.width = w * c;
        dot.alpha = Math.sin(t * 6) > 0 ? 0.95 : 0.25;
      });
    } else if (kind === "files") {
      // 文件管理器：选中框在列表里逐行跳
      const sel = new Graphics();
      sel.roundRect(x + w * 0.06, y, w * 0.52, h * 0.085, 2).fill({ color: 0x4a86cf, alpha: 0.16 });
      box.addChild(sel);
      jobs.push((t) => {
        const row = Math.floor((t * 0.5) % 6);
        sel.position.y = y + h * (0.16 + row * 0.115);
      });
    } else if (kind === "apps") {
      // 应用网格：图标逐个"点亮"（alpha 脉冲，相位错开）
      const cells: Graphics[] = [];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) {
        const ic = new Graphics();
        ic.roundRect(x + w * (0.1 + c * 0.17), y + h * (0.14 + r * 0.26), w * 0.1, h * 0.16, 3)
          .fill({ color: 0xdfe7f2, alpha: 0.85 });
        box.addChild(ic);
        cells.push(ic);
      }
      jobs.push((t) => {
        cells.forEach((ic, i) => { ic.alpha = 0.45 + 0.55 * Math.max(0, Math.sin(t * 1.4 + i * 0.9)); });
      });
    } else if (kind === "risk") {
      // 风控仪表盘：指针缓慢摆动 + 黄色警示灯脉冲
      const needle = new Graphics();
      needle.roundRect(-1.2, -h * 0.16, 2.4, h * 0.16, 1).fill({ color: 0xffc94d });
      needle.pivot.set(0, h * 0.16);
      needle.position.set(x + w * 0.5, y + h * 0.52);
      const lamp = new Graphics();
      lamp.circle(x + w * 0.14, y + h * 0.18, Math.max(2, h * 0.028)).fill({ color: 0xffc94d, alpha: 0.9 });
      box.addChild(needle, lamp);
      jobs.push((t) => {
        needle.rotation = -0.5 + Math.sin(t * 0.5) * 0.55;
        lamp.alpha = 0.35 + 0.65 * Math.abs(Math.sin(t * 1.1));
      });
    }
    return { update: (t) => { for (const j of jobs) j(t); } };
  }

  const bg = new Graphics();
  bg.rect(x, y, w, h).fill(screenBg(kind));
  box.addChild(bg);
  /** 小工具：把屏幕内容按 0~1 比例定位（内容和机身尺寸解耦，改显示器大小不用重算每一块）。 */
  const px = (v: number) => x + w * v;
  const py = (v: number) => y + h * v;
  /** 一根"文字条"：真实 UI 里的字在缩略图尺寸下就是一根条，长度/明度分级即可。 */
  const barW = (bw: number, bh: number, col: number, alpha = 1) => ({ bw, bh, col, alpha });

  if (kind === "code") {
    // ── 代码编辑器：顶栏（窗口点 + 标签页）→ 行号槽 → 语法着色的代码行 → 缩略图 → 状态栏
    const chrome = new Graphics();
    chrome.rect(x, y, w, h * 0.115).fill(hex("#eef2f7"));
    chrome.rect(x, py(0.115), w, 0.9).fill(hex("#dbe3ec"));
    const dots = [hex("#ef6b5e"), hex("#f3bf4f"), hex("#5fc46a")];
    dots.forEach((c, i) => chrome.circle(px(0.028) + i * w * 0.026, py(0.058), Math.max(1, h * 0.017)).fill(c));
    for (let i = 0; i < 3; i++) {
      const tw = w * 0.19;
      const tx = px(0.11) + i * tw;
      const active = i === 0;
      chrome.rect(tx, py(active ? 0 : 0.022), tw, h * 0.115 - (active ? 0 : h * 0.022)).fill(active ? hex("#f8fafd") : hex("#e5ebf2"));
      chrome.roundRect(tx + tw * 0.1, py(0.048), tw * 0.62, Math.max(1.3, h * 0.02), 0.6).fill(active ? hex("#4a86cf") : hex("#c3cdd8"));
    }
    box.addChild(chrome);
    // 行号槽
    const gut = new Graphics();
    gut.rect(x, py(0.115), w * 0.125, h * 0.815).fill(hex("#eef2f7"));
    for (let i = 0; i < 8; i++) {
      gut.roundRect(px(0.042), py(0.16) + i * h * 0.095, w * 0.045, Math.max(1, h * 0.021), 0.5).fill(hex("#b7c2cf"));
    }
    box.addChild(gut);
    // 代码行：每行 2~3 段语法色（关键字/标识符/字符串/注释），逐行"敲"出来
    const segPalette = [hex("#3f7fcf"), hex("#4f9e6b"), hex("#c9922f"), hex("#8a5fd0"), hex("#7b8794")];
    const codeTop = py(0.155);
    const lh = h * 0.093;
    for (let i = 0; i < 8; i++) {
      const indent = w * (0.155 + (i % 3) * 0.028);
      const segs: Array<[number, number]> = [
        [w * (0.085 + ((i * 5) % 4) * 0.022), i % 3 === 0 ? 3 : 0],
        [w * (0.07 + ((i * 3) % 5) * 0.02), i % 3 === 1 ? 1 : 4],
        [w * (0.045 + ((i * 7) % 3) * 0.026), i % 3 === 2 ? 2 : 1],
      ];
      const barH = Math.max(1.7, h * 0.036);
      part(
        (gg) => {
          let cx = indent;
          for (const [len, ci] of segs) {
            gg.roundRect(cx, 0, len, barH, 0.8).fill(segPalette[ci]);
            cx += len + w * 0.022;
          }
        },
        (gg, t) => {
          gg.position.set(0, codeTop + i * lh);
          gg.scale.x = clamp01((cyc(t, 3.4) * 1.5 - i * 0.16) / 0.16);
        },
      );
    }
    // 光标：跟着"当前行"末尾闪
    part(
      (gg) => { gg.rect(0, 0, Math.max(1.4, w * 0.02), Math.max(3, h * 0.05)).fill(hex("#2f6bdd")); },
      (gg, t) => {
        const prog = cyc(t, 3.4) * 1.5;
        const row = Math.min(7, Math.max(0, Math.floor(prog / 0.16)));
        const grown = clamp01((prog - row * 0.16) / 0.16);
        gg.position.set(px(0.155) + w * 0.36 * grown, codeTop + row * lh + h * 0.008);
        gg.alpha = Math.sin(t * 7) > -0.2 ? 0.9 : 0.12;
      },
    );
    // 缩略图（右侧一列细条）+ 视口框
    const mini = new Graphics();
    for (let i = 0; i < 14; i++) {
      mini.rect(px(0.885), py(0.15) + i * h * 0.048, w * (0.03 + ((i * 5) % 4) * 0.012), Math.max(1, h * 0.022))
        .fill(i % 3 === 0 ? hex("#b9cbe4") : hex("#d3dce8"));
    }
    mini.rect(px(0.878), py(0.15), w * 0.105, h * 0.33).fill({ color: hex("#4a86cf"), alpha: 0.1 });
    box.addChild(mini);
    // 状态栏
    const stat = new Graphics();
    stat.rect(x, py(0.93), w, h * 0.07).fill(hex("#e9eef5"));
    stat.rect(px(0.02), py(0.95), w * 0.16, Math.max(1.2, h * 0.02)).fill(hex("#3f7fcf"));
    stat.rect(px(0.22), py(0.95), w * 0.1, Math.max(1.2, h * 0.02)).fill(hex("#9fb0c2"));
    stat.rect(px(0.7), py(0.95), w * 0.08, Math.max(1.2, h * 0.02)).fill(hex("#9fb0c2"));
    box.addChild(stat);
  } else if (kind === "sheet") {
    // ── 表格：工具条 + 公式栏 + 列标/行号 + 网格 + 选中格（会往下走）
    const tools = new Graphics();
    tools.rect(x, y, w, h * 0.095).fill(hex("#eef2f7"));
    tools.roundRect(px(0.03), py(0.03), w * 0.3, h * 0.04, 1).fill(hex("#ffffff"));
    tools.roundRect(px(0.03), py(0.03), w * 0.3, h * 0.04, 1).stroke({ color: hex("#cbd6e2"), width: 0.8 });
    for (let i = 0; i < 4; i++) tools.roundRect(px(0.4 + i * 0.055), py(0.032), w * 0.04, h * 0.036, 1).fill(hex("#c8d4e0"));
    tools.rect(x, py(0.095), w, 0.8).fill(hex("#dbe3ec"));
    // 列标（A~F）+ 行号（1~6）
    tools.rect(x, py(0.115), w * 0.085, h * 0.8).fill(hex("#f1f5f9"));
    tools.rect(x, py(0.095), w * 0.085, h * 0.05).fill(hex("#e3eaf2"));
    box.addChild(tools);
    const grid = new Graphics();
    const gx = px(0.085);
    const gw = w * 0.9;
    const gh = h * 0.075;
    const gy = py(0.155);
    const cols = 6;
    const cw = gw / cols;
    for (let i = 0; i <= cols; i++) grid.moveTo(gx + i * cw, py(0.115)).lineTo(gx + i * cw, py(0.915)).stroke({ color: hex("#dde5ee"), width: 0.7 });
    for (let r = 0; r <= 6; r++) grid.moveTo(x, gy + r * gh).lineTo(gx + gw, gy + r * gh).stroke({ color: hex("#dde5ee"), width: 0.7 });
    // 表头文字条 + 行号条
    for (let i = 0; i < cols; i++) grid.roundRect(gx + i * cw + cw * 0.35, py(0.108), cw * 0.3, Math.max(1.2, h * 0.022), 0.6).fill(hex("#9aa8b8"));
    for (let r = 0; r < 6; r++) grid.roundRect(px(0.032), gy + r * gh + gh * 0.4, w * 0.028, Math.max(1.1, h * 0.02), 0.5).fill(hex("#a8b5c4"));
    // 单元格内容：数字右对齐、文字左对齐（一眼是表格）
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < cols; c++) {
        if ((r * 7 + c * 3) % 5 === 0) continue;
        const numeric = (r + c) % 2 === 0;
        const cwl = cw * (numeric ? 0.42 : 0.6);
        const cx0 = numeric ? gx + c * cw + cw * 0.85 - cwl : gx + c * cw + cw * 0.12;
        grid.roundRect(cx0, gy + r * gh + gh * 0.35, cwl, Math.max(1.1, h * 0.021), 0.5)
          .fill(numeric ? hex("#8b98a8") : hex("#5f6c7c"));
      }
    }
    box.addChild(grid);
    // 选中格：蓝框 + 填充柄（每 4.6s 往下走一格）
    part(
      (gg) => { gg.rect(0, 0, cw, gh).stroke({ color: hex("#2f6bdd"), width: 1.4 }); gg.rect(cw - 2.4, gh - 2.4, 2.4, 2.4).fill(hex("#2f6bdd")); },
      (gg, t) => {
        const row = Math.floor(cyc(t, 4.6) * 5);
        const col = Math.floor(cyc(t, 4.6) * 5 + 1) % cols;
        gg.position.set(gx + col * cw, gy + row * gh);
      },
    );
    // 编辑光标（在选中格里闪）
    part(
      (gg) => { gg.rect(0, 0, 1.3, gh * 0.55).fill(hex("#2f6bdd")); },
      (gg, t) => {
        const row = Math.floor(cyc(t, 4.6) * 5);
        const col = Math.floor(cyc(t, 4.6) * 5 + 1) % cols;
        gg.position.set(gx + col * cw + cw * 0.14, gy + row * gh + gh * 0.25);
        gg.alpha = Math.sin(t * 6.5) > 0 ? 0.9 : 0.1;
      },
    );
  } else if (kind === "chart") {
    // ── 数据图：标题 + 图例 + 网格 + 面积线 + 折线 + 会走的游标
    const plot = new Graphics();
    plot.roundRect(px(0.03), py(0.03), w * 0.42, h * 0.045, 1).fill(hex("#5f6c7c"));   // 标题
    plot.roundRect(px(0.03), py(0.1), w * 0.26, h * 0.03, 1).fill(hex("#b9c2cd"));     // 副标题
    plot.circle(px(0.72), py(0.05), Math.max(1.2, h * 0.022)).fill(hex("#3f7fcf"));
    plot.roundRect(px(0.76), py(0.042), w * 0.1, Math.max(1.1, h * 0.02), 0.5).fill(hex("#9aa8b8"));
    plot.circle(px(0.72), py(0.11), Math.max(1.2, h * 0.022)).fill(hex("#e8833c"));
    plot.roundRect(px(0.76), py(0.102), w * 0.12, Math.max(1.1, h * 0.02), 0.5).fill(hex("#9aa8b8"));
    const ax = px(0.11), ay = py(0.18), aw = w * 0.84, ah = h * 0.66;
    for (let i = 0; i <= 3; i++) plot.moveTo(ax, ay + (ah * i) / 3).lineTo(ax + aw, ay + (ah * i) / 3).stroke({ color: hex("#e4eaf1"), width: 0.7 });
    for (let i = 0; i <= 4; i++) plot.roundRect(px(0.03), ay + (ah * i) / 4 - h * 0.012, w * 0.05, Math.max(1, h * 0.018), 0.5).fill(hex("#b9c2cd"));
    plot.moveTo(ax, ay).lineTo(ax, ay + ah).lineTo(ax + aw, ay + ah).stroke({ color: hex("#c8d4e0"), width: 1 });
    box.addChild(plot);
    // 面积 + 折线（两条序列）
    const seriesA = [0.62, 0.44, 0.55, 0.28, 0.36, 0.16, 0.24, 0.08];
    const seriesB = [0.72, 0.66, 0.58, 0.6, 0.44, 0.5, 0.34, 0.4];
    const pts = (s: number[]) => s.map((v, i) => [ax + (aw * i) / (s.length - 1), ay + ah * v] as const);
    const area = new Graphics();
    const pa = pts(seriesA);
    area.poly([pa[0][0], ay + ah, ...pa.flatMap(([a, b]) => [a, b]), pa[pa.length - 1][0], ay + ah])
      .fill({ color: hex("#3f7fcf"), alpha: 0.16 });
    area.poly(pa.flatMap(([a, b]) => [a, b])).stroke({ color: hex("#3f7fcf"), width: 1.8 });
    area.poly(pts(seriesB).flatMap(([a, b]) => [a, b])).stroke({ color: hex("#e8833c"), width: 1.5 });
    box.addChild(area);
    // 游标：沿 x 轴走 + 呼吸（"实时行情在动"）
    part(
      (gg) => { gg.circle(0, 0, Math.max(1.8, h * 0.028)).fill(hex("#2f6bdd")); gg.circle(0, 0, Math.max(3, h * 0.05)).stroke({ color: hex("#2f6bdd"), width: 1 }); },
      (gg, t) => {
        const p = cyc(t, 5.2);
        const idx = Math.min(seriesA.length - 2, Math.floor(p * (seriesA.length - 1)));
        const f = p * (seriesA.length - 1) - idx;
        gg.position.set(ax + (aw * (idx + f)) / (seriesA.length - 1), ay + ah * (seriesA[idx] + (seriesA[idx + 1] - seriesA[idx]) * f));
      },
    );
  } else if (kind === "design") {
    // ── 设计画布：工具条 + 画布 + 图层栏 + 选中框（拖动手柄）
    const tools = new Graphics();
    tools.rect(x, y, w, h * 0.09).fill(hex("#eef2f7"));
    for (let i = 0; i < 5; i++) {
      const active = i === 1;
      tools.roundRect(px(0.03 + i * 0.06), py(0.026), w * 0.042, h * 0.038, 1).fill(active ? hex("#2f6bdd") : hex("#c8d4e0"));
    }
    tools.rect(px(0.86), y, w * 0.14, h).fill(hex("#f4f7fa"));       // 图层面板
    for (let i = 0; i < 4; i++) tools.roundRect(px(0.885), py(0.14 + i * 0.09), w * 0.09, h * 0.035, 1).fill(i === 0 ? hex("#bcd2ef") : hex("#d7dfe8"));
    box.addChild(tools);
    const shapes = new Graphics();
    shapes.roundRect(px(0.1), py(0.25), w * 0.4, h * 0.42, 2).fill(hex("#cfe0f2"));
    shapes.roundRect(px(0.1), py(0.25), w * 0.4, h * 0.42, 2).stroke({ color: hex("#9fb8d6"), width: 1 });
    shapes.circle(px(0.62), py(0.5), w * 0.11).fill(hex("#f0d3a8"));
    shapes.roundRect(px(0.3), py(0.72), w * 0.34, h * 0.05, 1.5).fill(hex("#b7d3bb"));
    box.addChild(shapes);
    // 选中框 + 四角手柄：跟着"实体块"缓慢平移（像在被拖动）
    part(
      (gg) => {
        gg.rect(0, 0, w * 0.4, h * 0.42).stroke({ color: hex("#2f6bdd"), width: 1.3 });
        for (const [hx, hy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          gg.rect(hx * w * 0.4 - 1.6, hy * h * 0.42 - 1.6, 3.2, 3.2).fill(hex("#ffffff")).stroke({ color: hex("#2f6bdd"), width: 1 });
        }
      },
      (gg, t) => {
        gg.position.set(px(0.1) + Math.sin(t * 0.5) * w * 0.015, py(0.25) + Math.cos(t * 0.4) * h * 0.01);
      },
    );
  } else if (kind === "mail") {
    // ── 邮件：左侧文件夹 + 收件列表（头像 + 发件人 + 主题 + 时间）+ 未读点
    const side = new Graphics();
    side.rect(x, y, w * 0.2, h).fill(hex("#eef2f7"));
    side.roundRect(px(0.03), py(0.04), w * 0.13, h * 0.04, 1).fill(hex("#3f7fcf"));
    for (let i = 0; i < 4; i++) side.roundRect(px(0.03), py(0.13 + i * 0.085), w * 0.12, h * 0.032, 1).fill(hex("#cdd8e3"));
    box.addChild(side);
    const list = new Graphics();
    for (let i = 0; i < 4; i++) {
      const ry = py(0.06) + i * h * 0.23;
      list.rect(px(0.22), ry, w * 0.76, h * 0.2).fill(i === 0 ? hex("#e8eff8") : i % 2 ? hex("#f7fafc") : hex("#f2f6fa"));
      list.roundRect(px(0.235), ry + h * 0.04, w * 0.05, h * 0.05, 1).fill(hex("#c8d4e0"));
      list.circle(px(0.26), ry + h * 0.065, Math.max(2, h * 0.055)).fill(hex("#9fb8d6"));
      list.roundRect(px(0.31), ry + h * 0.045, w * 0.2, Math.max(1.2, h * 0.024), 0.6).fill(hex("#5f6c7c"));
      list.roundRect(px(0.31), ry + h * 0.105, w * 0.44, Math.max(1.1, h * 0.02), 0.5).fill(hex("#a8b5c4"));
      list.roundRect(px(0.78), ry + h * 0.045, w * 0.13, Math.max(1, h * 0.018), 0.5).fill(hex("#c3cdd8"));
    }
    box.addChild(list);
    // 未读点：脉冲（"有新消息一直没点开"）
    part(
      (gg) => { gg.circle(0, 0, Math.max(1.6, h * 0.026)).fill(hex("#e0453c")); },
      (gg, t) => {
        gg.position.set(px(0.93), py(0.14));
        const s = 1 + 0.3 * (0.5 + 0.5 * Math.sin(t * 3.4));
        gg.scale.set(s);
        gg.alpha = 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(t * 3.4));
      },
    );
  } else {
    // ── 打盹：熄屏（暗屏 + 缓慢的屏保光带 + 两个 z）
    const halo = new Graphics();
    halo.rect(x, y, w, h).fill({ color: hex("#8fb6e8"), alpha: 0.05 });
    box.addChild(halo);
    part(
      (gg) => { gg.roundRect(0, 0, w * 0.5, h * 0.16, 2).fill({ color: hex("#9fc4ec"), alpha: 0.1 }); },
      (gg, t) => {
        const p = cyc(t, 6);
        gg.position.set(x + (p * 2 - 0.5) * w, y + h * 0.42);
      },
    );
    part((gg) => { gg.circle(0, 0, Math.max(3, h * 0.08)).stroke({ color: hex("#7f8ea3"), width: 1.3 }); },
      (gg, t) => {
        const c = cyc(t, 3.6);
        gg.position.set(px(0.34), py(0.44) - c * h * 0.16);
        gg.alpha = c < 0.15 ? c / 0.15 : Math.max(0, 1 - (c - 0.15) / 0.85) * 0.9;
      });
    part((gg) => { gg.circle(0, 0, Math.max(4, h * 0.11)).stroke({ color: hex("#68758a"), width: 1.3 }); },
      (gg, t) => {
        const c = cyc(t, 3.6, 0.45);
        gg.position.set(px(0.62), py(0.6) - c * h * 0.16);
        gg.alpha = c < 0.15 ? c / 0.15 : Math.max(0, 1 - (c - 0.15) / 0.85) * 0.8;
      });
    jobs.push((t) => { halo.alpha = 0.3 + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.8)); });
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
 * ⛔ 09-30 加 role 参数（成员的中文职业）：按职业关键词映射屏幕内容——资金分析师看行情、
 *    研究员看表格、工程师看代码……按序号错开避免全员同屏。调用点（OfficeCanvas.syncStatics）
 *    必须把 slot.profession 传进来，且 syncStatics 的 key 要含 profession（漏了会出现
 *    「换了人屏幕没换」）。
 */
export function screenKindOf(index: number, running: boolean, dozing: boolean, role = ""): ScreenKind {
  if (dozing) return "sleep";
  const r = String(role ?? "");
  if (/资金|流向|行情|交易|投资/.test(r)) return "chart";
  if (/基本面|研究|财务|审计|校对/.test(r)) return "sheet";
  if (/估值|定价|量化/.test(r)) return "chart";
  if (/风控|风险|合规/.test(r)) return "risk";
  if (/代码|工程|开发|架构|测试/.test(r)) return "code";
  if (/设计|视觉|交互|UI/i.test(r)) return "design";
  if (/文案|内容|编辑|运营/.test(r)) return "browser";
  if (/数据|统计|可视化/.test(r)) return "sheet";
  const pool: ScreenKind[] = ["code", "sheet", "chart", "browser", "mail", "video", "apps", "files"];
  if (running) return index % 3 === 1 ? "sheet" : "code";
  return pool[((index % pool.length) + pool.length) % pool.length];
}

/**
 * 背景模式下**只画屏幕**（09-30「场景/桌椅/设施一张图」模式）：房间、桌椅、显示器外壳
 * 都在场景背景图里（images/edits 按白模重绘，桌位 = 我们的 deskSlots 坐标），
 * 这里只把**会动的屏幕**（生图界面 + 逐帧动画）叠到背景的显示器位置。
 * ⛔ 屏幕几何必须与 drawDeskStation ⑤ 段**同口径**（同一段公式复制，改一处同步另一处）。
 */
export function drawScreenOnly(u: number, v: number, screen: ScreenKind, host: Container): PropTicker | null {
  const k = floorPoint(u, v).scale;
  const u0 = u - DESK_HALF_U;
  const u1 = u + DESK_HALF_U;
  const deskW = floorPoint(u1, v).x - floorPoint(u0, v).x;
  const mw = Math.min(deskW * 0.56, 86);
  const mh = mw * 0.605;
  const mon = floorPoint(u, v - MONITOR_DV);
  const baseY = mon.y - (DESK_H + MONITOR_LIFT) * k;
  const shellTop = baseY - mh;
  return drawScreen(host, screen, mon.x, shellTop, mw, mh);
}

/**
 * 画一个工位的**家具**：桌 + 显示器 + 桌下侧柜 + 柔阴影。锚点 (u, v) = **座位地面点**。
 * ⛔ 桌子往**远侧**（v 减小）铺 —— 角色坐近侧、背对观众，桌椅才不会压在人身上。
 * ⛔ 椅子**不在这里**：它要盖在角色之上（见 drawChair），画进同一个 Graphics 会把人挡住。
 */
export function drawDeskStation(g: Graphics, u: number, v: number, screen: ScreenKind, host?: Container, idx = 0): PropTicker | null {
  const seat = floorPoint(u, v);
  const k = seat.scale;
  const cx = seat.x;
  const u0 = u - DESK_HALF_U;
  const u1 = u + DESK_HALF_U;
  const vFar = v - DESK_DV;

  // ① 柔阴影：家具"落"在地上而不是浮着（按桌面**占地中心**落，桌子短了阴影也要跟着挪）
  //    ⛔ 白系房间的立体感**全靠它**：阴影一淡，白桌白椅立刻"飘"起来（v10 就是这么变成线稿的）。
  const dc = floorPoint(u, v - DESK_DV / 2);
  softShadow(g, dc.x - 6 * dc.scale, dc.y + 10 * dc.scale, 98 * dc.scale, 23 * dc.scale, 0.26);
  // 桌腿落地的接触阴影（点状，压在四个脚下）—— 白桌"站"在地板上全靠它
  floorCorners(u0 + 0.009, vFar + 0.007, u1 - 0.009, v - 0.007).forEach((p) => {
    softShadow(g, p.x, p.y, 9 * k, 3.2 * k, 0.3);
  });

  // 素材路线：桌子 + 侧柜用生图精灵（⛔ 必须挂在 Container 上 —— Graphics 里放不了 Sprite）
  const deskSprite = host ? propSprite(host, "desk", u, v) : false;
  if (deskSprite && host) propSprite(host, "pedestal", u + 0.055, v - 0.028);

  if (!deskSprite) {
  // ② 桌下侧柜 —— ⛔ 必须画在**桌面之前**：画在后面时它的顶面会盖住整块桌面
  //    （浅木桌面 + 白色柜顶 = 桌面中间一大块白板，09-30 放大截图实测）。
  isoBox(g, u + 0.026, vFar + 0.03, u1 - 0.006, v - 0.028, DESK_H * 0.8, {
    top: SKIN.whiteTop, front: SKIN.cabinet, side: SKIN.cabinetEdge,
  });
  const dr = floorPoint(u + 0.078, v - 0.030);
  const drW = 30 * k;
  // 三个抽屉面 + **内凹拉手**（照参考：无拉手设计，抽屉面上一条浅槽）
  for (let i = 0; i < 3; i++) {
    const dy = dr.y - (DESK_H * 0.8 - 6 - i * 10.5) * k;
    g.roundRect(dr.x - drW / 2, dy - 9.4 * k, drW, 9.4 * k, 1.2).fill(SKIN.cabinet);
    g.roundRect(dr.x - drW / 2, dy - 9.4 * k, drW, 9.4 * k, 1.2).stroke({ color: SKIN.cabinetEdge, width: 0.9 });
    g.roundRect(dr.x - drW * 0.22, dy - 5.4 * k, drW * 0.44, 1.5 * k, 0.7).fill({ color: SKIN.cabinetEdge, alpha: 0.95 });
  }

  // ③ 桌面：浅木台面（顶面受光 + 侧面压暗）+ 木纹 + 前缘亮线
  //    ⛔ **后两条腿必须先画**：画在桌面之后会从桌面里"穿出来"（09-30 放大实测）。
  const legs = floorCorners(u0 + 0.009, vFar + 0.007, u1 - 0.009, v - 0.007);
  const leg = (p: Pt) => {
    g.rect(p.x - 2.4 * k, p.y - (DESK_H - 8) * k, 4.8 * k, (DESK_H - 8) * k).fill(SKIN.deskLeg);
    g.rect(p.x - 2.4 * k, p.y - (DESK_H - 8) * k, 1.5 * k, (DESK_H - 8) * k).fill(SKIN.deskLegDark);
    g.ellipse(p.x, p.y, 3.2 * k, 1.3 * k).fill(SKIN.deskLegDark);
  };
  leg(legs[0]);
  leg(legs[1]);
  isoPrism(g, u0, vFar, u1, v, DESK_H - 8, DESK_H, { top: SKIN.deskTop, front: SKIN.deskFront, side: SKIN.deskSide });
  const topPt = (uu: number, vv: number) => { const p = floorPoint(uu, vv); return [p.x, p.y - DESK_H * k] as const; };
  // 台面靠后的一条极淡压暗：白桌落在白地上，全靠这种层次才"立"得起来（⛔ 不是木纹）
  const a0 = topPt(u0 + 0.012, vFar + 0.02);
  const b0 = topPt(u1 - 0.012, vFar + 0.02);
  g.moveTo(a0[0], a0[1]).lineTo(b0[0], b0[1]).stroke({ color: SKIN.shadow, width: 2.6, alpha: 0.07 });
  const [fa, fb] = [floorPoint(u0, v), floorPoint(u1, v)];
  g.rect(fa.x, fa.y - (DESK_H - 8) * k, fb.x - fa.x, 2.6 * k).fill({ color: SKIN.deskEdge, alpha: 0.8 });
  g.moveTo(fa.x, fa.y - DESK_H * k).lineTo(fb.x, fb.y - DESK_H * k).stroke({ color: SKIN.whiteTop, width: 1.5, alpha: 0.45 });

  // ④ 前面两条腿（画在桌面之后，才会压在桌面下沿）
  leg(legs[2]);
  leg(legs[3]);
  }   // ← 素材路线在此结束（桌子/侧柜由精灵承担，显示器与桌面小物继续程序化）

  // ⑤ 显示器：浅色窄边框 + 深色屏 + 支架 + 底座的椭圆盘
  const deskW = floorPoint(u1, v).x - floorPoint(u0, v).x;
  // ⛔ 宽度**封顶**：前排桌宽是后排的 1.25 倍，不封顶前排显示器会长到上一排人的胸口。
  const mw = Math.min(deskW * 0.56, 86);
  const mh = mw * 0.605;                 // 屏幕本体（16:9.7）
  const mon = floorPoint(u, v - MONITOR_DV);
  const baseY = mon.y - (DESK_H + MONITOR_LIFT) * k;
  const shellTop = baseY - mh;
  const lit = screen !== "sleep";
  // 屏幕亮时往桌面洒一片冷光（比 v10 那个"显示器后面一块灰玻璃"真实得多）
  if (lit) g.ellipse(mon.x, baseY + 3 * k, mw * 0.5, 7 * k).fill({ color: SKIN.screenGlow, alpha: 0.16 });
  g.ellipse(mon.x, baseY + 1.4 * k, mw * 0.21, 4.2 * k).fill(SKIN.monitorBase);
  g.roundRect(mon.x - mw * 0.045, baseY - MONITOR_LIFT * k * 0.78, mw * 0.09, MONITOR_LIFT * k * 0.8, 3).fill(SKIN.monitorStand);
  g.roundRect(mon.x - mw / 2, shellTop, mw, mh, mw * 0.025).fill(SKIN.monitorShell);
  g.roundRect(mon.x - mw / 2, shellTop, mw, mh * 0.42, mw * 0.025).fill(SKIN.monitorShellTop);
  // 屏幕（含逐帧动画）挂在 host 上 —— ⛔ 必须在机身之后，否则被外壳盖住
  const screenAnim = host ? drawScreen(host, screen, mon.x, shellTop, mw, mh) : null;
  g.roundRect(mon.x - mw / 2, shellTop, mw, mh, mw * 0.025).stroke({ color: SKIN.monitorEdge, width: 1.2 });
  g.circle(mon.x + mw * 0.42, baseY - 2 * k, 1.4).fill(lit ? hex("#8fd6a4") : hex("#7d838b"));

  // ⑥ 键鼠（贴桌沿）。⛔ 键盘**不居中**：人坐正中、躯干会把居中的键盘整个挡住；
  //    挪到人的左手侧前角（09-30 再往左前挪一点：桌深收短后原位置太靠桌心，仍被身体压住）。
  const kb = floorPoint(u - 0.056, v - 0.052);
  const ky = kb.y - DESK_H * k;
  const kbW = deskW * 0.32;
  const kbH = deskW * 0.052;
  const kbX = kb.x - kbW / 2;
  const kbY = ky - kbH;
  g.ellipse(kb.x, ky + 1.2 * k, kbW * 0.56, 2.6 * k).fill({ color: SKIN.shadow, alpha: 0.09 });
  g.roundRect(kbX, kbY, kbW, kbH, 1.6).fill(hex("#e9e6e0"));
  g.roundRect(kbX + 1.1, kbY + 1.1, kbW - 2.2, kbH - 2.2, 1.2).fill(hex("#f4f2ed"));
  // 键位：4 行浅线 + 空格 + 回车（放大能看出是键盘）
  for (let i = 1; i <= 4; i++) {
    g.moveTo(kbX + kbW * 0.07, kbY + (kbH * i) / 5).lineTo(kbX + kbW * 0.93, kbY + (kbH * i) / 5)
      .stroke({ color: hex("#d3cec5"), width: 0.7 });
  }
  g.roundRect(kbX + kbW * 0.24, kbY + kbH * 0.76, kbW * 0.42, kbH * 0.15, 0.9).fill(hex("#dcd7ce"));
  g.roundRect(kbX + kbW * 0.78, kbY + kbH * 0.1, kbW * 0.13, kbH * 0.52, 0.9).fill(hex("#dcd7ce"));
  // 鼠标垫 + 鼠标
  const mpX = kbX + kbW + deskW * 0.05;
  g.roundRect(mpX - deskW * 0.05, ky - deskW * 0.062, deskW * 0.1, deskW * 0.072, 2).fill(hex("#dfe3e8"));
  g.ellipse(mpX, ky - deskW * 0.028, deskW * 0.022, deskW * 0.02).fill(hex("#f5f3ef"));
  g.ellipse(mpX, ky - deskW * 0.028, deskW * 0.022, deskW * 0.02).stroke({ color: hex("#cfcbc3"), width: 0.9 });
  g.moveTo(mpX, ky - deskW * 0.043).lineTo(mpX, ky - deskW * 0.021).stroke({ color: hex("#b9b3a9"), width: 0.9 });

  // ⑦ 笔筒（每个工位都有）+ 桌面小物按工位序号换（不是每个桌子都长一样）
  const penBase = floorPoint(u + DESK_HALF_U * 0.72, vFar + DESK_DV * 0.16);
  const penY = penBase.y - DESK_H * k;
  g.roundRect(penBase.x - 4 * k, penY - 9 * k, 8 * k, 9 * k, 2).fill(SKIN.paper);
  g.roundRect(penBase.x - 4 * k, penY - 9 * k, 8 * k, 9 * k, 2).stroke({ color: SKIN.cabinetEdge, width: 1 });
  g.moveTo(penBase.x - 2 * k, penY - 9 * k).lineTo(penBase.x - 3.4 * k, penY - 16 * k).stroke({ color: hex("#4f9e6b"), width: 1.5 });
  g.moveTo(penBase.x + 1 * k, penY - 9 * k).lineTo(penBase.x + 2.6 * k, penY - 15 * k).stroke({ color: hex("#3f7fcf"), width: 1.5 });

  const leftCorner = floorPoint(u - DESK_HALF_U * 0.66, v - DESK_DV * 0.32);
  const ly = leftCorner.y - DESK_H * k;
  if (idx % 2 === 0) {
    // 马克杯（杯口一圈亮边 + 杯柄 + 杯垫）
    g.ellipse(leftCorner.x, ly + 0.6 * k, 7 * k, 2.4 * k).fill({ color: SKIN.shadow, alpha: 0.1 });
    g.roundRect(leftCorner.x - 5 * k, ly - 10 * k, 10 * k, 10 * k, 2).fill(hex("#f6f4f0"));
    g.roundRect(leftCorner.x - 5 * k, ly - 10 * k, 10 * k, 2.4 * k, 1.2).fill(hex("#e6e2da"));
    g.moveTo(leftCorner.x + 5 * k, ly - 8 * k).quadraticCurveTo(leftCorner.x + 8.4 * k, ly - 5 * k, leftCorner.x + 5 * k, ly - 2 * k)
      .stroke({ color: hex("#e6e2da"), width: 1.6 });
  } else {
    // 笔记本 + 一支笔（纸页有横线）
    g.roundRect(leftCorner.x - 7 * k, ly - 9 * k, 14 * k, 9 * k, 1.2).fill(hex("#f7f5f0"));
    g.roundRect(leftCorner.x - 7 * k, ly - 9 * k, 14 * k, 9 * k, 1.2).stroke({ color: SKIN.cabinetEdge, width: 0.9 });
    for (let i = 1; i <= 3; i++) {
      g.moveTo(leftCorner.x - 5 * k, ly - 9 * k + i * 2.2 * k).lineTo(leftCorner.x + 5 * k, ly - 9 * k + i * 2.2 * k)
        .stroke({ color: hex("#d8d3ca"), width: 0.7 });
    }
    g.moveTo(leftCorner.x + 6 * k, ly - 6 * k).lineTo(leftCorner.x + 13 * k, ly - 8 * k).stroke({ color: hex("#3f7fcf"), width: 1.6 });
  }
  if (idx % 3 === 0) {
    // 小多肉（陶盆 + 三片叶）
    const px = floorPoint(u + DESK_HALF_U * 0.52, v - DESK_DV * 0.16);
    const py = px.y - DESK_H * k;
    g.ellipse(px.x, py + 0.5 * k, 5 * k, 2 * k).fill({ color: SKIN.shadow, alpha: 0.09 });
    g.poly([px.x - 4 * k, py - 6 * k, px.x + 4 * k, py - 6 * k, px.x + 3 * k, py, px.x - 3 * k, py]).fill(SKIN.pot);
    g.ellipse(px.x, py - 7 * k, 3.4 * k, 2.4 * k).fill(SKIN.plant);
    g.ellipse(px.x - 3 * k, py - 8 * k, 2.4 * k, 2 * k).fill(SKIN.plantDark);
    g.ellipse(px.x + 3 * k, py - 8.6 * k, 2.2 * k, 1.8 * k).fill(SKIN.plantLight);
  }

  // ⑧ 显示器线缆：支架底 → 桌沿后侧垂下
  g.moveTo(mon.x + mw * 0.08, baseY + 2 * k)
    .quadraticCurveTo(mon.x + mw * 0.13, baseY + MONITOR_LIFT * k * 0.55, mon.x + mw * 0.07, baseY + MONITOR_LIFT * k)
    .stroke({ color: hex("#5c6169"), width: 1.1, alpha: 0.85 });

  return screenAnim;
}

/**
 * 画椅子（浅灰布面人体工学椅，**背对观众**）。⛔ 必须单独一层、zIndex **大于人物** ——
 * 参考里椅背正好挡住角色下半身；画在人物之前会让人整个盖住椅子（v9 的老毛病）。
 * 09-30 v12 重画：去掉"悬浮头枕"（旧版那块孤零零的横板）、椅背收窄 + 网面竖线 + 腰托、
 * 五星脚改细金属 + 深色滚轮、座面前缘做圆角与厚度 —— 旧版远看像"灰桶 + 蜘蛛"。
 */
export function drawChair(g: Graphics, u: number, v: number, host?: Container): void {
  const c = floorPoint(u, v + CHAIR_DV);
  const k = c.scale;
  const x = c.x;
  const y = c.y;
  const deskW = floorPoint(u + DESK_HALF_U, v).x - floorPoint(u - DESK_HALF_U, v).x;
  // ⛔ 别加宽：椅背和角色肩宽一样时，放大看像"人卡在一张大椅子里"（v10 实测）⇒ 收到 0.36
  const w = deskW * 0.36;

  // 椅子的落地阴影：白/浅灰椅子落在浅地板上，没有它就等于"人悬在桌沿上"
  softShadow(g, x, y + 2 * k, w * 1.05, 10 * k, 0.22);

  // 素材路线：整把椅子用生图精灵（同样只挂在 Container 上）
  if (host && propSprite(host, "chair", u, v + CHAIR_DV)) return;
  // 五星脚 + 滚轮（滚轮加深色轮毂：全同色的小圆看着像"五个脚印"）
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
    const px = x + Math.cos(a) * w * 0.5;
    const py = y + Math.sin(a) * w * 0.5 * 0.32 + 1 * k;
    g.moveTo(x, y - 3 * k).lineTo(px, py).stroke({ color: SKIN.chairFrame, width: 2.8 * k });
    g.circle(px, py, 2.5 * k).fill(SKIN.caster);
  }
  // 气压杆 + 座面（前缘圆角 + 侧厚 + 座面缝线）
  g.roundRect(x - 2.1 * k, y - 41 * k, 4.2 * k, 39 * k, 2).fill(SKIN.chairLeg);
  g.roundRect(x - w / 2, y - 51 * k, w, 10.5 * k, 4.5).fill(SKIN.chairSeat);
  g.roundRect(x - w / 2, y - 43 * k, w, 2.8 * k, 1.4).fill(SKIN.chairBackDark);
  g.moveTo(x - w * 0.4, y - 46 * k).lineTo(x + w * 0.4, y - 46 * k).stroke({ color: SKIN.chairBackDark, width: 0.9 });
  // 扶手：立柱 + 端板（先画，靠背压在上面）
  [-1, 1].forEach((s) => {
    const ax = x + s * w * 0.5;
    g.roundRect(ax - 1.7 * k, y - 44 * k, 3.4 * k, 12 * k, 1.4).fill(SKIN.chairFrame);
    g.roundRect(ax - 5 * k, y - 47 * k, 10 * k, 3.4 * k, 1.7).fill(SKIN.chairBackDark);
  });
  // 靠背：**白色网面**（浅灰网 + 白框 + 三条竖线 + 腰托），照参考
  const backH = CHAIR_BACK_TOP - 45;
  g.roundRect(x - w * 0.5, y - CHAIR_BACK_TOP * k, w, backH * k, w * 0.22).fill(SKIN.chairBack);
  for (let i = -1; i <= 1; i++) {
    g.moveTo(x + i * w * 0.24, y - (CHAIR_BACK_TOP - 5) * k)
      .lineTo(x + i * w * 0.24, y - (CHAIR_BACK_TOP - backH + 7) * k)
      .stroke({ color: SKIN.chairBackDark, width: 0.9, alpha: 0.9 });
  }
  g.roundRect(x - w * 0.5, y - CHAIR_BACK_TOP * k, w, 4.5 * k, w * 0.2).fill(SKIN.chairBackLit);
  g.roundRect(x - w * 0.42, y - (CHAIR_BACK_TOP - 15) * k, w * 0.84, 4.4 * k, 2.2).fill(SKIN.chairFrame);
  // 外框走**白**（参考的椅背是一圈白塑料框包住灰网）
  g.roundRect(x - w * 0.5, y - CHAIR_BACK_TOP * k, w, backH * k, w * 0.22).stroke({ color: SKIN.whiteTop, width: 1.6 });
}

/* ── 办公设施（饮水机 / 打印机 / 资料架 / 挂钟 / 洗手间 / 咖啡蒸汽）────────
   ⛔ 位置必须与 office-director 的跑腿目标**同源**（OfficeCanvas 的 ERRAND_SPOT_UV）：
      「去接水」的人要真的站在饮水机旁、「去打印」站在打印机旁。
      设施只是画在那个目标点上 —— ⛔ 不要在渲染层另定一套坐标（两边一漂移就穿帮）。 */

/** 逐帧动画部件：t 是场景时钟（秒·缩放后）。 */
export type PropTicker = { update: (t: number) => void };

/* ── 独立设施布局（09-30「物体都独立化、都可以互动」的单一真相源）──────────
   ⛔ spot 与 OfficeCanvas.ERRAND_SPOT_UV **逐字同源**（守卫【176】按 uv 对账）；
   ⛔ 程序化版与场景背景叠加版（drawAmenityProps）都读这份表 —— 别再各写一份坐标。
   anim：sway 植物摇摆 / bubble 饮水机气泡 / belt 跑步机跑带 / blink 贩卖机·打印机
   指示灯 / steam 茶水台热气 —— 全部 transform-only（DESIGN.md：只动变换不重画）。 */
export type AmenItem = { id: PropId; u: number; v: number; spot?: ErrandSpot; anim?: "sway" | "bubble" | "belt" | "blink" | "steam" };
export const AMEN_LAYOUT: AmenItem[] = [
  { id: "water", u: 0.955, v: 0.62, spot: "water", anim: "bubble" },
  { id: "printer", u: 0.90, v: 0.13, spot: "printer", anim: "blink" },
  { id: "shelf", u: 0.055, v: 0.21, spot: "shelf" },
  { id: "door", u: 0.055, v: 0.90 },
  { id: "plantbig", u: 0.955, v: 0.34, anim: "sway" },
  { id: "plantbig", u: 0.035, v: 0.55, anim: "sway" },
  /* 跑步机（右下空地）/ 贩卖机（上墙右）/ 茶水杯台（上墙中）—— 与跑腿点同源 */
  { id: "treadmill", u: 0.94, v: 0.84, spot: "treadmill", anim: "belt" },
  { id: "vending", u: 0.76, v: 0.115, spot: "vending", anim: "blink" },
  { id: "cup", u: 0.655, v: 0.115, spot: "tea", anim: "steam" },
  /* 纯装饰件（不参与跑腿）。⛔ whiteboard 不叠 —— 背景图已烙了软木板，精灵盖上去是重影。 */
  { id: "shelf2", u: 0.22, v: 0.09 },
];

/** 设施的逐帧微动画（item.anim 驱动；busy = 有人正在使用 ⇒ 动画明显加速，物体↔人物互动）。 */
function amenTickers(layer: Container, sp: Sprite, item: AmenItem, busy: () => boolean): PropTicker[] {
  const tickers: PropTicker[] = [];
  const phase = item.u * 7.3;
  if (item.anim === "sway") {
    tickers.push({ update: (t) => { sp.rotation = Math.sin(t * (busy() ? 1.6 : 0.8) + phase) * 0.035; } });
  } else if (item.anim === "bubble") {
    for (let i = 0; i < 3; i++) {
      const b = new Graphics();
      b.circle(0, 0, Math.max(1.6, sp.height * 0.028)).fill({ color: 0xffffff, alpha: 0.85 });
      b.zIndex = sp.zIndex + 0.1;
      layer.addChild(b);
      const ph = i / 3;
      tickers.push({ update: (t) => {
        const c = (t * (busy() ? 0.5 : 0.2) + ph) % 1;
        b.position.set(sp.x + (i - 1) * sp.width * 0.12, sp.y - sp.height * (0.86 - c * 0.42));
        b.alpha = (c < 0.16 ? c / 0.16 : Math.max(0, 1 - (c - 0.16) / 0.84)) * 0.9;
      } });
    }
  } else if (item.anim === "belt") {
    const bw = sp.width * 0.5;
    const bh = Math.max(3, sp.height * 0.1);
    const belt = new Graphics();
    belt.roundRect(-bw / 2, -bh, bw, bh, bh / 2).fill({ color: 0x2c3138, alpha: 0.85 });
    belt.zIndex = sp.zIndex + 0.1;
    belt.position.set(sp.x, sp.y - sp.height * 0.06);
    layer.addChild(belt);
    const marks: Graphics[] = [];
    for (let i = 0; i < 3; i++) {
      const m = new Graphics();
      m.rect(-bw * 0.08, 0, bw * 0.1, bh * 0.7).fill({ color: 0x9aa3ad, alpha: 0.8 });
      m.zIndex = belt.zIndex + 0.02;
      layer.addChild(m);
      marks.push(m);
    }
    tickers.push({ update: (t) => {
      const speed = busy() ? 0.55 : 0.12;
      marks.forEach((m, i) => { m.position.x = belt.position.x - bw / 2 + (((t * speed + i / 3) % 1)) * bw; });
    } });
  } else if (item.anim === "blink") {
    const led = new Graphics();
    led.circle(0, 0, Math.max(1.5, sp.height * 0.03)).fill({ color: 0x7de08a });
    led.zIndex = sp.zIndex + 0.1;
    layer.addChild(led);
    tickers.push({ update: (t) => {
      const pulse = 0.35 + 0.65 * Math.abs(Math.sin(t * (busy() ? 3.2 : 1.1) + phase));
      led.alpha = pulse;
      led.position.set(sp.x + sp.width * 0.28, sp.y - sp.height * 0.72);
    } });
  } else if (item.anim === "steam") {
    for (let i = 0; i < 3; i++) {
      const s = new Graphics();
      s.circle(0, 0, Math.max(2, sp.height * 0.05)).fill({ color: 0xffffff, alpha: 0.8 });
      s.zIndex = sp.zIndex + 0.1;
      layer.addChild(s);
      const ph = i / 3;
      tickers.push({ update: (t) => {
        const c = (t * (busy() ? 0.5 : 0.28) + ph) % 1;
        s.position.set(sp.x + (i - 1) * sp.width * 0.14 + Math.sin(c * 6) * 2, sp.y - sp.height * (0.92 + c * 0.25));
        s.alpha = (c < 0.2 ? c / 0.2 : Math.max(0, 1 - (c - 0.2) / 0.8)) * (busy() ? 0.85 : 0.55);
        s.scale.set(0.6 + c * 0.9);
      } });
    }
  }
  return tickers;
}

/**
 * 场景背景模式的设施叠加层（09-30「物体都独立化」）：背景图只烙房间壳+桌子，
 * 全部设施走这份独立精灵 —— 可动画、可点击（点设施派人过去）、hover 微放大。
 * busySpots：正在被使用的跑腿点（物体↔人物互动：饮水机有人接水时气泡变活跃）。
 */
export function drawAmenityProps(layer: Container, opts: { onPick?: (spot: ErrandSpot) => void; busySpots?: () => Set<ErrandSpot> } = {}): PropTicker[] {
  const tickers: PropTicker[] = [];
  for (const item of AMEN_LAYOUT) {
    const p = floorPoint(item.u, item.v);
    const sh = new Graphics();
    softShadow(sh, p.x, p.y + 3 * p.scale, 30 * p.scale, 9 * p.scale, 0.16);
    sh.zIndex = p.y - 0.5;
    layer.addChild(sh);
    const sp = propSprite(layer, item.id, item.u, item.v);
    if (!sp) continue;
    if (item.spot && opts.onPick) {
      sp.eventMode = "static";
      sp.cursor = "pointer";
      const base = sp.scale.x;
      sp.on("pointerover", () => sp.scale.set(base * 1.07));
      sp.on("pointerout", () => sp.scale.set(base));
      sp.on("pointertap", () => opts.onPick?.(item.spot as ErrandSpot));
    }
    tickers.push(...amenTickers(layer, sp, item, () => (opts.busySpots?.().has(item.spot as ErrandSpot) ?? false)));
  }
  return tickers;
}

/** opts.facilities = false：跳过全部设施（精灵版 + 程序化版），只画挂钟 / 蒸汽等动画件 ——
 *  场景背景正式模式与底稿模式都用它：设施由 drawAmenityProps 的独立精灵负责，别双画。 */
export function drawAmenities(layer: Container, opts: { facilities?: boolean } = {}): PropTicker[] {
  const tickers: PropTicker[] = [];
  const g = new Graphics();
  g.zIndex = -7e5;
  const drawFacilities = opts.facilities !== false;

  /* ── 素材路线（09-30）：设施用生图精灵，坐标与下面程序化版**逐个同源** ──
     ⛔ 三处跑腿目标（water / printer / shelf）与 restroom 的 u,v 必须与 OfficeCanvas 的
        ERRAND_SPOT_UV 逐字一致，否则「去接水」的人会走到空气里（守卫【176】锚这条）。
     ⛔ 只跳过"设施"那几块，**挂钟与咖啡蒸汽继续程序化**（它们是有动画的部件，不该被素材吃掉）。 */
  const useSprites = drawFacilities && propArtOf("water") !== null;
  if (useSprites) {
    for (const item of AMEN_LAYOUT) {
      const p = floorPoint(item.u, item.v);
      const sh = new Graphics();
      softShadow(sh, p.x, p.y + 3 * p.scale, 30 * p.scale, 9 * p.scale, 0.16);
      sh.zIndex = p.y - 0.5;
      layer.addChild(sh);
      /* 独立设施动画（09-30「物体都独立化、单独打磨细节」）：植物摇摆 / 贩卖机灯闪 */
      const sp = propSprite(layer, item.id, item.u, item.v);
      if (sp) tickers.push(...amenTickers(layer, sp, item, () => false));
    }
  }

  /* ① 饮水机（水桶里的气泡持续上升）—— 对应 errand「去接水」 */
  if (!useSprites && drawFacilities) {
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
  if (!useSprites && drawFacilities) {
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
  if (!useSprites && drawFacilities) {
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

  /* ④ 墙上挂钟（⛔ 09-30 改**真实时间**：时分秒针都按系统时钟走，秒针细红针最上层）*/
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
    /* 09-30 新增秒针（细红针）：挂钟从此显示**真实时间**——原实现只有两根针按固定速率转，
       看着"在走"但不是真时间（交接 §3⑤）。 */
    const second = new Graphics();
    second.roundRect(-0.6, -13.5, 1.2, 15, 0.6).fill(hex("#d9534f"));
    second.position.set(c.x, c.y);
    const dot = new Graphics();
    dot.circle(c.x, c.y, 2).fill(hex("#4b5057"));
    hour.zIndex = -7e5 + 2; minute.zIndex = -7e5 + 2; dot.zIndex = -7e5 + 2; second.zIndex = -7e5 + 3;
    layer.addChild(hour, minute, second, dot);
    tickers.push({ update: () => {
      const now = new Date();
      const sec = now.getSeconds() + now.getMilliseconds() / 1000;
      const min = now.getMinutes() + sec / 60;
      const hr = (now.getHours() % 12) + min / 60;
      second.rotation = (sec / 60) * Math.PI * 2;
      minute.rotation = (min / 60) * Math.PI * 2;
      hour.rotation = (hr / 12) * Math.PI * 2;
    } });
  }

  /* ⑤ 卫生间隔间（左下角）—— 对应 errand「去洗手间」 */
  if (!useSprites && drawFacilities) {
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

  /* ⑦ 跑步机（右下空地，09-30 新增跑腿点）—— ⛔ 坐标与 ERRAND_SPOT_UV.treadmill 同源 */
  if (!useSprites && drawFacilities) {
    const p = floorPoint(0.94, 0.84);
    const k = p.scale, x = p.x, y = p.y;
    g.ellipse(x, y + 3 * k, 34 * k, 9 * k).fill({ color: SKIN.shadow, alpha: 0.08 });
    g.roundRect(x - 20 * k, y - 14 * k, 40 * k, 12 * k, 3).fill(hex("#39404a"));           // 跑带
    g.roundRect(x - 17 * k, y - 10 * k, 34 * k, 4 * k, 2).fill(hex("#565e6a"));           // 跑带面
    g.roundRect(x + 12 * k, y - 52 * k, 7 * k, 40 * k, 3).fill(hex("#8a95a3"));           // 立柱
    g.roundRect(x - 2 * k, y - 60 * k, 30 * k, 9 * k, 4).fill(hex("#eef1f4"));            // 仪表台
    g.rect(x + 4 * k, y - 57 * k, 16 * k, 3 * k).fill(hex("#9fd7a8"));                    // 显示条
    g.roundRect(x - 14 * k, y - 54 * k, 6 * k, 16 * k, 3).fill(hex("#8a95a3"));           // 扶手
  }

  /* ⑧ 贩卖机（上墙右侧，09-30 新增跑腿点）—— 坐标与 ERRAND_SPOT_UV.vending 同源 */
  if (!useSprites && drawFacilities) {
    const p = floorPoint(0.76, 0.115);
    const k = p.scale, x = p.x, y = p.y;
    g.ellipse(x, y + 3 * k, 22 * k, 7 * k).fill({ color: SKIN.shadow, alpha: 0.07 });
    g.roundRect(x - 16 * k, y - 74 * k, 32 * k, 74 * k, 4).fill(hex("#d94f4f"));
    g.roundRect(x - 12 * k, y - 66 * k, 16 * k, 34 * k, 2).fill(hex("#2b3038"));
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
      g.roundRect(x - 10 * k + c * 8 * k, y - 62 * k + r * 11 * k, 6 * k, 8 * k, 1.5)
        .fill([hex("#f3bf4f"), hex("#7aa3dd"), hex("#95c785"), hex("#e09275"), hex("#bd97dd"), hex("#95c785")][r * 2 + c]);
    }
    g.roundRect(x + 6 * k, y - 60 * k, 8 * k, 26 * k, 2).fill(hex("#20242e"));            // 取货口
    g.roundRect(x - 12 * k, y - 26 * k, 24 * k, 6 * k, 2).fill(hex("#20242e"));           // 投币面板
  }

  /* ⑨ 茶水台（上墙中，09-30 新增跑腿点）—— 坐标与 ERRAND_SPOT_UV.tea 同源（矮柜 + 水壶 + 两只杯） */
  if (!useSprites && drawFacilities) {
    const p = floorPoint(0.655, 0.115);
    const k = p.scale, x = p.x, y = p.y;
    g.ellipse(x, y + 3 * k, 26 * k, 7 * k).fill({ color: SKIN.shadow, alpha: 0.07 });
    g.roundRect(x - 20 * k, y - 34 * k, 40 * k, 34 * k, 3).fill(SKIN.woodFront);
    g.roundRect(x - 20 * k, y - 34 * k, 40 * k, 4 * k, 2).fill(SKIN.woodTop);
    g.roundRect(x - 16 * k, y - 30 * k, 14 * k, 12 * k, 2).fill(SKIN.cabinet);            // 柜门
    g.roundRect(x + 2 * k, y - 30 * k, 14 * k, 12 * k, 2).fill(SKIN.cabinet);
    g.roundRect(x - 8 * k, y - 44 * k, 14 * k, 10 * k, 3).fill(hex("#e8eaee"));           // 电水壶
    g.roundRect(x - 5 * k, y - 40 * k, 8 * k, 2.4 * k, 1).fill(hex("#9fd7a8"));
    g.circle(x + 10 * k, y - 38 * k, 3.2 * k).fill(hex("#ffffff"));                       // 杯
    g.circle(x + 16 * k, y - 38 * k, 3.2 * k).fill(hex("#dfe7f2"));
  }

  layer.addChild(g);
  return tickers;
}
