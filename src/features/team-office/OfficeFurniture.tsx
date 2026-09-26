/**
 * 斜俯视房间与家具（team-office 域 09-26 v7「换成美术素材」）。
 *
 * 演进：v3~v5 正视平铺 → v6 用 SVG 复刻 ai-office-react 的斜俯视构图 → v7 换素材。
 *
 * ⛔ v7 为什么换：用户看完参考实现（workbzw/ai-office-react = PixiJS + Spine + 预渲染大图）
 *    后指出「人物还是好丑 / 场景也很丑」—— 它的观感**来自美术素材，不是来自技术**。
 *    调研结论：
 *      · LimeZu「Modern Interiors」❌ 免费版**仅限私人用途**（作者亲口回复），有商用风险 ⇒ 排除；
 *      · **Kenney「Furniture Kit」✅ CC0 1.0**（可商用、免署名；来源 kenney.nl）——
 *        含 120 种家具、每件 4 个朝向的**等距渲染件**，低多边形 3D 渲染 + 柔和光照，
 *        材质（木纹/布面）与明暗层次是真画出来的，手绘 SVG 复刻不出来。
 *      · 但它**没有等距人物** ⇒ 角色仍自绘（OfficeWorker.tsx），只换家具与环境。
 *
 * ⛔ SPRITE_SIZE 是**实测 PNG 头**读出来的（不是估的）：错一个数家具就整体错位。
 * ⛔ 图层顺序（复刻参考实现的构图，v7 修正）：**显示器（最远）→ 椅子 → 人 → 桌子（最近）**。
 *    早先是「家具先画、人后画」⇒ 人浮在桌子上方，看着像站在桌前而不是坐在桌后（这是 v6 “人像躲在桌子底/浮着”的真因）。
 */
import { ISO } from "./office-palette";
import { floorPoint, FLOOR, SCENE_W, WALL_H, wallPoint } from "./office-iso";

/* ══ Kenney 素材（CC0 1.0，kenney.nl「Furniture Kit」isometric renders）══════
   ⛔ 用**静态 import**而不是 import.meta.glob：glob 依赖对文件系统的路径扫描，
      本模块被 vite root 之外的入口加载时（离线预览、以及将来别的入口）**实测匹配到 0 个文件**
      —— 而失败是静默的：`IsoSprite` 直接 return null，整间办公室的家具"凭空消失"却零报错。
      静态 import 由 vite 的 asset 管线处理，任何加载位置都稳定，也便于 tsc 静态检查。 */
import bookcaseClosedUrl from "../../assets/office/bookcaseClosed_NE.png";
import bookcaseOpenUrl from "../../assets/office/bookcaseOpen_NE.png";
import booksUrl from "../../assets/office/books_NE.png";
import cabinetTelevisionUrl from "../../assets/office/cabinetTelevision_NE.png";
import cardboardBoxClosedUrl from "../../assets/office/cardboardBoxClosed_NE.png";
import ceilingFanUrl from "../../assets/office/ceilingFan_NE.png";
import chairDeskUrl from "../../assets/office/chairDesk_NE.png";
import computerKeyboardUrl from "../../assets/office/computerKeyboard_NE.png";
import computerMouseUrl from "../../assets/office/computerMouse_NE.png";
import computerScreenUrl from "../../assets/office/computerScreen_NE.png";
import deskUrl from "../../assets/office/desk_NE.png";
import doorwayUrl from "../../assets/office/doorway_NE.png";
import lampRoundFloorUrl from "../../assets/office/lampRoundFloor_NE.png";
import laptopUrl from "../../assets/office/laptop_NE.png";
import plantSmall1Url from "../../assets/office/plantSmall1_NE.png";
import plantSmall2Url from "../../assets/office/plantSmall2_NE.png";
import plantSmall3Url from "../../assets/office/plantSmall3_NE.png";
import pottedPlantUrl from "../../assets/office/pottedPlant_NE.png";
import rugRectangleUrl from "../../assets/office/rugRectangle_NE.png";
import sideTableDrawersUrl from "../../assets/office/sideTableDrawers_NE.png";
import sideTableUrl from "../../assets/office/sideTable_NE.png";
import trashcanUrl from "../../assets/office/trashcan_NE.png";
import wallWindowUrl from "../../assets/office/wallWindow_NE.png";

/** 素材名 → 打包后的 URL。 */
const SPRITE_URL: Record<string, string> = {
  bookcaseClosed: bookcaseClosedUrl,
  bookcaseOpen: bookcaseOpenUrl,
  books: booksUrl,
  cabinetTelevision: cabinetTelevisionUrl,
  cardboardBoxClosed: cardboardBoxClosedUrl,
  ceilingFan: ceilingFanUrl,
  chairDesk: chairDeskUrl,
  computerKeyboard: computerKeyboardUrl,
  computerMouse: computerMouseUrl,
  computerScreen: computerScreenUrl,
  desk: deskUrl,
  doorway: doorwayUrl,
  lampRoundFloor: lampRoundFloorUrl,
  laptop: laptopUrl,
  plantSmall1: plantSmall1Url,
  plantSmall2: plantSmall2Url,
  plantSmall3: plantSmall3Url,
  pottedPlant: pottedPlantUrl,
  rugRectangle: rugRectangleUrl,
  sideTableDrawers: sideTableDrawersUrl,
  sideTable: sideTableUrl,
  trashcan: trashcanUrl,
  wallWindow: wallWindowUrl,
};

/** sprite 原始像素尺寸（实测 PNG 头）。 */
const SPRITE_SIZE: Record<string, [number, number]> = {
  desk: [85, 88],
  chairDesk: [44, 56],
  computerScreen: [34, 40],
  computerKeyboard: [30, 23],
  computerMouse: [9, 6],
  laptop: [37, 24],
  bookcaseOpen: [49, 101],
  bookcaseClosed: [49, 99],
  cabinetTelevision: [79, 79],
  sideTable: [57, 68],
  sideTableDrawers: [57, 68],
  cardboardBoxClosed: [32, 40],
  trashcan: [25, 45],
  pottedPlant: [21, 61],
  plantSmall1: [10, 14],
  plantSmall2: [10, 14],
  plantSmall3: [10, 14],
  lampRoundFloor: [19, 76],
  ceilingFan: [55, 39],
  books: [18, 19],
  rugRectangle: [188, 134],
  wallWindow: [79, 153],
  doorway: [44, 107],
};

/**
 * 素材整体缩放（配合 deskSlots 收窄后的工位间距 ≈146px）。
 * ⛔ 别调大：等距 sprite 的垂直占用 = 深度投影(≈半宽) + 实际高度，
 *    1.5 时桌高 132px > 人坐高，人只露头顶；1.05 仍压住肩。0.95 才能露出头+肩。
 * ⛔ 也别再调小：desk 宽 85×0.95=81px，再小工位之间就空成"大房间摆小桌"。
 */
export const SPRITE_K = 1.05;

/* ── 与素材缩放**联动**的三个高度 ────────────────────────────────────────────
   ⛔ 别在 OfficeScene 里写这几个魔数：它们都是"人坐在桌前"的对齐量，
      桌子投影一变高，三个必须一起变（v7 实测：58 → 78 → 90 → 110，
      每一次都是因为桌子变高、把坐着的人整个盖住了）。 */
/** 坐姿人物相对地面的抬高量（≈ 椅子坐垫高度）。 */
export const SEAT_LIFT = 110;
/** 头顶标签相对地面的高度（= SEAT_LIFT + 头内偏移 27.5 + 标签框自身高度）。 */
export const TAG_LIFT = 172;
/** 交接卡片落点高度（对方头部附近）。 */
export const HANDOFF_LIFT = 160;

/** 桌面「后边缘」离屏高度（sprite 原始像素 = desk 的 88）。
 *  ⛔ 取值必须是 88（**sprite 的整个垂直投影**），不是"桌腿高度"：等距 sprite 的垂直范围
 *     = 后边线桌面 → 前边线地面，所以桌面靠后的上表面就在 88 处。
 *     取 46 时显示器整块坐在桌面之下（只露 14px）；取 78 时显示器升到人的肩膀旁
 *     （看着像"扛着屏幕"）。取 88 才是"显示器立在桌子后缘"。 */
const DESK_TOP = 88;

function spriteUrl(name: string): string {
  return SPRITE_URL[name] ?? "";
}

/**
 * 通用等距 sprite：**底边中心**对齐到 (x, y)。
 * ⛔ 锚点是底边中心，不是左上角 —— 等距素材的贴地参考点是物体在地面上的中心投影，
 *    用左上角对齐会让家具整体偏半个身位（多件叠加后误差累积成"乱"）。
 */
export function IsoSprite({ name, x, y, k = 1, opacity, className }: {
  name: string; x: number; y: number; k?: number; opacity?: number; className?: string;
}) {
  const size = SPRITE_SIZE[name];
  const url = spriteUrl(name);
  if (!size || !url) return null;
  const [w, h] = size;
  return (
    <image
      className={className}
      href={url}
      x={x - (w * k) / 2}
      y={y - h * k}
      width={w * k}
      height={h * k}
      opacity={opacity}
      preserveAspectRatio="none"
      style={{ imageRendering: "auto" }}
    />
  );
}

/* ── 房间：地板 / 后墙 / 两侧墙 / 踢脚 / 天花板边缘 ── */
export function IsoRoom() {
  const { bl, br, fr, fl } = FLOOR;
  const p = (x: number, y: number) => `${x},${y}`;
  return (
    <g className="ofc-room">
      {/* 后墙 */}
      <rect x={bl[0]} y={bl[1] - WALL_H} width={br[0] - bl[0]} height={WALL_H} fill={ISO.wall} />
      {/* 左右侧墙（向内收的四边形） */}
      <polygon points={`${p(bl[0], bl[1] - WALL_H)} ${p(bl[0], bl[1])} ${p(fl[0], fl[1])} ${p(fl[0], fl[1] - WALL_H)}`} fill={ISO.wallSide} />
      <polygon points={`${p(br[0], br[1] - WALL_H)} ${p(br[0], br[1])} ${p(fr[0], fr[1])} ${p(fr[0], fr[1] - WALL_H)}`} fill={ISO.wallSide} />
      {/* 墙顶平面（天花板边缘，给房间"封顶"） */}
      <polygon points={`${p(bl[0], bl[1] - WALL_H)} ${p(br[0], br[1] - WALL_H)} ${p(br[0] + 42, br[1] - WALL_H - 26)} ${p(bl[0] - 42, bl[1] - WALL_H - 26)}`} fill={ISO.wallTop} />
      <polygon points={`${p(bl[0] - 42, bl[1] - WALL_H - 26)} ${p(fl[0] - 42, fl[1] - WALL_H - 40)} ${p(fr[0] + 42, fr[1] - WALL_H - 40)} ${p(br[0] + 42, br[1] - WALL_H - 26)}`} fill={ISO.ceiling} opacity="0.85" />
      {/* 天花板灯轨（两条斜线，参考实现顶部那几道结构线） */}
      <g stroke={ISO.baseboard} strokeWidth="3" opacity="0.75">
        <line x1={bl[0] - 34} y1={bl[1] - WALL_H - 18} x2={fl[0] - 34} y2={fl[1] - WALL_H - 32} />
        <line x1={br[0] + 34} y1={br[1] - WALL_H - 18} x2={fr[0] + 34} y2={fr[1] - WALL_H - 32} />
      </g>
      {/* 地板 */}
      <polygon points={`${p(bl[0], bl[1])} ${p(br[0], br[1])} ${p(fr[0], fr[1])} ${p(fl[0], fl[1])}`} fill={ISO.floor} />
      {/* 地板拼缝：**两个方向都画**（等 u 线 + 等 v 线 = 地砖格）。
          ⛔ 只画一个方向时大片浅色地板会显得很空（实测"大房间摆小桌"）。 */}
      <g stroke={ISO.floorTile} strokeWidth="2.4">
        {[0.14, 0.28, 0.42, 0.58, 0.72, 0.86].map((u) => {
          const a = floorPoint(u, 0);
          const b = floorPoint(u, 1);
          return <line key={`u${u}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
        })}
        {[0.2, 0.4, 0.6, 0.8].map((v) => {
          const a = floorPoint(0, v);
          const b = floorPoint(1, v);
          return <line key={`v${v}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
        })}
      </g>
      {/* 踢脚线 */}
      <line x1={bl[0]} y1={bl[1]} x2={br[0]} y2={br[1]} stroke={ISO.baseboard} strokeWidth="5" />
      <line x1={bl[0]} y1={bl[1]} x2={fl[0]} y2={fl[1]} stroke={ISO.baseboard} strokeWidth="5" />
      <line x1={br[0]} y1={br[1]} x2={fr[0]} y2={fr[1]} stroke={ISO.baseboard} strokeWidth="5" />
      {/* 地板前沿（观众侧边缘，参考图里那条浅色地台边） */}
      <polygon points={`${p(fl[0], fl[1])} ${p(fr[0], fr[1])} ${p(fr[0] + 14, fr[1] + 16)} ${p(fl[0] - 14, fl[1] + 16)}`} fill={ISO.wallTop} stroke={ISO.baseboard} strokeWidth="3" />
    </g>
  );
}

/** 墙上窗户（Kenney wallWindow，等距渲染件）。 */
export function IsoWindow({ u, up, k = 1 }: { u: number; up: number; k?: number }) {
  const p = wallPoint(u, up);
  return <IsoSprite name="wallWindow" x={p.x} y={p.y + 153 * k} k={k} className="ofc-window" />;
}

/** 地板地毯（Kenney rugRectangle）。 */
export function IsoRug({ u, v, k = 1 }: { u: number; v: number; k?: number }) {
  const p = floorPoint(u, v);
  return <IsoSprite name="rugRectangle" x={p.x} y={p.y + 20 * p.scale} k={k * p.scale} opacity={0.95} className="ofc-rug" />;
}

/** 落地绿植（Kenney pottedPlant）。 */
export function IsoPlant({ u, v, size = 1 }: { u: number; v: number; size?: number }) {
  const p = floorPoint(u, v);
  return (
    <g className="ofc-plant">
      <IsoSprite name="pottedPlant" x={p.x} y={p.y} k={SPRITE_K * p.scale * size} />
    </g>
  );
}

/** 靠墙木柜（Kenney bookcaseClosed）。 */
export function IsoCabinet({ u, v }: { u: number; v: number }) {
  const p = floorPoint(u, v);
  return <IsoSprite name="bookcaseClosed" x={p.x} y={p.y} k={SPRITE_K * p.scale} className="ofc-furn" />;
}

/** 开放书架（Kenney bookcaseOpen）。 */
export function IsoShelfUnit({ u, v }: { u: number; v: number }) {
  const p = floorPoint(u, v);
  return <IsoSprite name="bookcaseOpen" x={p.x} y={p.y} k={SPRITE_K * p.scale} className="ofc-furn" />;
}

/** 矮柜 / 边桌（Kenney sideTableDrawers）。 */
export function IsoSideTable({ u, v }: { u: number; v: number }) {
  const p = floorPoint(u, v);
  return <IsoSprite name="sideTableDrawers" x={p.x} y={p.y} k={SPRITE_K * p.scale} className="ofc-furn" />;
}

/** 纸箱（Kenney cardboardBoxClosed）。 */
export function IsoCarton({ u, v, k = 1 }: { u: number; v: number; k?: number }) {
  const p = floorPoint(u, v);
  return <IsoSprite name="cardboardBoxClosed" x={p.x} y={p.y} k={SPRITE_K * p.scale * k} className="ofc-furn" />;
}

/** 垃圾桶（Kenney trashcan）。 */
export function IsoBin({ u, v }: { u: number; v: number }) {
  const p = floorPoint(u, v);
  return <IsoSprite name="trashcan" x={p.x} y={p.y} k={SPRITE_K * p.scale} className="ofc-furn" />;
}

/** 落地灯（Kenney lampRoundFloor）。 */
export function IsoFloorLamp({ u, v }: { u: number; v: number }) {
  const p = floorPoint(u, v);
  return <IsoSprite name="lampRoundFloor" x={p.x} y={p.y} k={SPRITE_K * p.scale} className="ofc-lamp" />;
}

/** 矮几（Kenney sideTable）。 */
export function IsoLowTable({ u, v }: { u: number; v: number }) {
  const p = floorPoint(u, v);
  return <IsoSprite name="sideTable" x={p.x} y={p.y} k={SPRITE_K * p.scale} className="ofc-furn" />;
}

/** 小盆栽（Kenney plantSmall*）。 */
export function IsoSmallPlant({ u, v, variant = 1 }: { u: number; v: number; variant?: 1 | 2 | 3 }) {
  const p = floorPoint(u, v);
  return <IsoSprite name={`plantSmall${variant}`} x={p.x} y={p.y} k={SPRITE_K * p.scale} className="ofc-furn" />;
}

/** 吊扇（Kenney ceilingFan，挂在画面顶部，不参与地面排序）。 */
export function IsoCeilingFan({ x, y, k = 1 }: { x: number; y: number; k?: number }) {
  return <IsoSprite name="ceilingFan" x={x} y={y} k={k} className="ofc-fan" />;
}

/* ── 工位（v7 拆成三联：显示器 / 椅子 / 桌子）────────────────────────────
   ⛔ 必须拆开渲染，因为**人要夹在中间**：
        显示器（最远）→ 椅子 → 人 → 桌子（最近，遮住人的下半身）
      合成一个函数就没法在中间插人 —— 这是 v6「人浮在桌子上方」的根因。
   ⛔ 三个部件各带一点 v 偏移：桌子在人的**近侧**（v+）、显示器在远侧（v−）。
      同 v 的话桌子的等距投影正好落在人身上、把人整个盖住（实测只露头顶）。 */

/** 工位·远景：桌面上的显示器 + 键盘。
    ⛔ 必须**偏到人的左侧**（x − 40·scale）：显示器放在工位正中会正好被坐着的人的脑袋挡住
       （人物半宽 ≈ 20px，显示器半宽 ≈ 22px ⇒ 偏 40 才完全不重叠）。
    ⛔ v 与桌子**同值**（不再 −/+ 偏移）：人就是坐在这一格的桌前，错开会让桌子掉到脚边或
       显示器升到肩膀（两种都实测过）。 */
export function IsoDeskBack({ u, v }: { u: number; v: number }) {
  const p = floorPoint(u, v);
  const k = SPRITE_K * p.scale;
  const top = DESK_TOP * k;
  return (
    <g className="ofc-desk-back">
      <IsoSprite name="computerScreen" x={p.x - 40 * p.scale} y={p.y - top} k={k * 1.15} />
      <IsoSprite name="computerKeyboard" x={p.x - 34 * p.scale} y={p.y - top + 11 * p.scale} k={k * 0.95} />
    </g>
  );
}

/** 工位·中景：椅子（画在人之下，人坐进去会盖住坐垫，只露出椅背与五爪）。 */
export function IsoDeskChair({ u, v }: { u: number; v: number }) {
  const p = floorPoint(u, v + 0.025);
  const k = SPRITE_K * p.scale;
  return (
    <g className="ofc-desk-chair">
      <IsoSprite name="chairDesk" x={p.x + 4 * p.scale} y={p.y + 4 * p.scale} k={k * 0.82} />
    </g>
  );
}

/** 工位·近景：桌子（画在人之上 ⇒ 遮住人的下半身 = "坐在桌后"）。 */
export function IsoDeskFront({ u, v }: { u: number; v: number }) {
  const p = floorPoint(u, v);
  const k = SPRITE_K * p.scale;
  return (
    <g className="ofc-desk-furn">
      {/* 桌前地面阴影 */}
      <ellipse cx={p.x} cy={p.y - 2} rx={64 * p.scale} ry={22 * p.scale} fill={ISO.shadow} opacity="0.1" />
      <IsoSprite name="desk" x={p.x} y={p.y} k={k} />
      {/* 桌上小物（靠右那侧，避开左边的显示器） */}
      <IsoSprite name="books" x={p.x + 38 * p.scale} y={p.y - DESK_TOP * k} k={k * 0.85} />
    </g>
  );
}

/** 房间尺寸导出（供 Scene 设 viewBox）。 */
export const ROOM_BOX = { w: SCENE_W, h: 640 };
