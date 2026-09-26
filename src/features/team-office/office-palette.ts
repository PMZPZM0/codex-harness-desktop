/**
 * 办公室插画色板（team-office 域 09-26 v5「造型升级」）。
 *
 * ⛔ 统一描边（OFC.ink）是「卡通感」的地基：纯填充色块永远像占位图（v2 教训）。
 * ⛔ v4 被评「人物丑 / 场景也丑」，去 GitHub 调研现成库（DiceBear / open-peeps /
 *    avataaars / notionists）后的结论：
 *      现成库全是半身或头像、且 SVG 扁平化（无部件分组）⇒ 不能直接用于工位动画；
 *      但它们共有的**造型规律**可以用：粗描边 + 大头 + 极简五官 + **饱和纯色（不用渐变/灰调）**。
 *    v4 的错在于配色一路往「淡」调（墙 #eef3f9 几乎白、地板 #f5ebdd 灰米），整屏像褪色照片。
 *    v5 转向：**明确的主色 + 明确的对比**，让每个面一眼能分辨。
 * ⛔ 场景是**固定浅色插画**（不跟随深色主题）—— 插画自带光感与阴影，跟主题反色会发脏。
 */
export const OFC = {
  // 墨色（描边）：比 v4 深一档，粗描边才压得住画面
  ink: "#22303f",
  inkSoft: "#5b6a7d",

  // 墙：上浅下深（腰线分隔，给墙面做层次，不再是"一整片糊白"）
  wall: "#e9eff8",
  wallLower: "#d9e4f2",
  skirt: "#bfcede",

  // 地板：暖木色（v4 的灰米色是"脏"的主因之一）
  floorA: "#f3e4c8",
  floorB: "#e0c9a0",

  // 地毯：明确的暖黄（v4 的 #e8d6c0 和地板几乎同色，等于白铺）
  rug: "#f7d089",
  rugEdge: "#dfa945",

  // 木器
  wood: "#b8863f",
  woodLight: "#ecc79b",
  woodDark: "#9c6f33",

  // 金属 / 屏幕
  metal: "#c2ccd8",
  metalDark: "#8d9aab",
  screen: "#e4eef8",
  screenOn: "#b9e3cd",
  screenOnDeep: "#86cfa8",
  codeInk: "#2f7a53",
  codeIdle: "#93a5b8",

  // 纸与便签
  paper: "#ffffff",
  noteA: "#ffe08a",
  noteB: "#a8d8f0",
  noteC: "#f7b3c0",
  noteD: "#b8e6b0",

  // 植物 / 容器 / 水
  plant: "#5cb85c",
  plantDeep: "#3f9a4a",
  pot: "#d98a52",
  water: "#cbe6ff",
  waterDeep: "#8fc4ee",

  // 地面投影色（家具与人物脚下）
  shadow: "#5b6a7d",

  // 语义色
  ok: "#4aa96c",
  warn: "#e8875f",
  info: "#5b9bd5",
} as const;

/**
 * 斜俯视房间色板（09-26 v6「复刻 ai-office-react」）。
 * ⛔ 参考实现的观感 = **极简浅色现代办公室**（近白地板 + 灰白墙 + 纯白桌 + 深灰显示器背面
 *    + 木色柜 + 绿植点缀），与 v5 的「暖木地板 + 蓝灰墙」是两套语言 —— 换投影就得换色板，
 *    否则浅色等距房间配暖色家具会脏。
 */
export const ISO = {
  floor: "#f5f6f8",
  floorTile: "#eaecf0",
  wall: "#e9e7e2",
  wallSide: "#dbd8d2",
  wallTop: "#f2f0ec",
  baseboard: "#cbc8c1",
  ceiling: "#f8f7f5",
  deskTop: "#ffffff",
  deskEdge: "#e0ded8",
  deskLeg: "#c9c7c1",
  monitor: "#2f3033",
  monitorBack: "#26272a",
  monitorStand: "#a8a9ac",
  chair: "#d7d5cf",
  chairDark: "#bcbab4",
  wood: "#c9a473",
  woodDark: "#ab8552",
  pot: "#d8dade",
  plant: "#4f9f61",
  plantDark: "#3d8a4d",
  ink: "#2b2f36",
  shadow: "#8d8f95",
} as const;

/**
 * 主轮廓描边宽度。
 * ⛔ 「卡通感」的第一杠杆：2.x 的细描边在这个尺寸下看着像线稿没画完，3.2 才是粗描边扁平插画。
 * ⛔ 只给**主轮廓**用它；眉毛/嘴/腰带/屏幕内容这些细节仍用 INK_W_THIN，否则一脸糊。
 */
export const INK_W = 3.2;
/** 细节线（眉/嘴/内衬/屏幕内容/书脊）。 */
export const INK_W_THIN = 2.2;

/** 肤色（三档，按成员稳定分配）。 */
export const SKINS = ["#f6d3ad", "#ecc39a", "#d9a878"] as const;
/** 发色。 */
export const HAIRS = ["#3a4657", "#5a4632", "#2c2f3a", "#7a5a3a", "#8a6a4a"] as const;
/** 上衣色（饱和度比 v4 高一档，且彼此拉开）。 */
export const CLOTHES = ["#3d8fd6", "#6f6ce0", "#2fb3a3", "#ef7d4e", "#c95fae", "#5ebd68", "#e0a52c", "#7f6fe0"] as const;

export type WorkerLook = {
  skin: string;
  hair: string;
  /** 0 = 短圆头 / 1 = 中分长鬓 / 2 = 丸子头 */
  hairStyle: 0 | 1 | 2;
  glasses: boolean;
  cloth: string;
  /** 有领子（正装感） */
  collar: boolean;
};

/** 按成员序号派生视觉特征 —— 同一成员每次进办公室都是同一张脸（不是每帧随机）。 */
export function workerLook(index: number, seed = 0): WorkerLook {
  const n = index + seed * 7;
  return {
    skin: SKINS[n % SKINS.length],
    hair: HAIRS[(n * 3 + 1) % HAIRS.length],
    hairStyle: ((n * 5) % 3) as 0 | 1 | 2,
    glasses: (n * 7) % 3 === 0,
    cloth: CLOTHES[n % CLOTHES.length],
    collar: (n * 11) % 2 === 0,
  };
}
