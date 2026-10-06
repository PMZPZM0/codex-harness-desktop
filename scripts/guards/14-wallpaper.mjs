/**
 * 应用壁纸判据（wallpaper 域，2026-10-05，纯离线、可随预检跑）
 *
 * ⛔ 三条铁律（都是"看起来接好了、其实会出事"的接缝）：
 *   ① 壁纸层必须 pointer-events:none + z-index:-1 —— 纯视觉层永不挡交互、永不盖内容；
 *   ② tsparticles 的 fullScreen 必须关 —— 默认全屏会劫持 body，壁纸只属于聊天区；
 *   ③ vanta 初始化必须 try/catch + destroy 清理 —— 它对 three 版本敏感，炸了要静默降级。
 * 附：懒加载（import()）是主包体积红线；素材颜色一律 token（mask + --accent），不写死色值。
 */
import { readFileSync } from "node:fs";
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
const particlesSrc = codeOnly(read("src/features/wallpaper/ParticlesPane.tsx"));
const settingsSrc = codeOnly(read("src/features/wallpaper/WallpaperSettings.tsx"));
const cssSrc = read("src/styles/28-wallpaper.css");
const styles = read("src/styles.css");
const appearance = codeOnly(read("src/features/settings-appearance/AppearanceSettingsSection.tsx"));
const timeline = codeOnly(read("src/features/app-view/AppView/02-main-stage/01-timeline.tsx"));
const appView = codeOnly(read("src/features/app-view/AppView.tsx"));

/* ── 数据面 ── */
ok(libSrc.includes("off") && libSrc.includes("particles") && libSrc.includes("vanta") && libSrc.includes("custom"), "模式注册表含 off/pattern/particles/vanta/custom（归一化白名单）");
ok(libSrc.includes("Math.min(40, Math.max") && libDts.includes("normalizeWallpaper"), "浓度归一夹在 2~40%（避免满壁纸盖脸 / 0% 看不见）");
ok(layerSrc.includes("cfg.opacity / 100 : 1"), "浓度只压图案/自定义图（粒子/3D 被层透明度压住 = 全部隐身，10-05 实测「假功能」观感的真凶之一）");
const patternCount = (libSrc.split("WALLPAPER_PRESETS")[0].match(/id: "/g) ?? []).length;
ok(patternCount >= 10, "图案库 ≥10 款 48px 大瓷砖（24px 小瓷砖铺出来像噪点 = 「不好看」主因；实测 " + patternCount + "）");
const presetCount = (libSrc.split("WALLPAPER_PRESETS")[1]?.match(/id: "/g) ?? []).length;
ok(presetCount >= 6 && libDts.includes("WALLPAPER_PRESETS"), "精选渐变壁纸 ≥6 款（自定义图档的内置好看款，点击即用）");
ok(layerSrc.includes("isPresetImage") && layerSrc.includes("presetById"), "壁纸层认识 preset: 前缀（精选渐变走 CSS 背景、不走文件协议）");
ok(settingsSrc.includes("WALLPAPER_PRESETS.map") && settingsSrc.includes("preset:"), "设置段渲染精选壁纸缩略图行（点击即用）");
ok(particlesSrc.includes("links: { enable: true"), "粒子开了邻接连线（素点无连线肉眼几乎不可见 = 「粒子没效果」主因）");
ok(cssSrc.includes("mask-size: 48px 48px") && cssSrc.includes("background-color: var(--accent)"), "图案层用 --accent 上色（token，不写死色值）");

/* ── 层本体：铁律① ── */
ok(cssSrc.includes("z-index: -1; pointer-events: none;"), "壁纸层 z-index:-1 + pointer-events:none（挡交互/盖内容 = 直接不可用）");
ok(styles.includes("styles/28-wallpaper"), "styles.css 已接入 28-wallpaper");

/* ── 动效引擎：铁律②③ + 懒加载 ── */
ok(layerSrc.includes("lazy(() => import(\"./ParticlesPane\")") && layerSrc.includes("Suspense"), "tsparticles 整块 React.lazy（包装器会静态拖进 @tsparticles/engine，顶层 import = 主包变大）");
ok(particlesSrc.includes("fullScreen: { enable: false }"), "tsparticles fullScreen 已关（默认全屏劫持 body = 壁纸铺满整窗）");
ok(layerSrc.includes("vanta/dist/vanta.net.min.js") && layerSrc.includes("catch") && layerSrc.includes("destroy()"), "vanta 懒加载 + try/catch 静默降级 + destroy 清理（three 版本敏感，炸了不许白屏）");
ok(layerSrc.includes("prefers-reduced-motion") && layerSrc.includes("pattern"), "减动效偏好下粒子/3D 退回静态图案（accessibility 基本盘）");

/* ── 接线：挂载 + 设置段 ── */
// ⛔ 10-06 铺满全应用：挂载点从 timeline-wrap 上移到 app-shell 根（fixed 铺满视口）。
ok(appView.includes("<WallpaperLayer />") && !timeline.includes("<WallpaperLayer />"), "WallpaperLayer 挂在 AppView 根（app-shell 内铺满全应用；timeline 内旧挂载已撤）");
ok(cssSrc.includes(".app-shell { isolation: isolate; }") && cssSrc.includes("position: fixed"), "app-shell 是堆叠上下文 + 层 fixed 铺满（负 z 层画在 shell 背景上、内容下）");
ok(cssSrc.includes(':root[data-wallpaper="on"] .app-shell') && cssSrc.includes(':root[data-wallpaper="on"] .composer') && cssSrc.includes(':root[data-wallpaper="on"] .workspace') && cssSrc.includes(':root[data-wallpaper="on"] .sidebar'), "data-wallpaper 驱动表面透明化（app-shell/workspace 透明 + composer/sidebar 半透明，漏一层 = 一块白底，10-06 真机遍历抓出）");
ok(appearance.includes("WallpaperSettingsSection") && settingsSrc.includes("saveWallpaper") && settingsSrc.includes("chooseImages"), "外观页接了壁纸设置段（模式/图案/浓度/自定义图全部落到 saveWallpaper）");
ok(libSrc.includes("WALLPAPER_EVENT") && libSrc.includes("dispatchEvent") && layerSrc.includes("subscribeWallpaper") && settingsSrc.includes("subscribeWallpaper"), "配置变更经 CustomEvent 广播（设置页与壁纸层同源联动，不走 bag 不走 IPC）");
ok(layerSrc.includes("dataset.wallpaper"), "层挂载时驱动 data-wallpaper 属性（CSS 透明化的开关必须来自真实挂载状态）");

console.log(`\n【wp】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
