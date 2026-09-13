// scripts/check-preflight.mjs —— 离线预检：不需要 GUI，跑完就知道「这次改动有没有低级问题」
//
// 检查项：
//   1. 构建产物存在 + 新鲜度（源码比产物新 = 你还没 build，别急着测）
//   2. IPC 三件套一致性（main.ts 的 handler ↔ preload.ts 桥接 ↔ vite-env.d.ts 类型）
//   3. CSS 类覆盖（JSX/SVG 里写死的类名，在 styles.css 里是否有规则）—— 仅告警
//   4. 纯逻辑行为断言（src/lib/*.mjs 这类零依赖纯函数，node 直接 import 跑断言）
//      —— 目前只有「模型选择的作用域」（会话独立选模型，09-11 两次返工后定稿）+ 写入点守卫
//
// 用法：npm run check（= build 之后自动跑本脚本）

import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolveModelForOpen, shouldSyncOpenThread } from "../src/lib/model-scope.mjs";
import { planCompletedFold } from "../src/lib/turn-fold-plan.mjs";
import { createAec, createEchoGate, createSentenceChunker, resampleLinear, rmsOf } from "../src/lib/voice-aec.mjs";
import { createSpeakFilter, normalizeNumbers, numberToChinese, toSpeakableText } from "../src/lib/speak-text.mjs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

let hardFails = 0;
let warns = 0;

function ok(msg) {
  console.log(`  ${C.green("✓")} ${msg}`);
}
function fail(msg) {
  hardFails++;
  console.log(`  ${C.red("✗")} ${msg}`);
}
function warn(msg) {
  warns++;
  console.log(`  ${C.yellow("!")} ${msg}`);
}

// ---------- 工具 ----------

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "dist-electron", "release", ".e2e-artifacts"]);

function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith(".") && name !== ".codex-harness") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push({ path: p, mtime: st.mtimeMs });
  }
  return out;
}

/**
 * 取「对象字面量最外层」的键名。
 * 不用正则硬凑：按括号深度扫描，只收 depth 0 处的 `name:` / `name(`，
 * 这样 `(patch: { a?: boolean })` 这类参数里的键不会被误当方法名。
 */
function topLevelKeys(block) {
  const keys = new Set();
  let depth = 0;
  let i = 0;
  let lastSig = "{"; // 上一个有效（非空白）字符
  const isWs = (ch) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r";

  while (i < block.length) {
    const c = block[i];

    if (c === "/" && block[i + 1] === "/") {
      while (i < block.length && block[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && block[i + 1] === "*") {
      const end = block.indexOf("*/", i + 2);
      i = end === -1 ? block.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < block.length && block[i] !== q) i += block[i] === "\\" ? 2 : 1;
      i++;
      lastSig = q;
      continue;
    }
    if (c === "{" || c === "(" || c === "[") {
      depth++;
      lastSig = c;
      i++;
      continue;
    }
    if (c === "}" || c === ")" || c === "]") {
      depth--;
      lastSig = c;
      i++;
      continue;
    }

    // 只有「紧随 { , ; 之后的标识符」才算这个对象自己的键，
    // 这样 `(patch: {...})` 里的参数名、返回值里的字段名都不会被误收。
    if (depth === 0 && !isWs(c) && (lastSig === "{" || lastSig === "," || lastSig === ";")) {
      const m = /^(\w+)\s*[:(]/.exec(block.slice(i, i + 80));
      if (m) {
        keys.add(m[1]);
        // 类型声明里方法写作 `name(...)`，括号被一并吃掉，这里要手动补一次深度
        if (m[0].endsWith("(")) {
          depth++;
          lastSig = "(";
        } else {
          lastSig = ":";
        }
        i += m[0].length;
        continue;
      }
    }

    if (!isWs(c)) lastSig = c;
    i++;
  }
  return keys;
}

// ---------- 1. 构建产物存在 + 新鲜度 ----------
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

// ---------- 2. IPC 三件套 ----------

console.log(C.bold("\n【2】IPC 通道一致性（main.ts ↔ preload.ts ↔ vite-env.d.ts）"));

const mainSrc = existsSync(join(ROOT, "electron", "main.ts"))
  ? readFileSync(join(ROOT, "electron", "main.ts"), "utf8")
  : "";
const preloadSrc = existsSync(join(ROOT, "electron", "preload.ts"))
  ? readFileSync(join(ROOT, "electron", "preload.ts"), "utf8")
  : "";
const typesPath = join(ROOT, "src", "vite-env.d.ts");
const typesSrc = existsSync(typesPath) ? readFileSync(typesPath, "utf8") : "";

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
}

// ---------- 3. CSS 类覆盖（仅告警） ----------

console.log(C.bold("\n【3】CSS 类覆盖（静态字面量，仅告警）"));

const stylesPath = join(ROOT, "src", "styles.css");
if (!existsSync(stylesPath)) {
  warn("找不到 src/styles.css，跳过");
} else {
  const css = readFileSync(stylesPath, "utf8");
  const cssClasses = new Set();
  for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) cssClasses.add(m[1]);

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

  const missing = [...usedClasses].filter((c) => !cssClasses.has(c));
  if (missing.length) {
    warn(`有 ${missing.length} 个 JSX 类名在 styles.css 里找不到规则（可能是父选择器承载 / 动态变体，需人眼判定）：\n      ${missing.slice(0, 25).join(", ")}${missing.length > 25 ? ` …另 ${missing.length - 25} 个` : ""}`);
  } else {
    ok(`全部 ${usedClasses.size} 个静态类名在 styles.css 均有规则`);
  }
}

// ---------- 4. 纯逻辑行为断言 ----------

console.log(C.bold("\n【4】纯逻辑行为断言（模型选择的作用域：每个会话独立）"));

if (typeof resolveModelForOpen !== "function") {
  fail("src/lib/model-scope.mjs 没有导出 resolveModelForOpen");
} else {
  // 每条都先断言「喂进去的确实是这两个值」，再断言输出——防假通过
  const cases = [
    {
      name: "会话有记录 → 用会话自己的（哪怕全局是别的模型）【会话独立的核心】",
      input: { stored: "custom:p:mine", global: "custom:p:global" },
      want: "custom:p:mine",
    },
    {
      name: "会话还没记录 → 用全局默认（新建 / 从没选过的会话）",
      input: { stored: "", global: "custom:p:global" },
      want: "custom:p:global",
    },
    {
      name: "会话记录与全局都空 → 空串（交调用方兜底）",
      input: { stored: "", global: "" },
      want: "",
    },
    {
      name: "字段缺省（undefined）不炸：按「没记录」处理",
      input: {},
      want: "",
    },
    {
      name: "两者相同 → 原值返回",
      input: { stored: "custom:p:same", global: "custom:p:same" },
      want: "custom:p:same",
    },
  ];

  for (const c of cases) {
    const got = resolveModelForOpen(c.input);
    // 前置条件：输入原样（防止用例自身写错导致断言无意义）
    const inputIntact =
      (c.input.stored === undefined || typeof c.input.stored === "string") &&
      (c.input.global === undefined || typeof c.input.global === "string");
    if (!inputIntact) fail(`${c.name} —— 用例输入本身不合法`);
    if (got === c.want) ok(c.name);
    else fail(`${c.name} —— 期望 ${JSON.stringify(c.want)}，实际 ${JSON.stringify(got)}`);
  }

  // 改「全局默认模型」时要不要顺手同步当前会话：只有真有会话打开才是 true
  const scopeCases = [
    { name: "有会话打开 → 同步到该会话（用户改了就该生效）", input: "thread-abc", want: true },
    { name: "无会话（欢迎页）→ 只改全局默认，别碰任何会话", input: "", want: false },
    { name: "undefined → 不同步（防拼出 'undefined' 这样的幽灵会话键）", input: undefined, want: false },
  ];
  for (const c of scopeCases) {
    const got = shouldSyncOpenThread(c.input);
    got === c.want ? ok(c.name) : fail(`${c.name} —— 期望 ${c.want}，实际 ${got}`);
  }

  // 接线守卫：openThread 的模型回填必须走这层判定（防日后退回「无条件用会话记录」或
  // 「全局后改就覆盖会话」——后者会把所有旧会话的模型选择冲掉，与「会话独立」冲突）
  const appSrc = existsSync(join(ROOT, "src", "App.tsx")) ? readFileSync(join(ROOT, "src", "App.tsx"), "utf8") : "";
  if (!appSrc) {
    warn("找不到 src/App.tsx，跳过接线守卫");
  } else {
    const wired = /const storedModel = resolveThreadModel\(id\);/.test(appSrc);
    const imported = /from "\.\/lib\/model-scope\.mjs"/.test(appSrc);
    wired && imported
      ? ok("openThread 回填已接上 resolveThreadModel（且 import 了 model-scope）")
      : fail(`openThread 模型回填未接上作用域判定（import=${imported} wire=${wired}）`);

    // 写入点守卫：`default-model` 全仓库只许在 applyGlobalModelChoice 里写一次。
    // 散落写入 = 绕过「有会话才同步、其它会话一律不动」的作用域规则（09-11 返工的根因）。
    const writes = appSrc.match(/setItem\(\s*"default-model"/g) ?? [];
    writes.length === 1
      ? ok("`default-model` 只有一处写入（applyGlobalModelChoice 统一入口）")
      : fail(`\`default-model\` 有 ${writes.length} 处写入，应全部收敛到 applyGlobalModelChoice——散落写入会绕过作用域规则`);

    const helperUsesScope = /shouldSyncOpenThread\(openId\)/.test(appSrc);
    helperUsesScope
      ? ok("applyGlobalModelChoice 按 shouldSyncOpenThread 决定是否同步当前会话")
      : fail("applyGlobalModelChoice 没走 shouldSyncOpenThread —— 改全局默认会波及别的会话");
  }
}

// ---------- 4b. 语音通话纯逻辑（回声消除 / 门控 / 断句） ----------

console.log(C.bold("\n【4b】语音通话纯逻辑（回声消除 / 回声门控 / 断句）"));

{
  // 重采样：采样率相同时必须原样返回（不做无谓的插值，避免引入失真）
  const src = new Float32Array([0, 0.5, 1, 0.5, 0, -0.5, -1, -0.5]);
  const same = resampleLinear(src, 16000, 16000);
  same === src ? ok("重采样：同采样率原样返回（不重复插值）") : fail("重采样：同采样率不应复制/变换");
  const half = resampleLinear(new Float32Array(1600), 16000, 8000);
  half.length === 800 ? ok("重采样：16k → 8k 长度减半") : fail(`重采样：期望 800，实际 ${half.length}`);

  // 能量：静音必须是 0，满幅正弦约 0.707
  rmsOf(new Float32Array(1024)) === 0 ? ok("能量：静音 = 0") : fail("能量：静音应为 0");
  const sine = new Float32Array(1600);
  for (let i = 0; i < sine.length; i++) sine[i] = Math.sin((2 * Math.PI * 440 * i) / 16000);
  const sineRms = rmsOf(sine);
  Math.abs(sineRms - 0.7071) < 0.02 ? ok(`能量：满幅正弦 ≈ 0.707（实际 ${sineRms.toFixed(3)}）`) : fail(`能量：满幅正弦期望 ≈0.707，实际 ${sineRms.toFixed(3)}`);

  // --- 回声消除：合成一条线性回声路径，验证真的压下去了 ---
  // 用宽带噪声：正弦下「任意延迟都等价于同频不同相」，滤波器怎么都能减干净，测不出对齐问题
  const N = 12000;
  const ECHO_DELAY = 40;
  const noiseAt = (len, seed) => {
    const out = new Float32Array(len);
    let state = seed >>> 0;
    for (let i = 0; i < len; i++) {
      state = (state * 1664525 + 1013904223) >>> 0;
      out[i] = ((state / 0xffffffff) * 2 - 1) * 0.3;
    }
    return out;
  };
  const far = noiseAt(N, 999);
  const mic = new Float32Array(N);
  for (let i = 0; i < N; i++) mic[i] = i - ECHO_DELAY >= 0 ? far[i - ECHO_DELAY] * 0.5 : 0;

  const aec = createAec({ filterLength: 128, delay: 32, step: 0.2 });
  const out = new Float32Array(N);
  const CHUNK = 256;
  for (let off = 0; off < N; off += CHUNK) {
    out.set(aec.process(mic.subarray(off, off + CHUNK), far.subarray(off, off + CHUNK)), off);
  }
  const tailStart = N - 4000;
  const erle = 20 * Math.log10(rmsOf(mic.subarray(tailStart)) / Math.max(rmsOf(out.subarray(tailStart)), 1e-12));
  erle > 12
    ? ok(`回声消除：纯回声段抑制 ${erle.toFixed(1)} dB（>12dB 判定有效）`)
    : fail(`回声消除：抑制只有 ${erle.toFixed(1)} dB，滤波器没收敛`);

  // 前置条件断言：确认这段输入里**确实有回声**，否则上面那条断言等于没测
  rmsOf(mic) > 0.05 ? ok("回声消除：用例输入确有回声（前置条件成立）") : fail("回声消除：用例输入没有回声，断言无意义");

  // 双讲冻结：冻结时只减不学，滤波器不会跟着跑
  const frozenAec = createAec({ filterLength: 128, delay: 32, step: 0.2 });
  frozenAec.setFrozen(true);
  const frozenOut = new Float32Array(N);
  for (let off = 0; off < N; off += CHUNK) {
    frozenOut.set(frozenAec.process(mic.subarray(off, off + CHUNK), far.subarray(off, off + CHUNK)), off);
  }
  const frozenErle = 20 * Math.log10(rmsOf(mic.subarray(tailStart)) / Math.max(rmsOf(frozenOut.subarray(tailStart)), 1e-12));
  frozenErle < 3
    ? ok("回声消除：全程冻结时滤波器不收敛（证明冻结真的生效）")
    : fail(`回声消除：冻结后仍收敛了 ${frozenErle.toFixed(1)} dB，冻结没生效`);

  // --- 回声门控：起播静音不压零；单块尖峰不算；持续人声才算；双讲期间地板冻住 ---
  // 回归用例（09-12 用户实测「我没说话，播报也会自动断」）：旧实现把**第一块**直接当回声
  // 地板，而播报刚起步那几十毫秒是静音 → 地板≈0 → 之后任何回声都超阈 → 播报被自己打断。
  const quietGate = createEchoGate({ echoGateDb: 6 });
  let quietFalse = false;
  for (let i = 0; i < 30; i++) {
    quietGate.update(0.0002, true); // 播报起步的静音段
    if (quietGate.doubleTalk) quietFalse = true;
  }
  for (let i = 0; i < 30; i++) {
    quietGate.update(0.006, true); // 之后的稳态回声：比起步静音大 30 倍，仍属回声量级
    if (quietGate.doubleTalk) quietFalse = true;
  }
  quietFalse === false
    ? ok("门控：起播静音不再把地板压到 0（回归：播报不会被自己打断）")
    : fail("门控：起播静音后误判插话 —— 播报会被自动打断（旧 bug 回归）");

  // 起播学习期：前若干块只学地板，即使突然变响也不判插话（避开起音瞬态）
  const seeded = createEchoGate({ echoGateDb: 6 });
  let earlyFire = false;
  for (let i = 0; i < 8; i++) {
    seeded.update(0.01, true);
    if (seeded.doubleTalk) earlyFire = true;
  }
  earlyFire === false ? ok("门控：起播学习期内不判插话（起音瞬态不误触发）") : fail("门控：起播学习期就判了插话");

  const gate = createEchoGate({ echoGateDb: 6 });
  for (let i = 0; i < 8; i++) gate.update(0.01, true); // 学习期
  gate.update(0.01, true);
  gate.doubleTalk === false ? ok("门控：稳态回声不误判为插话") : fail("门控：稳态回声被误判为插话");
  gate.update(0.5, true);
  gate.doubleTalk === false ? ok("门控：单块能量尖峰不判插话（去抖生效）") : fail("门控：单块尖峰就判插话（去抖失效）");
  let fired = false;
  for (let i = 0; i < 6; i++) {
    gate.update(0.5, true);
    if (gate.doubleTalk) fired = true;
  }
  fired ? ok("门控：持续人声（连续多块超阈）→ 判定插话") : fail("门控：持续人声没被识别");
  // 连喊 80 次：无冻结时地板会爬升、越喊越难打断；有冻结时地板纹丝不动，80 帧全部判插话。
  const floorBefore = gate.floor;
  let stayed = true;
  for (let i = 0; i < 80; i++) {
    gate.update(0.5, true);
    if (!gate.doubleTalk) stayed = false;
  }
  stayed
    ? ok("门控：双讲期间地板冻结（连喊 80 次仍判插话，不会越喊越难打断）")
    : fail("门控：地板被插话带高，越说越难打断（冻结失效）");
  Math.abs(gate.floor - floorBefore) < 1e-9
    ? ok(`门控：双讲期间地板数值不变（保持 ${floorBefore.toFixed(4)}）`)
    : fail(`门控：地板在双讲期间被抬高了（${floorBefore.toFixed(4)} → ${gate.floor.toFixed(4)}）`);
  gate.update(0.5, false);
  gate.doubleTalk === false && gate.floor === 0
    ? ok("门控：播报停止后复位（下次播报重新学习地板）")
    : fail("门控：播报停止后未复位");

  // 首句阈值：模型开头常常几十字没有句号，首句必须比后续句子更早出声（跟手感）
  const firstFast = createSentenceChunker({ maxChars: 60 });
  const firstOut = firstFast.push("这是一句没有任何标点符号而且很长的话用来验证首句是不是会提前切出来");
  firstOut.length === 1 && firstOut[0].length <= 10
    ? ok(`断句：首句提前切出（${firstOut[0].length} 字，阈值 10，不等满 60 字）`)
    : fail(`断句：首句没有提前切出（${JSON.stringify(firstOut).slice(0, 60)}）`);
  // 反证口径：09-13 审计 ④ 把首句阈值从 18 压到 10，这里必须跟着压，
  // 否则「阈值被改回 18」这种回归照不出来（10 也算 ≤18）
  const firstOld = createSentenceChunker({ maxChars: 60, firstMaxChars: 18 });
  const oldOut = firstOld.push("这是一句没有任何标点符号而且很长的话用来验证首句是不是会提前切出来");
  oldOut[0].length > firstOut[0].length
    ? ok(`断句：首句阈值确实变小了（18 字 → ${firstOut[0].length} 字，首块合成更快出声）`)
    : fail("断句：首句阈值没有随审计 ④ 调小（firstMaxChars 还是 18）");
  const later = firstFast.push("第二句同样没有标点但是首句已经出过声了所以应该按 60 字阈值继续攒着" + "补字补字补字补字补字补字补字补字补字补字补字补字补字补字补字补字补字补字补字补字");
  later.length === 0 || later[0].length > 18
    ? ok("断句：首句之后回到常规阈值（不会一直碎句）")
    : fail("断句：首句之后仍在碎切（阈值没回到 maxChars）");

  // --- 断句：句读即切、超长在软断点切、结尾 flush ---
  const hard = createSentenceChunker({ maxChars: 10 });
  const got1 = hard.push("你好。");
  got1.length === 1 && got1[0] === "你好。" ? ok("断句：遇到句号立即成句") : fail(`断句：句号未切，实际 ${JSON.stringify(got1)}`);
  hard.push("abc").length === 0 ? ok("断句：未到句读且不超长 → 继续攒") : fail("断句：短句被提前切了");

  const hardCut = createSentenceChunker({ maxChars: 10 });
  const got2 = hardCut.push("abcdefghijklmn");
  got2.length === 1 && got2[0] === "abcdefghij"
    ? ok("断句：无标点超长 → 按上限硬切（避免长回答憋着不出声）")
    : fail(`断句：硬切结果不对，实际 ${JSON.stringify(got2)}`);
  const tail2 = hardCut.flush();
  tail2.length === 1 && tail2[0] === "klmn" ? ok("断句：flush 吐出残留") : fail(`断句：flush 结果不对，实际 ${JSON.stringify(tail2)}`);

  const soft = createSentenceChunker({ maxChars: 10 });
  const got3 = soft.push("abc,defghijkl");
  got3.length === 1 && got3[0] === "abc," ? ok("断句：超长时优先在逗号处切") : fail(`断句：软断点结果不对，实际 ${JSON.stringify(got3)}`);
}

// ---------- 4c. 语音链路（09-13 审计 ①~⑥） ----------

console.log(C.bold("\n【4c】语音链路（打断世代号 / 朗读视图 / 听写预热 / 延迟 / AEC 对齐 / 来源标记）"));

{
  // ===== ② 朗读视图：给人看的 markdown → 给耳朵听的口语 =====
  const codeFilter = createSpeakFilter();
  const s1 = codeFilter.push("先看这段代码：");
  const s2 = codeFilter.push("```ts");
  const s3 = codeFilter.push("const answer = 42;");
  const s4 = codeFilter.push("```");
  s1.length > 0 && s2 === "" && s3 === ""
    ? ok("朗读视图：代码块整段不念（围栏内逐行丢弃）")
    : fail(`朗读视图：代码块没被丢弃（${JSON.stringify([s2, s3]).slice(0, 80)}）`);
  /代码块/.test(s4)
    ? ok("朗读视图：代码块用一句占位提示代替（用户知道「有代码，看屏幕」）")
    : fail(`朗读视图：代码块收尾没有占位提示（实际 ${JSON.stringify(s4)}）`);

  const tableFilter = createSpeakFilter();
  const t1 = tableFilter.push("| 指标 | 值 |");
  const t2 = tableFilter.push("| --- | --- |");
  const t3 = tableFilter.push("| gap | 54 |");
  /表格/.test(t1) && t2 === "" && t3 === ""
    ? ok("朗读视图：表格整段不念（只留一句占位）")
    : fail(`朗读视图：表格没被丢弃（${JSON.stringify([t1, t2, t3]).slice(0, 80)}）`);

  const inline = toSpeakableText("见 https://example.com/a/b 的 **锚点** 🎉 与 `code`，文件 C:\\Users\\me\\a.ts");
  !/http|\*\*|🎉|`/.test(inline) && /锚点/.test(inline) && /路径/.test(inline) && /code/.test(inline)
    ? ok(`朗读视图：URL/加粗/emoji/路径/反引号都清掉了（"${inline.slice(0, 40)}…"）`)
    : fail(`朗读视图：行内清洗不完整（实际 "${inline}"）`);

  numberToChinese(10) === "十" && numberToChinese(105) === "一百零五" && numberToChinese(20005) === "二万零五" && numberToChinese(1000000) === "一百万"
    ? ok("朗读视图：中文读数正确（十 / 一百零五 / 二万零五 / 一百万）")
    : fail(`朗读视图：中文读数不对（${[10, 105, 20005, 1000000].map(numberToChinese).join(" / ")}）`);

  const spokenNum = normalizeNumbers("2026-09-13 12:30 覆盖率 98%，耗时 3.5 秒，共 1,234 条");
  /二零二六年九月十三日/.test(spokenNum) && /十二点三十分/.test(spokenNum) && /百分之九十八/.test(spokenNum) && /三点五/.test(spokenNum) && /一千二百三十四/.test(spokenNum)
    ? ok("朗读视图：日期/时间/百分数/小数/千分位都中文化了")
    : fail(`朗读视图：数字中文化不完整（实际 "${spokenNum}"）`);

  // 前置条件式反证：标识符**必须**原样保留，否则会把 GPT-4 念成「GPT 四」、1.2.3 念成「一点二点三」
  normalizeNumbers("GPT-4 与 v2 接口、H264、版本 1.2.3") === "GPT-4 与 v2 接口、H264、版本 1.2.3"
    ? ok("朗读视图：紧贴字母/版本号的数字不动（GPT-4 / v2 / H264 / 1.2.3）")
    : fail(`朗读视图：把标识符里的数字也改了（实际 "${normalizeNumbers("GPT-4 与 v2 接口、H264、版本 1.2.3")}"）`);

  toSpeakableText("---") === "" && toSpeakableText("🎉") === "" && toSpeakableText("```") === ""
    ? ok("朗读视图：清完为空 → 调用方可直接跳过合成（不会合成空音频）")
    : fail(`朗读视图：纯记号文本没有被清空（${JSON.stringify([toSpeakableText("---"), toSpeakableText("🎉"), toSpeakableText("```")])}）`);

  // ===== ⑤ AEC 延迟线：真实设备量级的回声延迟（旧用例 delay=32/回声 40 样本，恰好落在可覆盖区间，测不出失配） =====
  // ⚠️ 必须用**宽带信号**（噪声）而不是正弦：单频正弦的任意延迟都等价于「同频不同相」，
  //    256 抽头的滤波器照样能把它减干净（实测正弦下错配也会「压 150dB」）→ 测不出对齐。
  //    噪声不可预测，只有抽头窗口真的覆盖到那个延迟才减得掉。
  const noiseOf = (len, seed = 12345) => {
    const out = new Float32Array(len);
    let state = seed >>> 0;
    for (let i = 0; i < len; i++) {
      state = (state * 1664525 + 1013904223) >>> 0;
      out[i] = ((state / 0xffffffff) * 2 - 1) * 0.3;
    }
    return out;
  };
  const M = 24000;
  const ECHO_OFFSET = 600; // 37.5ms @16k：外放/蓝牙量级，**大于** 256 抽头 → 延迟线不校正就压不掉
  const far = noiseOf(M);
  const micEcho = new Float32Array(M);
  for (let i = 0; i < M; i++) micEcho[i] = i - ECHO_OFFSET >= 0 ? far[i - ECHO_OFFSET] * 0.5 : 0;
  const runAec = (aec) => {
    const buf = new Float32Array(M);
    for (let off = 0; off < M; off += 256) {
      buf.set(aec.process(micEcho.subarray(off, off + 256), far.subarray(off, off + 256)), off);
    }
    return buf;
  };
  const tailAt = M - 8000;
  const erleOf = (buf) => 20 * Math.log10(rmsOf(micEcho.subarray(tailAt)) / Math.max(rmsOf(buf.subarray(tailAt)), 1e-12));

  const alignedAec = createAec({ filterLength: 256, delay: 0, maxDelay: 1024, step: 0.2 });
  alignedAec.setDelay(ECHO_OFFSET);
  const erleAligned = erleOf(runAec(alignedAec));
  const blindAec = createAec({ filterLength: 256, delay: 0, maxDelay: 1024, step: 0.2 });
  const erleBlind = erleOf(runAec(blindAec));

  alignedAec.delay === ECHO_OFFSET ? ok(`AEC：setDelay 生效（延迟线 = ${ECHO_OFFSET} 样本）`) : fail(`AEC：setDelay 没生效（delay=${alignedAec.delay}）`);
  erleAligned > 12
    ? ok(`AEC：校正延迟线后 600 样本回声被压 ${erleAligned.toFixed(1)} dB`)
    : fail(`AEC：校正延迟线后仍只压了 ${erleAligned.toFixed(1)} dB —— 延迟线没起作用`);
  erleBlind < 6
    ? ok(`AEC：不校正延迟线时压不掉（${erleBlind.toFixed(1)} dB）—— 证明上面那条断言真的在测「对齐」`)
    : fail(`AEC：不校正也能压 ${erleBlind.toFixed(1)} dB —— 这条断言测不出对齐问题（用例不成立）`);
  alignedAec.setDelay(999999);
  alignedAec.delay === 1024 ? ok("AEC：setDelay 越界被夹到 maxDelay（不会写坏延迟线）") : fail(`AEC：setDelay 越界没夹住（${alignedAec.delay}）`);

  // ===== 静态接线守卫（主进程/引擎侧 CDP 测不到，按 AGENTS.md 铁律 5 钉在这里） =====
  const readSrc = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "");
  const floatSrc = readSrc("src/components/VoiceCallFloat.tsx");
  const serviceSrc = readSrc("electron/voice/voice-service.ts");
  const settingsSrc = readSrc("electron/voice/voice-settings.ts");
  const workersSrc = readSrc("electron/voice/workers.ts");
  const preloadSrcV = readSrc("electron/preload.ts");

  if (!floatSrc || !serviceSrc || !settingsSrc || !workersSrc) {
    warn("找不到语音源码，跳过语音接线守卫");
  } else {
    // ① 打断：引擎把「被打断的回合」标出来，渲染层据此丢弃半句
    const statusChecked = /turn\/completed[\s\S]{0,600}?turn\?\.status/.test(serviceSrc) && /aborted/.test(serviceSrc);
    const abortedHandled = /event\.type === "turnDone"[\s\S]{0,300}?event\.aborted[\s\S]{0,120}?bumpSpeechEpoch/.test(floatSrc);
    const epochOnFinal = /event\.type === "final"[\s\S]{0,300}?bumpSpeechEpoch\(\)/.test(floatSrc);
    const epochGuard = /epoch !== speechEpochRef\.current/.test(floatSrc) && /if \(epoch !== speechEpochRef\.current\) return/.test(floatSrc);
    statusChecked && abortedHandled && epochOnFinal && epochGuard
      ? ok("① 打断：世代号 + turn.status=interrupted 双保险（在途合成与断句器半句都会被丢弃）")
      : fail(`① 打断链路不完整（status=${statusChecked} aborted=${abortedHandled} final=${epochOnFinal} epochGuard=${epochGuard}）`);

    // ③ 听写：先开麦再加载识别线程 + 补静音不再写死 3 秒 + 线程保活
    const captureIdx = floatSrc.indexOf("await startCapture();");
    const voiceStartIdx = floatSrc.indexOf("await window.codex.voiceStart(");
    captureIdx > 0 && voiceStartIdx > captureIdx
      ? ok("③ 听写：startCall 里先开麦（startCapture）再加载识别线程（voiceStart）")
      : fail(`③ 听写：开麦与加载顺序没换过来（capture=${captureIdx} voiceStart=${voiceStartIdx}）—— 开头 1~3 秒又会丢字`);
    const prebufferWired = /PREBUFFER_MAX_SAMPLES/.test(floatSrc) && /prebufferRef\.current = \[\]/.test(floatSrc) && /for \(const block of pending\) window\.codex\.voiceAudio\(block\)/.test(floatSrc) && /liveRef\.current = true/.test(floatSrc);
    prebufferWired
      ? ok("③ 听写：加载期间的音频暂存并在就绪后按序回灌（回灌后才切实时链路，顺序不乱）")
      : fail("③ 听写：暂存/回灌链路没接全（prebufferRef / liveRef / 回灌循环）");
    const silenceParam = /finishSilenceSec/.test(workersSrc) && !/sampleRate \* 3/.test(workersSrc);
    const keepAlive = /WORKER_KEEPALIVE_MS/.test(serviceSrc) && /parkIdle\("asr"/.test(serviceSrc) && /takeIdle\("asr"/.test(serviceSrc);
    silenceParam && keepAlive
      ? ok("③ 听写：松手补静音改为 rule2+0.3（不再 3 秒）+ 挂断后线程保活复用")
      : fail(`③ 听写：松手/保活优化缺失（silence=${silenceParam} keepAlive=${keepAlive}）`);

    // ④ 延迟：默认端点阈值 + 老档案迁移 + 提前端点
    const rule2Default = /asr: \{ rule1: 2\.4, rule2: 0\.8/.test(settingsSrc);
    const migrated = /VOICE_SETTINGS_VERSION/.test(settingsSrc) && /migrateSettings\(raw\)/.test(settingsSrc) && /1\.2/.test(settingsSrc);
    const endpointWired = /voice:endpoint-now/.test(mainSrc) && /voiceEndpointNow/.test(preloadSrcV) && /voiceEndpointNow\(\)/.test(floatSrc);
    rule2Default && migrated && endpointWired
      ? ok("④ 延迟：rule2 默认 0.8 + 老档案迁移（只改还是旧默认 1.2 的档案）+ 提前端点接线")
      : fail(`④ 延迟链路不完整（rule2=${rule2Default} migrate=${migrated} endpoint=${endpointWired}）`);

    // ⑤ AEC：参考环容量、延迟线校正、与浏览器 AEC 不叠加、麦克风设置读取顺序
    const ringOk = /REF_RING_SECONDS = 30/.test(floatSrc) && /CAPTURE_RATE \* REF_RING_SECONDS/.test(floatSrc);
    const delayWired = /maxDelay: AEC_MAX_DELAY_SAMPLES/.test(floatSrc) && /\.setDelay\?\.\(/.test(floatSrc) && /outputLatency/.test(floatSrc);
    const noDoubleAec = /browserAec/.test(floatSrc) && /useSelfAec/.test(floatSrc) && /aecRef\.current = useSelfAec/.test(floatSrc);
    const micReadIdx = floatSrc.indexOf("micSettingsRef.current = mic;");
    const gumIdx = floatSrc.indexOf("navigator.mediaDevices.getUserMedia(");
    micReadIdx > 0 && gumIdx > micReadIdx
      ? ok("⑤ AEC：麦克风/回声消除设置先读后用（第一次通话就生效）")
      : fail(`⑤ AEC：设置读取仍在 getUserMedia 之后（sett=${micReadIdx} gum=${gumIdx}）`);
    ringOk && delayWired && noDoubleAec
      ? ok("⑤ AEC：参考环 30s + 按播放领先量写入 + outputLatency 校正延迟线 + 浏览器 AEC 开启时不叠加 NLMS")
      : fail(`⑤ AEC 接线不完整（ring=${ringOk} delay=${delayWired} noDouble=${noDoubleAec}）`);

    // ⑥ 来源标记：引擎要能区分「语音消息」与「打字消息」
    const prefixDefined = /export const VOICE_MESSAGE_PREFIX = "\[语音\] "/.test(serviceSrc);
    const prefixUsed = /const input = \[\{ type: "text", text: `\$\{VOICE_MESSAGE_PREFIX\}\$\{text\}`/.test(serviceSrc);
    const bothPaths = (serviceSrc.match(/^\s+input,$/gm) ?? []).length >= 2;
    const trigger = /turnTrigger: VOICE_TURN_TRIGGER/.test(serviceSrc);
    prefixDefined && prefixUsed && bothPaths && trigger
      ? ok("⑥ 来源标记：语音消息带 [语音] 前缀（turn/start 与排队两条路径都带）+ turnTrigger=voice")
      : fail(`⑥ 来源标记不完整（def=${prefixDefined} use=${prefixUsed} both=${bothPaths} trigger=${trigger}）`);
  }
}

// ---------- 4d. 语音唤醒（09-13 取证：默认唤醒词根本匹配不上） ----------

console.log(C.bold("\n【4d】语音唤醒（同音容错匹配 / 端点复位 / 配置即时生效）"));

{
  // 纯逻辑跑的是**编译产物**（electron/voice/wake-match.ts → dist-electron/voice/wake-match.js）：
  // 主进程代码 CDP 测不到，但它是纯函数，直接把真正会上线的那份 require 进来断言。
  let wakeMatch = null;
  try {
    wakeMatch = await import("../dist-electron/voice/wake-match.js");
  } catch (error) {
    fail(`语音唤醒纯逻辑产物读不到（先 npm run build）：${error?.message ?? error}`);
  }

  if (wakeMatch) {
    const { buildHomophoneMap, createWakeMatcher, normalizeWakeText, phraseVocabHint } = wakeMatch;

    // lexicon 样本照抄真实 lexicon.txt 的写法（注音 + 声调符号）：柯/科 同音，哥 不同声母
    const LEXICON = [
      "柯 ㄎ ㄜ ˉ",
      "科 ㄎ ㄜ ˉ",
      "可 ㄎ ㄜ ˇ",
      "客 ㄎ ㄜ ˋ",
      "哥 ㄍ ㄜ ˉ",
      "小 ㄒ ㄧ ㄠ ˇ",
      "消 ㄒ ㄧ ㄠ ˉ",
      "多字词 ㄉ ㄨ ㄛ ˉ ㄗ ㄘ ˊ", // 多字条目必须被忽略（读音是拼接的）
    ].join("\n");
    const homo = buildHomophoneMap(LEXICON);
    homo.get("柯")?.has("科") && homo.get("柯")?.has("可")
      ? ok(`唤醒：同音表按读音归类（柯 ≈ ${[...(homo.get("柯") ?? [])].join("")}）`)
      : fail("唤醒：同音表没把 柯/科/可 归为一类（lexicon 解析错了）");
    homo.get("柯")?.has("哥") === false
      ? ok("唤醒：不同声母不算同音（柯 ㄎㄜ ≠ 哥 ㄍㄜ）")
      : fail("唤醒：把 哥 也当成 柯 的同音字 —— 会把「小哥」这种日常词误唤醒");

    const matcher = createWakeMatcher({ phrase: "小柯小柯", homophones: homo });
    // 正例：探针实测到的真实识别结果（合成音频 → 唤醒配置识别）
    const positives = [
      ["小柯小柯", "完全正确（探针实测出现过）"],
      ["小科小科", "同音常用字（说小科小科时模型常写成小柯小柯）"],
      ["消客小客", "探针实测「说小可小可」的输出：同音不同调"],
      ["嗯，小科小科，帮我看下", "前后有别的字（滑窗）"],
    ];
    for (const [text, note] of positives) {
      matcher.match(text) ? ok(`唤醒：match("${text}") = true（${note}）`) : fail(`唤醒：漏唤醒 —— match("${text}") 应为 true（${note}）`);
    }
    // 负例：不能为了「能唤醒」把门槛放到把日常话也当唤醒
    const negatives = [
      ["小哥小哥", "声母听错：故意不匹配（否则「小哥」天天误唤醒）"],
      ["哎呀这个项目真不错", "无关内容"],
      ["小", "只说了一半"],
      ["", "空文本"],
    ];
    for (const [text, note] of negatives) {
      matcher.match(text) === false ? ok(`唤醒：match("${text}") = false（${note}）`) : fail(`唤醒：误唤醒 —— match("${text}") 应为 false（${note}）`);
    }
    // 前置条件：同音容错确实在起作用（去掉同音表后「小科小科」必须匹配不上）
    const exactOnly = createWakeMatcher({ phrase: "小柯小柯", homophones: null });
    exactOnly.match("小科小科") === false && exactOnly.match("小柯小柯") === true
      ? ok("唤醒：同音容错真的在起作用（无同音表时只认精确匹配）")
      : fail("唤醒：同音表接没接上分不出来 —— 这条断言没意义");
    createWakeMatcher({ phrase: "  " }).ready === false
      ? ok("唤醒：空唤醒词永不命中（不会把每句话都当唤醒）")
      : fail("唤醒：空唤醒词也能命中 —— 会疯狂误唤醒");
    normalizeWakeText(" 小 柯，小柯。 ") === "小柯小柯"
      ? ok("唤醒：归一化去掉空白与标点")
      : fail(`唤醒：归一化不对（${normalizeWakeText(" 小 柯，小柯。 ")}）`);
    // 词表可达性提示：柯 不在 tokens 里（真实模型 2002 项词表就是这种情况）→ 必须提示
    phraseVocabHint("小柯小柯", "小 1\n哥 2\n科 3") .includes("柯")
      ? ok("唤醒：唤醒词含词表外字时给出提示（这正是默认词「小柯小柯」时好时坏的原因）")
      : fail("唤醒：没有提示词表外字，用户无从知道该换词");
    phraseVocabHint("小科小科", "小 1\n科 2") === ""
      ? ok("唤醒：唤醒词全在词表内时不打扰用户")
      : fail("唤醒：词表内也报警，提示会被无视");
  }

  // ===== 接线守卫（唤醒是常驻监听，主进程侧 CDP 测不到）=====
  const readSrc2 = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "");
  const floatSrc2 = readSrc2("src/components/VoiceCallFloat.tsx");
  const serviceSrc2 = readSrc2("electron/voice/voice-service.ts");
  const settingsUiSrc = readSrc2("src/components/VoiceSettingsSection.tsx");

  if (!floatSrc2 || !serviceSrc2 || !settingsUiSrc) {
    warn("找不到语音源码，跳过唤醒接线守卫");
  } else {
    // ① 开关/唤醒词改了必须立刻重挂（旧实现依赖数组只有 [phase] → 打开开关毫无反应）
    const depsOk = /\}, \[phase, wakeCfg\.enabled, wakeCfg\.phrase\]\);/.test(floatSrc2);
    const broadcast = /type: "settings", settings: next/.test(mainSrc);
    const listensSettings = /event\?\.type === "settings"/.test(floatSrc2);
    depsOk && broadcast && listensSettings
      ? ok("唤醒：设置变更即时生效（主进程广播 settings + effect 依赖含开关与唤醒词）")
      : fail(`唤醒：改了设置不重挂（deps=${depsOk} 广播=${broadcast} 监听=${listensSettings}）`);

    // ② 命中后不得用 effect 里捕获的 startCall（threadId 会过期）
    const refForwarded = /startCallRef\.current\(\)/.test(floatSrc2) && /const startCallRef = useRef/.test(floatSrc2);
    const noStaleCall = !/event\.type === "wake"[\s\S]{0,400}?\bstartCall\(\)/.test(floatSrc2);
    refForwarded && noStaleCall
      ? ok("唤醒：命中后经 startCallRef 取最新闭包（不会用到过期的 threadId）")
      : fail(`唤醒：命中路径仍可能用过期闭包（ref=${refForwarded} 无裸调用=${noStaleCall}）`);

    // ③ 匹配与复位在主进程：渲染层不再拿文本、不再自己 includes
    const mainMatches = /wakeMatcher\?\.match\(text\)/.test(serviceSrc2);
    const endpointReset = /if \(endpoint\)[\s\S]{0,300}?request\("reset"/.test(serviceSrc2);
    const preloaded = /await this\.wakeAsr\.request\("create"\)/.test(serviceSrc2);
    const noRenderMatch = !/norm\.includes\(wake\.phrase\)/.test(floatSrc2) && !/includes\(wakeCfg\.phrase\)/.test(floatSrc2);
    mainMatches && endpointReset && preloaded && noRenderMatch
      ? ok("唤醒：匹配在主进程 + 每次端点复位识别流 + 启动即预热模型（不再每块回传整坨文本）")
      : fail(`唤醒：主进程侧不完整（match=${mainMatches} reset=${endpointReset} 预热=${preloaded} 渲染层无匹配=${noRenderMatch}）`);

    // ④ 背压：忙时攒块、空了合并发送（旧实现每块无条件 invoke → 越积越慢）
    const backpressure = /let busy = false;/.test(floatSrc2) && /pending\.push\(raw\)/.test(floatSrc2) && /const pump = \(\) => \{/.test(floatSrc2) && /MAX_PENDING/.test(floatSrc2);
    backpressure
      ? ok("唤醒：识别忙时攒块合并发送（有背压上限，不会无限积压）")
      : fail("唤醒：没有背压 —— 识别跟不上时会越积越慢");

    // ⑤ 失败必须可见 + 「最近听到什么」必须显示得出来
    //    判据要落在**启动失败那条分支**上（catch 块里也有一处 patchWakeState，只匹配调用会让守卫放水）
    const failureVisible = /if \(!started\?\.ok\) \{[\s\S]{0,240}?patchWakeState\(\{ listening: false, error:/.test(floatSrc2);
    const statusShown = /wakeState\.heard/.test(settingsUiSrc) && /subscribeWakeState/.test(settingsUiSrc);
    failureVisible && statusShown
      ? ok("唤醒：启动失败会提示 + 设置页显示「最近听到什么」（诊断可见）")
      : fail(`唤醒：失败静默或诊断不可见（失败提示=${failureVisible} 状态显示=${statusShown}）`);
  }
}

// ---------- 4e. 语音唤醒关键词模型（KWS）：中文唤醒词 → 拼音 token 行 ----------

console.log(C.bold("\n【4e】语音唤醒关键词模型（KWS，读音匹配；关键词生成器对照模型自带样例验证）"));

{
  let kwsMod = null;
  try {
    kwsMod = await import("../dist-electron/voice/kws-keywords.js");
  } catch (error) {
    fail(`关键词生成器产物读不到（先 npm run build）：${error?.message ?? error}`);
  }

  if (kwsMod) {
    const { buildKeywordLines, parseLexiconReadings, zhuyinToSyllable } = kwsMod;

    // 对照验证：模型自带 keywords_raw.txt（中文）↔ keywords.txt（拼音 token）8 对，
    // 生成器必须原样复现 —— 这是判断注音→拼音表对不对**唯一**可信的判据。
    const GROUND_TRUTH = [
      ["你好军哥", "n ǐ h ǎo j ūn g ē @你好军哥"],
      ["蛋哥蛋哥", "d àn g ē d àn g ē @蛋哥蛋哥"],
      ["小爱同学", "x iǎo ài t óng x ué @小爱同学"],
      ["你好问问", "n ǐ h ǎo w èn w èn @你好问问"],
      ["小艺小艺", "x iǎo y ì x iǎo y ì @小艺小艺"],
      ["小米小米", "x iǎo m ǐ x iǎo m ǐ @小米小米"],
      ["林美丽", "l ín m ěi l ì @林美丽"],
      ["你好西西", "n ǐ h ǎo x ī x ī @你好西西"],
    ];
    // 模型自带的注音（与音色模型 lexicon.txt 同一套写法）：手写这批读音，避免依赖本机模型文件
    const LEXICON = [
      "你 ㄋ ㄧ ˇ", "好 ㄏ ㄠ ˇ", "军 ㄐ ㄩ ㄣ ˉ", "哥 ㄍ ㄜ ˉ",
      "蛋 ㄉ ㄢ ˋ", "小 ㄒ ㄧ ㄠ ˇ", "爱 ㄞ ˋ", "同 ㄊ ㄨ ㄥ ˊ", "学 ㄒ ㄩ ㄝ ˊ",
      "问 ㄨ ㄣ ˋ", "艺 ㄧ ˋ", "米 ㄇ ㄧ ˇ", "林 ㄌ ㄧ ㄣ ˊ", "美 ㄇ ㄟ ˇ", "丽 ㄌ ㄧ ˋ",
      "西 ㄒ ㄧ ˉ", "柯 ㄎ ㄜ ˉ", "助 ㄓ ㄨ ˋ", "手 ㄕ ㄡ ˇ",
    ].join("\n");
    const readings = parseLexiconReadings(LEXICON);
    readings.size >= 15
      ? ok(`关键词：注音词典解析出 ${readings.size} 个字`)
      : fail(`关键词：注音词典解析数量异常（${readings.size}）`);

    let matched = 0;
    for (const [phrase, expected] of GROUND_TRUTH) {
      const built = buildKeywordLines({ phrase, readings });
      const got = built.lines[0]?.line ?? "(空)";
      if (got === expected) matched += 1;
      else fail(`关键词：与模型自带样例不一致 —— ${phrase}\n      期望 ${expected}\n      实际 ${got}`);
    }
    matched === GROUND_TRUTH.length
      ? ok(`关键词：${matched}/${GROUND_TRUTH.length} 行与模型自带 keywords.txt 完全一致（注音→拼音→声母/韵母拆分全对）`)
      : fail(`关键词：只有 ${matched}/${GROUND_TRUTH.length} 行与模型样例一致`);

    const target = buildKeywordLines({ phrase: "小柯小柯", readings });
    target.lines[0]?.line === "x iǎo k ē x iǎo k ē @小柯小柯"
      ? ok("关键词：默认唤醒词「小柯小柯」→ `x iǎo k ē x iǎo k ē @小柯小柯`（探针实测该行命中 3/4、零误触发）")
      : fail(`关键词：默认唤醒词生成错误（${target.lines[0]?.line}）`);

    // 前置条件/反证口径：j/q/x 后的 ü 必须写成 u（军 jūn / 学 xué）——写错就是 token 表里不存在的韵母
    const jun = zhuyinToSyllable(["ㄐ", "ㄩ", "ㄣ", "ˉ"]);
    const xue = zhuyinToSyllable(["ㄒ", "ㄩ", "ㄝ", "ˊ"]);
    jun?.final === "ūn" && xue?.final === "ué"
      ? ok("关键词：j/q/x 后的 ü 写成 u（军 ūn / 学 ué，与模型样例一致）")
      : fail(`关键词：ü 的拼写规则不对（军=${jun?.final} 学=${xue?.final}）`);
    // 舌尖元音：ㄓ/ㄔ/ㄕ/ㄖ/ㄗ/ㄘ/ㄙ 单独成音节时写作 zhi/chi/shi/ri/zi/ci/si（声调在韵母上：世 → sh ì）
    const shi = zhuyinToSyllable(["ㄕ", "ˋ"]);
    const zhi = zhuyinToSyllable(["ㄓ", "ˉ"]);
    shi?.initial === "sh" && shi?.final === "ì" && zhi?.initial === "zh" && zhi?.final === "ī"
      ? ok("关键词：舌尖元音音节（ㄕ ˋ → sh ì）能正确转换（lexicon 里这类字很多）")
      : fail(`关键词：舌尖元音音节转换失败（世=${shi?.initial}/${shi?.final} 之=${zhi?.initial}/${zhi?.final}）`);

    // 无法转换时**必须报出来**，不能生成一条永远唤不醒的关键词
    const unknown = buildKeywordLines({ phrase: "小柯𠀀", readings });
    unknown.unknownChars.length > 0 || unknown.lines.some((l) => l.missing.length > 0)
      ? ok("关键词：查不到读音/不在 token 表时如实上报（不会静默生成无效关键词）")
      : fail("关键词：无效字被静默吞掉 —— 用户会遇到「唤不醒且无提示」");
    const empty = buildKeywordLines({ phrase: "   ", readings });
    empty.lines.length === 0 ? ok("关键词：空唤醒词不生成任何行") : fail("关键词：空唤醒词生成了行");
  }

  // ===== KWS 接线守卫 =====
  const readSrc3 = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "");
  const serviceSrc3 = readSrc3("electron/voice/voice-service.ts");
  const workersSrc3 = readSrc3("electron/voice/workers.ts");
  const settingsUiSrc3 = readSrc3("src/components/VoiceSettingsSection.tsx");
  const manifestSrc = readSrc3("electron/voice/model-manifest.ts");
  const storeSrc = readSrc3("electron/voice/model-store.ts");

  if (!serviceSrc3 || !workersSrc3 || !settingsUiSrc3) {
    warn("找不到语音源码，跳过 KWS 接线守卫");
  } else {
    // ① 首选关键词模型、失败再回退识别模型（顺序反了就等于白装）
    const kwsFirst = serviceSrc3.indexOf("if (kwsReady(this.deps.modelsRoot))") > 0
      && serviceSrc3.indexOf("if (kwsReady(this.deps.modelsRoot))") < serviceSrc3.indexOf("startWakeAsrFallback(");
    kwsFirst
      ? ok("KWS：唤醒优先用关键词模型，装不上/转不出关键词才回退识别模型")
      : fail("KWS：引擎选择顺序不对（回退分支排在关键词模型之前）");

    // ② 关键词落盘在 userData（模型目录只读语义），且命中即 reset（否则同句反复命中）
    const kwFile = /voice-kws/.test(serviceSrc3) && /keywords\.txt/.test(serviceSrc3);
    const kwsWorkerReset = /keyword/.test(workersSrc3) && /if \(keyword\) spotter\.reset\(stream\)/.test(workersSrc3);
    kwFile && kwsWorkerReset
      ? ok("KWS：keywords.txt 写在 userData + worker 命中后立即 reset 识别流")
      : fail(`KWS：关键词落盘或 reset 缺失（file=${kwFile} reset=${kwsWorkerReset}）`);

    // ③ 关键词行必须来自生成器（不许手拼拼音），且要按 token 表过滤
    const usesBuilder = /buildKeywordLines\(/.test(serviceSrc3) && /parseLexiconReadings\(/.test(serviceSrc3);
    const filtersMissing = /filter\(\(line\) => line\.missing\.length === 0\)/.test(serviceSrc3);
    usesBuilder && filtersMissing
      ? ok("KWS：关键词行由生成器产出并按模型 token 表过滤（无效行不会写进 keywords.txt）")
      : fail(`KWS：关键词生成没走生成器或没过滤（builder=${usesBuilder} filter=${filtersMissing}）`);

    // ④ 换唤醒词必须重挂（keywordsFile 是 worker 启动参数，改词不重建 = 还在等旧词）
    const rearm = /stopWakeListener\(\)\.then\(\(\) => this\.startWakeListener\(\)\)/.test(serviceSrc3);
    rearm ? ok("KWS：改唤醒词后重建 worker（keywordsFile 是启动参数，不重建就还在等旧词）") : fail("KWS：改唤醒词没有重挂 worker");

    // ⑤ 安装链路 + UI 入口（模型 31MB，按需下载；不装也能用回退）
    const installChain = /voice:kws-install/.test(mainSrc) && /voiceKwsInstall/.test(preloadSrc) && /ensureKws\(/.test(storeSrc);
    const uiEntry = /installKws\(\)/.test(settingsUiSrc3) && /voiceKwsInstall\(\)/.test(settingsUiSrc3);
    const archive = /KWS_ARCHIVE/.test(manifestSrc) && /kwsReady/.test(manifestSrc) && /b2f7c89690dc8ce4c6ed6afeab7cd800c36ad1421fb6b6302b4a4b194cf7f35f/.test(manifestSrc);
    installChain && uiEntry && archive
      ? ok("KWS：安装链路（归档 SHA256 + ensureKws + IPC + 设置页一键下载）齐全")
      : fail(`KWS：安装链路不完整（chain=${installChain} ui=${uiEntry} archive=${archive}）`);

    // ⑥ 关键词模型不能进「主模型齐备」判定：它只服务唤醒，缺了不该把整个语音功能挡住
    const notInAll = !/ALL_VOICE_REPOS[^\n]*KWS/.test(manifestSrc) && /KWS_REPO/.test(manifestSrc) === false;
    notInAll
      ? ok("KWS：关键词模型不参与「主模型是否齐备」判定（不装也能用通话/听写）")
      : fail("KWS：关键词模型被算进了主模型齐备判定 —— 没装唤醒模型的用户会看到「语音模型未下载完整」");
  }
}

// ---------- 4f. 麦克风错误翻译 + 模型下载（取消 / 提速） ----------

console.log(C.bold("\n【4f】麦克风错误翻译（唤醒/通话共用）+ 模型下载（可取消 / 会换源提速）"));

{
  // ===== 纯逻辑：错误翻译（用户实测界面直接显示过英文原文 Requested device not found）=====
  let describeMicError = null;
  try {
    ({ describeMicError } = await import("../src/lib/mic-error.mjs"));
  } catch (error) {
    fail(`麦克风错误翻译模块读不到：${error?.message ?? error}`);
  }
  if (describeMicError) {
    const notFound = describeMicError(Object.assign(new Error("Requested device not found"), { name: "NotFoundError" }));
    /未找到可用的麦克风设备/.test(notFound) && /(1)/.test(notFound) && !/^Requested device not found$/.test(notFound)
      ? ok("麦克风错误：NotFoundError → 中文说明 + 三步排查（不再把英文原文丢给用户）")
      : fail(`麦克风错误：NotFoundError 没翻译（${notFound}）`);
    /权限/.test(describeMicError(Object.assign(new Error("Permission denied"), { name: "NotAllowedError" })))
      ? ok("麦克风错误：NotAllowedError → 权限提示")
      : fail("麦克风错误：NotAllowedError 没翻译");
    /独占/.test(describeMicError(Object.assign(new Error("Could not start audio source"), { name: "NotReadableError" })))
      ? ok("麦克风错误：NotReadableError → 「被别的程序独占」提示")
      : fail("麦克风错误：NotReadableError 没翻译");
    /OverconstrainedError/.test(describeMicError(Object.assign(new Error("bad constraints"), { name: "OverconstrainedError" })))
      ? ok("麦克风错误：OverconstrainedError → 参数/设备提示")
      : fail("麦克风错误：OverconstrainedError 没翻译");
    // 兜底：未知错误也必须带前缀（便于在日志里认出来），且不能是空串
    const unknown = describeMicError(new Error("weird failure"));
    /^打开麦克风失败：/.test(unknown) && unknown.length > 8
      ? ok("麦克风错误：未知错误有兜底前缀（不会显示空白提示）")
      : fail(`麦克风错误：未知错误兜底不对（${unknown}）`);
  }

  const readSrc4 = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "");
  const floatSrc4 = readSrc4("src/components/VoiceCallFloat.tsx");
  const storeSrc4 = readSrc4("electron/voice/model-store.ts");
  const settingsUiSrc4 = readSrc4("src/components/VoiceSettingsSection.tsx");

  if (!floatSrc4 || !storeSrc4 || !settingsUiSrc4) {
    warn("找不到源码，跳过【4f】接线守卫");
  } else {
    // ① 两条采集链路共用同一份翻译（旧实现只有通话侧有，唤醒侧直接漏英文）
    const usesTranslator = (floatSrc4.match(/describeMicError\(/g) ?? []).length >= 2;
    const noRawLeak = !/patchWakeState\(\{ listening: false, error: String\(error\?\.message/.test(floatSrc4);
    usesTranslator && noRawLeak
      ? ok("唤醒：麦克风错误与通话共用一份翻译（唤醒侧不再漏原生英文）")
      : fail(`唤醒：错误翻译没共用或仍有裸英文（translator=${usesTranslator} raw=${!noRawLeak}）`);

    // ② 唤醒要重试 + 用设置里的设备（旧实现硬编码 constraints，用户换的麦不生效）
    const retries = /for \(let attempt = 0; attempt < 3/.test(floatSrc4);
    const usesSettingsMic = /micCfg\.deviceId/.test(floatSrc4) && /wakeConstraint/.test(floatSrc4);
    retries && usesSettingsMic
      ? ok("唤醒：麦克风失败重试 3 次 + 使用设置里选的设备/开关")
      : fail(`唤醒：缺重试或用的是硬编码设备（retry=${retries} settingsMic=${usesSettingsMic}）`);

    // ③ 下载可取消：UI 有按钮 + 取消**保留**断点（旧实现取消也把残file 删了 → 下次从头来）
    const cancelUi = /取消下载/.test(settingsUiSrc4) && /voiceKwsCancel\(\)/.test(settingsUiSrc4);
    const cancelKeepsPartial = /cancelled: true/.test(storeSrc4) && !/error\?\.fatal \|\| signal\?\.aborted/.test(storeSrc4);
    cancelUi && cancelKeepsPartial
      ? ok("下载：设置页有「取消下载」，且取消保留已下载部分（下次点下载续传）")
      : fail(`下载：取消不完整（ui=${cancelUi} keepPartial=${cancelKeepsPartial}）`);

    // ④ 提速：候选地址并发探测排序 + 连接超时 + 速度下限换源 + 进度显示速度
    //    判据要落在**调用点**上：只查函数定义的话，把调用删掉守卫照样绿（反证时踩到过）
    const ordered = /await orderCandidatesByLatency\(candidates, signal\)/.test(storeSrc4)
      && /async function orderCandidatesByLatency\(/.test(storeSrc4);
    const connTimeout = /headersTimeoutMs/.test(storeSrc4) && /AbortController/.test(storeSrc4);
    const speedFloor = /minSpeedBytesPerSec/.test(storeSrc4) && /alternativesLeft/.test(storeSrc4);
    const speedShown = /MB\/s/.test(storeSrc4);
    ordered && connTimeout && speedFloor && speedShown
      ? ok("下载：候选地址按实测首字节排序 + 连接超时 + 太慢自动换源 + 进度带 MB/s")
      : fail(`下载：提速项缺失（order=${ordered} timeout=${connTimeout} speedFloor=${speedFloor} shown=${speedShown}）`);
  }
}

// 接线守卫：语音悬浮入口必须真的挂到 App 上（防「组件写了但没接」）
{
  const appPath = join(ROOT, "src", "App.tsx");
  if (!existsSync(appPath)) {
    warn("找不到 src/App.tsx，跳过语音接线守卫");
  } else {
    const appSrc = readFileSync(appPath, "utf8");
    const imported = /import\s+VoiceCallFloat\s+from\s+["']\.\/components\/VoiceCallFloat["']/.test(appSrc);
    const mounted = /<VoiceCallFloat\s+threadId=/.test(appSrc);
    imported && mounted
      ? ok("语音悬浮入口已挂载到 App（且带 threadId）")
      : fail(`语音悬浮入口未接线（import=${imported} mounted=${mounted}）`);
  }
}

// ---------- 【4g】Bot Channel 配对门卫（09-13：聊天里发 6 位授权码 + 电脑端审批） ----------
// 这条守卫跑编译产物 electron/bot-pairing.ts → dist-electron/bot-pairing.js 的**真实现**：
// 未批准聊天发普通消息只收到配对引导；发对授权码挂起等审批；审批通过才放行；
// 连续错 5 次触发冷却。改坏配对门卫 = 机器人聊天对全网裸奔，所以钉在预检里。
console.log(C.bold("\n【4g】Bot Channel 配对门卫（授权码 + 电脑端审批，跑编译产物真实现）"));
{
  const botPairPath = join(ROOT, "dist-electron", "bot-pairing.js");
  let BotPairingService = null;
  try { BotPairingService = (await import("file://" + botPairPath.replace(/\\/g, "/"))).BotPairingService; }
  catch { fail(`bot-pairing 编译产物读不到（先 npm run build）`); }
  if (BotPairingService) {
    const notifications = [];
    const gate = new BotPairingService(() => "135790", (req) => notifications.push(req), () => undefined);
    // ① 未批准聊天 + 普通消息 → 只收到配对引导（消息不会到达引擎）
    const guide = gate.onChannelMessage("qq", "chat-1", "QQ 测试", "帮我看看这个报错");
    guide.action === "guide" && /配对码/.test(guide.message)
      ? ok("未批准聊天：普通消息只收到配对引导（不执行）")
      : fail(`未批准聊天没有引导或直接放行（${JSON.stringify(guide).slice(0, 80)}）`);
    // ② 配对码错误 → 仍引导（且不产生审批请求）
    gate.onChannelMessage("qq", "chat-1", "QQ 测试", "000000");
    notifications.length === 0
      ? ok("配对码错误不会进入审批队列")
      : fail("错码也触发了审批请求 —— 输码校验失效");
    // ③ 授权码正确 → 挂起等电脑端审批（此刻消息仍不放行）
    const wait = gate.onChannelMessage("qq", "chat-1", "QQ 测试", "135790");
    wait.action === "wait" && Boolean(wait.rid)
      ? ok("授权码正确 → 挂起等电脑端审批（给出 rid）")
      : fail(`授权码正确却没挂起（${JSON.stringify(wait).slice(0, 80)}）`);
    const stillGuide = gate.onChannelMessage("qq", "chat-1", "QQ 测试", "还没批准呢再发一条");
    stillGuide.action === "guide"
      ? ok("审批通过前该聊天仍被拦截")
      : fail("审批还没通过消息就放行了 —— 门卫失效");
    // ④ 电脑端批准 → 同聊天放行
    gate.approve(wait.rid) ? null : fail("approve(rid) 返回失败 —— 审批流转断了");
    const allowed = gate.onChannelMessage("qq", "chat-1", "QQ 测试", "再发一条正常消息");
    allowed.action === "allow" ? ok("电脑端批准后同聊天放行") : fail("批准后仍被拦截 —— 批准没写进已批准表");
    // ⑤ 冷却：连续错 5 次触发锁定（挡暴力试码）
    const gate2 = new BotPairingService(() => "246810", () => undefined, () => undefined);
    let locked = null;
    for (let i = 0; i < 6; i++) locked = gate2.onChannelMessage("wx", "chat-2", "微信", "111111");
    locked.action === "guide" && /锁定/.test(locked.message)
      ? ok("连续错 5 次触发冷却锁定（挡暴力试码）")
      : fail(`错码没有冷却锁定（最后一次 ${JSON.stringify(locked).slice(0, 80)}）`);
    // ⑥ 反证：门卫形同虚设的情形 = 所有消息都 allow —— 这里用"已批准表"对照证明 ① 的拦截真的由批准状态驱动
    gate.revoke("qq", "chat-1");
    const afterRevoke = gate.onChannelMessage("qq", "chat-1", "QQ 测试", "撤销后再发一条");
    afterRevoke.action === "guide" ? ok("撤销已批准聊天后重新回到拦截（revoke 生效）") : fail("撤销后仍放行 —— revoke 没删批准表");
  }
}


// ---------- 【4h】内置音色与试听反馈（09-13：换开源预设 + 试听提速可停止） ----------
{
  // 预设清单：旧的两个预设已下线；新预设必须「wav + 精确参考文本」成对且文件随包存在
  //（ZipVoice 铁律：文本对不上音质明显劣化，所以每个预设都必须有官方成对转写）。
  try {
    const raw = JSON.parse(readFileSync(join(ROOT, "resources", "voice-presets", "presets.json"), "utf8"));
    const list = Array.isArray(raw) ? raw : [];
    const ids = list.map((p) => p.id);
    list.length >= 2 ? ok(`随包内置音色预设 ${list.length} 个（开源项目官方成对样本）`) : fail("内置音色预设少于 2 个 —— presets.json 可能被清空");
    !ids.includes("taiwan-female") && !ids.includes("jarvis-butler")
      ? ok("已下线预设（台湾腔小美/贾维斯风）不再随包提供")
      : fail("下线预设又回来了 —— taiwan-female / jarvis-butler 必须移除");
    const missingPair = list.filter((p) => !p.wav || !p.refText || !existsSync(join(ROOT, "resources", "voice-presets", String(p.wav))));
    missingPair.length === 0
      ? ok("全部预设「wav + 参考文本」成对且音频文件存在")
      : fail(`预设缺 wav/参考文本或音频文件缺失：${missingPair.map((p) => p.id).join(", ")}`);
  } catch (error) {
    fail(`voice-presets/presets.json 不可读：${error.message}`);
  }

  // 试听提速：previewVoice 必须复用缓存的 worker（旧实现 finally 里 terminate = 每次冷启动）
  const voiceSrc = readFileSync(join(ROOT, "electron", "voice", "voice-service.ts"), "utf8");
  const previewStart = voiceSrc.indexOf("async previewVoice(");
  const previewEnd = voiceSrc.indexOf("schedulePreviewDispose(): void", previewStart);
  const previewBody = previewStart >= 0 && previewEnd > previewStart ? voiceSrc.slice(previewStart, previewEnd) : "";
  previewBody.includes("this.previewTts") && previewBody.includes("this.previewTtsKey")
    ? ok("音色试听复用缓存的预览 worker（模型常驻，第二次试听秒出）")
    : fail("previewVoice 又改成每次新建 worker —— 试听会退回「半天才出声」");
  !/finally\s*\{[^}]*terminate/.test(previewBody)
    ? ok("试听结束不再立刻销毁 worker（空闲 5 分钟才回收）")
    : fail("previewVoice 在 finally 里 terminate —— 缓存被每次清掉");

  // 试听反馈：设置页必须有「合成中 → 播放中（可停止）」三态
  const settingsSrc = readFileSync(join(ROOT, "src", "components", "VoiceSettingsSection.tsx"), "utf8");
  settingsSrc.includes("playCtlRef") && settingsSrc.includes('"playing"')
    ? ok("试听有播放态反馈且播放中可停止")
    : fail("试听反馈缺失 —— 只有合成中、没有播放态/停止按钮");
}


console.log(C.bold("\n【5】启动链健壮性（boot 副作用不得裸 await）"));
{
  // 为什么是硬失败：主进程 boot 是 `app.whenReady().then(async () => { … })`——里面任何一处
  // await 抛出都会变成 unhandled rejection，**整条启动链就此中断、引擎根本不 spawn**，
  // 表现是「界面能打开、发消息完全没有回复」，日志里只有一行 EPERM（09-11 实测：
  // memory-mode.json 写不进去）。下面三处是已知副作用点，必须各自 try/catch 兜底降级；
  // 以后往 boot 里加类似步骤，请照此办理。
  if (!mainSrc) {
    warn("找不到 electron/main.ts，跳过启动链守卫");
  } else {
    const guarded = [
      /try\s*\{\s*await applyMemoryMode\(await readMemoryMode\(\)\);\s*\}/,
      /try\s*\{\s*await scheduler\.start\(\);\s*\}/,
      /try\s*\{\s*await remote\.start\(\);\s*\}/,
    ];
    const missing = guarded.filter((re) => !re.test(mainSrc)).length;
    missing === 0
      ? ok("boot 的 applyMemoryMode / scheduler.start / remote.start 都有 try/catch 兜底")
      : fail(`boot 里有 ${missing} 处副作用没兜底 —— 裸 await 抛出会掐死引擎启动（界面能开但毫无回复）`);
    // 身份引导存量迁移（09-12）也必须满足两条：带 try/catch，且在 server.start() **之前**跑完
    // （引擎启动后档案才改就晚了——新会话可能已经按旧档案注入过引导）。
    if (!/migrateGreetedForExistingUsers\s*\(/.test(mainSrc)) {
      fail("main.ts 没有调用 migrateGreetedForExistingUsers —— 存量用户（有历史会话、档案无 greeted）升级后会被当成初次见面再引导一遍");
    } else {
      const iMig = mainSrc.indexOf("migrateGreetedForExistingUsers(");
      const iStart = mainSrc.indexOf("await server.start()");
      const guardedMig = /try\s*\{[^}]*migrateGreetedForExistingUsers\s*\(/.test(mainSrc);
      iMig > 0 && iStart > 0 && iMig < iStart && guardedMig
        ? ok("存量身份引导迁移在 server.start() 之前、且有 try/catch 兜底")
        : fail(`存量身份引导迁移位置不对（iMig=${iMig} iStart=${iStart} 有兜底=${guardedMig}）—— 必须在 server.start() 之前且包 try/catch`);
    }
  }
}

console.log(C.bold("\n【6】零阻塞宿主（codex:request 链上禁止同步磁盘 I/O）"));
{
  // 为什么是硬失败（09-12 多会话性能）：所有会话共用**同一个主进程事件循环**，而
  // codex:request 的处理链上只要出现同步文件读写，那段时间里**所有会话**的事件转发
  // 全部停摆 —— 这正是「多会话一起卡」的形态（实测曾有 9.9ms/次的同步 rollout 扫描，
  // 且渲染层每个回合结束都打一发）。所以这两个函数（内部是 readdirSync/readFileSync/
  // statSync + 逐行 JSON.parse）**不允许**再出现在 main.ts 里；它们已被 worker 版替代。
  //
  // 以后要往 codex:request 链上加"要看磁盘"的能力：先用 worker / 异步 fs，
  // 或把结果缓存在内存里；不要直接调同步函数。
  const SYNC_IO_CALLS = ["listRolloutThreads", "enrichThreadWithRolloutTools"];
  if (!mainSrc) {
    warn("找不到 electron/main.ts，跳过零阻塞宿主守卫");
  } else {
    const hits = SYNC_IO_CALLS.filter((name) => new RegExp(`\\b${name}\\s*\\(`).test(mainSrc));
    hits.length === 0
      ? ok("codex:request 链上没有任何同步磁盘 I/O 调用（rollout 扫描已移出主进程）")
      : fail(`main.ts 仍在调用同步 I/O 函数：${hits.join(", ")} —— 会阻塞所有会话的事件转发（应改用 worker 版）`);
  }
  // 附带守卫：worker 源码的内联产物必须存在且不落后于源文件。
  // 它由 `node scripts/gen-rollout-worker.mjs` 生成（已挂进 build:electron）——产物缺失
  // 会让打包后的应用 new Worker 直接失败、侧栏兜底与 resume 增强全丢。
  {
    const workerSrc = join(ROOT, "electron", "rollout-worker.cjs");
    const workerGen = join(ROOT, "electron", "rollout-worker-source.ts");
    if (!existsSync(workerSrc)) {
      fail("缺少 electron/rollout-worker.cjs（rollout 磁盘 I/O 的 worker 实现）");
    } else if (!existsSync(workerGen)) {
      fail("缺少 electron/rollout-worker-source.ts —— 先跑 `node scripts/gen-rollout-worker.mjs`（build:electron 已含）");
    } else {
      const srcM = statSync(workerSrc).mtimeMs;
      const genM = statSync(workerGen).mtimeMs;
      genM + 1 >= srcM
        ? ok("rollout worker 内联产物已生成且不落后于源文件")
        : fail("electron/rollout-worker-source.ts 落后于 rollout-worker.cjs —— 重新生成（build:electron 会做）");
    }
  }
}

console.log(C.bold("\n【7】验收入口唯一化 + 持久 profile（带历史，不得回落成空白临时目录）"));
{
  // 为什么是硬失败（09-12 用户两次定稿，原话「把旧的验收流程删干净，每次都写最新的 cpd 脚本
  // 验收，不然你老是卡住」/「为啥你每次拉起来的应用都没有历史记录，那测试有什么意义呢」）：
  //   ① 旧的「一堆历史场景 + 增量哈希 runner」：改一处主进程源码就连带选中十几个历史场景，
  //      一轮十几分钟，人卡在等它跑完 → **不允许再回来**；
  //   ② 收成一条 `scripts/accept.mjs`（CDP 直连），跑在**跨轮次复用的持久 profile** 上，
  //      首次把真实会话历史搬进来 → 测的才是有历史的真实形态。
  // 结构上必须满足这几条，缺一条这层能力就悄悄退化了：
  //   ① 旧流程（scenarios/ + run.mjs）确实已删除，验收入口只有 accept.mjs；
  //   ② harness 支持持久 profile（profileName → <root>/.e2e-profile/<name>，close 不删）；
  //   ③ 首次构建 profile 时会把**真实会话历史**搬进来（否则侧栏零会话，测了等于没测）；
  //   ④ `_rolloutFiles` 支持 { since } 过滤 —— 否则历史文件会把「本轮数据」的断言顶成假绿；
  //   ⑤ profile 目录必须被 gitignore —— 它含真实对话内容与本机 Key 密文。
  const legacy = ["scripts/e2e/run.mjs", "scripts/e2e/scenarios"];
  const leftovers = legacy.filter((p) => existsSync(join(ROOT, p)));
  leftovers.length === 0
    ? ok("旧的场景验收流程已删干净（scripts/e2e/run.mjs、scenarios/ 均不存在）")
    : fail(`旧的场景验收流程又回来了：${leftovers.join(", ")} —— 验收入口必须只有 scripts/accept.mjs`);
  const acceptPath = join(ROOT, "scripts", "accept.mjs");
  if (!existsSync(acceptPath)) {
    fail("缺少 scripts/accept.mjs（唯一验收入口）");
  } else {
    const acceptSrc = readFileSync(acceptPath, "utf8");
    /profileName:\s*value\("profile",\s*"main"\)/.test(acceptSrc)
      ? ok("accept.mjs 跑在持久 profile 上（默认 .e2e-profile/main，跨轮次累积历史）")
      : fail("accept.mjs 没有用持久 profile（profileName）—— 又会回到「每次拉起来都没有历史记录」");
  }
  const harnessPath = join(ROOT, "scripts", "e2e", "lib", "harness.mjs");
  if (!existsSync(harnessPath)) {
    fail("缺少 scripts/e2e/lib/harness.mjs（CDP 驱动）");
  } else {
    const src = readFileSync(harnessPath, "utf8");
    // 注意：判据必须锚在**代码**上，不能只搜 ".e2e-profile" 字样——注释里就写着这串，
    // 反证时整段实现删掉、只留注释也会假绿（实测踩过）。
    const hasResolve = /_resolveProfileDir\s*\(/.test(src) && /join\(\s*this\.root\s*,\s*"\.e2e-profile"/.test(src);
    hasResolve
      ? ok("harness 支持持久 profile（.e2e-profile/<name>，跨轮次复用、close 不删）")
      : fail("harness 丢了持久 profile 能力（_resolveProfileDir / .e2e-profile）—— 又回到「每轮空白 profile」了");
    const hasHistory = /export function seedRealSessionHistory\s*\(/.test(src)
      && /seedRealSessionHistory\s*\(this\.userDataDir\)/.test(src);
    hasHistory
      ? ok("首次建 profile 会把真实会话历史搬进来（侧栏不是空的）")
      : fail("harness 不再搬真实会话历史（seedRealSessionHistory）—— 空侧栏测不出切会话类问题");
    const hasSince = /_rolloutFiles\s*\(\s*opts\s*=\s*\{\}\s*\)/.test(src) && /since/.test(src);
    hasSince
      ? ok("harness 的 rollout 扫描支持 { since } 过滤（断言本轮数据不被历史顶成假绿）")
      : fail("harness._rolloutFiles 不支持 { since } —— 持久 profile 下历史文件会让「本轮」断言假绿");
  }
  const giPath = join(ROOT, ".gitignore");
  const gi = existsSync(giPath) ? readFileSync(giPath, "utf8") : "";
  /^\.e2e-profile\/?\s*$/m.test(gi)
    ? ok(".e2e-profile/ 已被 gitignore（含真实对话内容 + 本机 Key 密文，绝不入库）")
    : fail(".gitignore 里缺 .e2e-profile/ —— 持久 profile 含真实对话内容与 Key 密文，必须排除");

  // 身份引导的判据标记必须与 App.tsx 的注入文本同源。
  // 为什么是硬失败：判据一旦和真实注入文本脱钩，断言就会**恒定假绿**
  // （比如改文案后老标记再也匹配不到 → 「次会话没有引导」永远成立，等于没断言）。
  // 另注：判据只能看 rollout 里 role === "developer" 的消息——项目 AGENTS.md 里就有
  // 一段写着「初次见面」的文档，e2e 工作区 = 项目根 → 对整份文本 includes 会恒为真。
  {
    const appPath = join(ROOT, "src", "App.tsx");
    const inspectPath = join(ROOT, "scripts", "e2e", "lib", "rollout-inspect.mjs");
    if (!existsSync(appPath) || !existsSync(inspectPath)) {
      warn("找不到 App.tsx 或 rollout-inspect.mjs，跳过身份引导判据守卫");
    } else {
      const appSrc = readFileSync(appPath, "utf8");
      const inspectSrc = readFileSync(inspectPath, "utf8");
      const injected = /const IDENTITY_ONBOARD_INSTRUCTIONS = \[\s*"([^"]+)"/.exec(appSrc)?.[1] ?? "";
      const marker = /export const GREETING_MARKER = "([^"]+)"/.exec(inspectSrc)?.[1] ?? "";
      const guardsRole = /payload\?\.role === "developer"/.test(inspectSrc);
      if (!injected) fail("App.tsx 里找不到 IDENTITY_ONBOARD_INSTRUCTIONS 的首句（判据守卫失效）");
      else if (!marker) fail("rollout-inspect.mjs 里找不到 GREETING_MARKER 导出");
      else if (!injected.startsWith(marker)) {
        fail(`身份引导判据标记与注入文本不同源：marker=${marker.slice(0, 24)}… 注入首句=${injected.slice(0, 24)}…（断言会恒定假绿）`);
      } else if (!guardsRole) {
        fail("身份引导判据没有限定 role === \"developer\" —— 会被项目 AGENTS.md 的文档文本顶成假红");
      } else {
        ok("身份引导判据与 App.tsx 注入文本同源，且只看 developer 消息（不会被 AGENTS.md 干扰）");
      }
    }
  }
}

console.log(C.bold("\n【8】打包必备件：随包 automation-tools.zip（发布包三大安装项的前提）"));
{
  // 为什么是硬失败（09-12 用户实测发布包故障，原话「桌面自动化和浏览器自动化还有浏览内核，
  // 这三个都下载安装不了，直接下载失败」）：
  //   实测 v0.0.13 的 GitHub Release **只有两个 mac zip**，没有 automation-tools.zip 资产；
  //   而旧代码在「随包 zip 缺失」时是 **warn 后静默放过**，应用侧再回落去拉那个 404 地址 →
  //   用户看到「直接下载失败」，浏览器内核两项（依赖该包里的 playwright-cli / cloakbrowser）
  //   跟着一起废。结论：**包里没有 zip 的安装包就是坏包**，打包必须失败而不是放行。
  // 这里直接**跑一遍 before-pack**（指向一个空的 tools 根）来验证它真的会硬失败；
  // 再验证逃生阀 AUTOMATION_ZIP_OPTIONAL=1 能放行（否则发布链路会被彻底卡死）。
  const beforePack = join(ROOT, "scripts", "before-pack.cjs");
  if (!existsSync(beforePack)) {
    fail("缺少 scripts/before-pack.cjs —— 打包前不再保证 automation-tools.zip 存在");
  } else {
    const emptyRoot = join(ROOT, ".e2e-artifacts", "empty-tools-probe");
    try { rmSync(emptyRoot, { recursive: true, force: true }); } catch { /* 忽略 */ }
    mkdirSync(emptyRoot, { recursive: true });
    // 必须**真的调用**那个导出的钩子（直接 `node before-pack.cjs` 只是加载模块、永远退出 0）
    const invoke = `require(${JSON.stringify(beforePack)})().then(() => process.exit(0), (e) => { console.error(String((e && e.message) || e)); process.exit(1); });`;
    const strict = spawnSync(process.execPath, ["-e", invoke], {
      encoding: "utf8",
      env: { ...process.env, AUTOMATION_TOOLS_ROOT: emptyRoot, AUTOMATION_ZIP_OPTIONAL: "" },
    });
    const relaxed = spawnSync(process.execPath, ["-e", invoke], {
      encoding: "utf8",
      env: { ...process.env, AUTOMATION_TOOLS_ROOT: emptyRoot, AUTOMATION_ZIP_OPTIONAL: "1" },
    });
    try { rmSync(emptyRoot, { recursive: true, force: true }); } catch { /* 忽略 */ }
    strict.status !== 0
      ? ok("缺 automation-tools.zip 时 before-pack 会**中止打包**（不发坏包）")
      : fail("before-pack 在缺 zip 时仍然放行 —— 会打出「三大安装项全废」的坏包");
    relaxed.status === 0
      ? ok("逃生阀 AUTOMATION_ZIP_OPTIONAL=1 可显式放行（发布链路不会被卡死）")
      : fail("AUTOMATION_ZIP_OPTIONAL=1 也无法放行 —— 需要出无自动化包的版本时会卡死");
  }
  // 应用侧不得再回落在线下载（那个地址 404，只会把真问题藏起来）
  if (mainSrc) {
    const hasUrlFallback = /AUTOMATION_TOOLS_URL/.test(mainSrc) || /--url=\$\{AUTOMATION_TOOLS_URL\}/.test(mainSrc);
    hasUrlFallback
      ? fail("main.ts 又出现了 AUTOMATION_TOOLS_URL 在线回落 —— 那个 Release 资产不存在，只会变成「下载失败」")
      : ok("应用侧只认随包 zip（解压安装），不再回落到不存在的在线地址");
  }
}

console.log(C.bold("\n【9】过程折叠不得吞掉正文（长正文/最终答复永远是正文锚点）"));
{
  // 09-12 用户反馈「折叠消息把 codex 最后汇报的也折叠进去了」。
  // 实测某会话 rollout 条目序列：… AgentMessage(712字) → DynamicToolCall → Reasoning → AgentMessage(80字)。
  // 旧的「完成态」把「除最后一条正文以外的**全部**内容」塞进一个折叠组，而“最后一条正文”挑中的
  // 是那条 80 字收尾 → 712 字的**汇报本身**被当过程收了起来。这里跑真实现断言行为。
  const unit = (id, type, text = "") => ({ item: { id, type, text }, kind: type === "agentMessage" ? "body" : "foldable" });
  const units = [
    unit("tool1", "commandExecution"),
    unit("thinking1", "reasoning"),
    unit("body712", "agentMessage", "报".repeat(712)),
    unit("tool2", "dynamicToolCall"),
    unit("thinking2", "reasoning"),
    unit("body80", "agentMessage", "收".repeat(80)),
  ];
  const plan = planCompletedFold(units, "body80");
  const bodies = plan.filter((p) => p.kind === "body").map((p) => p.unit.item.id);
  const folded = plan.filter((p) => p.kind === "fold").flatMap((p) => p.units.map((u) => u.item.id));
  bodies.includes("body712")
    ? ok("长正文（712 字汇报）留在折叠组外 —— 不会再被「耗时」吞掉")
    : fail(`长正文被折叠进去了（folded=${folded.join(",")}）—— 用户报的正是这个`);
  bodies.includes("body80")
    ? ok("最终答复（80 字收尾）也留在折叠组外")
    : fail("最终答复被折叠进去了");
  !folded.includes("body712") && !folded.includes("body80")
    ? ok("折进过程组的只有工具/思考等真过程单元")
    : fail(`正文混进了过程组：${folded.join(",")}`);
  folded.includes("tool1") && folded.includes("thinking1") && folded.includes("tool2")
    ? ok("工具与思考仍照常收进过程组（折叠能力没被削弱）")
    : fail(`过程单元没被收进去（folded=${folded.join(",")}）—— 折叠功能被改坏了`);

  // ★ 用户中途插进来的消息（队列「立即」/ steer）不许被折进过程组（用户 09-13 定稿：
  //   「折叠还是一样的原理，过程都折叠，展示总结，用户中间发的消息不折叠进去」）。
  const midUnits = [
    unit("toolA", "commandExecution"),
    unit("userMid", "userMessage", "跑10轮"),
    unit("thinkingA", "reasoning"),
    unit("agentEnd", "agentMessage", "收".repeat(80)),
  ];
  const midPlan = planCompletedFold(midUnits, "agentEnd");
  const midBodies = midPlan.filter((p) => p.kind === "body").map((p) => p.unit.item.id);
  const midFolded = midPlan.filter((p) => p.kind === "fold").flatMap((p) => p.units.map((u) => u.item.id));
  midBodies.includes("userMid")
    ? ok("用户中途插入的消息留在折叠组外（不会被过程折叠吞掉）")
    : fail(`用户消息被折进过程组了（folded=${midFolded.join(",")}）—— 用户明确要求不折叠进去`);
}

// ---------- 【10】滚动/锚定状态的单一 owner（09-13 审计加的结构守卫） ----------
// 这一天的所有 bug 都长成同一个形状：**同一份状态有两个写者**、或**默认值选错逼每个调用点自己兜**。
// 下面三条把这类回归钉死在预检里（改坏了 build 阶段就红，不必等到验收）。
console.log(C.bold("\n【10】滚动与锚定状态：单一 owner + 默认值不许回退"));

{
  const appSrc = readFileSync(join(ROOT, "src", "App.tsx"), "utf8");
  const utilsSrc = readFileSync(join(ROOT, "src", "components", "scroll-utils.ts"), "utf8");

  // ① jumpToBottom 的第三个参数必须保持**必传**：一旦回退成可选并给 scrollHeight 默认值，
  //    "滚到底"就会重新变成"滚进尾部留白"（切回会话用户消息被切在视口顶 + 下方一大片空白）。
  !/getTarget\s*\?:/.test(utilsSrc) && /getTarget:\s*\(scroller: HTMLElement\)\s*=>\s*number/.test(utilsSrc)
    ? ok("jumpToBottom 的目标解析函数是必传参数（不会悄悄回退成 scrollHeight）")
    : fail("jumpToBottom 的 getTarget 又变成可选了 —— 默认值 scrollHeight 会把视口滚进尾部留白");

  // ② 「到底部」类落点不得再直写 scrollHeight：主时间线一律走 contentTailTarget。
  //    `contentRef` / `bodyRef` 是**卡片内部**的滚动容器（工具输出卡、思考卡），
  //    里面没有尾部留白，`scrollTop = scrollHeight` 在那里是正确的语义 —— 放行。
  const srcLines = appSrc.split("\n");
  const rawScrollHeightHits = srcLines
    .map((line, i) => ({ line: line.trim(), no: i + 1 }))
    .filter((entry) => /scrollTop\s*=\s*(scroller|el)\.scrollHeight/.test(entry.line))
    // 卡片内部的滚动容器（工具输出卡 contentRef / 思考卡 bodyRef）里没有尾部留白，
    // `scrollTop = scrollHeight` 在那里是正确的语义 —— 按"上文 15 行内绑定的容器"放行。
    .filter((entry) => {
      const context = srcLines.slice(Math.max(0, entry.no - 15), entry.no).join("\n");
      return !/contentRef\.current|bodyRef\.current/.test(context);
    });
  rawScrollHeightHits.length === 0
    ? ok("主时间线没有「scrollTop = scrollHeight」的直写（内容底部一律经 contentTailTarget 计算）")
    : fail(`主时间线仍有直写 scrollHeight 的落点：${rawScrollHeightHits.map((h) => `L${h.no}`).join(", ")}`);

  // ③ 锚定标志的写者数量做成"预算"：新增写入点就红，逼作者先想清楚这是不是第二个 owner。
  //    （09-13 之前「回到底部」按钮就绕过 releaseToUser 直写 anchorTopRef，留下半死的锚定状态。）
  const anchorWriters = appSrc
    .split("\n")
    .map((line, i) => ({ line: line.trim(), no: i + 1 }))
    .filter((entry) => /anchorTopRef\.current\s*=/.test(entry.line) && !entry.line.startsWith("*") && !entry.line.startsWith("//"));
  const ANCHOR_WRITER_BUDGET = 7; // 发送 2 处 + releaseToUser + 长消息 + 切换分支 + 声明初始化
  anchorWriters.length <= ANCHOR_WRITER_BUDGET
    ? ok(`锚定状态写者 ${anchorWriters.length} 处（预算 ${ANCHOR_WRITER_BUDGET}）—— 没有新增第二 owner`)
    : fail(`锚定状态写者增到 ${anchorWriters.length} 处（预算 ${ANCHOR_WRITER_BUDGET}）：${anchorWriters.map((w) => `L${w.no}`).join(", ")} —— 请先确认是不是又出现了第二个 owner，再调预算`);

  // ④ 点「回到底部」这类按钮必须走 releaseToUser（统一复位全部锚定状态），不许直写标志。
  /releaseToUserRef\.current\("button"\)/.test(appSrc)
    ? ok("「回到底部」按钮走 releaseToUser 统一复位（不再直写锚定标志）")
    : fail("「回到底部」按钮没有走 releaseToUser —— 直写标志会漏掉 pinGapLocked/pinFix 等复位");
}

// ---------- 【11】09-13 应用级审计的 P0 修复：不许回退 ----------
// 这几条都是"一退就出大事"的结构（退出时把引擎重新拉起、配置写坏就再也打不开窗口、
// 远控面没有鉴权、权限判据静默提权）。它们都不适合用 CDP 验收（要重启/断网/多网段），
// 所以钉在预检里：改坏了 build 阶段就红。
console.log(C.bold("\n【11】09-13 审计 P0 修复不得回退（引擎生命周期 / 启动链容错 / 远控鉴权 / 权限不提权）"));

{
  const serverSrc = readFileSync(join(ROOT, "electron", "codex-server.ts"), "utf8");
  const mainSrc = readFileSync(join(ROOT, "electron", "main.ts"), "utf8");
  const remoteSrc = readFileSync(join(ROOT, "electron", "remote.ts"), "utf8");
  const appSrc = readFileSync(join(ROOT, "src", "App.tsx"), "utf8");

  // ① 主动停止时不许自动拉起引擎（否则退出/更新过程中会重新 spawn 孤儿 codex.exe，抢 codex.exe 占用）
  const stopBody = serverSrc.slice(serverSrc.indexOf("  stop() {"), serverSrc.indexOf("  private write("));
  /this\.stopping = true/.test(stopBody) && /removeAllListeners\("exit"\)/.test(stopBody)
    ? ok("引擎 stop() 置 stopping 标志并摘掉 exit 监听（不会被自己的 exit→fail→restart 拉起）")
    : fail("stop() 没有置 stopping 或没摘 exit 监听 —— 退出时会把引擎重新 spawn 出来");
  /if \(this\.stopping\) \{/.test(serverSrc)
    ? ok("fail() 在主动停止时直接返回（不再无条件 restart）")
    : fail("fail() 缺少 stopping 判断 —— 主动停止会被自动重启反转");

  // ② 配置文件损坏不能让启动链断掉（曾导致"窗口根本不创建"，且进程持单实例锁，双击永远秒退）
  const readCustom = mainSrc.slice(mainSrc.indexOf("async function readCustomModel()"), mainSrc.indexOf("async function readCustomModels()"));
  !/throw error;/.test(readCustom)
    ? ok("readCustomModel 解析失败不再 throw（坏配置改名备份后按空配置继续启动）")
    : fail("readCustomModel 又抛异常了 —— 配置写坏一次就会永远打不开窗口");

  // ③ 远控控制面必须有鉴权，且不得再自动改系统防火墙策略
  // （配对端点 /api/pair* 是"投名状"入口，允许匿名；其余一律走 authorize）
  /private authorize\(/.test(remoteSrc) && /!this\.authorize\(req, res, url\)\) return;/.test(remoteSrc)
    ? ok("远控所有路由（含 WS 升级）统一走 authorize 鉴权")
    : fail("remote.ts 缺少统一鉴权入口 —— 控制面会再次对局域网裸奔");
  !/advfirewall", \["firewall", "add"/.test(remoteSrc)
    ? ok("远控不再自动添加防火墙放行规则（改由用户显式放行）")
    : fail("remote.ts 又在自动改系统防火墙策略了");

  // ③-b 09-13 二次加固：二维码/配对链接不得夹带凭据 + 必须有「6 位配对码 + 电脑端审批」
  //     （能力式 URL 会随链接、截图、浏览器历史、隧道日志外泄；拿到链接就等于拿到
  //      danger-full-access agent 的控制权。这两条都不适合用 CDP 验，钉在预检里）
  const pairUrlAuthBody = remoteSrc.slice(remoteSrc.indexOf("  pairUrlAuth() {"), remoteSrc.indexOf("  pairUrlAuth() {") + 400);
  const pairUrlForBody = remoteSrc.slice(remoteSrc.indexOf("  pairUrlFor("), remoteSrc.indexOf("  pairUrlFor(") + 400);
  const bindBody = remoteSrc.slice(remoteSrc.indexOf("  createBindSession("), remoteSrc.indexOf("  createBindSession(") + 700);
  !/accessToken/.test(pairUrlAuthBody) && !/accessToken/.test(pairUrlForBody) && !/k=\$\{this\.accessToken\}/.test(bindBody)
    ? ok("配对地址/二维码不再夹带一次性凭据（不再是能力式 URL）")
    : fail("配对地址又把 accessToken 拼进 URL 了 —— 链接或截图一泄露就等于交出控制权");
  /rotatePairingCode\(/.test(remoteSrc) && /checkPairingCode\(/.test(remoteSrc) && /approvePair\(/.test(remoteSrc) && /onPairRequest/.test(remoteSrc)
    ? ok("首次连接走「6 位配对码 + 电脑端审批」（配对码可轮换、审批有批准入口）")
    : fail("远控缺配对码或电脑端审批入口 —— 又退回成「扫码即控制」");

  // ③-c 09-13 语音通话审视的防回退：电平不进 state / 外发光不逐帧 paint blur / 静音拦截在喂识别之前
  const floatSrc = readFileSync(join(ROOT, "src", "components", "VoiceCallFloat.tsx"), "utf8");
  const cssSrc = readFileSync(join(ROOT, "src", "styles.css"), "utf8");
  !/setLevel\(/.test(floatSrc)
    ? ok("语音电平不进 React state（走 ref + body 级 CSS 变量，通话中不再每块音频全量重渲）")
    : fail("VoiceCallFloat 又用 setLevel() 驱动电平了 —— 每块音频全量重渲通话 UI");
  const avatarBlock = cssSrc.slice(cssSrc.indexOf(".voice-call-avatar {"), cssSrc.indexOf(".voice-call-avatar::before"));
  const orbBlock = cssSrc.slice(cssSrc.indexOf(".voice-mascot-orb {"), cssSrc.indexOf(".voice-mascot-orb::before"));
  const ballBlock = cssSrc.slice(cssSrc.indexOf(".voice-ball {"), cssSrc.indexOf(".voice-ball::before"));
  // 只查 box-shadow **声明**（transform/opacity 里的 var(--voice-level) 是合成器友好的合法用法）
  const blurGlow = (block) => (block.match(/box-shadow\s*:[^;]*;/g) ?? []).some((decl) => /var\(--voice-level/.test(decl));
  !blurGlow(avatarBlock) && !blurGlow(orbBlock) && !blurGlow(ballBlock)
    ? ok("外发光不再用 box-shadow blur 逐帧 paint（已改 ::before 光晕层 opacity/scale）")
    : fail("avatar/orb/悬浮球的外发光又回到 box-shadow blur —— 全屏遮罩上逐帧 paint，通话全程掉帧");
  /mutedRef\.current\).*?return;/.test(floatSrc.replace(/\r?\n\s*/g, " ")) || /if \(mutedRef\.current\) \{ applyLevel\(0\); return; \}/.test(floatSrc)
    ? ok("静音在喂识别之前拦截（voiceAudio 不收静音期的音频）")
    : fail("静音没有在喂识别之前拦截 —— 静音期间麦克风还在往识别送音频");

  // ④ 引擎 thread.status 是对象，不许再按字符串比较（否则"在跑"判据恒假）
  !/params\.status !== "inProgress"/.test(appSrc) && !/input\.status === "inProgress"/.test(readFileSync(join(ROOT, "src", "lib", "turn-fold.ts"), "utf8"))
    ? ok("运行态判据按 status?.type 判定（不会再因对象/字符串比较而恒假）")
    : fail("又有地方按字符串比较 engine thread.status —— 在跑会话会被判成已停止");

  // ⑥ 更新链必须有完整性校验，且安装路径不得由渲染层决定（否则 = 任意 exe 落盘并执行）
  const updSrc = readFileSync(join(ROOT, "electron", "updates.ts"), "utf8");
  const engineUpdSrc = readFileSync(join(ROOT, "electron", "engine-updater.ts"), "utf8");
  /sha256OfFile\(/.test(updSrc) && /expectedSha256/.test(updSrc)
    ? ok("应用更新包下载后比对 sha256（不匹配即删除并报错）")
    : fail("updates.ts 又不校验 sha256 了 —— 发布站被换掉就会静默装上攻击者的包");
  /更新包地址必须是 https/.test(updSrc)
    ? ok("应用更新包只允许 https（挡住明文替换）")
    : fail("updates.ts 又允许 http 明文下载安装包");
  /lastVerifiedUpdatePath/.test(mainSrc) && /path_not_verified/.test(mainSrc)
    ? ok("updates:install 只接受刚校验通过的那个文件（渲染层给不了任意路径）")
    : fail("updates:install 又能被渲染层指定任意安装路径了");
  !/rejectUnauthorized: false/.test(engineUpdSrc)
    ? ok("引擎更新默认校验 TLS 证书（自签名场景需显式 CODEX_HARNESS_INSECURE_TLS=1）")
    : fail("engine-updater.ts 又无条件关闭 TLS 校验 —— 下载物会被当场执行（--version 探针）");

  // ⑦ 渲染层入参校验层（09-13 审计 S5）：不许再把渲染层给的路径/根当文件系统与 shell 目标
  const mainForSec = readFileSync(join(ROOT, "electron", "main.ts"), "utf8");
  // fs:write 不得再用渲染层自报的 root 做包含性判断
  const fsWrite = mainForSec.slice(mainForSec.indexOf('ipcMain.handle("fs:write"'), mainForSec.indexOf('ipcMain.handle("fs:read"'));
  // fs:write：**保持原行为**（用户 09-13 明确要求「权限我可以自己改，不要限制死」）——
  // 因此这里不再断言可信根来源，只留一句记录，避免下轮又"顺手"把它改成限定工作区。
  ok("fs:write 保持原语义（渲染层给 root；用户明确要求不收紧，见 09-13 决策）");
  // external:open / browser:popout 不得无条件放行 file:
  !/url\.protocol !== "file:"\s*\)\s*throw new Error\("Unsupported URL"\)/.test(mainForSec)
    ? ok("external:open / popout 不再无条件放行 file:（只允许工作区内的 .html）")
    : fail("external:open 又放行任意 file: 了 —— 渲染层可让系统执行任意本地程序");
  // harness-image 必须收敛路径
  /protocol\.handle\("harness-image"[\s\S]{0,1200}?Forbidden/.test(mainForSec)
    ? ok("harness-image 协议收敛到图片 + 可信根内（不再任意读文件）")
    : fail("harness-image 协议没有路径收敛 —— 它是默认 session 上的任意文件读取原语");
  // 导航与新窗口收敛必须有
  /will-navigate/.test(mainForSec) && /setWindowOpenHandler/.test(mainForSec) && /will-attach-webview/.test(mainForSec)
    ? ok("主窗口导航 / 新窗口 / webview 挂载都有收敛（此前全仓零命中）")
    : fail("缺少 will-navigate / setWindowOpenHandler / will-attach-webview 收敛");
  // commands:delete 必须限定在命令目录内
  /只能删除自定义命令目录内的文件/.test(mainForSec)
    ? ok("commands:delete 限定在自定义命令目录内（deleteCustomCommand 是裸 fs.rm）")
    : fail("commands:delete 又变成任意路径删除了");

  // ⑤ 权限判据不得再"怀疑污染就落到全局默认"（曾把用户选的只读静默提成完全访问）
  !/const recordTrusted =/.test(appSrc) && /saferSandbox\(/.test(appSrc)
    ? ok("会话权限取「记录 / 全局默认」中更保守的一方（不会静默提权）")
    : fail("权限判据又回到「记录==引擎值即污染 → 落全局默认」—— 那会把只读会话悄悄变成完全访问");
}

// ---------- 汇总 ----------

console.log("");
if (hardFails === 0) {
  console.log(C.green(`预检通过${warns ? `（${warns} 条告警，见上）` : ""}`));
} else {
  console.log(C.red(`预检失败：${hardFails} 项硬失败${warns ? `，${warns} 条告警` : ""}`));
}
console.log(C.gray("下一步：npm run accept（拉起应用，在带历史的持久 profile 上跑本轮验收）"));
process.exit(hardFails === 0 ? 0 : 1);
