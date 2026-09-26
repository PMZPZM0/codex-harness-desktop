/**
 * 办公室插画色板（team-office 域 09-26 v4）。
 *
 * ⛔ 统一描边（OFC.ink）是「卡通感」的地基：纯填充色块永远像占位图（v2 教训）。
 * ⛔ 场景是**固定浅色插画**（不跟随深色主题）—— 插画自身有光感与阴影，跟着主题反色会脏。
 */
export const OFC = {
  ink: "#2f3a4a",
  inkSoft: "#5b6a7d",

  wall: "#eef3f9",
  wallTop: "#e2eaf4",
  wallStripe: "#e6edf6",
  skirt: "#cfd9e6",

  floorA: "#f5ebdd",
  floorB: "#ecdcc6",
  rug: "#e8d6c0",
  rugEdge: "#d8c1a6",

  wood: "#c09a63",
  woodLight: "#e2c39a",
  woodDark: "#a97f4b",

  metal: "#b9c4d1",
  metalDark: "#8d9aab",

  screen: "#dfe9f5",
  screenOn: "#bfe3cf",
  screenOnDeep: "#8fd0ac",
  codeInk: "#2f7a53",
  codeIdle: "#93a5b8",

  paper: "#ffffff",
  noteA: "#ffe08a",
  noteB: "#a8d8f0",
  noteC: "#f7b3c0",
  noteD: "#b8e6b0",

  plant: "#6bbf73",
  plantDeep: "#4a9a55",
  pot: "#d9915f",

  water: "#bfe0ff",
  waterDeep: "#8fc4ee",

  ok: "#4aa96c",
  warn: "#e8875f",
  info: "#5b9bd5",
} as const;

/** 肤色（三档，按成员稳定分配）。 */
export const SKINS = ["#f6d3ad", "#ecc39a", "#d9a878"] as const;
/** 发色。 */
export const HAIRS = ["#3a4657", "#5a4632", "#2c2f3a", "#7a5a3a", "#8a6a4a"] as const;
/** 上衣色（柔和但有区分度）。 */
export const CLOTHES = ["#5b9bd5", "#7e7ce0", "#3fb6a8", "#e8875f", "#c96fb4", "#6bbf73", "#d8a13f", "#8a7fd6"] as const;

export type WorkerLook = {
  skin: string;
  hair: string;
  /** 0 = 短圆头 / 1 = 中分 / 2 = 丸子头 */
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
