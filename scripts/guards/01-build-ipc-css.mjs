/**
 * 预检守卫组：01-build-ipc-css
 * 分节：【1】【2】【3】（原 L229–L495）
 *
 * 09-22 从 scripts/check-preflight.mjs（8,997 行单文件）按域拆出，正文逐字未改；
 * 共享面由 ./_ctx.mjs 注入（同名导入）。动机：多路并行写者往同一文件加守卫会互相覆盖（已发生）。
 */
import {
  C, ROOT, existsSync, fail, join, mainSrc, ok, preloadSrc, readFileSync, readMainSource, readModuleWithDir, readStyles, readdirSync, topLevelKeys, typesPath, typesSrc, walk, warn,
} from "./_ctx.mjs";
import { spawnSync } from "node:child_process";
import { GEN_BEGIN, GEN_END, MANIFEST_PATH, PRELOAD_PATH, TYPES_PATH, generatePreloadRegion, generateTypesRegion, normalizeEol, regionOf } from "../lib/gen-ipc-core.mjs";

export async function run() {

  /* ══ 【1】原 L229–L259 ══ */
  {
console.log(C.bold("\n【1】构建产物"));

const distIndex = join(ROOT, "dist", "index.html");
const mainJs = join(ROOT, "dist-electron", "main.js");
const rendererOk = existsSync(distIndex);
const mainOk = existsSync(mainJs);
rendererOk ? ok("dist/index.html 存在") : fail("dist/index.html 缺失 —— 先 npm run build:vite");
mainOk ? ok("dist-electron/main.js 存在") : fail("dist-electron/main.js 缺失 —— 先 npm run build:electron");

if (rendererOk && mainOk) {
  const srcNewest = Math.max(0, ...walk(join(ROOT, "src"), [".ts", ".tsx", ".css", ".mjs"]).map((f) => f.mtime));
  const distFiles = walk(join(ROOT, "dist"), [".js", ".css", ".html"]);
  const distNewest = Math.max(0, ...distFiles.map((f) => f.mtime));

  const electronNewest = Math.max(0, ...walk(join(ROOT, "electron"), [".ts"]).map((f) => f.mtime));
  const mainOutNewest = Math.max(0, ...walk(join(ROOT, "dist-electron"), [".js"]).map((f) => f.mtime));

  if (srcNewest > distNewest) {
    const lag = ((srcNewest - distNewest) / 1000).toFixed(0);
    fail(`渲染层产物已过期：src/ 比 dist/ 新 ${lag}s —— 源码改了没重建，“没生效”多半就是这个`);
  } else {
    ok("渲染层产物新鲜（dist/ 不落后于 src/）");
  }

  if (electronNewest > mainOutNewest) {
    const lag = ((electronNewest - mainOutNewest) / 1000).toFixed(0);
    fail(`主进程产物已过期：electron/ 比 dist-electron/ 新 ${lag}s —— 需要 npm run build:electron`);
  } else {
    ok("主进程产物新鲜（dist-electron/ 不落后于 electron/）");
  }
}
  }

  /* ══ 【2】原 L263–L449 ══ */
  {
console.log(C.bold("\n【2】IPC 通道一致性（main.ts ↔ preload.ts ↔ vite-env.d.ts）"));

// ⛔ 架构改造期（09-21）：主进程代码正按域从 electron/main.ts 拆进 electron/features/**。
//    「按文件内容写」的断言若只读 main.ts，会在每次搬域时假红（不是功能退化，是代码搬走了）。
//    统一口径：readMainSource() = electron/main.ts + electron/features/** 下所有 .ts 的并集。
//    判据语义不变 —— 盯的是「这段主进程逻辑存在」，不关心落在哪个文件。
//    ⚠️ 负面断言（!/…/）因此变得更严格（范围为超集），是安全方向。
/* 09-22：VoiceCallFloat 的 1015 行状态/逻辑提成了同目录的 use-voice-call-float-state.tsx
   ⇒ 只读基文件 = 语音接线断言集体找不到代码（实测假红 13 项）。
   把「组件文件 + 同名子目录」当整体读，判据语义不变。 */
/* 09-22：VoiceSettingsSection 也拆成了「组件文件 + 同名子目录」（hook + 9 个子组件，10 文件）
   ⇒ 只读基文件 = 语音设置 UI 断言集体找不到代码（实测假红 5 项）。语义不变。 */



/**
 * 读「<relBase>.ts + 同名子目录 <relBase>/**.ts」的并集（09-22）。
 * ⛔ 起因：builtin-skills.ts 按技能切成 electron/builtin-skills/NN-skill-*.ts（纯数据搬迁）后，
 *    5 处直读单文件的断言立刻报 18 项 ✗（【58】【74】【75】【82】），
 *    而 build 通过、语句多重集逐字符一致 —— **是读取口径没跟上结构，不是内容退化**。
 *    判据语义不变：盯的是「这段技能正文存在」，不关心落在哪个文件。
 *    ⚠️ 这同时也是 **防静默失覆盖**：scripts/lib/config-scan.mjs 曾因同一原因让内置技能
 *    退出扫描，使【86】「内置技能零 critical/high」变成恒真（假绿）。
 */
/** 内置技能正文（含搬迁后的子文件）—— 供【58】【74】【75】【82】使用 */
/** Responses 协议桥源码（含搬迁后的 electron/responses-bridge/**）—— 供【72】【73】等使用 */

// ⛔ 架构改造期（09-21）：样式已从 src/styles.css 拆到 src/styles/**（19 个分节 + 入口 @import）。
//    只读单文件的断言会在拆分后集体假红（不是样式退化，是样式搬走了）。
//    统一口径：readStyles() = 入口 src/styles.css + src/styles/** 下所有 .css 的并集。
//    拼接顺序 = 分节文件名升序，与入口 @import 顺序、原文件行序三者一致 ⇒ 级联顺序不变。


if (!mainSrc || !preloadSrc) {
  warn("找不到 electron/main.ts 或 electron/preload.ts，跳过 IPC 检查");
} else {
  const collect = (src, re) => {
    const set = new Set();
    for (const m of src.matchAll(re)) set.add(m[2] ?? m[1]);
    return set;
  };
  const handlers = collect(mainSrc, /ipcMain\.(?:handle|on)\(\s*["'`]([^"'`]+)["'`]/g);
  const bridges = collect(preloadSrc, /ipcRenderer\.(?:invoke|send|sendSync)\(\s*["'`]([^"'`]+)["'`]/g);

  ok(`主进程 handler ${handlers.size} 个 / preload 桥接 ${bridges.size} 个`);

  // 高置信度死链：preload 发出，但主进程无 handler
  const deadLinks = [...bridges].filter((c) => !handlers.has(c));
  if (deadLinks.length) {
    fail(`preload 桥接到主进程没有 handler 的通道 ${deadLinks.length} 个：\n      ${deadLinks.join("\n      ")}`);
  } else {
    ok("无「preload 有、main 无」的死链");
  }

  // 主进程有 handler 但 preload 完全不提（可能是动态拼名，仅告警）
  const orphan = [...handlers].filter((c) => !preloadSrc.includes(c));
  if (orphan.length) {
    warn(`主进程注册但 preload 未出现的通道 ${orphan.length} 个（若为动态拼名可忽略）：\n      ${orphan.slice(0, 12).join("\n      ")}${orphan.length > 12 ? `\n      …另 ${orphan.length - 12} 个` : ""}`);
  } else {
    ok("所有 handler 都能在 preload 中找到引用");
  }

  // ---- window.codex 方法面：preload 暴露的 ↔ vite-env.d.ts 声明的 ----
  // 漏声明 = 桥接好了但渲染层调它没有类型（TS 报错或退化成 any）
  const sliceBetween = (src, startRe, endRe) => {
    const m = src.match(startRe);
    if (!m) return "";
    const from = m.index + m[0].length;
    const rest = src.slice(from);
    const e = rest.match(endRe);
    return e ? rest.slice(0, e.index) : rest;
  };

  const exposedBlock = sliceBetween(preloadSrc, /exposeInMainWorld\(\s*["'`]codex["'`]\s*,\s*\{/, /\n\}\);/);
  const exposed = topLevelKeys(exposedBlock);

  const typedBlock = sliceBetween(typesSrc, /interface Window\s*\{\s*codex\s*:\s*\{/, /\n\s{2}\};/);
  const typed = topLevelKeys(typedBlock);

  if (!exposed.size || !typed.size) {
    warn(`无法解析 window.codex 方法面（preload 解析到 ${exposed.size} 个、类型解析到 ${typed.size} 个），跳过`);
  } else {
    ok(`window.codex 方法面：preload 暴露 ${exposed.size} 个 / 类型声明 ${typed.size} 个`);

    // 渲染层实际调用了哪些 window.codex.* —— 只有「真在用」的方法缺类型才算硬失败
    const usedInRenderer = new Set();
    for (const f of walk(join(ROOT, "src"), [".ts", ".tsx"])) {
      const src = readFileSync(f.path, "utf8");
      for (const m of src.matchAll(/window\.codex\.(\w+)/g)) usedInRenderer.add(m[1]);
    }

    const notTyped = [...exposed].filter((m) => !typed.has(m));
    const breaking = notTyped.filter((m) => usedInRenderer.has(m));
    const redundant = notTyped.filter((m) => !usedInRenderer.has(m));

    if (breaking.length) {
      fail(`渲染层在用、但 vite-env.d.ts 未声明的方法 ${breaking.length} 个（调用处会失去类型）：\n      ${breaking.join(", ")}`);
    } else {
      ok("渲染层调用的每个方法都有类型声明");
    }
    if (redundant.length) {
      warn(`preload 暴露但渲染层从未调用、类型也未声明的方法 ${redundant.length} 个（疑似冗余桥接，可清理）：\n      ${redundant.join(", ")}`);
    } else {
      ok("无未被使用的多余桥接方法");
    }

    const notExposed = [...typed].filter((m) => !exposed.has(m));
    if (notExposed.length) {
      warn(`类型声明了但 preload 未暴露的方法 ${notExposed.length} 个（疑似残留声明）：\n      ${notExposed.slice(0, 12).join(", ")}`);
    } else {
      ok("类型声明无多余方法");
    }
  }

  /* ══ 【2】加（09-23）：gen-ipc-bridge 单一真相源 ════════════════════
     manifest 是 preload invoke 方法与 d.ts 签名的唯一来源，两个生成物必须与它逐字节一致。
     ⛔ 改了 manifest 忘跑 `npm run gen:ipc`、或手改生成物，都会在这里红。 */
  {
    const manifestOk = existsSync(MANIFEST_PATH);
    (manifestOk ? ok : fail)("【2】存在 electron/ipc-channels.manifest.json（IPC 桥单一真相源）");
    if (manifestOk) {
      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
      (Array.isArray(manifest.channels) && manifest.channels.length === manifest.count ? ok : fail)(
        `【2】manifest channels 数与 count 一致（${manifest.channels?.length} vs ${manifest.count}）`
      );
      (existsSync(PRELOAD_PATH) && normalizeEol(regionOf(readFileSync(PRELOAD_PATH, "utf8"))) === normalizeEol(generatePreloadRegion(manifest.channels)) ? ok : fail)(
        "【2】preload.ts gen 内联段与 manifest 逐字节一致（改了 manifest 就跑 npm run gen:ipc）"
      );
      /* ⛔ 沙箱化 preload 不许 require 相对模块（09-23 白屏事故根因：生成物放独立文件
         preload.generated.ts ⇒ preload 加载失败 ⇒ window.codex 不存在）⇒ 钉死「自包含单文件」 */
      const preloadNow = readFileSync(PRELOAD_PATH, "utf8");
      const runtimeRel = preloadNow.match(/^import (?!type )[^\n]*from ["']\.\//m);
      (!runtimeRel ? ok : fail)(
        `【2】preload.ts 无运行时相对 import（沙箱 preload 加载不了相对模块；实得：${runtimeRel ? runtimeRel[0].trim() : "无"}）`
      );
      (!existsSync(join(ROOT, "electron", "preload.generated.ts")) ? ok : fail)(
        "【2】废弃的独立生成文件 preload.generated.ts 不许回来（两文件形态在沙箱下必炸）"
      );
      const typesNow = readFileSync(TYPES_PATH, "utf8");
      const ga = typesNow.indexOf(GEN_BEGIN), gb = typesNow.indexOf(GEN_END);
      (ga >= 0 && gb > ga && normalizeEol(typesNow.slice(ga, gb + GEN_END.length)) === normalizeEol(generateTypesRegion(manifest.channels)) ? ok : fail)(
        "【2】vite-env.d.ts 生成段与 manifest 逐字节一致"
      );
      const regSrc = readFileSync(join(ROOT, "electron", "ipc-registry.ts"), "utf8");
      const regCh = new Set([...regSrc.matchAll(/["']([\w-]+(?::[\w-]+)+)["']/g)].map((x) => x[1]));
      const unregistered = [...new Set(manifest.channels.map((c) => c.channel))].filter((c) => !regCh.has(c));
      (unregistered.length === 0 ? ok : fail)(
        `【2】manifest 频道全部在 ipc-registry 登记（未登记 ${unregistered.length} 个：${unregistered.slice(0, 6).join(", ")}）`
      );
      /* ── 【153】（09-25）：宿主接口清单技能与 manifest 同步（用户：「让 Codex 知道，不用一个个去扫」）──
         技能正文由 scripts/gen-capability-skill.mjs 从 manifest+registry 生成（⛔ 正文必须字面量，【86】），
         gen:ipc 已挂钩顺带重生成。这里真跑生成器 --check，比对落盘技能是否过期。 */
      try {
        const r = spawnSync(process.execPath, [join(ROOT, "scripts", "gen-capability-skill.mjs"), "--check"], { encoding: "utf8", timeout: 60000 });
        if (r.error && r.error.code === "EBUSY") {
          warn("【153】沙箱拒绝 spawnSync（EBUSY）⇒ 跳过比对（宿主跑 npm run check 才是真判据）");
        } else {
          (r.status === 0 ? ok : fail)("【153】harness-api 技能与 manifest/registry 一致（过期就重跑 npm run gen:ipc）");
        }
      } catch (error) {
        fail(`【153】生成器 --check 跑不了：${error?.message ?? error}`);
      }
      const skillEntrySrc = readFileSync(join(ROOT, "electron", "builtin-skills.ts"), "utf8");
      (skillEntrySrc.includes('"harness-api"') && skillEntrySrc.includes("HARNESS_API_SKILL") ? ok : fail)("【153】harness-api 技能已登记进 builtin-skills（漏登记 = 引擎永远看不到清单）");
      /* ── IPC 强化层（09-24）：invoke 走 __ipc（校验/归一化/超时表）、订阅走 __on（幂等+精确退订）── */
      const hardSrc = readFileSync(join(ROOT, "electron", "preload.ts"), "utf8");
      (/function __ipc\(/.test(hardSrc) ? ok : fail)("【2】__ipc 辅助存在（arity 前置校验 + 错误归一化 + 超时表）");
      (/function normalizeIpcError\(/.test(hardSrc) && /ERR_NO_HANDLER/.test(hardSrc) ? ok : fail)("【2】invoke 错误归一化成结构化 code（ERR_NO_HANDLER/ERR_UNCLONABLE/…）");
      (/const IPC_TIMEOUT_MS/.test(hardSrc) ? ok : fail)("【2】通道级超时表存在（默认空 = 零行为变化，需超时的通道在此登记）");
      (/function __on</.test(hardSrc) ? ok : fail)("【2】__on 幂等订阅封装存在（同 (通道,监听引用) 只注册一次）");
      /* ⛔ 判据要落在**代码**上：注释里出现 `removeAllListeners` 字样（讲这个坑）不算违规 */
      const hardCode = hardSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      (!/removeAllListeners/.test(hardCode) ? ok : fail)("【2】preload 不许再 removeAllListeners（会误伤同通道其他订阅者）");
      (/=> __ipc\(/.test(preloadSrc) ? ok : fail)("【2】生成段 invoke 统一走 __ipc（不许退回直连 ipcRenderer.invoke）");
      /* 手写面收敛（09-24）：64 条手写 invoke 已迁进 manifest（251 → 315 条）。
         `ipcRenderer.invoke(` 只允许出现在 __ipc 内部那一处；voiceAudio 走 send（fire-and-forget），另计。 */
      const invokeCalls = (hardCode.match(/ipcRenderer\.invoke\(/g) || []).length;
      (invokeCalls <= 1 ? ok : fail)(`【2】手写 invoke 已全量收敛（实得直调 ${invokeCalls} 处，只允许 __ipc 内部 1 处）`);
      (manifest.channels.length >= 315 ? ok : fail)(`【2】manifest 条目数不得回退（实得 ${manifest.channels.length}，迁入后基线 315）`);
      /* 跨 contextBridge 会丢自定义字段（真机实测 e.code === undefined）⇒ 渲染层必须有解析入口 */
      const ipcErrSrc = readFileSync(join(ROOT, "src", "lib", "ipc-error.mjs"), "utf8");
      (/export function ipcErrorCodeOf/.test(ipcErrSrc) ? ok : fail)("【2】渲染层有 ipcErrorCodeOf（跨桥丢 e.code 后的唯一解析入口）");
      (/\\\[\(ERR_\[A-Z_\]\+\)\\\]/.test(ipcErrSrc) ? ok : fail)("【2】错误码写在消息前缀 [ERR_*]（跨进程后仍可读）");
      (/\[ERR_/.test(hardCode) || /\[\\\$\{code\}\]/.test(hardCode) ? ok : fail)("【2】preload 侧错误消息确实带 [ERR_*] 前缀");
      /* ── 主题注册表（09-24）：多主题扩展结构 ── */
      const themesSrc = readFileSync(join(ROOT, "src", "lib", "themes.ts"), "utf8");
      (/export const THEMES/.test(themesSrc) && /normalizeThemeId/.test(themesSrc) ? ok : fail)("【2】主题注册表存在（THEMES + normalizeThemeId 兜底脏值）");
      const appearSrc = readFileSync(join(ROOT, "src", "features", "settings-appearance", "AppearanceSettingsSection.tsx"), "utf8");
      (/THEMES\.map\(/.test(appearSrc) && !/theme === "light" \? "active"/.test(appearSrc) ? ok : fail)("【2】外观页主题按钮由注册表渲染（不许再手写 light/dark 两份）");
      (/normalizeThemeId\(localStorage\.getItem\("theme"\)\)/.test(readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part02", "03-thread-switch-update", "01-thread-switch-system-events.tsx"), "utf8")) ? ok : fail)("【2】主题初始化过 normalizeThemeId（localStorage 脏值兜底）");
      /* ── 任务栏图标 / AUMID（09-24：用户报「任务栏图标又变成默认的 Electron 原子图标」）──
         Windows 靠 AUMID 把运行中的进程与某个**注册了同一 AUMID 的快捷方式**配对，配对成功任务栏才
         取我们的 build/icon.ico；否则回退 electron.exe 的原子图标（dev 形态必然如此）。
         ⛔ 所以 dev 与打包必须各用一个 id，且都能被对应快捷方式注册（dev = .dev 后缀）。 */
      const mainNow = readFileSync(join(ROOT, "electron", "main.ts"), "utf8");
      (/app\.setAppUserModelId\(app\.isPackaged \? "com\.codexharness\.desktop" : "com\.codexharness\.desktop\.dev"\)/.test(mainNow) ? ok : fail)(
        "【2】AUMID 按 dev/打包分叉设置（dev 用 .dev 后缀，与桌面快捷方式注册值一致 —— 否则任务栏回落原子图标）"
      );
      (/app\.setAppUserModelId\("com\.codexharness\.desktop\.dev"\)/.test(mainNow) || /"com\.codexharness\.desktop\.dev"/.test(mainNow) ? ok : fail)(
        "【2】dev AUMID 常量存在（缺了就等于没有 dev 图标）"
      );
      const iconPath = join(ROOT, "build", "icon.ico");
      const iconOk = existsSync(iconPath) && (() => {
        const b = readFileSync(iconPath);
        return b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0;   // ICO 魔数
      })();
      (iconOk ? ok : fail)("【2】build/icon.ico 存在且是合法 ICO（坏文件会让窗口/任务栏回退默认图标）");
      const wfSrc = readFileSync(join(ROOT, "electron", "features", "window-factory.ts"), "utf8");
      (/icon: existsSync\(windowIcon\) \? windowIcon : undefined/.test(wfSrc) && /app\.getAppPath\(\)/.test(wfSrc) ? ok : fail)(
        "【2】窗口图标锚 app.getAppPath()（⛔ 不许用 __dirname —— 09-21 搬进 features/ 时曾把图标路径打歪）"
      );
    }
  }
}
  }

  /* ══ 【3】原 L453–L495 ══ */
  {
console.log(C.bold("\n【3】CSS 类覆盖（静态字面量，仅告警）"));

const stylesEntry = join(ROOT, "src", "styles.css");
if (!existsSync(stylesEntry)) {
  warn("找不到 src/styles.css，跳过");
} else {
  const css = readStyles();
  const cssClasses = new Set();
  for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) cssClasses.add(m[1]);

  // ⛔ 合法样式来源不止 styles.css（09-22：这条告警长期挂着 3 个假阳性）：
  //  ① index.html 的 <style>：启动闪屏样式必须先于 React 生效，只能写在 HTML 里
  //  ② scripts/** 里被当 CDP 选择器锚点引用的类名 —— 规则 §4.4 允许「明确的 JS 锚点用途」
  const scriptAnchors = new Set();
  {
    const htmlEntry = join(ROOT, "index.html");
    if (existsSync(htmlEntry)) {
      const html = readFileSync(htmlEntry, "utf8");
      for (const m of html.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) cssClasses.add(m[1]);
    }
    for (const f of walk(join(ROOT, "scripts"), [".mjs", ".cjs"])) {
      for (const m of readFileSync(f.path, "utf8").matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) scriptAnchors.add(m[1]);
    }
  }

  const tsxFiles = walk(join(ROOT, "src"), [".tsx", ".ts"]);
  const usedClasses = new Set();
  for (const f of tsxFiles) {
    const src = readFileSync(f.path, "utf8");
    // 只取 className="..." / className='...' 这种纯字面量，避开模板拼接的动态类
    for (const m of src.matchAll(/className=(?:"([^"]*)"|'([^']*)')/g)) {
      const raw = m[1] ?? m[2] ?? "";
      for (const c of raw.split(/\s+/)) if (c && !c.includes("$")) usedClasses.add(c);
    }
  }

  const missing = [...usedClasses].filter((c) => !cssClasses.has(c) && !scriptAnchors.has(c));
  if (missing.length) {
    warn(`有 ${missing.length} 个 JSX 类名在 styles.css 里找不到规则（可能是父选择器承载 / 动态变体，需人眼判定）：\n      ${missing.slice(0, 25).join(", ")}${missing.length > 25 ? ` …另 ${missing.length - 25} 个` : ""}`);
  } else {
    ok(`全部 ${usedClasses.size} 个静态类名在 styles.css 均有规则`);
  }
}
  }
}
