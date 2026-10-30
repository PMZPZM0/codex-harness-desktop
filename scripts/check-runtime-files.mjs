#!/usr/bin/env node
/**
 * 【288】打包后「运行时读的文件」是否真的进了包。
 *
 * ⛔⛔ 为什么要有它（10-30 真机事故，v0.0.51 用户装了打不开）：
 *   打包白名单 `build.files` 只列了 dist/dist-electron/src/lib/build 的几个文件，而运行时还在读
 *   别的东西。凡是「开发机仓里存在、asar 里没有」的路径，本地一切正常、`npm run check` 全绿，
 *   只有**装完的用户**会崩或功能静默失效。已实证的三类：
 *     ① `require("../../scripts/lib/tools-versions.cjs")` —— 启动即崩（Cannot find module）；
 *     ② `path.join(app.getAppPath(), "build", iconName)` —— icon.ico / icon.png 没进包 ⇒ 图标回落默认；
 *     ③ `path.join(app.getAppPath(), "electron", "declared-plugins")` —— 内置插件清单读不到（静默空）。
 *
 * 判据：源码里所有**字面量**的
 *   · `path.join(app.getAppPath(), …)`（打包后 = asar 根）
 *   · `path.join(__dirname, …)`（换算成编译后的 dist-electron 位置再上溯）
 * 必须被 `build.files` 覆盖；`process.resourcesPath` 的引用必须在 `extraResources`（Windows）
 * 或 `build/copy-mac-tools.cjs` 的复制清单（mac）里。
 *
 * ⛔ 允许例外，但必须**写进 KNOWN_OPTIONAL 并给理由** —— 不许靠"它反正有兜底"口头豁免。
 *
 * 用法：node scripts/check-runtime-files.mjs   （已接进 npm run check）
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname, resolve, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = normalize(dirname(fileURLToPath(import.meta.url)) + "/..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const includePatterns = ((pkg.build && pkg.build.files) || [])
  .filter((p) => !String(p).startsWith("!"))
  .map((p) => String(p).replace(/\\/g, "/"));

let okCount = 0, failCount = 0;
const ok = (m) => { okCount++; console.log("  ✓ " + m); };
const fail = (m) => { failCount++; console.log("  ✗ " + m); };

const globToRe = (glob) =>
  new RegExp("^" + String(glob)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\/?/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*") + "$");
const packaged = (relPath) => {
  const p = relPath.replace(/\\/g, "/");
  return includePatterns.some((pat) => {
    if (globToRe(pat).test(p)) return true;
    // `dir/**` 同时覆盖 dir 本身与任意子文件
    const base = pat.replace(/\/\*\*$/, "");
    return base !== pat && (p === base || p.startsWith(base + "/"));
  });
};

/**
 * 允许「不打包」的引用（每条都要有理由；新增条目必须说清为什么不会失效）。
 * 键 = 仓内相对路径（`*` 为通配）。
 */
const KNOWN_OPTIONAL = [
  // 动态拼的安装脚本名（install-runtimes.cjs 等）：打包版由 extraResources 放到 resources/tools 下，
  // 这条只是开发态回退，读不到就走 resourcesPath 那条。
  ["scripts/*", "开发态回退路径；打包版走 resourcesPath/tools（extraResources 已带 install-*.cjs）"],
  // kb-embedding 的历史内置位置：现行主路径是 process.resourcesPath/tools/kb-embedding。
  ["resources/tools/kb-embedding", "legacy 兜底；主路径 resourcesPath/tools/kb-embedding"],
  // toolchain.ts 的三元：isPackaged ? resourcesPath/tools : getAppPath/resources/tools
  // 只有开发态走这一侧；打包态由 ③（resourcesPath）负责，已在 extraResources + afterPack 双端核对。
  ["resources/tools", "仅开发态分支（app.isPackaged 为 false）；打包态走 resourcesPath/tools"],
];
const optional = (relPath) =>
  KNOWN_OPTIONAL.find(([pat, why]) => globToRe(pat).test(relPath.replace(/\\/g, "/")) && why);

const walk = (dir) => {
  const out = [];
  (function w(d) {
    let items = [];
    try { items = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of items) {
      const p = join(d, e.name);
      if (e.isDirectory()) w(p);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(p);
    }
  })(dir);
  return out;
};

/** 从源码片段里取出「全是字面量」的路径段；含插值就返回 null（动态路径本守卫覆盖不到）。 */
const literalSegments = (tail) => {
  const segs = [];
  const re = /"([^"]*)"|'([^']*)'/g;
  let m;
  while ((m = re.exec(tail))) segs.push(m[1] ?? m[2]);
  // 出现 `${` / 反引号 / 变量名 ⇒ 动态，跳过
  if (/[`$]/.test(tail.replace(/"[^"]*"|'[^']*'/g, ""))) return null;
  if (/\b[A-Za-z_$][\w$]*/.test(tail.replace(/"[^"]*"|'[^']*'/g, ""))) return null;
  return segs;
};

const sources = walk(join(ROOT, "electron"));
const appPathMiss = new Map();   // 需要进 asar 但没进
const resMiss = new Map();       // 需要进 resources 但 extraResources/afterPack 没带

/* extraResources 的 `to` 前缀（Windows 侧）；mac 侧看 copy-mac-tools.cjs 的复制清单。 */
const resTargets = ((pkg.build && pkg.build.extraResources) || [])
  .map((e) => String(e.to || "").replace(/\\/g, "/"))
  .filter(Boolean);
const macCopySrc = readFileSync(join(ROOT, "build", "copy-mac-tools.cjs"), "utf8");
const macCopies = (segment) =>
  macCopySrc.includes(`"${segment}"`) || macCopySrc.includes(`'${segment}'`) || resTargets.includes(segment);

let appRefs = 0, resRefs = 0;
for (const file of sources) {
  const relTs = relative(ROOT, file).replace(/\\/g, "/");
  const compiledDir = "dist-electron/" + dirname(relTs.replace(/^electron\//, ""));
  const src = readFileSync(file, "utf8");
  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    /* ① app.getAppPath() 之后的字面量段 */
    const appM = /path\.(?:join|resolve)\(\s*app\.getAppPath\(\)\s*,([^)]*)/.exec(line);
    if (appM) {
      const segs = literalSegments(appM[1]);
      if (segs && segs.length) {
        appRefs++;
        const relPath = normalize(segs.join("/")).replace(/\\/g, "/");
        const why = optional(relPath);
        if (!packaged(relPath) && !why) {
          const key = relPath;
          if (!appPathMiss.has(key)) appPathMiss.set(key, new Set());
          appPathMiss.get(key).add(relTs + ":" + (i + 1));
        }
      }
    }
    /* ② __dirname 上溯（换算到编译后位置） */
    const dirM = /path\.(?:join|resolve)\(\s*__dirname\s*,([^)]*)/.exec(line);
    if (dirM) {
      const segs = literalSegments(dirM[1]);
      if (segs && segs.length) {
        appRefs++;
        const relPath = normalize(join(compiledDir, ...segs)).replace(/\\/g, "/");
        const why = optional(relPath);
        if (!packaged(relPath) && !why) {
          if (!appPathMiss.has(relPath)) appPathMiss.set(relPath, new Set());
          appPathMiss.get(relPath).add(relTs + ":" + (i + 1));
        }
      }
    }
    /* ③ process.resourcesPath 之后的字面量段 */
    const resM = /path\.(?:join|resolve)\(\s*process\.resourcesPath[^,]*,\s*([^)]*)/.exec(line);
    if (resM) {
      const segs = literalSegments(resM[1]);
      if (segs && segs.length) {
        resRefs++;
        const first = segs[0].replace(/\\/g, "/");
        if (!macCopies(first)) {
          if (!resMiss.has(first)) resMiss.set(first, new Set());
          resMiss.get(first).add(relTs + ":" + (i + 1));
        }
      }
    }
  });
}

if (appPathMiss.size === 0) ok(`asar 内的 ${appRefs} 处运行时路径引用都被 build.files 覆盖`);
else {
  fail(`有 ${appPathMiss.size} 处运行时路径**没进包**（装完会崩或静默失效）：`);
  for (const [relPath, where] of appPathMiss) {
    console.log("      " + relPath + "  ← " + [...where].join(", "));
  }
  console.log("\n  修法：加进 package.json 的 build.files（照 `build/tray.png` / `src/lib/*.mjs` 那几行），");
  console.log("  或把这份数据搬进 dist-electron 变成编译产物。⛔ 本地能读到不算数 —— 用户装的是 asar。");
}

if (resMiss.size === 0) ok(`resources 目录的 ${resRefs} 处引用 Windows(extraResources) / mac(afterPack) 都带上了`);
else {
  fail(`有 ${resMiss.size} 处 resources 引用**两端至少一端没带**：`);
  for (const [seg, where] of resMiss) console.log("      resources/" + seg + "  ← " + [...where].join(", "));
  console.log("\n  修法：Windows 加 extraResources；mac 加进 build/copy-mac-tools.cjs 的复制清单。");
}

/* ④ 动态文件名补一条显式断言：窗口/宠物图标走 `path.join(app.getAppPath(), "build", iconName)`，
     文件名是变量（`icon.ico` / `icon.png`），静态扫描抓不到 ⇒ 这里按「两个平台的图标都得在包里」钉死。
     10-30 实证：两个文件都在仓里、都不在白名单，打包后窗口图标回落 Electron 默认（历史同类事故复发）。 */
const icons = ["build/icon.png", "build/icon.ico"];
(icons.every((f) => packaged(f)) ? ok : fail)(
  "【288】build/icon.png + build/icon.ico 都进包（运行时按平台取，动态名静态扫不到 —— 这条是显式补的）"
);

/* ⑤ mac 侧的 resources 布局必须与 Windows 对齐：
      mac 的 extraResources 是空数组（避免 builder 过滤 node_modules），全靠 afterPack 复制。
      ⇒ `build/copy-mac-tools.cjs` 必须同时带：tools 整树、expert-skills、voice-presets、安装脚本、
      以及**按 package.json 文件级 extraResources 逐条补齐**（10-30 实证：video-providers.mjs 两端不一致）。 */
const macOk = /resources\/tools/.test(macCopySrc) || /"tools"\)/.test(macCopySrc);
(macOk ? ok : fail)("【288】mac afterPack 会复制 resources/tools 整树（工具链的唯一来源）");
(["expert-skills", "voice-presets"].every((n) => macCopySrc.includes(`"${n}"`)) ? ok : fail)(
  "【288】mac afterPack 会补齐 expert-skills / voice-presets（extraResources 为空数组，不补就全空）"
);
(/build\.extraResources|extraResources/.test(macCopySrc) && /require\("\.\.\/package\.json"\)/.test(macCopySrc) ? ok : fail)(
  "【288】mac afterPack 按 package.json 的**文件级** extraResources 逐条补齐（⛔ 删了这条，mac 会缺 src/lib/*.mjs 这类同源文件）"
);
(["install-runtimes.cjs", "install-automation.cjs"].every((n) => macCopySrc.includes(`"${n}"`)) ? ok : fail)(
  "【288】mac afterPack 带上安装脚本（缺了「开发工具」页所有安装动作秒失败）"
);


/* ⑥ 10-30 Windows 真机事故（0.0.51 装了打不开）：版本表在**顶层裸 require**，文件没进 asar ⇒ 主进程启动即死。
     两条都要钉：① 文件必须进包（上面 ①/② 已覆盖）；② **读不到要降级**——一张数据表不许把应用搞崩。 */
const runtimeIpcSrc = readFileSync(join(ROOT, "electron", "features", "runtime-ipc.ts"), "utf8");
(/try \{[\s\S]{0,400}?require\("\.\.\/\.\.\/scripts\/lib\/tools-versions\.cjs"\)/.test(runtimeIpcSrc) ? ok : fail)(
  "【288】tools-versions 读不到要降级（⛔ 顶层裸 require 会让主进程启动即崩 —— 0.0.51 事故）"
);
(/TOOLS_VERSIONS\.feishuCli \?\? "latest"/.test(runtimeIpcSrc) ? ok : fail)(
  "【288】降级后版本号有 latest 兜底（⛔ 空表会拼出 @larksuite/cli@undefined）"
);
console.log("");
console.log(`【288】运行时文件打包守卫：${failCount === 0 ? "通过" : "失败 " + failCount + " 项"}`);
process.exit(failCount === 0 ? 0 : 1);
