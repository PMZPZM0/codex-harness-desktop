/**
 * 生图素材注册表（team-office 域，09-30 v15「素材路线」）。
 *
 * ⛔ 这一版**推翻了 v10~v14 的"零贴图"约定**（用户 09-30 明确要求：「动物用生图模型重新出」
 *    「办公室场景和桌子还有配套设施都用生图模型重新出」）。推翻的同时保住两条底线：
 *      ① **素材必须集中在这一个文件里**（单一真相源）—— 画布/渲染层不许各自 import 图片，
 *         否则"哪张图在哪儿用"会散成十几处（守卫【168】锚这条）；
 *      ② **程序化路线必须保留**（`preset = "procedural"`）—— 素材是**预设**，不是唯一路径，
 *         这样素材风格不满意时能一键回退，而不是"只能重出图"。
 *
 * ⛔ 为什么素材是 data: 内联而不是独立文件：打包版用 file:// 载入页面，PixiJS 读贴图走 fetch，
 *    而 Chromium 拒绝 file:// 上的 fetch ⇒ 独立文件必然渲染成**白方块**（守卫【175】有这段历史）。
 *    所以 vite.config.ts 把 assetsInlineLimit 抬到 64KB，本文件里的素材全部内联进 data:。
 *
 * ⛔ 素材来源与版权：全部由本机配置的生图接口现出（prompt 见 .workbuddy 的生成脚本），
 *    不使用任何第三方素材包 —— 参考项目（Marvis）的素材作者自己标注过版权问题，不碰。
 */
import type { AnimalKind } from "./office-palette";
import type { ScreenKind } from "./office-render";
import { WALK_ART, POSE_ART } from "./office-art-pose";
import { PERSON_ART } from "./office-art-person";
import { Assets, Texture } from "pixi.js";

/* ── 动物：三套预设（同一物种三套画风，按序号稳定取用）───────────────────── */
import plushBackCat from "./assets/animals/plush-back-cat.webp";
import plushBackFox from "./assets/animals/plush-back-fox.webp";
import plushBackDog from "./assets/animals/plush-back-dog.webp";
import plushBackRabbit from "./assets/animals/plush-back-rabbit.webp";
import plushBackBear from "./assets/animals/plush-back-bear.webp";
import plushBackSheep from "./assets/animals/plush-back-sheep.webp";
import plushBackKoala from "./assets/animals/plush-back-koala.webp";
import plushBackMouse from "./assets/animals/plush-back-mouse.webp";
import plushBackDeer from "./assets/animals/plush-back-deer.webp";
import plushBackHedgehog from "./assets/animals/plush-back-hedgehog.webp";
import plushBackPig from "./assets/animals/plush-back-pig.webp";
import plushBackLion from "./assets/animals/plush-back-lion.webp";
import plushFrontCat from "./assets/animals/plush-front-cat.webp";
import plushFrontFox from "./assets/animals/plush-front-fox.webp";
import plushFrontDog from "./assets/animals/plush-front-dog.webp";
import plushFrontRabbit from "./assets/animals/plush-front-rabbit.webp";
import plushFrontBear from "./assets/animals/plush-front-bear.webp";
import plushFrontSheep from "./assets/animals/plush-front-sheep.webp";
import plushFrontKoala from "./assets/animals/plush-front-koala.webp";
import plushFrontMouse from "./assets/animals/plush-front-mouse.webp";
import plushFrontDeer from "./assets/animals/plush-front-deer.webp";
import plushFrontHedgehog from "./assets/animals/plush-front-hedgehog.webp";
import plushFrontPig from "./assets/animals/plush-front-pig.webp";
import plushFrontLion from "./assets/animals/plush-front-lion.webp";
import flatFrontCat from "./assets/animals/flat-front-cat.webp";
import flatFrontFox from "./assets/animals/flat-front-fox.webp";
import flatFrontDog from "./assets/animals/flat-front-dog.webp";
import flatFrontRabbit from "./assets/animals/flat-front-rabbit.webp";
import flatFrontBear from "./assets/animals/flat-front-bear.webp";
import flatFrontSheep from "./assets/animals/flat-front-sheep.webp";
import flatFrontKoala from "./assets/animals/flat-front-koala.webp";
import flatFrontMouse from "./assets/animals/flat-front-mouse.webp";
import flatFrontDeer from "./assets/animals/flat-front-deer.webp";
import flatFrontHedgehog from "./assets/animals/flat-front-hedgehog.webp";
import flatFrontPig from "./assets/animals/flat-front-pig.webp";
import flatFrontLion from "./assets/animals/flat-front-lion.webp";

/* ── 屏幕内容：一套真实界面截图（代码 / 表格 / 行情 / 邮件 / 设计 / 熄屏）── */
import screenCode from "./assets/screens/gen-code.webp";
import screenSheet from "./assets/screens/gen-sheet.webp";
import screenChart from "./assets/screens/gen-chart.webp";
import screenMail from "./assets/screens/gen-mail.webp";
import screenDesign from "./assets/screens/gen-design.webp";
import screenSleep from "./assets/screens/gen-sleep.webp";

/* ── 家具 / 设施（等距精灵；⛔ 全部同一机位出图，按 floorPoint 落位才不漂）── */
import propDesk from "./assets/props/gen-desk.webp";
import propPedestal from "./assets/props/gen-pedestal.webp";
import propChair from "./assets/props/gen-chair.webp";
import propMonitor from "./assets/props/gen-monitor.webp";
import propKeyboard from "./assets/props/gen-keyboard.webp";
import propPlant from "./assets/props/gen-plant.webp";
import propWater from "./assets/props/gen-water.webp";
import propPrinter from "./assets/props/gen-printer.webp";
import propCabinet from "./assets/props/gen-cabinet.webp";
import propCoffee from "./assets/props/gen-coffee.webp";
import propFridge from "./assets/props/gen-fridge.webp";
import propShelf from "./assets/props/gen-shelf.webp";
import propPlantBig from "./assets/props/gen-plantbig.webp";
import propDoor from "./assets/props/gen-door.webp";

/* ── 新增配套设施（09-30「多放一些配套设施」；坐标与跑腿点同源，见 OfficeCanvas.ERRAND_SPOT_UV）── */
import propTreadmill from "./assets/props/gen-treadmill.webp";
import propVending from "./assets/props/gen-vending.webp";
import propToilet from "./assets/props/gen-toilet.webp";
import propCup from "./assets/props/gen-cup.webp";
import propWhiteboard from "./assets/props/gen-whiteboard.webp";
import propShelf2 from "./assets/props/gen-shelf2.webp";
import propKb2 from "./assets/props/gen-kb2.webp";
import propMouse2 from "./assets/props/gen-mouse2.webp";

/* ── 第二批屏幕内容（gen2-*：游戏 / 新闻网页 / 短视频流 / 文件管理器 / 应用网格 / 风控仪表盘）── */
import screenGame from "./assets/screens/gen2-game.webp";
import screenBrowser from "./assets/screens/gen2-browser.webp";
import screenVideo from "./assets/screens/gen2-video.webp";
import screenFiles from "./assets/screens/gen2-files.webp";
import screenApps from "./assets/screens/gen2-apps.webp";
import screenRisk from "./assets/screens/gen2-risk.webp";

/* ── 场景背景（09-30「场景/人物/桌子/摆件/配套设施一次完成」）：
   程序化白模底稿 → images/edits 重绘成真实办公室（桌位 = deskSlots 坐标，机位由底稿锁死，
   彻底绕开坑⑥「生图家具机位对不上」）。房间/桌椅/大件设施都在这张图里，
   运行时只叠：人物精灵、屏幕动画、挂钟秒针/蒸汽。 */
import sceneBgUrl from "./assets/scene-bg.webp";

/** 动物预设名（⛔ 顺序即展示顺序；新增一套就加到这里 + 下面的表 + localStorage 合法值）。 */
export const ANIMAL_PRESETS = ["plush-front", "plush-back", "flat-front"] as const;
export type AnimalArtPreset = (typeof ANIMAL_PRESETS)[number];
/** "procedural" = 不走素材，回到手画（保底路线，永远保留）；"person" = 人物化（09-30 默认）。 */
export type ArtPreset = AnimalArtPreset | "procedural" | "person";

const ANIMAL_ART: Record<AnimalArtPreset, Record<AnimalKind, string>> = {
  "plush-front": {
    cat: plushFrontCat, fox: plushFrontFox, dog: plushFrontDog, rabbit: plushFrontRabbit,
    bear: plushFrontBear, sheep: plushFrontSheep, koala: plushFrontKoala, mouse: plushFrontMouse,
    deer: plushFrontDeer, hedgehog: plushFrontHedgehog, pig: plushFrontPig, lion: plushFrontLion,
  },
  "plush-back": {
    cat: plushBackCat, fox: plushBackFox, dog: plushBackDog, rabbit: plushBackRabbit,
    bear: plushBackBear, sheep: plushBackSheep, koala: plushBackKoala, mouse: plushBackMouse,
    deer: plushBackDeer, hedgehog: plushBackHedgehog, pig: plushBackPig, lion: plushBackLion,
  },
  "flat-front": {
    cat: flatFrontCat, fox: flatFrontFox, dog: flatFrontDog, rabbit: flatFrontRabbit,
    bear: flatFrontBear, sheep: flatFrontSheep, koala: flatFrontKoala, mouse: flatFrontMouse,
    deer: flatFrontDeer, hedgehog: flatFrontHedgehog, pig: flatFrontPig, lion: flatFrontLion,
  },
};

const SCREEN_ART: Record<ScreenKind, string> = {
  code: screenCode,
  sheet: screenSheet,
  chart: screenChart,
  mail: screenMail,
  design: screenDesign,
  sleep: screenSleep,
  game: screenGame,
  browser: screenBrowser,
  video: screenVideo,
  files: screenFiles,
  apps: screenApps,
  risk: screenRisk,
};

/** 素材开关的存储键 —— 改它就能换预设（不用改代码）；写坏/没写 → 用默认值。 */
export const ART_PRESET_KEY = "office-art-preset";
/** 场景背景开关（⛔ 默认开）："0" = 回到全程序化（房间/桌椅手画）。 */
export const SCENE_BG_KEY = "office-art-scene";

/** 场景背景图（edits 重绘的真实办公室，桌位与 deskSlots 坐标对齐）；开关关 → null（全程序化）。 */
export function sceneBgArt(): string | null {
  try { if (localStorage.getItem(SCENE_BG_KEY) === "0") return null; } catch { return null; }
  return sceneBgUrl;
}
/** 默认预设：**人物**（09-30 用户：「把宠物换成人物」，Marvis 式职场小人）。
 *  回落链：person → plush-back（动物绒毛）→ procedural（手画）。
 *  ⛔ person 素材缺某姿势/角色时调用方逐处回落动物素材，绝不画白方块。 */
export const DEFAULT_ART_PRESET: ArtPreset = "person";

/** 当前生效的动物预设（localStorage 可覆盖；⛔ 读不到一律回落默认，绝不抛）。 */
export function animalPreset(): ArtPreset {
  try {
    const v = localStorage.getItem(ART_PRESET_KEY);
    if (v === "procedural" || v === "person" || (ANIMAL_PRESETS as readonly string[]).includes(v || "")) return v as ArtPreset;
  } catch { /* 无 localStorage（SSR/测试）→ 默认 */ }
  return DEFAULT_ART_PRESET;
}

/** 人物化是否生效（preset === "person"）。 */
export function personPresetOn(): boolean {
  return animalPreset() === "person";
}

/** 某物种的素材 URL；`procedural` 或没有该物种的图 → null（调用方回落手画）。
 *  ⛔ person 预设回落 **plush-back** 动物图（人物素材缺姿势/角色时的兜底，见文件头回落链）。 */
export function animalArtOf(animal: AnimalKind, preset: ArtPreset = animalPreset()): string | null {
  if (preset === "procedural") return null;
  const key: AnimalArtPreset = preset === "person" ? "plush-back" : (preset as AnimalArtPreset);
  return ANIMAL_ART[key]?.[animal] ?? null;
}

/** 屏幕内容素材（⛔ 熄屏也走素材：那张图就是锁屏画面）。 */
export function screenArtOf(kind: ScreenKind): string {
  return SCREEN_ART[kind];
}

/**
 * 家具 / 设施精灵：`w` = 该件在**场景坐标**里的目标宽度（CSS px，@scale 1）。
 * ⛔ 宽度按各自的真实占地给（桌子宽、饮水机窄），不是统一缩放 —— 统一缩放会让饮水机变成"胖箱子"。
 */
export const PROP_ART = {
  desk: { url: propDesk, w: 150 },
  pedestal: { url: propPedestal, w: 52 },
  chair: { url: propChair, w: 62 },
  monitor: { url: propMonitor, w: 78 },
  keyboard: { url: propKeyboard, w: 46 },
  plant: { url: propPlant, w: 26 },
  water: { url: propWater, w: 34 },
  printer: { url: propPrinter, w: 58 },
  cabinet: { url: propCabinet, w: 88 },
  coffee: { url: propCoffee, w: 92 },
  fridge: { url: propFridge, w: 54 },
  shelf: { url: propShelf, w: 50 },
  plantbig: { url: propPlantBig, w: 62 },
  door: { url: propDoor, w: 52 },
  /* 09-30 新增配套设施（跑步机 / 贩卖机 / 卫生间标识 / 茶水杯 / 白板 / 墙面置物架 / 键鼠特写） */
  treadmill: { url: propTreadmill, w: 96 },
  vending: { url: propVending, w: 58 },
  toilet: { url: propToilet, w: 88 },
  cup: { url: propCup, w: 34 },
  whiteboard: { url: propWhiteboard, w: 120 },
  shelf2: { url: propShelf2, w: 66 },
  kb2: { url: propKb2, w: 52 },
  mouse2: { url: propMouse2, w: 30 },
} as const;
export type PropId = keyof typeof PROP_ART;

/** 这件家具是否走素材（`procedural` 预设下一律走手画）。
 *
 *  ⛔ **默认关闭**（09-30 实测结论）：生图出的家具是**另一套相机角度**，落进我们固定的等距坐标后
 *     比例与透视都对不上（桌子变成薄片、绿植被抠成白块、椅子与椅背位置打架），画面反而比程序化差。
 *     角色与屏幕内容不受影响 —— 它们是"独立物件"（不参与房间透视），所以照用素材。
 *  想试：`localStorage.setItem("office-art-props", "1")`（预览页 `?props=1`），无需改代码。 */
export const PROP_ART_KEY = "office-art-props";
/** ⛔ 09-30 起场景背景路线（默认开）下**全素材放开**：背景图只烙房间壳+桌子，
 *  椅子 / 全部设施都是独立精灵 —— 素材是主体而不是实验；旧门禁只在 bg 关（全程序化回退）时生效。 */
export function propArtOf(id: PropId): { url: string; w: number } | null {
  if (animalPreset() === "procedural") return null;
  if (sceneBgArt()) return PROP_ART[id];
  try { if (localStorage.getItem(PROP_ART_KEY) !== "1") return null; } catch { return null; }
  return PROP_ART[id];
}

/** 需要预加载的素材清单（只加载当前预设，别把三套都读进显存）。 */
export function activeArtUrls(): string[] {
  const preset = animalPreset();
  const animals = preset === "procedural" ? [] : Object.values(ANIMAL_ART[preset as AnimalArtPreset] ?? {});
  const urls: string[] = [...animals, ...Object.values(SCREEN_ART)];
  if (sceneBgArt()) urls.push(sceneBgUrl);
  /* 走路/姿势图集只在 plush-back 预设生效（walkArtOf/poseArtOf 的判定同此） */
  if (preset === "plush-back") {
    for (const v of Object.values(WALK_ART)) { if (v) urls.push(v[0], v[1]); }
    for (const poses of Object.values(POSE_ART)) { if (poses) urls.push(...Object.values(poses).filter((u): u is string => Boolean(u))); }
  }
  /* 人物化（09-30）：person 预设加载全部人物姿势图 */
  if (preset === "person") {
    for (const poses of Object.values(PERSON_ART)) { if (poses) urls.push(...Object.values(poses).filter((u): u is string => Boolean(u))); }
  }
  /* 场景背景路线：椅子/全部设施都是**独立精灵**（propArtOf 放行）⇒ props 必须预加载，
     缺了会整件静默消失（09-30 实测：椅子和饮水机全没影，人悬空坐在桌前）。 */
  if (sceneBgArt() && preset !== "procedural") {
    urls.push(...Object.values(PROP_ART).map((p) => p.url));
  }
  return urls;
}

/** 已加载贴图（URL → Texture）。⛔ 只由 preloadArt 写入、只由 artTexture 读，别处不许碰。 */
const TEXTURES = new Map<string, Texture>();

/**
 * 预加载当前预设的全部素材（画布 setup 里 await 它，**再**置 ready）。
 * ⛔ 素材是 data: 内联（见文件头）⇒ 这里不产生 file:// 的 fetch，守卫【175】的 CSP 才成立。
 */
export async function preloadArt(): Promise<void> {
  await Promise.all(activeArtUrls().map(async (url) => {
    const tex = (await Assets.load(url)) as Texture;
    if (tex) TEXTURES.set(url, tex);
  }));
}

/** 取已加载贴图；没加载到 → null（调用方回落到程序化绘制，绝不画白方块）。 */
export function artTexture(url: string): Texture | null {
  return TEXTURES.get(url) ?? null;
}
