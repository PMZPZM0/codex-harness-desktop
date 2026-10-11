/**
 * 550C 开机动画的档位与开关判定（纯函数，node 可直接 import 跑真值表）。
 *
 * ⛔ 本模块是**唯一口径**：渲染层（外观设置行 / 启动接管）与 `index.html` 的首帧内联脚本
 *    读的是同一个 localStorage 键。改键名必须两处同步（内联脚本不能用 import）。
 *
 * 档位语义（与上游 dsh-550c-boot 的 simple/full/off 对齐）：
 *   · simple —— 只播 550C logo 逐路径书写（约 4 秒）
 *   · full   —— 完整覆写流程（约 16 秒）
 *   · off    —— 不播，直接进主界面
 */

/** localStorage 键。⛔ index.html 里的内联脚本写死了同名字面量，改这里要同步改那边。 */
export const BOOT_INTRO_STORAGE_KEY = "boot-intro";

/** 合法档位（展示与遍历顺序即此序）。 */
export const BOOT_INTRO_MODES = ["simple", "full", "off"];

/** 默认档位。 */
export const BOOT_INTRO_DEFAULT_MODE = "full";

/** 归一化档位：非法值（含 null / undefined / 旧值）一律回落默认。 */
export function normalizeBootIntroMode(value) {
  return BOOT_INTRO_MODES.includes(value) ? value : BOOT_INTRO_DEFAULT_MODE;
}

/** 读当前档位；storage 缺失或抛错（隐私模式）时回落默认。 */
export function readBootIntroMode(storage) {
  try {
    return normalizeBootIntroMode(storage ? storage.getItem(BOOT_INTRO_STORAGE_KEY) : undefined);
  } catch {
    return BOOT_INTRO_DEFAULT_MODE;
  }
}

/** 写档位；失败静默（与主题 / 字号的写法一致）。 */
export function writeBootIntroMode(storage, mode) {
  try {
    if (storage) storage.setItem(BOOT_INTRO_STORAGE_KEY, normalizeBootIntroMode(mode));
  } catch {
    /* 忽略：隐私模式等写不进去，回落默认即可 */
  }
}

/** 档位展示名（设置页与提示共用一份，避免两处措辞漂移）。 */
export function bootIntroModeLabel(mode) {
  switch (normalizeBootIntroMode(mode)) {
    case "simple":
      return "简易（约 4 秒 · logo 书写）";
    case "off":
      return "关闭";
    default:
      return "完整（约 16 秒 · 覆写全流程）";
  }
}

/**
 * 该不该播启动动画。三者**任一成立就不播**：
 *   ① 档位是 off；② 系统开了「减弱动效」；③ 这是桌面宠物浮窗（不透明白底会盖住透明窗）。
 */
export function shouldPlayBootIntro(mode, ctx) {
  if (normalizeBootIntroMode(mode) === "off") return false;
  if (ctx && ctx.reducedMotion) return false;
  if (ctx && ctx.petWindow) return false;
  return true;
}

/** 播放档位归一：off 不是播放档，这里给个安全的兜底（调用点只会在 shouldPlay 为真时用）。 */
export function bootIntroPlayMode(mode) {
  return normalizeBootIntroMode(mode) === "simple" ? "simple" : "full";
}

/* ── 配色（上游四套磷光方案；琥珀 = 原作者配色，不设 data-scheme）───────────────────
   ⛔ 琥珀刻意**不设** host 的 data-scheme 属性：上游 CSS 里没有 `[data-scheme="amber"]` 块，
      默认值（:host 上的 --amber 等）直接接管。改成设 "amber" 会让它落进"没有对应块"的空档。 */

/** 配色存储键。 */
export const BOOT_INTRO_SCHEME_KEY = "boot-intro-scheme";

/** 合法配色（顺序即展示顺序，琥珀在前作默认）。 */
export const BOOT_INTRO_SCHEMES = ["amber", "green", "cyan", "white"];

/** 默认配色。 */
export const BOOT_INTRO_DEFAULT_SCHEME = "amber";

/** 归一化配色：非法值回落琥珀。 */
export function normalizeBootIntroScheme(value) {
  return BOOT_INTRO_SCHEMES.includes(value) ? value : BOOT_INTRO_DEFAULT_SCHEME;
}

/** 读配色；storage 缺失或抛错时回落琥珀。 */
export function readBootIntroScheme(storage) {
  try {
    return normalizeBootIntroScheme(storage ? storage.getItem(BOOT_INTRO_SCHEME_KEY) : undefined);
  } catch {
    return BOOT_INTRO_DEFAULT_SCHEME;
  }
}

/** 写配色；失败静默。 */
export function writeBootIntroScheme(storage, scheme) {
  try {
    if (storage) storage.setItem(BOOT_INTRO_SCHEME_KEY, normalizeBootIntroScheme(scheme));
  } catch {
    /* 忽略 */
  }
}

/** 配色展示名（设置页与提示共用一份）。 */
export function bootIntroSchemeLabel(scheme) {
  switch (normalizeBootIntroScheme(scheme)) {
    case "green":
      return "绿";
    case "cyan":
      return "青";
    case "white":
      return "白";
    default:
      return "琥珀";
  }
}

/** 该给宿主设的 data-scheme 值：琥珀返回空串（= 不设属性）。 */
export function bootIntroSchemeAttr(scheme) {
  const normalized = normalizeBootIntroScheme(scheme);
  return normalized === BOOT_INTRO_DEFAULT_SCHEME ? "" : normalized;
}
