/**
 * 应用壁纸判据（wallpaper 域，10-05 立；11-02 全部重做后重写）。
 *
 * 11-02 用户三连：「把旧的壁纸删了，多做几套新的，主题色」→「太失望了，旧的线条都还在」→
 *   「你生成一些好看的壁纸，静态动态，你全部重新做」。
 * 现在的形态（这就是本守卫要钉住的契约）：
 *   · 模式只有 5 档：off / aurora / ribbon / halo / custom；旧图案·粒子·星空**整组删除**
 *     （老档案里的值统一迁移到 aurora）；⛔ 负向断言防复活。
 *   · 静态壁纸 = 6 张**生图资产**（public/wallpapers/*.jpg），不是 CSS 糖果色；资源必须在仓里。
 *   · 动态壁纸 = 纯 CSS 柔光（主题 token 上色）+ 鼠标视差（--wp-px/--wp-py × --wp-depth）；
 *     减动效偏好下静帧（保留柔光，不突然变纯黑）。
 *   · 层本体：fixed 铺满 / z-index:-1 / pointer-events:none；html 让位 + 表面令牌半透明，
 *     保证输入框 / 卡片 / 菜单 / 弹窗全都跟着壁纸走。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log(`  ✗ 【wp】${m}`); } };

const read = (p) => readFileSync(join(ROOT, p), "utf8");
const libSrc = codeOnly(read("src/lib/wallpaper.mjs"));
const libDts = read("src/lib/wallpaper.d.mts");
const layerSrc = codeOnly(read("src/features/wallpaper/WallpaperLayer.tsx"));
const settingsSrc = codeOnly(read("src/features/wallpaper/WallpaperSettings.tsx"));
const cssSrc = read("src/styles/28-wallpaper.css");
const styles = read("src/styles.css");
const baseCss = read("src/styles/01-base-and-chrome.css");
const appView = codeOnly(read("src/features/app-view/AppView.tsx"));
const dispatchCore = codeOnly(read("electron/features/dispatch-core.ts"));
const dispatchRpc = codeOnly(read("electron/features/dispatch-rpc.ts"));
const appearance = codeOnly(read("src/features/settings-appearance/AppearanceSettingsSection.tsx"));

/* ── ① 模式集合：只许 5 档，旧模式负向 ── */
{
  ok(/WALLPAPER_MODES = \["off", "aurora", "ribbon", "halo", "custom"\]/.test(libSrc),
    "模式 = off / aurora / ribbon / halo / custom（旧图案·粒子·星空已删除）");
  ok(/LEGACY_MODES = \["pattern", "particles", "stars", "vanta"\]/.test(libSrc) && /LEGACY_MODES\.includes\(r\.mode\) \? "aurora"/.test(libSrc),
    "老档案里的旧模式迁移到 aurora（不会突然没壁纸）");
  ok(!/WALLPAPER_PATTERNS/.test(libSrc) && !/patternMask/.test(libSrc) && !/patternMask/.test(libDts),
    "⛔ 图案库 / patternMask 已删除（用户：「旧的那种线条都还在」）");
  ok(!existsSync(join(ROOT, "src/features/wallpaper/ParticlesPane.tsx")),
    "⛔ 粒子引擎（tsparticles 连线网）已删除，不许复活");
  ok(!/wallpaper-stars|StarfieldPane|starScale/.test(layerSrc + settingsSrc + libSrc),
    "⛔ 星空点阵（canvas 点阵）已删除，不许复活");
  ok(!/wallpaper-pattern|wallpaper-swatch|theme-switch\.five/.test(cssSrc),
    "⛔ 旧图案 CSS 已删除（防死样式回头）");
}

/* ── ② 静态壁纸 = 生图资产 ── */
{
  const ids = [...libSrc.matchAll(/\{ id: "([a-z-]+)", name: "([^"]+)", src: "wallpapers\/([a-z-]+\.jpg)" \}/g)];
  ok(ids.length >= 6, `静态壁纸 ≥6 张生图资产（实测 ${ids.length}）`);
  const missing = ids.filter((m) => !existsSync(join(ROOT, "public", "wallpapers", m[3])));
  ok(missing.length === 0, `壁纸图片都在 public/wallpapers（缺：${missing.map((m) => m[3]).join("、") || "无"}）`);
  const oversized = ids
    .map((m) => join(ROOT, "public", "wallpapers", m[3]))
    .filter((file) => existsSync(file) && statSync(file).size > 800 * 1024);
  ok(oversized.length === 0, `单张壁纸 ≤800KB（超了先压再进包：${oversized.map((f) => f.split(/[\\/]/).pop()).join("、") || "无"}）`);
  ok(/isPresetImage/.test(layerSrc) && /presetById/.test(layerSrc) && /url\("\.\/\$\{preset\.src\}"\)|url\(`\.\/\$\{preset\.src\}`\)/.test(layerSrc),
    "壁纸层按 preset.src 加载图片（不是 CSS 渐变字符串）");
  ok(/WALLPAPER_PRESETS\.map/.test(settingsSrc) && /url\("\.\/\$\{p\.src\}"\)|url\(`\.\/\$\{p\.src\}`\)/.test(settingsSrc),
    "设置页缩略图用同一张图（点击即用）");
  ok(!/#[0-9a-fA-F]{6}/.test(libSrc.slice(libSrc.indexOf("WALLPAPER_PRESETS"), libSrc.indexOf("presetById"))),
    "⛔ 静态壁纸不许回到写死糖果色（旧六款的问题）");
}

/* ── ③ 动态光幕：三档 + 鼠标视差 + 减动效 ── */
{
  ok(["aurora", "ribbon", "halo"].every((mode) => libSrc.includes(`"${mode}"`)), "三档动态壁纸都在清单里");
  ok(/function MotionVeil/.test(layerSrc) && /is-\$\{variant\}/.test(layerSrc) && /<i><b \/><\/i><i><b \/><\/i><i><b \/><\/i>/.test(layerSrc),
    "动态光幕 = 三层柔光组件（外层视差 / 内层动画各管一件事）");
  ok(/addEventListener\("mousemove"/.test(layerSrc) && layerSrc.includes("--wp-px") && layerSrc.includes("--wp-py")
    && /\.wallpaper-motion i \{[^}]*var\(--wp-px\)/.test(cssSrc) && /--wp-depth/.test(cssSrc),
    "鼠标视差在位（缓动 + 每层不同深度；用户 11-02「动态壁纸要加上鼠标动态交互效果」）");
  ok(/prefersReducedMotion\(\)/.test(layerSrc) && /prefers-reduced-motion: reduce[\s\S]{0,260}\.wallpaper-motion i b \{ animation: none/.test(cssSrc)
    && /\.wallpaper-motion i \{ transform: none !important; \}/.test(cssSrc),
    "减动效偏好：视差监听不挂、动画静帧（保留柔光）");
  ok(["is-aurora", "is-ribbon", "is-halo"].every((cls) => cssSrc.includes(cls)), "三档样式齐备（keyframes + 柔光层）");
  ok(/color-mix\(in srgb, var\(--(accent|ic-)/.test(cssSrc), "动态光幕颜色取主题 token（切主题自动换色）");
  ok(/\.wallpaper-motion::after/.test(cssSrc) && /feTurbulence/.test(cssSrc) && /\.wallpaper-motion::before/.test(cssSrc),
    "动态光幕叠颗粒 + 暗角（有材质，不像 PPT 渐变）");
  ok(/\.wallpaper-preset::after \{[\s\S]{0,160}24%/.test(cssSrc) && !/\.wallpaper-preset::after[^{]*\{[^}]*82%/.test(cssSrc),
    "静态壁纸的雾只压 24–34%（旧值 82% 把画面压没了 = 「普通壁纸也丑」的直接原因）");
}

/* ── ④ 层本体 + 全界面适配 ── */
{
  ok(/\.wallpaper-layer \{ position: fixed; inset: 0; z-index: -1; pointer-events: none; overflow: hidden; \}/.test(cssSrc),
    "壁纸层 fixed + z-index:-1 + pointer-events:none（不挡交互、不盖内容）");
  ok(/\.app-shell \{ isolation: isolate; \}/.test(cssSrc) && styleMountOk(), "app-shell 堆叠上下文 + 层挂载在 AppView 根");
  ok(/:root\[data-wallpaper="on"\] \{\s*[\s\S]{0,220}background: transparent;/.test(cssSrc) && /--bg-base/.test(baseCss),
    "壁纸开着时 html 画布让位（负 z 层不被底色盖住）+ 表面基准令牌在位");
  ok(/:root\[data-wallpaper="on"\] \{\s*[\s\S]{0,460}--bg: color-mix\(in srgb, var\(--bg-base\)/.test(cssSrc)
    && /--panel: color-mix\(in srgb, var\(--panel-base\)/.test(cssSrc)
    && /--field: color-mix\(in srgb, var\(--field-base\)/.test(cssSrc),
    "表面令牌统一半透明（输入框 / 卡片 / 菜单 / 弹窗自动跟随）");
  ok(/:root\[data-wallpaper="on"\] :where\(\.settings-dialog, \.media-preview-dialog/.test(cssSrc)
    && /backdrop-filter: blur\(22px\)/.test(cssSrc),
    "大块表面（顶栏 / 右栏 / 设置 / 二级弹窗）加玻璃模糊");
  ok(/\.wallpaper-preset::before \{[\s\S]{0,300}feTurbulence/.test(cssSrc), "静态壁纸叠细噪点（渐变/图片有质感）");
  ok(styles.includes("styles/28-wallpaper"), "styles.css 已接入 28-wallpaper");
}

/* ── ⑤ 接线：设置页 + 引擎自助接口 ── */
{
  ok(appearance.includes("WallpaperSettingsSection") && settingsSrc.includes("saveWallpaper") && settingsSrc.includes("chooseImages"),
    "外观页接壁纸设置段（模式 / 静态壁纸 / 自定义图全部落地）");
  ok(/MODE_LABELS[\s\S]{0,260}aurora: "极光"/.test(settingsSrc) && /ribbon: "流光"/.test(settingsSrc) && /halo: "光晕"/.test(settingsSrc),
    "设置页档位文案：极光 / 流光 / 光晕");
  ok(/mode: \{ type: "string", description: "off \/ aurora \/ ribbon \/ halo \/ custom" \}/.test(dispatchCore)
    && /\["off", "aurora", "ribbon", "halo", "custom"\]/.test(dispatchRpc),
    "引擎工具 wallpaper_set 的模式白名单同步（否则 Codex 切不了新壁纸）");
}

function styleMountOk() {
  return appView.includes("<WallpaperLayer />");
}

console.log(`\n【wp】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);