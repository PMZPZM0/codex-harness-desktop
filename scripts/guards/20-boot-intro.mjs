/**
 * 550C 开机动画判据（外观域 / boot550c，2026-10-11，纯离线、可随预检跑）
 *
 * 移植自 DSH 插件 dsh-550c-boot@0.3.3（MIT）。素材是**逐字移植**的，所以这里不验"动画好不好看"，
 * 只钉那些「看起来接好了，其实会出事」的接缝：
 *   ① 素材必须逐字（头注释留上游出处）—— 就地手改会让"与上游对账"失效；
 *   ② 四套配色的 CSS 在**增强层** ENHANCE_CSS 里（`:host([data-scheme=…])`），不能只搬 CSS_550C；
 *   ③ 增强层样式必须**排在移植 CSS 之后**注入（上游口径）—— 反了会被前者的 :host 变量盖掉；
 *   ④ 简易/完整两档的标记不能挂错（简易档挂上 APP_MARKUP 会让驱动找不到外壳元素）；
 *   ⑤ 跳过（点击 / Esc）与三条不播判据（关闭档 / 减弱动效 / 宠物浮窗）必须都在；
 *   ⑥ ⛔ logo 用 clip-path 描绘、**不给 logo path 设 transform** —— 连续缩放会让 GPU 每帧重采样
 *      大位图，壁纸/three 抢 GPU 时肉眼发糊（10-06 启动页实拍事故的因果面；弹窗上的 scale 不在此列）。
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log(`  ✗ 【bi】${m}`); } };

const read = (p) => readFileSync(join(ROOT, p), "utf8");
const libSrc = codeOnly(read("src/lib/boot-intro.mjs"));
const libDts = read("src/lib/boot-intro.d.mts");
const assets = read("src/features/settings-appearance/boot550c/assets.ts");
const showRaw = read("src/features/settings-appearance/boot550c/show.mjs");
const showSrc = codeOnly(showRaw);
const compSrc = codeOnly(read("src/features/settings-appearance/boot550c/BootIntro550c.tsx"));
const gateSrc = codeOnly(read("src/features/settings-appearance/boot550c/BootIntroGate.tsx"));
const rowSrc = codeOnly(read("src/features/settings-appearance/boot550c/BootIntroSettingsRow.tsx"));
const appearance = codeOnly(read("src/features/settings-appearance/AppearanceSettingsSection.tsx"));
const timeline = codeOnly(read("src/features/app-view/AppView/02-main-stage/01-timeline.tsx"));
const html = read("index.html");
const styles = read("src/styles.css");
const css = read("src/styles/36-boot-550c.css");
const notices = read("THIRD_PARTY_NOTICES.md");

/* ── 纯函数口径（档位）── */
ok(libSrc.includes('["simple", "full", "off"]'), "档位白名单 = simple/full/off");
ok(/BOOT_INTRO_DEFAULT_MODE = "full"/.test(libSrc), "默认档位 = full（用户 10-11 拍板）");
ok(libSrc.includes("BOOT_INTRO_MODES.includes(value) ? value : BOOT_INTRO_DEFAULT_MODE"), "非法档位一律回落默认（旧值 / null 不炸）");
ok(
  libSrc.includes('if (normalizeBootIntroMode(mode) === "off") return false') &&
    libSrc.includes("ctx.reducedMotion") &&
    libSrc.includes("ctx.petWindow"),
  "三条不播判据齐全：关闭档 / 减弱动效 / 宠物浮窗"
);
ok(libSrc.includes("BOOT_INTRO_STORAGE_KEY = \"boot-intro\""), "存储键 boot-intro（index.html 内联脚本写死了同名字面量，两处必须同源）");

/* ── 纯函数口径（配色）── */
ok(libSrc.includes('["amber", "green", "cyan", "white"]'), "配色白名单 = amber/green/cyan/white");
ok(/BOOT_INTRO_DEFAULT_SCHEME = "amber"/.test(libSrc), "默认配色 = 琥珀（原作者配色）");
ok(libSrc.includes('normalized === BOOT_INTRO_DEFAULT_SCHEME ? "" : normalized'), "琥珀返回空串（= 不设 data-scheme，上游没有 [data-scheme=\"amber\"] 块）");
ok(libDts.includes("normalizeBootIntroScheme") && libDts.includes("bootIntroSchemeAttr"), "类型面导出了配色归一与属性值");

/* ── 素材：逐字移植 + 齐全 ── */
ok(showSrc.includes("export function createShow"), "驱动导出 createShow（只加 export，其余逐字）");
ok(showRaw.includes("github.com/yannicksong0106/dsh-550c-boot") && showRaw.includes("Voidpoket"), "驱动头注释留了上游出处 + 原稿作者（可对账）");
ok(/assets\.ts/.test(showSrc) === false, "驱动不 import 资产（资产由挂载壳注入，契约同上游 createShow(stage)）");
ok(assets.includes("export const CSS_550C") && assets.includes("export const ENHANCE_CSS") && assets.includes("export const BOOT_MARKUP") && assets.includes("export const APP_MARKUP"), "四件资产齐全：CSS_550C / ENHANCE_CSS / BOOT_MARKUP / APP_MARKUP");
ok(assets.includes(":host") && assets.includes("#boot") && assets.includes("#final"), "CSS_550C 含 :host 变量 + logo 容器 + 完整档收尾 #final");
ok(assets.includes('data-scheme=\\"green\\"') && assets.includes('data-scheme=\\"cyan\\"') && assets.includes('data-scheme=\\"white\\"'), "ENHANCE_CSS 含三套非默认配色块（绿/青/白）—— 只搬 CSS_550C 会丢配色");
ok(assets.includes('id=\\"logo\\"'), "BOOT_MARKUP 含 logo（简易档的舞台）");
ok(assets.includes('id=\\"app\\"') && assets.includes('id=\\"mainBody\\"'), "APP_MARKUP 含 #app 外壳与 #mainBody 主终端（完整档的舞台）");

/* ── 挂载壳契约 ── */
ok(compSrc.includes("attachShadow") && compSrc.includes("host.shadowRoot ??"), "Shadow DOM 隔离 + StrictMode 复用 shadow root（二次 attachShadow 会抛）");
ok(
  compSrc.includes("createPortal") && compSrc.includes("document.body"),
  "宿主 portal 到 document.body（祖先的 transform / filter / backdrop-filter 会成为 containing block，把 fixed 从「相对视口」降级成「相对该祖先」——不 portal 出去就只盖住设置内容列，实测截图抓到过）"
);
ok(
  /useLayoutEffect\(\(\)\s*=>\s*\{[\s\S]{0,120}?hostRef\.current/.test(compSrc),
  "挂载用 useLayoutEffect（useEffect 在首帧绘制之后才跑 ⇒ 先闪一帧主界面再被片头盖住；用户实测报过）"
);
ok(compSrc.includes('mode === "full" ? BOOT_MARKUP + APP_MARKUP : BOOT_MARKUP'), "简易档只挂 BOOT_MARKUP、完整档追加 APP_MARKUP（挂反会让驱动找不到外壳元素）");
ok(
  compSrc.indexOf("style.textContent = CSS_550C") < compSrc.indexOf("enhance.textContent = ENHANCE_CSS"),
  "增强层样式排在移植 CSS 之后注入（上游口径；反了会被前者的 :host 变量盖掉）"
);
ok(compSrc.includes("show.cancel()") && compSrc.includes('event.key !== "Escape"') && compSrc.includes("event.stopPropagation()") && compSrc.includes('addEventListener("click"'), "点击 / Esc 跳过 ⇒ show.cancel() 主动 unwind；Esc 在捕获阶段 stopPropagation（不连带关掉底下的设置页）");
ok(compSrc.includes("bootIntroSchemeAttr") && compSrc.includes("host.dataset.scheme"), "配色经 host.dataset.scheme 生效（CSS 块按它选色）");
ok(showSrc.includes("clipPath") && !/\.style\.transform/.test(showSrc), "⛔ logo 用 clip-path 描绘、驱动不给 logo path 设 transform（缩放重采样 = 10-06 模糊事故）");

/* ── 启动接线 ── */
ok(
  gateSrc.includes("prefers-reduced-motion") && gateSrc.includes('get("pet")') && gateSrc.includes("readBootIntroMode"),
  "启动分派门读了三条判据（减弱动效 / 宠物浮窗 / 档位）"
);
ok(timeline.includes("<BootIntroGate") && !timeline.includes("<BootSplash"), "01-timeline 改走 BootIntroGate（不再直接渲染 BootSplash —— 否则片头根本没机会播）");
ok(appearance.includes("BootIntroSettingsRow"), "外观设置页渲染了「开机动画」行");
ok(styles.includes("styles/36-boot-550c"), "styles.css 已接入 36-boot-550c");
ok(rowSrc.includes("BOOT_INTRO_SCHEMES.map") && rowSrc.includes("BOOT_INTRO_MODES.map"), "设置行含档位三选一 + 配色四选一");

/* ── 首帧与层级 ── */
ok(
  html.includes('setAttribute("data-boot-intro"') && html.includes('getItem("boot-intro")') && html.includes("background: #050403"),
  "index.html 首帧：读 boot-intro 键 ⇒ setAttribute 打 data-boot-intro ⇒ 底色用动画自己的 #050403（断言锚代码形态，不锚注释）"
);
ok(html.includes('get("pet") === "1"') && html.includes("prefers-reduced-motion"), "首帧判定也带宠物浮窗与减弱动效（否则透明窗上会闪一块黑）");
ok(
  css.includes("position: fixed") && css.includes("z-index: 9999") && /\.boot550c-host\s*\{[^}]*background:\s*#050403/.test(css),
  "宿主 .boot550c-host 固定定位 + z-index 9999（压过主界面 / 设置 / 画布 / 模态）+ 底色与动画同色（内容未塞进去的那一瞬也不透出主界面）"
);

/* ── 署名 ── */
ok(
  notices.includes("dsh-550c-boot") && notices.includes("Voidpoket") && notices.includes("MIT"),
  "THIRD_PARTY_NOTICES 记了上游包名 / 原稿作者 / 许可"
);

console.log(`\n【bi】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
