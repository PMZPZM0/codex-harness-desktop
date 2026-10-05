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

/* ── 数据面 ── */
ok(libSrc.includes("off") && libSrc.includes("particles") && libSrc.includes("vanta") && libSrc.includes("custom"), "模式注册表含 off/pattern/particles/vanta/custom（归一化白名单）");
ok(libSrc.includes("Math.min(16, Math.max") && libDts.includes("normalizeWallpaper"), "浓度归一夹在 2~16%（避免 100% 壁纸盖脸 / 0% 看不见）");
const patternCount = (libSrc.match(/id: "/g) ?? []).length;
ok(patternCount >= 6, "图案库 ≥6 款（mask data-uri，颜色由层 background 提供；实测 " + patternCount + "）");
ok(cssSrc.includes("mask-size: 24px 24px") && cssSrc.includes("background-color: var(--accent)"), "图案层用 --accent 上色（token，不写死色值）");

/* ── 层本体：铁律① ── */
ok(cssSrc.includes("z-index: -1; pointer-events: none;"), "壁纸层 z-index:-1 + pointer-events:none（挡交互/盖内容 = 直接不可用）");
ok(styles.includes("styles/28-wallpaper"), "styles.css 已接入 28-wallpaper");

/* ── 动效引擎：铁律②③ + 懒加载 ── */
ok(layerSrc.includes("lazy(() => import(\"./ParticlesPane\")") && layerSrc.includes("Suspense"), "tsparticles 整块 React.lazy（包装器会静态拖进 @tsparticles/engine，顶层 import = 主包变大）");
ok(particlesSrc.includes("fullScreen: { enable: false }"), "tsparticles fullScreen 已关（默认全屏劫持 body = 壁纸铺满整窗）");
ok(layerSrc.includes("vanta/dist/vanta.net.min.js") && layerSrc.includes("catch") && layerSrc.includes("destroy()"), "vanta 懒加载 + try/catch 静默降级 + destroy 清理（three 版本敏感，炸了不许白屏）");
ok(layerSrc.includes("prefers-reduced-motion") && layerSrc.includes("pattern"), "减动效偏好下粒子/3D 退回静态图案（accessibility 基本盘）");

/* ── 接线：挂载 + 设置段 ── */
ok(timeline.includes("<WallpaperLayer />"), "timeline-wrap 内挂了 <WallpaperLayer />（壁纸只透出在聊天区）");
ok(appearance.includes("WallpaperSettingsSection") && settingsSrc.includes("saveWallpaper") && settingsSrc.includes("chooseImages"), "外观页接了壁纸设置段（模式/图案/浓度/自定义图全部落到 saveWallpaper）");
ok(libSrc.includes("WALLPAPER_EVENT") && libSrc.includes("dispatchEvent") && layerSrc.includes("subscribeWallpaper") && settingsSrc.includes("subscribeWallpaper"), "配置变更经 CustomEvent 广播（设置页与壁纸层同源联动，不走 bag 不走 IPC）");

console.log(`\n【wp】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
