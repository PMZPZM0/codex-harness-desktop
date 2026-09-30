/**
 * 办公室场景几何与布局（team-office 域，09-30 v18「Kenney CC0 资产版」）。
 *
 * ⛔ 与 v9~v17 的根本差别：**不再程序化画家具、也不再用 AI 生图**，改用 Kenney
 *    Furniture Kit（CC0，等距 2:1，官方声明可商用）—— 用户 09-30 拍板
 *    「用免费的、直接用他们的现成的、不要重复造车轮」。
 *
 * 投影：**标准 2:1 等距**（Kenney 家具按 128×64 菱形格设计，两者同源，不再自己定梯形房间）：
 *      screenX = originX + (u - v) * TILE_W / 2
 *      screenY = originY + (u + v) * TILE_H / 2
 *   u 增大 → 右下；v 增大 → 左下。⛔ 等距资产**不做纵深缩放**（尺寸已按格子定死，
 *   再缩放会让桌腿与地板格子错位 —— v9~v17 的 depthScale 那套在这里必须关掉）。
 */

/** 一格菱形的像素尺寸（Kenney Furniture Kit 的设计基准）。 */
export const TILE_W = 128;
export const TILE_H = 64;

/** 房间格数（地板范围 0..ROOM_W × 0..ROOM_D）。 */
export const ROOM_W = 11;
export const ROOM_D = 8;

/** 画布尺寸（含墙高与四周留白）。 */
export const SCENE_W = 1280;
export const SCENE_H = 880;

/** 房间原点在画布中的位置（把房间中心放到画布中心）。 */
const CENTER_U = ROOM_W / 2;
const CENTER_D = ROOM_D / 2;
export const ORIGIN = {
  x: SCENE_W / 2 + (CENTER_D - CENTER_U) * (TILE_W / 2),
  y: (SCENE_H - (ROOM_W + ROOM_D) * (TILE_H / 2)) / 2 + 44,
};

export type Pt = { x: number; y: number };

/** 格坐标 → 屏幕坐标（菱形格中心）。 */
export function isoPoint(u: number, v: number): Pt {
  return {
    x: ORIGIN.x + (u - v) * (TILE_W / 2),
    y: ORIGIN.y + (u + v) * (TILE_H / 2),
  };
}

/** 地板四角（屏幕坐标）：上、右、下、左 —— 用于画地板多边形。 */
export function floorDiamond(): [Pt, Pt, Pt, Pt] {
  return [isoPoint(0, 0), isoPoint(ROOM_W, 0), isoPoint(ROOM_W, ROOM_D), isoPoint(0, ROOM_D)];
}

/**
 * 一件家具 / 一个角色的摆放。
 * ⛔ anchor 恒为「底边中心」：等距资产的底边中点 = 它落在地板上的那个点。
 *   dx/dy 是**逐件微调**（Kenney 各件的"落脚点"与菱形格中心有少量偏差，实测校准）。
 */
export type Placement = {
  key: string;
  u: number;
  v: number;
  dx?: number;
  dy?: number;
  /** 额外缩放（默认 1；等距资产一般不需要） */
  scale?: number;
};

/** 工位：一张桌子 + 一把椅子 + 电脑三件套（屏幕内容由渲染层叠动画）。 */
export function deskGroup(u: number, v: number, chairSide: "SW" | "SE" = "SW"): Placement[] {
  const ch = chairSide === "SW" ? { du: -0.45, dv: 0.9 } : { du: 0.9, dv: 0.45 };
  return [
    { key: `rugRectangle_${chairSide}`, u, v, dy: -2, scale: 0.5 },
    { key: `desk_${chairSide}`, u, v },
    { key: `chairDesk_${chairSide}`, u: u + ch.du, v: v + ch.dv, dy: -6 },
    { key: `computerScreen_${chairSide}`, u: u + 0.02, v: v - 0.34, dy: -74 },
    { key: `computerKeyboard_${chairSide}`, u: u - 0.16, v: v - 0.16, dy: -50 },
    { key: `computerMouse_${chairSide}`, u: u + 0.22, v: v - 0.12, dy: -50 },
  ];
}

/** 六个工位（2 行 × 3 列）+ CEO 位；⛔ u/v 是**格坐标**，行距必须 > 桌深（0.9 格）。 */
export const DESKS: Array<{ u: number; v: number; side: "SW" | "SE" }> = [
  { u: 2.2, v: 1.4, side: "SW" },
  { u: 4.4, v: 1.4, side: "SW" },
  { u: 6.6, v: 1.4, side: "SW" },
  { u: 2.2, v: 3.6, side: "SW" },
  { u: 4.4, v: 3.6, side: "SW" },
  { u: 6.6, v: 3.6, side: "SW" },
];

/** 场景静物（沿墙与空地摆放 —— ⛔ 不与背景烙的件重叠，也不扎堆一条线）。 */
export const PROPS: Placement[] = [
  /* 左墙：书柜两座 */
  { key: "bookcaseOpen_SW", u: 0.5, v: 0.6 },
  { key: "bookcaseClosed_SW", u: 0.5, v: 1.5 },
  /* 右墙：茶水间（咖啡机 + 冰箱 + 橱柜） */
  { key: "kitchenCabinet_SE", u: 9.6, v: 0.5 },
  { key: "kitchenCoffeeMachine_SE", u: 9.55, v: 0.45, dy: -46 },
  { key: "kitchenFridge_SE", u: 9.6, v: 1.4 },
  /* 右下：休息区（沙发 + 茶几 + 落地灯） */
  { key: "loungeSofa_SE", u: 8.4, v: 6.2, dy: -2 },
  { key: "tableCoffee_SE", u: 7.4, v: 5.6, dy: -2 },
  { key: "lampRoundFloor_SE", u: 9.3, v: 6.0 },
  /* 绿植（分散点缀，不扎堆） */
  { key: "pottedPlant_SW", u: 0.6, v: 3.2 },
  { key: "plantSmall1_SE", u: 10.2, v: 2.6 },
  { key: "plantSmall2_SE", u: 10.2, v: 4.4 },
  { key: "plantSmall3_SW", u: 1.0, v: 6.6 },
  /* 其他 */
  { key: "cabinetTelevision_SE", u: 7.4, v: 0.5 },
  { key: "sideTableDrawers_SW", u: 0.6, v: 5.0 },
  { key: "tableRound_SW", u: 4.0, v: 5.6, dy: -2 },
];

/** 屏幕内容变体（叠在 computerScreen 上；⛔ 只动 transform，不重画）。 */
export type ScreenKind = "code" | "chart" | "sheet" | "mail" | "off" | "game";
