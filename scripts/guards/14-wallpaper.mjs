/**
 * 应用壁纸判据（wallpaper 域，2026-10-05，纯离线、可随预检跑）
 *
 * ⛔ 三条铁律（都是"看起来接好了、其实会出事"的接缝）：
 *   ① 壁纸层必须 pointer-events:none + z-index:-1 —— 纯视觉层永不挡交互、永不盖内容；
 *   ② tsparticles 的 fullScreen 必须关 —— 默认全屏会劫持 body，壁纸只属于聊天区；
 *   ③ 星野是**自绘 canvas**、点之间**零连线**（用户 10-11：「黑夜→星空、白天→动态点，点不要连线」；
 *      原 vanta NET 只能画"点+连线"的网 ⇒ 整体退役，负向断言防复活）。
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
const part08 = codeOnly(read("src/features/app-state/parts/part08/01-seg.tsx"));
const core = read("dist-electron/features/dispatch-core.js");
const rpc = read("dist-electron/features/dispatch-rpc.js");
const preload = read("dist-electron/preload.js");

/* ── 数据面 ── */
ok(libSrc.includes("off") && libSrc.includes("particles") && libSrc.includes("stars") && libSrc.includes("custom"), "模式注册表含 off/pattern/particles/stars/custom（归一化白名单）");
ok(libSrc.includes('r.mode === "vanta" ? "stars"'), "旧值 vanta 迁移到 stars（老档案里存着 vanta 的用户不会突然没壁纸）");
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
ok(layerSrc.includes("wallpaper-stars") && layerSrc.includes('getContext("2d")') && layerSrc.includes("ResizeObserver"), "星野 = 自绘 2D canvas（铺满 + 跟随容器尺寸），不依赖第三方引擎");
ok(!/(moveTo|lineTo|stroke)\(/.test(layerSrc), "⛔ 点之间不画任何连线（用户 10-11「黑点直接不要连线」）—— canvas 绘制里不许出现 moveTo/lineTo/stroke");
ok(!/vanta/.test(layerSrc) && !/"three"/.test(layerSrc), "vanta / three 整体退役且不许复活（它只能画「点+连线」的网；负向）");
ok(layerSrc.includes("prefers-reduced-motion") && layerSrc.includes("pattern"), "减动效偏好下粒子/3D 退回静态图案（accessibility 基本盘）");

/* ── 主题色适配（10-11 用户实测：「3D 背景跟自定义的主题有些没做主题色适配，太丑了」）──
   ⛔ 三条都是"看着能跑、其实切主题就露馅"的接缝，静态断言正是它们唯一的防线。 */
ok(cssSrc.includes(':root[data-theme="dark"] .wallpaper-custom::after'), "自定义图/精选渐变的「雾」按主题分档（深色主题压更狠 —— 浅色壁纸在深色界面下会把主内容区整片染亮，侧栏顶栏却是黑的）");
ok((layerSrc.match(/attributeFilter: \["data-theme"\]/g) ?? []).length >= 1 && layerSrc.includes('readHex("--text"'), "星野跟随主题：监听 data-theme 重绘 + 颜色取 --text（浅色=深色点 / 深色=浅色星）");
ok(layerSrc.includes("prefersReducedMotion()") && layerSrc.includes("if (motion && !disposed)"), "减动效偏好下星野只画一帧、不起 rAF（accessibility）");
ok(
  layerSrc.includes('addEventListener("mousemove"') &&
    layerSrc.includes("curX += (targetX - curX)") &&
    layerSrc.includes('removeEventListener("mousemove"'),
  "星野跟鼠标动（缓动视差 + 纵深系数）+ 卸载时摘监听（用户 10-11「都要动态星空、跟着鼠标动，不是静态的」）"
);
ok(
  /Math\.max\(120,\s*Math\.min\(3000/.test(layerSrc) && layerSrc.includes("dark ? 1000 : 1600"),
  "星野密度按面积自适应且有下限（用户 10-11「星空太差了、太少了」——首版 1280×800 才 51 颗，不像星空）；上限 3000 让「比例」滑杆全量程有效（1600 时 300% 会被截）"
);
ok(layerSrc.includes("bright") && /Math\.random\(\) < 0\.08/.test(layerSrc), "约 8% 亮星做层次（全是均匀细点看着像噪点、不像星空）");
ok(
  settingsSrc.includes('cfg.mode === "stars"') && settingsSrc.includes("starScale") && /min=\{20\}[\s\S]{0,120}?max=\{300\}/.test(settingsSrc),
  "星空档有「比例」滑杆（20%~300%，默认 100%）—— 用户 10-11「星空加一个比例拉动板块」"
);
ok(
  libSrc.includes("starScale") && layerSrc.includes("scale / 100") && layerSrc.includes("StarfieldPane scale={cfg.starScale}"),
  "比例真正作用到密度（不是摆设）：密度 = 面积基线 × 比例/100"
);
ok(!/const color = accentHex\(\)/.test(particlesSrc) && particlesSrc.includes("useThemeColor()"), "粒子档接上 useThemeColor()（原来那个 hook 是死代码 —— 挂载取一次色，切主题不换色）");

/* ── 接线：挂载 + 设置段 ── */
// ⛔ 10-06 铺满全应用：挂载点从 timeline-wrap 上移到 app-shell 根（fixed 铺满视口）。
ok(appView.includes("<WallpaperLayer />") && !timeline.includes("<WallpaperLayer />"), "WallpaperLayer 挂在 AppView 根（app-shell 内铺满全应用；timeline 内旧挂载已撤）");
ok(cssSrc.includes(".app-shell { isolation: isolate; }") && cssSrc.includes("position: fixed"), "app-shell 是堆叠上下文 + 层 fixed 铺满（负 z 层画在 shell 背景上、内容下）");
ok(cssSrc.includes(':root[data-wallpaper="on"] .app-shell') && cssSrc.includes(':root[data-wallpaper="on"] .composer') && cssSrc.includes(':root[data-wallpaper="on"] .workspace') && cssSrc.includes(':root[data-wallpaper="on"] .sidebar'), "data-wallpaper 驱动表面透明化（app-shell/workspace 透明 + composer/sidebar 半透明，漏一层 = 一块白底，10-06 真机遍历抓出）");
ok(appearance.includes("WallpaperSettingsSection") && settingsSrc.includes("saveWallpaper") && settingsSrc.includes("chooseImages"), "外观页接了壁纸设置段（模式/图案/浓度/自定义图全部落到 saveWallpaper）");
ok(libSrc.includes("WALLPAPER_EVENT") && libSrc.includes("dispatchEvent") && layerSrc.includes("subscribeWallpaper") && settingsSrc.includes("subscribeWallpaper"), "配置变更经 CustomEvent 广播（设置页与壁纸层同源联动，不走 bag 不走 IPC）");
ok(layerSrc.includes("dataset.wallpaper"), "层挂载时驱动 data-wallpaper 属性（CSS 透明化的开关必须来自真实挂载状态）");

/* ── 拓展接口：Codex 自助做壁纸（10-06 用户「留好拓展接口，Codex 自己也能给自己做壁纸」）── */
ok(core.includes('"wallpaper_set"') && /wallpaper_set/.test(core), "网关有 wallpaper_set（免改码拓展接口：生图→写工作区→设壁纸）");
ok(rpc.includes('"wallpaper:apply"') && /isInsideTrustedRoots/.test(rpc.slice(rpc.indexOf('"wallpaper_set"'), rpc.indexOf('"wallpaper_set"') + 1600)), "wallpaper_set 执行端：路径过可信根闸 → sendToWindow(wallpaper:apply)");
ok(preload.includes("onWallpaperApply") && preload.includes('"wallpaper:apply"'), "preload 推送桥 onWallpaperApply → wallpaper:apply（手写桥）");
ok(layerSrc.includes("onWallpaperApply") && layerSrc.includes("saveWallpaper"), "壁纸层接 apply 推送并落 saveWallpaper（与设置页同一条链路）");
ok(part08.includes("wallpaper_set"), "harness_tools 网关描述列了 wallpaper_set（模型读不到 list 就靠这段常驻文本）");

/* ── ？号制作教程：提示词卡 + 一键复制 ── */
ok(settingsSrc.includes("GUIDE_PROMPTS") && (settingsSrc.match(/title: "/g) ?? []).length >= 4, "教程含 ≥4 类制作提示词（渐变/图案/图片/动效调参）");
ok(settingsSrc.includes("copyTextToClipboard") && settingsSrc.includes("复制提示词"), "每条提示词带一键复制（用户点名「支持复制提示词」）");
ok(settingsSrc.includes("WALLPAPER_SET_HINT") || settingsSrc.includes("wallpaper_set"), "教程提到 wallpaper_set（Codex 自助设壁纸的接口要在教程里可发现）");

console.log(`\n【wp】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
