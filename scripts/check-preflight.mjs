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
import { createRequire } from "node:module";
import { resolveModelForOpen, shouldSyncOpenThread } from "../src/lib/model-scope.mjs";
import { ALIGN_RESULT, CONTINUITY_TEXT, shouldAlignProvider } from "../src/lib/provider-continuity.mjs";
import { SESSION_SCOPE_HEADING, composeScopeInstructions, sessionScopeBlock, sessionScopeSignature, stripScopeBlock } from "../src/lib/session-scope.mjs";
import { OWN_WRITE_TTL_MS, emptyRuntime, isOwnEcho, legacyMirror, migrateRuntime, normalizeRuntime, patchRuntime, rememberOwnWrite, runtimeSignature } from "../src/lib/thread-runtime.mjs";
import { planCompletedFold } from "../src/lib/turn-fold-plan.mjs";
import { createAec, createEchoGate, createSentenceChunker, resampleLinear, rmsOf } from "../src/lib/voice-aec.mjs";
import { createSpeakFilter, normalizeNumbers, numberToChinese, toSpeakableText } from "../src/lib/speak-text.mjs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

// ---------- 4a-2. 会话作用域块（模型自报「我是谁」必须读到会话级配置） ----------

console.log(C.bold("\n【4a-2】会话作用域块（会话级配置下发到会话自己的 instructions）"));

{
  const base = "You are a fully capable autonomous engineering agent. LANGUAGE: 简体中文。";
  const scope = {
    threadId: "01a09cb0-f2f8-7fb3-9de0-1b3bd5238a07",
    model: "glm-5.3-flash",
    provider: "custom906",
    effort: "ultra",
    sandbox: "danger-full-access",
    approval: "never",
    workspace: "D:\\生图专用文件",
  };

  // ① 块里必须真的写出四项会话级取值（缺一项模型就答不全，09-14 体检实测的坑）
  const block = sessionScopeBlock(scope);
  const wantLines = [`模型：${scope.model}`, `思考档位：${scope.effort}`, `执行权限：${scope.sandbox}`, `审批 ${scope.approval}`, `工作区：${scope.workspace}`];
  const missing = wantLines.filter((line) => !block.includes(line));
  missing.length === 0
    ? ok("作用域块含 模型/档位/权限/工作区 四项会话级取值")
    : fail(`作用域块缺项：${missing.join(" / ")}`);

  // ② 必须显式否定「全局顶层 = 当前配置」——这正是模型报错模型的原因
  const deniesGlobal = block.includes("不代表当前会话") && block.includes("一律以本节为准");
  deniesGlobal
    ? ok("作用域块显式声明全局顶层 model/effort 不代表当前会话")
    : fail("作用域块没说清「全局顶层 ≠ 当前会话」——模型会继续读 config.toml 顶部自报旧模型");

  // ③ 签名：模型/档位/权限变了必须变（否则不会重新下发）；工作区变了不必重发
  const sig = sessionScopeSignature(scope);
  const sameSig = sessionScopeSignature({ ...scope, workspace: "D:\\other", threadId: "other" });
  sig === sameSig ? ok("签名只看 模型/供应商/档位/权限（工作区变动不触发重发）") : fail("签名把工作区/会话 ID 也算进去了——会无谓重发");
  const modelChanged = sessionScopeSignature({ ...scope, model: "deepseek-v4-flash" });
  modelChanged !== sig ? ok("签名随模型变化（切模型后必定重新下发作用域）") : fail("换模型后签名不变 → 切了模型模型仍自报旧模型");
  const effortChanged = sessionScopeSignature({ ...scope, effort: "high" });
  effortChanged !== sig ? ok("签名随思考档位变化") : fail("换档位后签名不变 → 体检的档位项会读到旧值");

  // ④ 组合：基线原样在前（否则作用域块会把语言/工具/自动化说明顶掉），块在后
  const composed = composeScopeInstructions(base, block);
  composed.startsWith(base) ? ok("组合结果以全局基线开头（不顶掉 nuphus-call / 语言 / 自动化说明）") : fail("组合结果丢掉了基线——模型会不知道内置工具怎么用");
  composed.indexOf(SESSION_SCOPE_HEADING) > composed.indexOf(base) ? ok("作用域块拼在基线之后") : fail("作用域块位置不对");

  // ⑤ 幂等：反复下发不许叠加（每次改档位都发一次，叠加会长到失控）
  const twice = composeScopeInstructions(composed, sessionScopeBlock({ ...scope, effort: "high" }));
  const headings = twice.split(SESSION_SCOPE_HEADING).length - 1;
  headings === 1 ? ok("反复下发幂等（作用域块只有一份）") : fail(`反复下发后作用域块出现 ${headings} 份——历史块没被剥离`);
  twice.includes("思考档位：high") ? ok("幂等组合保留了最新档位") : fail("幂等组合把最新档位弄丢了");
  stripScopeBlock(composed) === base ? ok("strip 能还原出原始基线") : fail("strip 不能还原基线（幂等剥离有偏差）");

  // ⑥ 缺项防护：不能拼出 undefined / null（旧会话可能没有工作区等字段）
  const sparse = sessionScopeBlock({ threadId: "t", model: "glm-5.3-flash" });
  !/undefined|null/.test(sparse) ? ok("缺项回落为占位符，不拼出 undefined/null") : fail("缺项拼出了 undefined/null");
  composeScopeInstructions("", block) === block ? ok("无基线时只下发作用域块") : fail("无基线时组合结果异常");

  // 接线守卫：App.tsx 必须真的把作用域塞进会话级 instructions（否则纯函数再对也没生效）
  const scopeSrc = existsSync(join(ROOT, "src", "App.tsx")) ? readFileSync(join(ROOT, "src", "App.tsx"), "utf8") : "";
  if (!scopeSrc) {
    warn("找不到 src/App.tsx，跳过会话作用域接线守卫");
  } else {
    const imported = /from "\.\/lib\/session-scope\.mjs"/.test(scopeSrc);
    // 下发点：collaborationMode 块里必须真的带上 developer_instructions（不能只 import 不用）
    const wired = /collaborationMode:\s*\{[\s\S]{0,400}?developer_instructions:\s*composeScopeInstructions\(/.test(scopeSrc);
    // 覆盖三条路径：新建会话（thread/start 注入 + pushSessionScope）、打开旧会话、设置变更
    const covered = /pushSessionScope\(/.test(scopeSrc) && /buildSessionScope\(/.test(scopeSrc) && /thread\/settings\/update", \{ threadId: thread\.id, \.\.\.values/.test(scopeSrc);
    imported && wired && covered
      ? ok("会话作用域已接进 thread/settings/update 的 collaborationMode.settings.developer_instructions")
      : fail(`会话作用域未接上（import=${imported} wire=${wired} covered=${covered}）——模型仍会去读全局 config.toml 顶层自报模型`);

    // 反泄漏守卫（09-14 用户实测「模型还是串全局」的次因）：档案对账（setProviderModel apply:true
    // 会改写 custom-model.json / config.toml 顶层 model）**必须**先判「当前有没有打开的会话」，
    // 否则切会话模型会把全局档案写成该会话的模型 → 别的会话自查读全局就报成别人的模型。
    const archiveGuarded = /if \(threadRef\.current\?\.id\) return;[\s\S]{0,600}?setProviderModel\(\{ provider, model: match\[2\], apply: true/.test(scopeSrc);
    archiveGuarded
      ? ok("全局档案对账已加「无会话才写」守卫（切会话模型不再改写全局档案）")
      : fail("全局档案对账缺少会话守卫——切会话模型会把 custom-model.json / config.toml 顶层 model 改成该会话的模型");
  }
}

// ---------- 4a-3. 会话运行时配置：单一存放处（09-14 向 ZCode 形态收敛） ----------

console.log(C.bold("\n【4a-3】会话运行时配置（模型/档位/权限收敛到一个对象）"));

{
  const rtSrc = existsSync(join(ROOT, "src", "App.tsx")) ? readFileSync(join(ROOT, "src", "App.tsx"), "utf8") : "";

  // ① 空态：字段恒在（不然后面的对账逻辑又要到处 ?? ""）
  const empty = emptyRuntime();
  const hasAllFields = ["model", "effort", "sandbox", "approval"].every((k) => k in empty) && empty.rev === 0;
  hasAllFields ? ok("空运行时四个字段恒在（rev 从 0 起）") : fail(`空运行时字段不全：${JSON.stringify(empty)}`);

  // ② 归一化：坏 JSON / 缺字段 / 类型不对都不能炸，也不能吐 undefined
  const messy = normalizeRuntime({ model: undefined, effort: 5, sandbox: null, approval: "never" });
  messy.model === "" && messy.effort === "5" && messy.sandbox === "" && messy.approval === "never"
    ? ok("归一化：缺项回落空串、非字符串转字符串，不吐 undefined/null")
    : fail(`归一化结果异常：${JSON.stringify(messy)}`);
  normalizeRuntime("not-an-object").model === "" ? ok("归一化：非对象输入回落到空运行时") : fail("归一化：非对象输入没有兜住");

  // ③ 迁移：旧三键族只在「新键没有值」时说话（这是旧键唯一还能生效的时刻）
  const fromLegacy = migrateRuntime({ model: "custom:custom906:glm-5.3-flash", effort: "ultra", permissions: { sandbox: "danger-full-access", approval: "never" } });
  fromLegacy.model === "custom:custom906:glm-5.3-flash" && fromLegacy.effort === "ultra" && fromLegacy.sandbox === "danger-full-access" && fromLegacy.approval === "never"
    ? ok("迁移：新键缺失时从旧三键族补齐（含权限对象）")
    : fail(`迁移没补齐旧值：${JSON.stringify(fromLegacy)}`);
  const stringPerms = migrateRuntime({ permissions: JSON.stringify({ sandbox: "read-only", approval: "on-request" }) });
  stringPerms.sandbox === "read-only" ? ok("迁移：permissions 为 JSON 字符串也能解析") : fail("迁移：permissions 字符串形态解析失败");

  // ④ 新键优先：新键有值时旧键**一律忽略**（否则又变成两处权威，回到分叉老路）
  const newWins = migrateRuntime({ runtime: { model: "custom:custom906:deepseek-v4-flash", effort: "high" }, model: "custom:custom906:glm-5.3-flash", effort: "ultra" });
  newWins.model === "custom:custom906:deepseek-v4-flash" && newWins.effort === "high"
    ? ok("迁移：新键有值时旧键一律忽略（旧键只是镜像，不具权威性）")
    : fail(`迁移让旧值盖掉了新值：${JSON.stringify(newWins)}`);

  // ⑤ 打补丁：只改传入的字段，其余原样保留（以前三键族分家最容易互相踩空）
  const patched = patchRuntime(fromLegacy, { effort: "low" });
  patched.changed && patched.runtime.effort === "low" && patched.runtime.model === fromLegacy.model && patched.runtime.sandbox === fromLegacy.sandbox
    ? ok("打补丁：只覆盖传入字段，其余原样保留")
    : fail(`打补丁污染了其它字段：${JSON.stringify(patched.runtime)}`);

  // ⑥ 空值不抹掉已有值（等价旧 helper 的「空值直接 return」——对账逻辑不许把选择清成空）
  const noop = patchRuntime(fromLegacy, { model: "", effort: undefined });
  noop.changed === false && noop.runtime.model === fromLegacy.model
    ? ok("打补丁：空串/undefined 不抹掉已有值（changed=false，不落盘）")
    : fail("打补丁把已有值清成了空——对账逻辑会误伤用户的选择");

  // ⑦ rev 递增：只有真变化才 +1（给后续多窗口并发保护留的钩子）
  patchRuntime(fromLegacy, { model: "custom:custom906:deepseek-v4-flash" }).runtime.rev === fromLegacy.rev + 1
    ? ok("rev 只在真变化时递增（多窗口互踩可据此判定）")
    : fail("rev 没有按变化递增");

  // ⑧ 签名：四项齐全才变，用于「要不要重新下发给引擎」的去重
  runtimeSignature(fromLegacy) !== runtimeSignature({ ...fromLegacy, approval: "on-request" })
    ? ok("签名覆盖 模型/档位/沙箱/审批 四项")
    : fail("签名漏掉了权限项——改权限后不会重新下发作用域");

  // ⑨ 镜像是派生值：只写不读（读取路径若再从旧键取值，等于把三处存放又救活了）
  const mirror = legacyMirror(fromLegacy);
  mirror.model === fromLegacy.model && JSON.parse(mirror.permissions).sandbox === fromLegacy.sandbox
    ? ok("旧键镜像是派生值（模型/权限与新键一致）")
    : fail(`旧键镜像与新键不一致：${JSON.stringify(mirror)}`);

  // ⑩ 接线守卫：App.tsx 里六个 helper 必须全部走单一对象，不许再有裸的旧键 setItem
  if (!rtSrc) {
    warn("找不到 src/App.tsx，跳过会话运行时接线守卫");
  } else {
    const legacyWrites = (rtSrc.match(/setItem\(\s*(?:"|`)(?:thread-model-|thread-effort-|thread-permissions-)/g) ?? []).length;
    // 镜像写的是 `LEGACY_PREFIX.model + id`（常量拼接），所以**字面量**前缀的写入应当归零
    legacyWrites === 0
      ? ok("旧三键族已无散落写入（镜像统一经 LEGACY_PREFIX 常量派生）")
      : fail(`旧三键族仍有 ${legacyWrites} 处字面量写入——应全部经 saveThreadRuntime 派生`);
    const helpersGoThroughRuntime = /function saveThreadModel\([^)]*\)\s*\{\s*saveThreadRuntime\(/.test(rtSrc)
      && /function saveThreadEffort\([^)]*\)\s*\{\s*saveThreadRuntime\(/.test(rtSrc)
      && /function saveThreadPermissions\([^)]*\)\s*\{\s*saveThreadRuntime\(/.test(rtSrc);
    helpersGoThroughRuntime
      ? ok("模型/档位/权限三个 save helper 全部走 saveThreadRuntime 单一入口")
      : fail("还有 helper 在直接写旧键——三处存放没真正收敛");
    const readsGoThroughRuntime = /function loadThreadModel\(id: string\): string \{\s*return loadThreadRuntime\(id\)\.model;/.test(rtSrc);
    readsGoThroughRuntime ? ok("读取也统一走 loadThreadRuntime（旧键只在迁移时被读）") : fail("读取路径仍在直接读旧键");
  }
}

// ---------- 4a-4. 多窗口并发保护（主进程权威 + 广播）接线守卫 ----------

console.log(C.bold("\n【4a-4】多窗口并发保护（会话运行时配置由主进程权威落盘 + 跨窗口广播）"));

{
  const readMaybe = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "");
  const mainSrc = readMaybe("electron/main.ts");
  const preloadSrc = readMaybe("electron/preload.ts");
  const storeSrc = readMaybe("electron/thread-runtime-store.ts");
  const appSrc2 = readMaybe("src/App.tsx");

  if (!storeSrc || !mainSrc || !preloadSrc || !appSrc2) {
    warn("找不到主进程/渲染层源文件，跳过多窗口接线守卫");
  } else {
    storeSrc.includes("字段级合并") || /\.\.\.current,\s*\.\.\.fields/.test(storeSrc)
      ? ok("主进程 store 是字段级合并（不是整对象覆盖）——两个窗口改不同字段时不丢更新")
      : fail("主进程 store 疑似整对象覆盖：并发写不同字段会互相抹掉（04 断言会红）");
    /baseRev\s*!==\s*current\.rev/.test(storeSrc)
      ? ok("主进程按 baseRev 做冲突检测（等价 ZCode 的 revision）")
      : fail("主进程没有 baseRev 冲突检测——过期写入会静默覆盖别人的改动");
    /thread-runtime:patch/.test(mainSrc) && /thread-runtime:seed/.test(mainSrc) && /thread-runtime:get/.test(mainSrc)
      ? ok("三个 IPC 通道齐备（get / seed / patch）")
      : fail("IPC 通道不全（get/seed/patch 缺一）——渲染层对不上主进程");
    /broadcastHarnessEvent\(\{ type: "thread-runtime"/.test(mainSrc)
      ? ok("变更后广播到所有窗口（多窗口界面才能跟着变）")
      : fail("主进程改了却没广播——另一个窗口界面不会更新，下次写入会拿旧值覆盖回去");
    /patchThreadRuntime:\s*\(input/.test(preloadSrc) && /getThreadRuntime:/.test(preloadSrc)
      ? ok("preload 已透出 getThreadRuntime / patchThreadRuntime")
      : fail("preload 没透出会话运行时通道");
    /event\.type === "thread-runtime"/.test(appSrc2) && /admitThreadRuntime\(tid, \(event as any\)\.runtime, \{ fromRemote: true \}\)/.test(appSrc2)
      ? ok("渲染层订阅了 thread-runtime 广播并收敛到界面（admitThreadRuntime）")
      : fail("渲染层没订阅广播——跨窗口改动不会反映到界面");
    /void syncThreadRuntimeWithMain\(id\)/.test(appSrc2)
      ? ok("打开会话时与主进程对齐（无记录则播种、有记录以主进程为准）")
      : fail("openThread 没有与主进程对齐——本地镜像与权威值会各说各话");
  }
}

// ---------- 4a-4b. 回声识别：自己写的改动广播回来不许提示「另一个窗口改了」 ----------

console.log(C.bold("\n【4a-4b】会话运行时写入的「回声识别」（自己切模型不该提示别的窗口改了）"));

{
  const mine = { model: "custom:custom906:glm-5.3-flash", effort: "high", sandbox: "danger-full-access", approval: "never", rev: 3 };
  const store = new Map();
  const T0 = 1_000_000;
  rememberOwnWrite(store, "thread-1", mine, T0);

  // ① 同签名、TTL 内 = 自己的回声（主进程把自己的写入原样广播回来，且常早于 React 提交 state）
  isOwnEcho(store, "thread-1", { ...mine, rev: 4 }, T0 + 120)
    ? ok("自己刚写出去的运行时（同签名）在 TTL 内被判为回声 → 不提示「另一个窗口改了」")
    : fail("回声没被认出来——用户自己切模型会弹「另一个窗口更新了…」（09-14 实测误报）");

  // ② rev 不参与签名：主进程回填自己的 rev 后仍要认出回声（否则误报会复发）
  const sigIgnored = runtimeSignature({ ...mine, rev: 999 }) === runtimeSignature({ ...mine, rev: 0 });
  sigIgnored && isOwnEcho(store, "thread-1", { ...mine, rev: 999 }, T0 + 200)
    ? ok("签名忽略 rev（主进程的版本号不参与回声判定）")
    : fail("签名把 rev 算进去了——主进程回填 rev 后回声判不出来，误报会复发");

  // ③ 别的窗口改的是**别的值** → 不是回声（必须提示 + 同步界面）
  isOwnEcho(store, "thread-1", { ...mine, model: "custom:custom906:deepseek-v4-flash" }, T0 + 300)
    ? fail("不同取值也被当成自己的回声——别的窗口的改动会被静默吞掉（用户看不到同步提示）")
    : ok("别的窗口改成不同取值 → 不是回声（会提示并同步界面）");

  // ④ 别的会话的同值写入不能算本会话的回声（key 必须带 threadId）
  isOwnEcho(store, "thread-2", mine, T0 + 300)
    ? fail("回声表没按会话区分——A 会话的写入会把 B 会话的改动误判成回声")
    : ok("回声表按会话区分（threadId 参与 key）");

  // ⑤ TTL 过期后不再算回声（表不会长期污染判定）
  isOwnEcho(store, "thread-1", mine, T0 + OWN_WRITE_TTL_MS + 1)
    ? fail("TTL 失效后仍判为回声——表会长期把真事件吞掉")
    : ok(`超过 ${OWN_WRITE_TTL_MS}ms 的回声记录自动失效`);

  // ⑥ **只认最近一次写入**：一次用户动作可能连写多次（切模型先写档位、再写模型），
  //    中间态不能被当成「自己的回声」——否则另一个窗口恰好把值改回那个中间态时会被静默吞掉
  //    （实测：多窗口场景 ② 就是这么假红的）。
  const multi = new Map();
  const step1 = { ...mine, effort: "medium" };                       // 中间态（先写档位）
  const step2 = { ...step1, model: "custom:custom906:deepseek-v4-flash" }; // 再写模型
  rememberOwnWrite(multi, "thread-1", step1, T0);
  rememberOwnWrite(multi, "thread-1", step2, T0 + 10);
  isOwnEcho(multi, "thread-1", step2, T0 + 20)
    ? ok("最近一次写入仍被判为回声")
    : fail("最近一次写入没被判为回声——自己的回声会漏出去当提示");
  isOwnEcho(multi, "thread-1", step1, T0 + 30)
    ? fail("中间态仍被当成回声——另一个窗口把值改回中间态时会被静默吞掉（多窗口场景 ② 实测假红）")
    : ok("中间态不再算回声（只认最近一次写入）");

  // ⑦ 每会话只留一条记录（不随写入次数增长）
  const perThread = new Map();
  for (let i = 0; i < 50; i += 1) rememberOwnWrite(perThread, "thread-1", { ...mine, effort: `e${i}` }, T0 + i);
  perThread.size === 1
    ? ok("回声表每会话只留一条（不随写入次数增长）")
    : fail(`回声表按次增长：size=${perThread.size}`);

  // 接线守卫：渲染层必须真的用这两个纯函数，且广播分支要跳过提示
  const rtSrc = existsSync(join(ROOT, "src", "App.tsx")) ? readFileSync(join(ROOT, "src", "App.tsx"), "utf8") : "";
  if (!rtSrc) {
    warn("找不到 src/App.tsx，跳过回声接线守卫");
  } else {
    /rememberOwnWrite\(ownRuntimeWrites, id, runtime\)/.test(rtSrc) && /isOwnEcho\(ownRuntimeWrites, id, next\)/.test(rtSrc)
      ? ok("App.tsx 用纯函数做回声判定（写入时登记、广播时比对）")
      : fail("App.tsx 没有接回声判定——自己切模型仍会误报「另一个窗口改了」");
  }
}

// ---------- 4a-5. 审批卡形态：输入框上一行 + 点开预览（09-14 用户「卡片太大」） ----------

console.log(C.bold("\n【4a-5】审批卡：一行摘要 + 点开预览（多条不占满输入框）"));

{
  const uiSrc = existsSync(join(ROOT, "src", "App.tsx")) ? readFileSync(join(ROOT, "src", "App.tsx"), "utf8") : "";
  const cssSrc = existsSync(join(ROOT, "src", "styles.css")) ? readFileSync(join(ROOT, "src", "styles.css"), "utf8") : "";

  if (!uiSrc || !cssSrc) {
    warn("找不到 src/App.tsx 或 src/styles.css，跳过审批卡形态守卫");
  } else {
    // ① 形态：一行条（compact）+ 摘要按钮 + 可展开细节
    /className=\{`approval-card compact \$\{expanded \? "expanded" : ""\}`\}/.test(uiSrc)
      ? ok("审批卡用 compact 形态（收起态只占一行）")
      : fail("审批卡不是 compact 形态——会退回「每条一张大卡」（两条就占满输入框上方）");
    /className="approval-summary"/.test(uiSrc) && /setExpanded\(/.test(uiSrc)
      ? ok("摘要行可点开/收起（点一下预览正文）")
      : fail("摘要行不可展开——用户要的「可以预览审批内容」没实现");
    /\{expanded && \(/.test(uiSrc)
      ? ok("正文只在展开时渲染（DOM 里不常驻大块内容）")
      : fail("正文无条件渲染——收起态也会被撑成大卡（反证 F5 实测 heights 148/73/108）");
    // ② 要用户填东西的两类必须默认展开（收起了没法填）
    /useState\(\(\) => isUserInput \|\| isElicitation\)/.test(uiSrc)
      ? ok("问问题 / MCP elicitation 默认展开（不展开就没法填，属可用性）")
      : fail("需要输入的两类没有默认展开——收起了用户没法填");
    // ③ 多条统一收进限高容器
    /className="approval-stack" data-count=\{mine\.length\}/.test(uiSrc)
      ? ok("多条审批收进 .approval-stack（整体限高，条数再多也不推挤输入框）")
      : fail("审批卡没有统一容器——多条会一路往下堆");
    // ④ CSS：容器滚动 + 行高不压缩 + 摘要省略号
    const stackRule = cssSrc.match(/\.approval-stack\s*\{[^}]*\}/)?.[0] ?? "";
    /max-height:/.test(stackRule) && /overflow-y:\s*auto/.test(stackRule)
      ? ok("CSS：stack 限高 + overflow-y auto（多条出滚动条）")
      : fail("CSS：stack 没限高/没滚动——多条会把输入框顶出视口");
    // flex 列默认压缩子项（flex-shrink:1），行高会被压到 24px 且永不溢出 → 必须 flex: none
    /\.composer-wrap \.approval-stack \.approval-card\s*\{[^}]*flex:\s*none/.test(cssSrc)
      ? ok("CSS：行不参与压缩（flex:none，否则行高被压、滚动条永不出现）")
      : fail("CSS：缺少 flex:none——flex 列会把每行压扁且不产生滚动（实测 8 条时 scrollable=false）");
    /\.approval-card\.compact \.approval-peek\s*\{[^}]*text-overflow:\s*ellipsis/.test(cssSrc)
      ? ok("CSS：摘要行超长省略（长命令不把按钮挤出可视区）")
      : fail("CSS：摘要行没有省略号——长命令会撑破一行布局");
    // ⑨ 窄窗口自适应：`.composer-wrap` 是 .workspace 的 grid item，默认 min-width:auto
    // = 内容 min-content → 一行 nowrap 长命令会把整列撑到 1150px（实测），按钮被挤出可视区。
    /\.workspace\s*>\s*\.composer-wrap\s*\{[^}]*min-width:\s*0/.test(cssSrc)
      ? ok("CSS：输入区作为 grid item 已 min-width:0（窄窗口不被长命令撑宽）")
      : fail("CSS：缺少 `.workspace > .composer-wrap { min-width: 0 }`——窄窗口下审批行会被长命令撑到视口外，允许/拒绝看不见（反证 F6 实测 stackW=1150 / actionsRight=1153）");
  }
}

// ---------- 4a-6. 弹窗/浮层窄窗口自适应（静态守卫：覆盖 e2e 打不开的那些） ----------

console.log(C.bold("\n【4a-6】弹窗/浮层窄窗口自适应（固定宽度必须有视口夹取）"));

{
  const cssSrc2 = existsSync(join(ROOT, "src", "styles.css")) ? readFileSync(join(ROOT, "src", "styles.css"), "utf8") : "";
  if (!cssSrc2) {
    warn("找不到 src/styles.css，跳过弹窗自适应静态守卫");
  } else {
    // 弹窗/菜单/浮层的类名特征（与 e2e narrow-dialogs 场景覆盖的是同一批组件）
    const DIALOG = /modal|dialog|popup|palette|pop-|sheet|overlay|drawer|picker|dropdown|agent-ask|approval|goals-pop|thread-row-menu/;
    const blocks = [...cssSrc2.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    const offenders = [];
    for (const m of blocks) {
      const sel = m[1].split("\n").pop().trim();
      if (!DIALOG.test(sel)) continue;
      const body = m[2];
      const fixedWidth = Number((body.match(/(?:^|[;{\s])width\s*:\s*(\d{3,4})px\s*;/) || [])[1] || 0);
      if (!fixedWidth || fixedWidth < 340) continue;
      // 同一 block 里必须有视口相对夹取（max-width: 92vw / min(...vw) / calc(100vw - x) / 100%）
      const clamped = /max-width\s*:[^;]*(vw|100%|calc\()/.test(body) || /width\s*:\s*min\(/.test(body);
      if (!clamped) offenders.push({ sel, fixedWidth });
    }
    offenders.length === 0
      ? ok(`固定宽度 ≥340px 的弹窗都有视口夹取（检查了 ${blocks.filter((m) => DIALOG.test(m[1].split("\n").pop().trim())).length} 个弹窗/浮层规则）`)
      : fail(`这些弹窗是固定宽度且没有视口夹取，窄窗口会被裁到视口外：${offenders.map((o) => `${o.sel}(${o.fixedWidth}px)`).join("、")}——改为 width: min(${offenders[0].fixedWidth}px, 100%) 或补 max-width: 92vw`);

    // 输入框浮层用「贴住输入区左右边」的定位，天然自适应；两条都丢才会撑出视口
    const paletteRule = cssSrc2.match(/\.command-palette,\s*\.context-picker\s*\{[^}]*\}/)?.[0] ?? "";
    /left:\s*0/.test(paletteRule) && /right:\s*0/.test(paletteRule)
      ? ok("输入框浮层（# / @ / 命令面板）用 left:0 + right:0 贴住输入区（天然自适应）")
      : fail("输入框浮层不再贴左右边——窄窗口下会溢出视口（改回了固定宽度？）");
    // ⛔ 选择器要带词边界：`\.info-modal` 会先匹配到 `.info-modal-mask`，把掩罩的规则当成弹窗本体
    // （实测这条写松了会假红——掩罩本来就不该有宽度约束）。
    const ruleOf = (name) => cssSrc2.match(new RegExp(`\\.${name}(?![\\w-])[^{]*\\{[^}]*\\}`))?.[0] ?? "";
    const applyModals = ["connector-setup-modal", "expert-team-editor-modal", "subagent-editor-modal", "command-editor-modal", "memory-config-modal", "info-modal"];
    const missingClamp = applyModals.filter((name) => {
      const rule = ruleOf(name);
      return !rule || !/min\(|max-width|100vw|width:\s*100%/.test(rule);
    });
    missingClamp.length === 0
      ? ok("编辑器类弹窗（连接器 / 专家团队 / 子代理 / 命令 / 记忆 / 信息）都有视口或百分比约束")
      : fail(`编辑器弹窗缺少宽度约束：${missingClamp.join("、")}`);
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

  // 09-13 徽章键映射：主进程 channels:status 的微信键是 weixin，机器人档案存的是 wechat
  // —— 不映射的话扫码成功后状态永远「未连接」（映射丢失 = 回归）
  const appSrc = readFileSync(join(ROOT, "src", "App.tsx"), "utf8");
  appSrc.includes("CHANNEL_STATUS_KEY") && appSrc.includes('wechat: "weixin"')
    ? ok("渠道状态键已映射（wechat→weixin，连接后徽章即时变「已连接」）")
    : fail("徽章键映射丢失（CHANNEL_STATUS_KEY）—— 扫码成功后状态又会卡在「未连接」");
  appSrc.includes("bot-pair-banner") || appSrc.includes("botPairState")
    ? ok("机器人管理面板内嵌配对卡（码 + 待审批）")
    : fail("机器人面板的配对码横条丢失 —— 用户又要回「手机远控」看码");

  // 机器人档案持久化 + 已连接渠道自动恢复卡片（09-13 用户实丢档案 + 「已连接机器人没显示」）
  appSrc.includes("botsGet") && appSrc.includes("botsSet") && !/localStorage\.setItem\(.bots./.test(appSrc)
    ? ok("机器人档案持久化到主进程（userData/bots.json，不再只存 localStorage）")
    : fail("机器人档案又退回 localStorage 直写 —— 清缓存/换实例会整单丢失");
  appSrc.includes("channelsStatus?.() ?? Promise.resolve({})")
    ? ok("档案为空时从渠道登录态自动恢复机器人卡片（已连接的不会隐身）")
    : fail("已连接渠道的卡片自动恢复缺失 —— 登录态在、卡片丢了就隐身");
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
  // ⛔ 09-16 实测：GitHub 的 browser_download_url 是 **302** 到 release-assets.githubusercontent.com，
  //    而 downloadUpdate 过去是裸 request + `status >= 300 reject`，不跟随重定向 ⇒ 用户点「下载并安装」
  //    直接报 HTTP 302。这个坑直到 v0.0.18 才暴露（09-15 才切 GitHub 单源，而当时仓库 0 个 release，
  //    检查更新拿不到东西，从没走到下载这步）。守卫锚定「确实存在跟随重定向的分支」。
  //    反证（本地 HTTPS mock，不依赖外网）：摘掉该分支 → 下载报 HTTP 302，见 tmp 验收脚本。
  (/res\.headers\.location/.test(updSrc) && /MAX_REDIRECTS/.test(updSrc) && /new URL\(res\.headers\.location, url\)/.test(updSrc) ? ok : fail)(
    "updates.ts 下载跟随重定向（GitHub 资产是 302 → release-assets.githubusercontent.com）"
  );
  // ⛔ 第二条必须锚定「重定向分支**内部**确实调用了 hop（即下一跳会重新过协议校验）」——
  //    第一版只查 `const hop = async (url: string, depth: number)` 与 https 抛错两段文本存在，
  //    把整个重定向分支摘掉后这两段仍在，守卫照样绿（反证时发现的假绿）。
  (/hop\(next, depth \+ 1\)\.then\(resolve, reject\);/.test(updSrc) && /const hop = async \(url: string, depth: number\)/.test(updSrc) && /if \(parsed\.protocol !== "https:"\) throw/.test(updSrc) ? ok : fail)(
    "updates.ts 重定向逐跳校验 https（下一跳走 hop 重新校验，防降级到明文替换安装包）"
  );
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

// ---------- 【12】09-14 会话切换丝滑化（学 WorkBuddy）的结构守卫 ----------
// 这四条都是"改了但没接线 / 接错线"才会出问题的结构，光看 UI 是绿的：
// 虚拟化组件写了却没接进代码块渲染器、过滤器写了却仍无条件放行、窗口记忆被下一次重构顺手删掉。
console.log(C.bold("\n【12】09-14 切换丝滑化不得回退（diff 行级虚拟化 / 按会话事件裁剪 / 窗口与位置记忆）"));

{
  const appSrc2 = readFileSync(join(ROOT, "src", "App.tsx"), "utf8");
  const mainSrc2 = readFileSync(join(ROOT, "electron", "main.ts"), "utf8");
  const cssSrc = readFileSync(join(ROOT, "src", "styles.css"), "utf8");

  // ① 大 diff 行级虚拟化：组件存在 + 真的接进 ToolCodeBlock + 几何常量与 CSS 行高一致
  const hasVirtualComponent = /const VirtualDiffLines = memo\(/.test(appSrc2);
  const wiredInToolCode = /virtualizable\s*\n?\s*\?\s*<VirtualDiffLines/.test(appSrc2) || /<VirtualDiffLines text=\{text\}/.test(appSrc2);
  hasVirtualComponent && wiredInToolCode
    ? ok("大 diff 行级虚拟化已接线（VirtualDiffLines 在 ToolCodeBlock 内生效）")
    : fail("VirtualDiffLines 没接线到 ToolCodeBlock —— 写了不用等于没写");
  const lineHeightMatch = /const DIFF_LINE_HEIGHT = (\d+)/.exec(appSrc2);
  const cssLineHeight = /\.virtual-diff-line \{[^}]*height: (\d+)px/.exec(cssSrc);
  lineHeightMatch && cssLineHeight && lineHeightMatch[1] === cssLineHeight[1]
    ? ok(`虚拟化行高与 CSS 一致（${lineHeightMatch[1]}px）`)
    : fail(`虚拟化行高与 CSS 不一致（js=${lineHeightMatch?.[1] ?? "?"} css=${cssLineHeight?.[1] ?? "?"}）—— 会导致滚动错位`);
  // 只在 diff + 行数超阈值 + 未折行 + 非追字时启用（否则会破坏折行/流式）
  /language === "diff" && !revealing && !settings\.wrap && lineCount > DIFF_VIRTUAL_THRESHOLD/.test(appSrc2)
    ? ok("虚拟化启用条件收窄（仅 diff / 大文件 / 不折行 / 非流式追字）")
    : fail("虚拟化启用条件放宽了 —— 折行或流式追字场景会错位");

  // ② 按会话事件裁剪：必须真的 return null（而不是继续记账放行），且保留逃生阀与空事件保护
  const filterBody = mainSrc2.slice(mainSrc2.indexOf("function filterForRenderer"), mainSrc2.indexOf("function filterForRenderer") + 1200);
  /return null;/.test(filterBody)
    ? ok("按会话事件裁剪真的在裁（filterForRenderer 命中即 return null）")
    : fail("filterForRenderer 又变成无条件放行了 —— 多会话时 N 倍无用事件照旧跨进程");
  /HARNESS_EVENT_FILTER !== "off"/.test(mainSrc2)
    ? ok("裁剪保留逃生阀（HARNESS_EVENT_FILTER=off 一键回放行）")
    : fail("裁剪没有逃生阀 —— 线上出问题时无法不改代码回退");
  /watchedThreadIds\(\)/.test(mainSrc2) && /popoutThreadIds\.values\(\)/.test(mainSrc2)
    ? ok("裁剪把「独立弹窗锁定的会话」也算作必须放行（否则弹窗会永久转圈）")
    : fail("裁剪没考虑弹窗锁定会话 —— 弹窗会收不到自己的事件");
  const forwardedGuard = mainSrc2.slice(mainSrc2.indexOf('server.on("event"'), mainSrc2.indexOf('server.on("event"') + 400);
  /const forwarded = filterForRenderer\(event\);\s*if \(forwarded\) broadcastCodexEvent\(forwarded\)/.test(forwardedGuard)
    ? ok("裁剪结果先判空再广播（null 不会当成空事件发给渲染层）")
    : fail("裁剪后没有判空就广播 —— 渲染层会收到空事件");

  // ③ 窗口与阅读位置记忆：切回命中缓存时必须保留（不能被下一次重构顺手改回无条件重置）
  /const keepWindow = Boolean\(threadCacheRef\.current\.get\(id\)\)/.test(appSrc2)
    ? ok("命中缓存的切换会保留展开的渲染窗口")
    : fail("openThread 又无条件把渲染窗口重置成 TURN_WINDOW —— 切回长会话内容会缩水");
  /function recallScrollOffset/.test(appSrc2) && /rememberScrollPosition\(threadRef\.current\?\.id/.test(appSrc2)
    ? ok("离开时记阅读位置、切回时还原（贴底会话不记忆）")
    : fail("阅读位置记忆链断了一环（记或还原缺一）");
  /function touchTurnWindow/.test(appSrc2) && /TURN_WINDOW_MEMORY_KEEP/.test(appSrc2)
    ? ok("窗口记忆有 LRU 上限（长跑不会无界增长）")
    : fail("窗口记忆没有淘汰上限 —— 会话多了会一直涨");
}

// ---------- 【13】供应商自动接力：切换供应商后旧会话必须能直接继续用（09-14 用户定稿） ----------

console.log(C.bold("\n【13】供应商自动接力（切换供应商后旧会话直接用：原地迁移优先 + fork 接力兜底）"));
{
  // ① 判定纯函数：绑定未知一律不迁（不猜引擎绑定），绑定相同不迁，绑定不同才迁
  shouldAlignProvider("ppz123", "ppz456") === true
    ? ok("绑定 ≠ 激活 → 需要对齐")
    : fail("绑定 ≠ 激活却判定不需要对齐 —— 切换供应商后旧会话会继续用旧 Key 撞 401");
  shouldAlignProvider("ppz123", "ppz123") === false
    ? ok("绑定 = 激活 → 不需要对齐（打开会话零开销）")
    : fail("绑定相同时也判定要迁 —— 每次打开会话都会白跑一次 resume");
  shouldAlignProvider(undefined, "ppz123") === false && shouldAlignProvider("", "ppz123") === false
    ? ok("★ 绑定未知 → 不迁移（引擎是绑定的唯一权威，拿不到就不猜）")
    : fail("绑定未知就迁移 —— 会误迁（旧行为只在已确认绑定差异时才迁）");
  shouldAlignProvider("ppz123", "") === false
    ? ok("激活未知 → 不迁移")
    : fail("激活供应商未知就迁移 —— 迁到空目标会把会话弄坏");

  // ② 结果语义 + 文案（用户可感知的三个点：接力 / 历史没丢 / 旧会话已归档）
  const rs = Object.values(ALIGN_RESULT).join(",");
  rs === "same,migrated,relayed,failed"
    ? ok("结果语义齐全（same/migrated/relayed/failed）")
    : fail("ALIGN_RESULT 语义变了：" + rs);
  const txts = Object.values(CONTINUITY_TEXT).map((f) => f("甲 · m1")).join(" | ");
  /自动接力/.test(txts)
    ? ok("文案点明「自动接力」（用户要知道这是接力不是新开）")
    : fail("文案没提自动接力");
  /历史上下文与聊天记录完整保留/.test(txts)
    ? ok("★ 文案点明「历史上下文与聊天记录完整保留」（用户最关心的）")
    : fail("文案没有说明历史没丢 —— 用户会以为聊天记录没了");
  /原会话已归档/.test(CONTINUITY_TEXT.relayed("甲 · m1"))
    ? ok("接力文案点明「原会话已归档」（侧栏不留两坨）")
    : fail("接力文案没提旧会话归档");

  // ③ 接线守卫：统一入口 + 四个场景都走它
  const appSrc3 = readFileSync(join(ROOT, "src/App.tsx"), "utf8");
  /async function alignThreadToProvider\(/.test(appSrc3)
    ? ok("存在统一入口 alignThreadToProvider（四个场景共用一套行为与文案）")
    : fail("找不到 alignThreadToProvider —— 迁移逻辑又散回各处了");
  const alignCalls = (appSrc3.match(/alignThreadToProvider\(/g) ?? []).length;
  alignCalls >= 5
    ? ok(`四个场景都接了统一入口（打开/发送/401/切换，共 ${alignCalls} 处）`)
    : fail(`只有 ${alignCalls} 处引用 —— 有场景还在直接调 migrateThreadToProvider`);
  {
    const openPart = appSrc3.slice(appSrc3.indexOf("const willRealign"), appSrc3.indexOf("const willRealign") + 1400);
    /void alignThreadToProvider\(/.test(openPart)
      ? ok("打开会话即对齐且不阻塞打开（void，不 await）")
      : fail("打开会话的对齐是 await 的 —— 打开动作会被迁移卡住");
    /runningThreadIdsRef\.current\.has\(id\)/.test(openPart)
      ? ok("打开即对齐带「运行中不打断」守卫")
      : fail("打开即对齐没有运行中守卫 —— 可能打断正在跑的会话");
    /shouldAlignProvider\(resultProvider, activeNow\?\.provider\)/.test(openPart)
      ? ok("打开即对齐的判定走纯函数（绑定未知不迁）")
      : fail("打开即对齐自己写了一套判定 —— 与纯函数口径可能不一致");
  }
  /willRealign && activeNow\s*$/m.test(appSrc3) || /willRealign && activeNow\n\s*\?/.test(appSrc3)
    ? ok("★ 即将接力的会话，模型回填取激活模型（不让旧记录把迁移结果覆盖回去）")
    : fail("模型回填没考虑即将接力 —— 迁移写入会被 openThread 的旧值覆盖（丢更新）");
  /thread\/fork/.test(appSrc3) && /thread\/delete", \{ threadId \}/.test(appSrc3) && !/await archiveThread\(threadId\)/.test(appSrc3)
    ? ok("接力成功后旧会话自动删除（09-15 用户定稿：只保留新的，fork 自带完整历史）")
    : fail("接力兜底缺一环（fork 或 旧会话删除）—— 侧栏会留两坨/历史会丢");
  // 09-14 统一 provider id：接力后登记的是统一 id（HARNESS_PROVIDER_ID），不再登记 target.provider
  /threadProviderRef\.current\.set\(next\.id, (?:target\.provider|HARNESS_PROVIDER_ID)\)/.test(appSrc3)
    ? ok("接力后的新会话登记了真实绑定（下次发送不再重复迁移）")
    : fail("接力后没登记新绑定 —— 每次发送都会再迁一次");

  // ⛔ 09-15「新增的模型选不了」回归守卫：调用方**禁止**拿引擎真实绑定直接跟供应商 id 裸比较。
  //    统一内置 provider id（harness）之后，会话绑定恒为 `harness`、生效供应商是 `custom906`，
  //    裸比较恒为真 → 每次发送都误判「供应商变了」：① setProviderModel 默认 restart，每次发送
  //    都重启引擎；② setModelId(updated.model) 把用户刚选的模型改回供应商顶层 model（用户看到
  //    「选完一发消息就弹回旧模型」）。判定必须一律走 shouldAlignProvider（它明确「绑 harness
  //    = 天然对齐」）。断言按「裸比较的调用点」计数：只允许出现在纯模块内部。
  {
    const rawComparisons = appSrc3.match(/boundProvider\s*!==\s*(?:customModel\.provider|active\.provider|active\?\.provider)/g) ?? [];
    rawComparisons.length === 0
      ? ok("★ 供应商对齐判定全走 shouldAlignProvider（无裸比较：绑 harness 天然对齐）")
      : fail(`检测到 ${rawComparisons.length} 处裸比较 \`boundProvider !== <供应商id>\` —— ` +
             `统一 provider id 后恒为真，会导致每次发送重启引擎 + 用户选的模型被改回去（09-15 用户实测）`);
  }
}
// ---------- 【14】历史分页懒加载（切会话成本与会话长度无关；不得回退） ----------

console.log(C.bold("\n【14】历史分页懒加载（首屏一页 / 滚一屏补一页 / 上下文不受影响）"));
{
  const appSrc4 = readFileSync(join(ROOT, "src/App.tsx"), "utf8");
  const win = Number((appSrc4.match(/const TURN_WINDOW = (\d+);/) ?? [])[1] ?? NaN);
  Number.isFinite(win) && win > 0 && win <= 30
    ? ok(`首屏窗口 = ${win} 回合（用户 09-14 定稿：只挂最近 5 个回合，越少越快）`)
    : fail(`TURN_WINDOW = ${win} —— 窗口被改回全量/超大值，长会话首屏又会卡`);
  const page = Number((appSrc4.match(/const TURNS_PAGE = (\d+);/) ?? [])[1] ?? NaN);
  Number.isFinite(page) && page > 0 && page <= 40
    ? ok(`续载页大小 = ${page} 回合（一页一页，单次请求数据量有上限）`)
    : fail(`TURNS_PAGE = ${page} —— 页大小失控`);
  const lightSig = appSrc4.slice(appSrc4.indexOf("async function resumeThreadLight"), appSrc4.indexOf("async function resumeThreadLight") + 2200);
  /turnBudget = TURNS_PAGE/.test(lightSig)
    ? ok("打开会话只取一页（resume 不再让引擎水合全部历史）")
    : fail("resumeThreadLight 的取数预算不再是 TURNS_PAGE —— 首屏数据量又回到全量");
  /turnsCursorRef\.current\.set/.test(lightSig)
    ? ok("取页同时记下游标（往上滚能续到更早，不会重拉最新页）")
    : fail("取页没有记游标 —— 续拉会重复拉最新一页");
  const scrollFn = appSrc4.slice(appSrc4.indexOf("function onTimelineScroll"), appSrc4.indexOf("function onTimelineScroll") + 700);
  /userScrolledRef\.current/.test(scrollFn)
    ? ok("★ 自动续载只认「真实用户滚动」（滚轮/触摸/翻页键/拖滚动条）")
    : fail("自动续载又只看 scrollTop —— 打开会话的程序化滚动会让「用户没滚也加载」");
  const anchorFn = appSrc4.slice(appSrc4.indexOf("async function loadEarlierTurns"), appSrc4.indexOf("async function loadEarlierTurns") + 4200);
  /anchorTopBefore/.test(anchorFn) && /isConnected/.test(anchorFn)
    ? ok("★ 位置补偿用锚点元素位移（content-visibility 下 scrollHeight 不可靠）")
    : fail("位置补偿退回 scrollHeight 增量 —— 上方插入内容会把用户看的内容顶飞");
  /setEarlierLoadingId/.test(anchorFn) && /load-earlier-hint/.test(appSrc4)
    ? ok("续载有可见提示（不再是静默加载）")
    : fail("续载没有载入提示");
  /userScrolledRef\.current = false/.test(appSrc4)
    ? ok("切换会话时重置「用户滚过」标记（新会话需重新滚才自动续载）")
    : fail("切换会话没重置用户滚动标记 —— 切过去没滚也会自动加载");
  // 载入提示不许常驻（用户 09-14 实测「一直常驻，切会话都在」：续载请求挂起会让提示与
  // 防重入锁一起卡住，该会话再也加载不了更早历史）。三重保护缺一不可：
  /turns\/list timeout/.test(anchorFn) && /Promise\.race/.test(anchorFn)
    ? ok("续载请求有超时保护（引擎慢/挂起时不会卡住加载状态）")
    : fail("续载请求没有超时保护 —— 请求挂起会让「正在载入」常驻");
  /hintTimer = window\.setTimeout/.test(anchorFn) && /clearTimeout\(hintTimer\)/.test(anchorFn)
    ? ok("提示有兜底计时器（异常路径也会自动清除）")
    : fail("提示没有兜底清除 —— 任何异常路径都会留下常驻提示");
  /setEarlierLoadingId\(null\)/.test(appSrc4)
    ? ok("切换会话时清掉提示（不留上一次的加载态）")
    : fail("切换会话没清提示 —— 会串会话残留");
  // 滚回最新必须把往上滚展开的渲染窗口收回来（用户 09-14：「滚上去看历史、再滚下来，
  // 切换会话回来它还在渲染，不方便」）；⛔ 只收窗口、不动数据（否则再看历史要重新请求）。
  const collapseFn = appSrc4.slice(appSrc4.indexOf("function collapseTurnWindow"), appSrc4.indexOf("function collapseTurnWindow") + 700);
  /TURN_WINDOW/.test(collapseFn) && !/turns:/.test(collapseFn) && !/setThread/.test(collapseFn)
    ? ok("★ 窗口回收只重置渲染窗口（不动 thread.turns / 不触发拉取）")
    : fail("窗口回收动了数据 —— 收起后再看历史得重新请求，且可能与引擎状态打架");
  const scrollFn2 = appSrc4.slice(appSrc4.indexOf("function onTimelineScroll"), appSrc4.indexOf("function onTimelineScroll") + 900);
  /collapseTurnWindow\(id\)/.test(scrollFn2) && /clientHeight/.test(scrollFn2)
    ? ok("★ 滚回最新（贴底）即收回窗口，切会话回来是初始态")
    : fail("没有「贴底即收回窗口」—— 展开过的历史会一直撑着渲染");
  // 刻度尺必须与分页口径对齐（用户 09-14：「滚轮也要同步最新每页」「加一页就短一点」）
  const rulerPage = Number((appSrc4.match(/const RULER_PAGE = (\d+);/) ?? [])[1] ?? NaN);
  rulerPage === page
    ? ok(`刻度尺滚轮步长 = 一页（RULER_PAGE=${rulerPage} = TURNS_PAGE）`)
    : fail(`刻度尺滚轮步长(${rulerPage})与页大小(${page})不一致 —— 滚轮不会按页滑动`);
  // ⛔ 只查常量值没有鉴别力：必须查**使用点**是否真的绑了 RULER_PAGE（反证过：把使用点改回
  //    固定格数，常量断言照样绿）。
  /direction \* RULER_PAGE/.test(appSrc4)
    ? ok("滚轮使用点真的按页滑（direction * RULER_PAGE）")
    : fail("滚轮使用点没绑 RULER_PAGE —— 又回到固定格数地滑");
  const cssSrc = readFileSync(join(ROOT, "src/styles.css"), "utf8");
  /--ruler-pad/.test(appSrc4) && /var\(--ruler-pad/.test(cssSrc)
    ? ok("刻度间距走 CSS 变量（已加载刻度多时自动压缩：加一页就短一点）")
    : fail("刻度间距是写死的 —— 刻度多了只能靠滑动窗口藏起来");
  /setWindowOffset\(0\); \}, \[currentIndex\]\)/.test(appSrc4)
    ? ok("刻度选区只在阅读位置变化时归位（加载新页不会把选区拽走）")
    : fail("加载新页会把刻度选区拽回最新 —— 往上滚看历史时选区会乱跳");
}
// ---------- 【15】供应商列表交互（点开关要切详情，不许只拦冒泡） ----------

console.log(C.bold("\n【15】供应商列表：点开关（启用/停用）右侧详情必须跟随"));
{
  const appSrc5 = readFileSync(join(ROOT, "src/App.tsx"), "utf8");
  // ⛔ 用户 09-14 实测：点开关（开启某个供应商）后右侧还停在上一个供应商的界面 ——
  //    因为开关的 onClick 只 stopPropagation()，把行点击（切详情）也拦掉了。
  // ⛔ 检查窗口必须限定在「开关」各自的上下文里：裸 stopPropagation 这个模式在文件别处也有，
  //    全文件扫会假红（本轮踩过）。取每个 .provider-switch 出现点之前的 2600 字符做上下文。
  const swIdx = appSrc5.indexOf("provider-switch-ui");
  const swBlock = appSrc5.slice(Math.max(0, swIdx - 2600), swIdx);
  !/onClick=\{\(event\) => event\.stopPropagation\(\)\}/.test(swBlock)
    ? ok("供应商开关不再裸 stopPropagation（拦冒泡时同时把详情切过去）")
    : fail("供应商开关又是裸 stopPropagation —— 点开关后右侧会停在旧界面");
  /setEditingProvider\(p\.provider\)/.test(swBlock)
    ? ok("开关的 onClick 里确实切了编辑对象（setEditingProvider）")
    : fail("开关 onClick 里没有切编辑对象 —— 详情不会跟随");
}
// ---------- 【16】统一内置 provider id（切供应商零迁移；用户 09-14「做固定供应商 ID」） ----------

console.log(C.bold("\n【16】统一内置 provider id（新会话一律绑 harness，切供应商无需会话迁移）"));
{
  const libSrc = readFileSync(join(ROOT, "src/lib/provider-continuity.mjs"), "utf8");
  /export const HARNESS_PROVIDER_ID = "harness"/.test(libSrc)
    ? ok("纯模块导出统一 id 常量（harness）")
    : fail("没有统一 id 常量 —— 新会话又会绑用户配置的真实 id，切供应商还是要迁移");
  const judge = libSrc.slice(libSrc.indexOf("export function shouldAlignProvider"));
  /if \(bound === HARNESS_PROVIDER_ID\) return false;/.test(judge)
    ? ok("★ 绑定统一 id 视为天然对齐（不会再触发迁移/提示）")
    : fail("判定没短路统一 id —— 每次打开会话都会判定「绑定 ≠ 激活」");
  const appSrc6 = readFileSync(join(ROOT, "src/App.tsx"), "utf8");
  const pc = appSrc6.slice(appSrc6.indexOf("const providerConfig = useMemo"), appSrc6.indexOf("const providerConfig = useMemo") + 1200);
  /modelProvider: HARNESS_PROVIDER_ID/.test(pc) && /model_provider: HARNESS_PROVIDER_ID/.test(pc) && /\[HARNESS_PROVIDER_ID\]: \{/.test(pc)
    ? ok("新建会话的使用点绑 HARNESS_PROVIDER_ID（三处：modelProvider / model_provider / providers 键）")
    : fail("providerConfig 又绑回 customModel.provider —— 新会话会产生新的绑定差异");
  const mig = appSrc6.slice(appSrc6.indexOf("async function migrateThreadToProvider"), appSrc6.indexOf("async function alignThreadToProvider"));
  /modelProvider: HARNESS_PROVIDER_ID/.test(mig) && /threadProviderRef\.current\.set\(threadId, HARNESS_PROVIDER_ID\)/.test(mig)
    ? ok("迁移过的会话也绑统一 id（从此永久对齐，不再迁移）")
    : fail("迁移后仍绑真实 id —— 同一个会话会被反复迁移");
  const mainSrc6 = readFileSync(join(ROOT, "electron/main.ts"), "utf8");
  /\[model_providers\.harness\]/.test(mainSrc6) && /model_provider = "harness"/.test(mainSrc6)
    ? ok("config.toml 恒写 harness 段 + 顶层 model_provider 指向它（永远指向当前生效供应商）")
    : fail("config.toml 没有 harness 段 —— 引擎解析不到统一 id");

  // ⛔ 09-15 实测验证：新增/删除供应商后，**旧会话仍必须可用**（用户问「会不会又卡 BUG」）。
  //    两条机制缺一不可：
  //    ① 历史 id 别名段（aliasToml）——旧版本创建的会话 rollout 里记的是具体 provider id
  //       （pttoken / relay-* / 用户自定义 id）。该 id 从供应商列表删掉后，引擎若无对应段
  //       会报 "Model provider not found"、会话打不开。别名段把它指向当前生效供应商兜底。
  //       实测：复制真实 rollout、只改 session_meta.model_provider=已删除 id → 启动即补别名段，
  //       打开该会话 26 条历史正常渲染、发消息写回该会话本身、零错误。
  //    ② harness 防重护栏（stripHarnessTable）——档案里若混入 id=harness 的条目，
  //       会与恒写的 harness 段重复 → TOML duplicate key → 引擎拒载整份配置 = 应用全瘫。
  /collectSessionProviderIds/.test(mainSrc6) && /aliasIds/.test(mainSrc6) && /历史会话别名 → 当前生效供应商/.test(mainSrc6)
    ? ok("★ 历史 id 别名段机制在（旧会话引用的已删除供应商 id 仍能解析，会话打不开=灾难）")
    : fail("别名段机制缺失 —— 删掉/改名供应商后，引用它的旧会话会报 provider not found 打不开");
  /stripHarnessTable/.test(mainSrc6) && /model_providers\.harness/.test(mainSrc6)
    ? ok("★ harness 段防重护栏在（档案里混入 id=harness 不会产生 duplicate key 全瘫）")
    : fail("防重护栏缺失 —— 档案混入 harness 条目会写出重复 TOML 段，引擎拒载配置=应用全瘫");
  // 洞明的 systemPrompt 带技能包**绝对路径**，而内置专家 ensure 是「按 teamId 存在即不更新」——
  // 安装位置一变（开发版 ↔ 打包版、项目目录改名/搬家），存档里的旧路径就失效，而专家读不到
  // 技能包时**不报错、静默降级**。下面用**编译产物**跑真行为断言（真实现，不是文本匹配）。
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  let et = null;
  try { et = req(join(ROOT, "dist-electron/expert-teams.js")); } catch { et = null; }
  if (!et || typeof et.syncSkillsPath !== "function" || typeof et.syncSkillsPathInTeam !== "function") {
    fail("dist-electron/expert-teams.js 缺 syncSkillsPath / syncSkillsPathInTeam —— 技能包路径无法随安装位置自愈");
  } else {
    // 注意：buildDongmingExpertTeam 收的是**技能库根目录**，它自己会拼 `/dongming-code-review`。
    // 所以「当前真实路径」必须从它生成的提示词里读回来，不能手写 —— 手写会多拼一层子目录，断言假红。
    const base = et.buildDongmingExpertTeam("D:/old-place/resources/expert-skills").lead.systemPrompt;
    const OLD = et.readSkillsPath(base);
    const NEW = et.readSkillsPath(et.buildDongmingExpertTeam("E:/new-place/resources/expert-skills").lead.systemPrompt);
    const next = et.syncSkillsPath(base, NEW);
    next && next.includes(NEW) && !next.includes(OLD) && next.split(NEW).join(OLD) === base
      ? ok("★ 技能包路径变了只换那一段（其余内容逐字保留）")
      : fail("路径同步改动了路径之外的内容，或没替换成功");
    et.syncSkillsPath(base, OLD) === null
      ? ok("路径没变时返回 null（不写盘、不刷时间戳）")
      : fail("路径没变仍返回新值 —— 每次启动都会重写专家档案，掩盖真实变更");
    const stripped = base.split("\n").filter((l) => !l.includes(et.SKILLS_PATH_MARK) && !l.includes("都在这个目录下") && !l.includes("技能列表里没有")).join("\n");
    const refilled = et.syncSkillsPath(stripped, NEW);
    refilled && refilled.includes(NEW) && refilled.includes(et.SKILLS_PATH_MARK)
      ? ok("老播种 / 路径行被删 → 自动补回兜底段")
      : fail("缺路径行时不补回 —— 老存档里的洞明永远读不到技能包");
    et.syncSkillsPathInTeam(et.buildZhiweiExpertTeam(), et.buildDongmingExpertTeam(NEW)) === null
      ? ok("teamId 不匹配时不动手（不会把洞明的路径写到别的专家上）")
      : fail("teamId 校验缺失 —— 可能误改其它专家配置");
    /syncSkillsPathInTeam\(stored, solo\)/.test(mainSrc6)
      ? ok("启动 ensure 已接入路径同步（已存在 ≠ 已最新）")
      : fail("main.ts 没接入 syncSkillsPathInTeam —— 安装位置一变，洞明静默读不到技能包");
  }
}

// ---------- 【17】回合时序规范化（09-15「更早消息按钮与内容对不上」修复的纯逻辑守卫） ----------
{
  const { orderTurnsByTime, mergeTurnListsById, visibleTurnWindow } = await import("../src/lib/turn-order.mjs");
  const appSrc7 = readFileSync(join(ROOT, "src/App.tsx"), "utf8");
  const mk = (id, startedAt) => ({ id, startedAt, items: [], status: "completed" });
  // 用户真实事故形状：mergeLongerStreams 盲目前插部分快照 → [3..8, 1, 2]（最旧的贴到末尾）
  const corrupted = [3, 4, 5, 6, 7, 8, 1, 2].map((n) => mk(`t${n}`, 1000 + n));
  const fixed = orderTurnsByTime(corrupted);
  fixed.map((t) => t.id).join(",") === "t1,t2,t3,t4,t5,t6,t7,t8"
    ? ok("orderTurnsByTime 把乱序回合按 startedAt 规范化（用户事故形状 [3..8,1,2] → [1..8]）")
    : fail("orderTurnsByTime 排序不正确 —— 回合顺序错乱会再次出现");
  const missing = mergeTurnListsById([mk("t3", 1003), mk("t4", 1004)], [mk("t1", 1001)]);
  missing.length === 3 && missing[0].id === "t1"
    ? ok("mergeTurnListsById 去重合并 + 时序收口（部分快照不再盲目前插）")
    : fail("mergeTurnListsById 合并结果不对 —— 乱序/重复回合会再次进入状态");
  const dup = mergeTurnListsById([mk("t1", 1001), mk("t2", 1002)], [mk("t2", 1002), mk("t3", 1003)]);
  dup.length === 3
    ? ok("mergeTurnListsById 同 id 去重（游标翻页不再产生重复回合）")
    : fail("mergeTurnListsById 没去重 —— 「游标原地打转」的重复回合会回来");
  const live = [mk("old", 5000), mk("streaming")]; // 直播回合无 startedAt → 视为最新，排在最后
  const win = visibleTurnWindow(live, 5);
  win.ordered[win.ordered.length - 1]?.id === "streaming" && win.visible.length === 2
    ? ok("visibleTurnWindow：无 startedAt 的直播回合排最后 + 窗口切片正确")
    : fail("visibleTurnWindow 对直播回合/窗口切片的处理不对 —— 正在进行的回合可能被挤丢");
  /visibleTurnWindow\(thread\?\.turns/.test(appSrc7)
    ? ok("时间线渲染入口走 visibleTurnWindow（渲染前时序规范化）")
    : fail("时间线渲染没有走时序规范化 —— 状态乱序会直接画到界面上");
  /mergeTurnListsById\(mergedTurns, extraTurns\)/.test(appSrc7) && /mergeTurnListsById\(c\.turns \?\? \[\], earlier\)/.test(appSrc7)
    ? ok("mergeLongerStreams 与 loadEarlierTurns 都走去重时序合并（事故源头收口）")
    : fail("回合合并仍有盲目前插/拼接 —— 顺序错乱源头未收口");
}
// ---------- 【18】用户气泡不得悬浮遮挡后代内容（09-15 实测事故） ----------
// 事故：为了「发送后钉住用户消息、消掉一屏留白」，给当前回合的用户气泡加了
//   position: sticky; top: 54px; z-index: 5; background: var(--bg);
// 结果气泡变成不透明白底浮层，盖住同回合内从 top:170 起的助手消息（实测重叠 [170,204]），
// 表现是「消息中间几行被竖着切断」。2026-09-15 已撤销，回归文档流。
// 判据：用户气泡（.user-message / .user-message-stack）**不得**同时具备
//   ① 脱离文档流的定位（sticky/fixed/absolute）② 不透明底色 ③ 正向 z-index
// 三者同时命中即「会遮挡后代内容」，构建期直接拦下。
{
  const css = readFileSync(join(ROOT, "src/styles.css"), "utf8");
  // 抓所有以 .user-message 开头（含 .user-message-stack）的选择器块
  const blocks = [];
  const re = /([^{}]*\.user-message(?:-stack)?[^{}]*)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) blocks.push({ sel: m[1].trim(), body: m[2] });
  const offenders = [];
  for (const b of blocks) {
    const floats = /position\s*:\s*(sticky|fixed|absolute)/.test(b.body);
    // 不透明底色：background / background-color 且不是 transparent / rgba(x,x,x,0)
    const bgRaw = (b.body.match(/background(?:-color)?\s*:\s*([^;]+)/) || [])[1] || "";
    const solid = !!bgRaw && !/transparent|rgba\([^)]*,\s*0\s*\)|none/.test(bgRaw);
    const z = Number((b.body.match(/z-index\s*:\s*(-?\d+)/) || [])[1] ?? 0);
    if (floats && solid && z > 0) offenders.push(b.sel + "  →  " + bgRaw.trim());
  }
  offenders.length === 0
    ? ok("用户气泡不使用「悬浮 + 不透明底 + z-index」组合（不会遮挡后代内容）")
    : fail("用户气泡是悬浮遮罩，会盖住同回合的助手消息：\n        " + offenders.join("\n        "));

  // 09-15 反转：当前回合/流式回合**必须**用真实高度（content-visibility: visible），
  // 否则高度会在「真实值 / 估算值 300px / 0」之间塌陷 → 用户看到「消息滚过时闪一下」。
  // 实测：26ms 内 scrollHeight 在 1073/993/1213/913 之间反复跳。
  /\.turn-group\.running[^{}]*\{[^{}]*content-visibility:\s*visible/.test(css)
    ? ok("流式回合用真实高度（content-visibility: visible）—— 不会高度塌陷闪烁")
    : fail("流式回合没关掉 content-visibility —— 内容高度会在真实值/估算值间塌陷，滚动时闪一下");

  const app = readFileSync(join(ROOT, "src", "App.tsx"), "utf8");
  // 09-15：sticky 方案已彻底删除（连开关一起），不许再以任何形式回来
  /STICKY_USER_SLOT/.test(app)
    ? fail("STICKY_USER_SLOT 又出现了 —— sticky 方案已整体撤销，不要再引入")
    : ok("sticky 方案已彻底移除（无 STICKY_USER_SLOT 残留）");
  // 09-15 新方案：留白「只补缺口 + 内容增长时单向收缩到 0」。
  // 撑满一屏（clientHeight）会让滚动范围多出一屏（用户实测「怎么滚都没到真底」），已废弃。
  /const shrinkAnchorPad = /.test(app) && /anchorPadAppliedRef/.test(app)
    ? ok("发送锚定留白会随内容收缩（滚到底 = 真底，无多余空间）")
    : fail("留白没有收缩逻辑 —— 内容长起来后底部会多出一大段空白，滚不到真底");
}

// ---------- 【19】just-sent 必须挂在 .user-message 上（09-15 实测「发消息没有过渡动画」） ----------
// 事故：入场动画的 CSS 选择器是 `.user-message.just-sent`（要求同一元素同时具备两个类），
// 但代码把 just-sent 挂在**外层** .user-message-stack 上 → 选择器永不匹配。
// 实测：stack 的 animationName = "none"；把类挂到 .user-message 上立刻得到
//   "user-msg-send-in / 0.55s"。用户观感 = 「发消息没有过渡动画」。
{
  const app = readFileSync(join(ROOT, "src", "App.tsx"), "utf8");
  const css = readFileSync(join(ROOT, "src", "styles.css"), "utf8");

  // ① 类必须挂在内层 .user-message 的 className 里
  const innerOk = /message user-message[\s\S]{0,160}?justSent \? " just-sent"/.test(app);
  innerOk
    ? ok("just-sent 挂在 .user-message（与 CSS 选择器同元素）")
    : fail("just-sent 没有挂在 .user-message 上 —— CSS 是 .user-message.just-sent，挂外层不生效（发消息无入场动画）");

  // ② 不许再往 .user-message-stack 上挂（那是错的元素）
  /user-message-stack\$\{justSent/.test(app)
    ? fail("just-sent 又被挂回 .user-message-stack —— 该元素没有任何 just-sent 样式，动画不会播")
    : ok("just-sent 没挂在 .user-message-stack（不会再挂错元素）");

  // ③ 动画规则与光斑规则仍在（防止有人「修」成删 CSS）
  /@keyframes user-msg-send-in/.test(css)
    ? ok("入场动画 @keyframes user-msg-send-in 在（动画不会被误删）")
    : fail("@keyframes user-msg-send-in 缺失 —— 入场动画丢了");
  /\.user-message\.just-sent\s*\{/.test(css)
    ? ok("动画选择器 .user-message.just-sent 在（与挂载元素一致）")
    : fail(".user-message.just-sent 选择器缺失 —— 动画匹配不上");
}

// ---------- 【20】调度（09-15）：Codex 调度 专家/专家团/子智能体 干活的四层防护 ----------
{
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  let dp = null;
  try { dp = req(join(ROOT, "dist-electron/dispatch.js")); } catch { dp = null; }
  const mainSrc9 = readFileSync(join(ROOT, "electron/main.ts"), "utf8");
  const appSrc9 = readFileSync(join(ROOT, "src/App.tsx"), "utf8");
  if (!dp || typeof dp.canDispatchFrom !== "function") {
    fail("dist-electron/dispatch.js 缺 canDispatchFrom —— 调度硬闸无法断言");
  } else {
    // L3 执行侧硬闸（不靠提示词、不靠注册侧，给了工具也不认）
    const blocked = dp.canDispatchFrom({ isDelegated: true });
    !blocked.ok && /委派会话/.test(String(blocked.reason ?? ""))
      ? ok("★ L3 硬闸：被委派会话再发起调度被拒（防套娃的最后一道）")
      : fail("被委派会话没被拦住 —— 专家调专家会无限套娃");
    dp.canDispatchFrom({ isDelegated: false, depth: 0 }).ok
      ? ok("L3 硬闸放行用户直连会话（depth=0）")
      : fail("正常会话被误拦 —— 调度根本用不起来");
    !dp.canDispatchFrom({ depth: dp.MAX_DEPTH }).ok
      ? ok(`L3 深度闸：depth >= MAX_DEPTH(${dp.MAX_DEPTH}) 拒绝`)
      : fail("深度闸失效 —— 调用链可以无限延长");
    // L4 并发闸
    !dp.admitDispatch({ running: dp.MAX_CONCURRENT_DISPATCH }).ok
      ? ok(`L4 并发闸：running >= ${dp.MAX_CONCURRENT_DISPATCH} 时拒绝`)
      : fail("并发闸失效 —— 模型一口气发十几个会把引擎压垮");
    const clipped = dp.clipDispatchOutput("x".repeat(dp.MAX_OUTPUT_CHARS + 500), "th-1");
    clipped.length <= dp.MAX_OUTPUT_CHARS && /th-1/.test(clipped)
      ? ok("回传输出超长被截断且指向完整会话（不撑爆调用方上下文）")
      : fail("输出没有截断 —— 长产出会撑爆调用方上下文");
    // 目录 / 开关
    const targets9 = [
      { kind: "expert", key: "a", name: "甲", profession: "", description: "" },
      { kind: "team", key: "b", name: "乙", profession: "", description: "" },
      { kind: "subagent", key: "c", name: "丙", profession: "", description: "" },
    ];
    dp.filterTargetsBySwitch(targets9, { enabled: false }).length === 0
      ? ok("总开关关闭时不暴露任何可调度对象")
      : fail("总开关关了仍能看到可调度对象");
    const onlyTeam = dp.filterTargetsBySwitch(targets9, { enabled: true, expert: false, team: true, subagent: false });
    onlyTeam.length === 1 && onlyTeam[0].kind === "team"
      ? ok("三类勾选分别生效（取消专家/子智能体后只剩专家团）")
      : fail("勾选过滤不生效");
    dp.resolveDispatchTarget(targets9, { kind: "expert", name: "a" }).target?.name === "甲"
      && dp.resolveDispatchTarget(targets9, { kind: "expert", name: "甲" }).target?.key === "a"
      ? ok("目标解析同时认 key 与显示名（模型传中文名也能命中）")
      : fail("目标解析只认一种写法 —— 模型传中文名就会失败");
    !dp.resolveDispatchTarget(targets9, { kind: "expert", name: "不存在" }).target
      ? ok("目标不存在时返回可读错误（含当前可用清单）")
      : fail("目标解析对不存在的名字不报错");
    // L1 提示词层（软防护，但必须覆盖三类对象且措辞不能误伤本职能力）
    const teamBlock = dp.delegateScopeBlock({ kind: "team", name: "研发交付团" });
    /只能调度\*\*本团队/.test(teamBlock) && /不要调用其他专家团/.test(teamBlock)
      ? ok("★ L1 文案：专家团主理人只许调度本团成员、不许跨团/跨类型")
      : fail("专家团约束文案缺失 —— 主理人会跨团或跨类型乱调");
    /不要调用其他专家、专家团或子智能体/.test(dp.delegateScopeBlock({ kind: "expert", name: "洞明" }))
      ? ok("★ L1 文案：被委派的专家/子智能体直接干活、不许转派")
      : fail("被委派者没被禁止转派 —— 提示词层防护缺失");
    /不要委派给任何人/.test(dp.delegateScopeBlock({ kind: "member", name: "承枢" }))
      ? ok("L1 文案：团队成员直接干活不转派")
      : fail("团队成员约束文案缺失");
    // L2 注册侧（渲染层不给工具）
    /dispatchIsDelegated \? \[\] : subAgentTools/.test(appSrc9)
      ? ok("★ L2 注册侧：委派会话不注册 subAgentTools")
      : fail("委派会话仍会拿到 subAgentTools —— 套娃入口没关");
    // ⛔ 09-16 起调度工具改走内置 MCP（引擎硬约束：dynamicTools 只在 thread/start 生效，
    // resume/fork/turn/start 全部不认 —— 渲染层 dynamic 注册对老会话永远不可见）
    !/name: "agent_invoke"/.test(appSrc9)
      ? ok("★ 渲染层不再用 dynamicTools 注册 agent_invoke（对老会话无效，改走 MCP）")
      : fail("App.tsx 仍存在 dynamic agent_invoke 注册 —— 与 MCP 双通道会让模型混乱");
    /mcp_servers\.harness-dispatch/.test(mainSrc9) && /dispatchMcpTools\(\)/.test(mainSrc9) && /ensureDispatchHttp/.test(mainSrc9)
      ? ok("★ 内置调度 MCP 已接线（HTTP 直连 + /mcp 端点 + config.toml 注入）")
      : fail("调度 MCP 通道缺失 —— 老会话永远拿不到调度工具");
    // MCP 协议三件套：POST（JSON-RPC）+ GET（SSE 长连接，引擎 rmcp 客户端必开，缺了报
    // "fail to get common stream: Unexpected content type: None"）+ DELETE（会话终止）
    /text\/event-stream/.test(mainSrc9) && /req\.method === "GET"/.test(mainSrc9)
      ? ok("★ /mcp 端点提供 SSE 长连接（引擎 streamable-http 客户端必需）")
      : fail("缺 SSE 端点 —— 引擎连上也会立刻报 content type 错误");
    // 固定端口 + 令牌持久化：url 跨运行必须稳定，否则引擎连上一次运行的死端口
    /DISPATCH_FIXED_PORT/.test(mainSrc9) && /dispatch-token\.txt/.test(mainSrc9)
      ? ok("★ 调度 MCP 端口固定 + 令牌持久化（config 的 url 跨运行稳定）")
      : fail("端口/令牌每次变化 —— 引擎会连死端口，工具注册不上");
    /ownedMcpServers\.has\(ownedBase\)/.test(mainSrc9)
      ? ok("★ MCP 子段按 base 名归属（harness-dispatch.env 不再被当用户段拼回 → 重复键）")
      : fail("MCP 子段归属判定缺失 —— config.toml 会写出重复段，引擎拒载整份配置");
    // 09-16 用户实测「Codex 说归档了但侧栏还在」：MCP 归档端必须真调引擎 thread/archive，
    // 只标登记表的话侧栏（archived:false 过滤）不生效。
    /agent_archive_sessions/.test(mainSrc9) && /server\.request\("thread\/archive"/.test(mainSrc9)
      ? ok("★ 调度归档真调引擎 thread/archive（只标登记表 → 侧栏不消失）")
      : fail("归档只标登记表 —— 侧栏会话不会消失（09-16 用户实测踩过）");
    // 09-16 用户要求「调度完头像停留 20 秒，方便用户查看内容」
    /DELEGATE_RAIL_LINGER_MS/.test(appSrc9) && /20\d\d\d/.test(appSrc9)
      ? ok("★ 调度头像轨跑完停留 20 秒（用户要求：方便查看内容）")
      : fail("头像跑完立刻消失 —— 用户没时间看内容");
    /dispatchMcpCount !== 1/.test(mainSrc9)
      ? ok("★ 启动自愈检测调度 MCP 段缺失/重复（老配置自动重写）")
      : fail("启动自愈不检测调度 MCP 段 —— 老配置永远不会被修复");
    /canDispatchFrom\(/.test(mainSrc9) && /delegateRegistry\.register/.test(mainSrc9)
      ? ok("主进程调度入口接了硬闸与登记表")
      : fail("主进程没接硬闸 —— 只靠提示词拦不住");
    /\.\.\.\(teamTools\.length \? \{ dynamicTools: teamTools \} : \{\}\)/.test(mainSrc9)
      ? ok("dynamicTools 只给专家团主理人会话（其余被调会话一律不带调度工具）")
      : fail("dynamicTools 传参条件变了 —— 确认没有给执行型会话挂调度工具");
    // .d.mts 同步守卫（09-15 踩坑：allowJs=false，改了 .mjs 不改 .d.mts 会报 has no exported member）
    const dmts9 = readFileSync(join(ROOT, "src/lib/thread-runtime.d.mts"), "utf8");
    /dispatch: DispatchConfig/.test(dmts9) && /emptyDispatch\(\): DispatchConfig/.test(dmts9) && /dispatchSignature\(raw: unknown\): string/.test(dmts9)
      ? ok("thread-runtime.d.mts 已同步 dispatch 声明（.mjs 导出必须有配套 .d.mts）")
      : fail("thread-runtime.d.mts 缺 dispatch 声明 —— TS 会报 has no exported member");
    // ⛔ 「开关确认后重放 resume 同步工具面」是假绿（09-16 四个决定性实验：resume/fork/
    // turn/start/queue/start 都不认 dynamicTools，引擎只在 thread/start 收）—— 已改为 MCP 通道。
    // 这里钉住教训：applyDispatch 里不允许再出现「resume 补注册工具」的复活。
    !/resumeThreadLight\(\{ threadId: id, dynamicTools/.test(appSrc9)
      ? ok("★ 已移除无效的 resume 重放（dynamicTools 只在 thread/start 生效，引擎硬约束）")
      : fail("applyDispatch 又出现了 resume 重放 —— 那条路是假绿（引擎不认）");
    typeof dp.dispatchOffNoticeText === "function" && /调度已关闭/.test(dp.dispatchOffNoticeText())
      ? ok("关闭开关也有告知文案（权限收回要立刻让对方知道）")
      : fail("缺关闭告知文案");
    /agents:off-notice/.test(mainSrc9) && /dispatchOffNotice\(/.test(appSrc9)
      ? ok("关闭告知的 IPC 链路在（main handler + 渲染层调用）")
      : fail("关闭告知链路缺失");
    // 运行状态行的词库（09-16 扩充）：规模、按活动分、不得照搬竞品原文
    const phraseBlock = /const RUN_PHRASES = \[([\s\S]*?)\];/.exec(appSrc9)?.[1] ?? "";
    const phraseCount = (phraseBlock.match(/^\s*"/gm) || []).length;
    phraseCount >= 30
      ? ok(`话语池 ${phraseCount} 条（够丰富，不容易撞句）`)
      : fail(`话语池只有 ${phraseCount} 条 —— 用户很快就会看到重复`);
    /RUN_PHRASES_BY_ACTIVITY/.test(appSrc9) && /function pickRunPhrase/.test(appSrc9)
      ? ok("按活动类型各有专属话语 + 通用池兜底")
      : fail("话语没有按活动分 —— 全是通用句，不够贴切");
    !/WorkBuddy|Claude|Cursor|Copilot|GPT/.test(phraseBlock)
      ? ok("★ 话语池不含竞品品牌名（自创文案，不照搬）")
      : fail("话语池混进了竞品品牌名 —— 必须自创");
  }
}

// 【21】模型上下文：顶层 model_context_window 必须保持「不生成 + 主动清理」（09-16 用户实测 bug）
//  背景：它是引擎的**全局单值**，一旦写下就覆盖 catalog 里每个模型各自的 context_window →
//  只有「写配置那一刻生效的模型」的上下文是对的，切到别的模型仍是旧值（UI 显示的就是它）。
//  探针实证：scripts/probe-context-window.cjs（写顶层：模型 B 的 1M 被压成 128000；不写：B → 1000000）。
//  ⚠️ 断言必须用 (cond ? ok : fail) 形式：ok()/fail() 只接受一个消息参数，写成 ok(msg, cond) 会恒绿。
{
  const mainSrc = readFileSync(join(ROOT, "electron/main.ts"), "utf8");
  const noGen = !/`model_context_window\s*=\s*\$\{/.test(mainSrc);
  (noGen ? ok : fail)("【21】applyCustomModel 不再生成顶层 model_context_window（生成即全局覆盖每模型上下文）");
  const hasLegacy = /const legacyContextKey\s*=/.test(mainSrc);
  (hasLegacy ? ok : fail)("【21】保留废止键残留检查 legacyContextKey（老版本写下的旧值必须主动清掉）");
  const noOldCond = !/if \(written\s*!==\s*wanted/.test(mainSrc);
  (noOldCond ? ok : fail)("【21】自愈不再用 written !== wanted 判定（不写该键后该条件恒真，会每次启动整份重写）");
  const tomlLib = readFileSync(join(ROOT, "electron/config-toml.ts"), "utf8");
  const keyKept = /HARNESS_CONFIG_KEYS\s*=\s*new Set\(\[[^\]]*"model_context_window"/.test(tomlLib);
  (keyKept ? ok : fail)("【21】HARNESS_CONFIG_KEYS 仍含 model_context_window（留着才能丢弃旧值，移出会原样拼回）");
}

// ---------- 22. Windows 原生圆角：koffi 依赖与打包就位（否则打包后运行期 dlopen 静默失败） ----------

console.log(C.bold("\n【22】Windows 原生圆角：koffi 依赖与打包就位"));

{
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const deps = pkg.dependencies || {};
  (deps.koffi ? ok : fail)("生产依赖含 koffi（主进程用它调 DwmSetWindowAttribute 做原生圆角）");
  const unpack = (pkg.build && pkg.build.asarUnpack) || [];
  const unpackHas = (pat) => unpack.some((p) => p.includes(pat));
  (unpackHas("node_modules/koffi") ? ok : fail)("asarUnpack 含 node_modules/koffi/**（.node 必须在 asar 外才能 dlopen）");
  (unpackHas("node_modules/@koromix") ? ok : fail)("asarUnpack 含 node_modules/@koromix/**（koffi 的 win32 预编译子包）");
  if (process.platform === "win32") {
    (existsSync(join(ROOT, "node_modules/koffi")) ? ok : fail)("node_modules/koffi 已安装");
    (existsSync(join(ROOT, "node_modules/@koromix/koffi-win32-x64")) ? ok : fail)("node_modules/@koromix/koffi-win32-x64 预编译就位（Electron 44 / ABI 149 下实测可加载）");
  } else {
    ok("非 win32 平台：跳过原生二进制检查（圆角函数内已按 platform 静默跳过）");
  }
}

console.log(C.bold("\n【23】API 协议：引擎只支持 Responses，chat 不得从任何路径写进配置"));

{
  // 09-16 真实引擎探针实证（scripts/probe-wire-api.cjs，独立 CODEX_HOME + app-server）：
  // config.toml 写 `wire_api = "chat"` 时 initialize 能过，但 **turn/start 必报**
  //   `wire_api = "chat"` is no longer supported. How to fix: set `wire_api = "responses"`
  // → 之后每一个请求都失败（等同应用全瘫）。所以：① 写配置一律恒 responses；
  // ② UI 不得再提供这个永远无法生效的选项（否则用户选了保存时被静默改回，表现为「协议自己跳回 re 开头」）。
  const mainTs = readFileSync(join(ROOT, "electron/main.ts"), "utf8");
  const appTsx = readFileSync(join(ROOT, "src/App.tsx"), "utf8");
  const hookTs = readFileSync(join(ROOT, "src/hooks/useModelProviders.ts"), "utf8");
  (!appTsx.includes('<option value="chat">') ? ok : fail)("App.tsx 不再提供「Chat Completions」协议选项（引擎不支持，选了也白选）");
  (!appTsx.includes('target.wireApi === "chat"') ? ok : fail)("App.tsx 会话接力内联 config 不把 chat 透传给引擎");
  (!mainTs.includes('savedWire === "chat" ? "chat"') ? ok : fail)("main.ts 历史会话别名段不把 chat 透传进 config.toml");
  (!mainTs.includes('input.wireApi === "chat" ? "chat"') ? ok : fail)("main.ts 保存入口恒 responses，不透传用户选的 chat（不依赖下游归一兜底）");
  (!hookTs.includes("wireApi: wireUsed") ? ok : fail)("useModelProviders 探测不再把实测协议回写草稿（避免「探测说 chat、保存变 responses」自相矛盾）");
  (mainTs.includes('wireApi: "responses" }') ? ok : fail)("main.ts normalizeProvider 仍在读入侧归一化 chat（保命逻辑，别删）");
  (mainTs.includes('const activeWireApi = "responses"') ? ok : fail)("main.ts applyCustomModel 生成的 provider 段恒为 responses");
  (hookTs.includes('wireApi: "responses" }') ? ok : fail)("保存路径显式归一 wireApi（草稿里的历史 chat 写不进配置）");
}

// ---------- 【24】协议桥（09-16）：chat-only 网关必须能真正用起来 ----------

console.log(C.bold("\n【24】协议桥：引擎只发 Responses，chat-only 网关由本地桥转换接入"));

{
  // 背景：引擎只会 POST /responses；只提供 /v1/chat/completions 的网关（火山 coding、Kimi Coding 等）
  // 过去「连接测试通过、对话全废」。桥上按上游实际能力转发/转换（双向转换契约来自真实引擎实证：
  // scripts/probe-responses-contract.cjs 录契约、scripts/probe-bridge.cjs 跑端到端）。
  // 这里守两件事：① 接线不得被绕过（任何下发点漏了桥 = chat-only 网关静默不可用）；
  // ② 转换行为不得回退（直接跑编译产物的真实转换函数，毫秒级）。
  const bridgeSrc = existsSync(join(ROOT, "electron/responses-bridge.ts"))
    ? readFileSync(join(ROOT, "electron/responses-bridge.ts"), "utf8") : "";
  const mainTs = readFileSync(join(ROOT, "electron/main.ts"), "utf8");
  const preloadTs = readFileSync(join(ROOT, "electron/preload.ts"), "utf8");
  const typesSrc = readFileSync(join(ROOT, "src/vite-env.d.ts"), "utf8");
  const hookTs = readFileSync(join(ROOT, "src/hooks/useModelProviders.ts"), "utf8");

  (bridgeSrc.includes("export class ResponsesBridge") ? ok : fail)("electron/responses-bridge.ts 存在且导出 ResponsesBridge");
  (mainTs.includes("new ResponsesBridge(") ? ok : fail)("main.ts 实例化协议桥单例");
  (mainTs.includes("await responsesBridge.start()") ? ok : fail)("启动链拉起协议桥（失败必须降级直连，不掐死启动）");
  (mainTs.includes("bridgeRewriteProviderConfig(params)") ? ok : fail)("codex:request 统一兜底：渲染层自带的内联 provider 配置也走桥");
  (mainTs.includes("bridgeDial(activeNormalized.provider, activeNormalized.baseUrl)") ? ok : fail)("applyCustomModel 的 config.toml 地址走桥（provider/别名/harness 三段的单点来源）");
  (mainTs.includes('base_url = "${bridgeDial(alias, active.baseUrl)}"') ? ok : fail)("历史会话别名段的 base_url 也走桥");
  (!/base_url: baseUrl\b/.test(mainTs) ? ok : fail)("main.ts 不留任何直连 base_url 的内联配置（漏一处 = chat-only 网关静默不可用）");
  const dialedCount = (mainTs.match(/base_url: bridgeDial\(/g) ?? []).length;
  (dialedCount >= 7 ? ok : fail)(`main.ts 内联 provider 配置已桥化（实测 ${dialedCount} 处）`);
  (preloadTs.includes('"bridge:status"') && typesSrc.includes("bridgeStatus") ? ok : fail)("桥状态 IPC 在 preload 与类型声明里对齐");
  (hookTs.includes("本机协议桥") ? ok : fail)("useModelProviders 明确告知 chat-only 网关已由协议桥接管（不再说「无法使用」）");

  // ── 行为级：直接跑编译产物的真实转换函数 ──
  const compiled = join(ROOT, "dist-electron", "responses-bridge.js");
  const compiledOk = existsSync(compiled);
  (compiledOk ? ok : fail)("协议桥已编译进 dist-electron（随主进程一起打包，不依赖额外运行时文件）");
  if (compiledOk) {
    const requireBridge = createRequire(import.meta.url);
    const { toChatRequest, ChatStreamTranslator, chatJsonToResponses } = requireBridge(compiled);

    const chat = toChatRequest({
      model: "m", instructions: "SYS",
      input: [
        { type: "message", role: "developer", content: [{ type: "input_text", text: "DEV" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "HI" }] },
        { type: "function_call", name: "exec_command", arguments: '{"cmd":"x"}', call_id: "c1" },
        { type: "function_call_output", call_id: "c1", output: "done" },
        { type: "reasoning", summary: [] },
      ],
      tools: [
        { type: "function", name: "exec_command", description: "d", parameters: { type: "object" } },
        { type: "web_search" },
      ],
      tool_choice: "auto", reasoning: { effort: "xhigh", summary: "auto" },
      stream: true, store: false, include: ["reasoning.encrypted_content"], prompt_cache_key: "k",
    });
    (chat.messages[0]?.role === "system" && chat.messages[0]?.content === "SYS" ? ok : fail)("转换：instructions → 首条 system 消息");
    (chat.messages[1]?.role === "system" ? ok : fail)("转换：developer 角色降级为 system（多数学网关不认 developer）");
    (chat.messages[2]?.role === "user" ? ok : fail)("转换：用户消息原样保留");
    (chat.messages[3]?.tool_calls?.[0]?.function?.name === "exec_command" ? ok : fail)("转换：function_call → assistant.tool_calls");
    (chat.messages[4]?.role === "tool" && chat.messages[4]?.tool_call_id === "c1" ? ok : fail)("转换：function_call_output → role:tool（call_id 必须对得上）");
    (chat.tools?.length === 1 && chat.tools[0].function?.name === "exec_command" ? ok : fail)("转换：tools 变 chat 嵌套形状，非 function 工具（web_search）剔除");
    (chat.reasoning_effort === "high" ? ok : fail)("转换：xhigh 降档 high（Chat 网关不认 xhigh）");
    (chat.stream_options?.include_usage === true ? ok : fail)("转换：流式请求要求 usage（引擎 token 统计依赖它）");
    (!("store" in chat) && !("prompt_cache_key" in chat) && !("include" in chat) ? ok : fail)("转换：Responses 专有字段不得泄漏给 chat 上游");

    const textTranslator = new ChatStreamTranslator("m");
    let textOut = textTranslator.push({ choices: [{ delta: { content: "he" } }] });
    textOut += textTranslator.push({ choices: [{ delta: { content: "llo" } }] });
    textOut += textTranslator.push({ choices: [{ delta: {} }], usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 } });
    textOut += textTranslator.finish();
    (textOut.includes("response.created") && textOut.includes("response.output_item.added") && textOut.includes("response.output_text.delta") ? ok : fail)("回流：文本增量转成引擎消费的事件序列（实证过的最小集）");
    (textOut.includes('"text":"hello"') ? ok : fail)("回流：收尾事件里文本已合并完整");
    (textOut.includes("response.completed") && textOut.includes('"input_tokens":4') ? ok : fail)("回流：completed 事件带 usage 映射（prompt→input）");

    const toolTranslator = new ChatStreamTranslator("m");
    let toolOut = toolTranslator.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c9", type: "function", function: { name: "exec_command", arguments: "" } }] } }] });
    toolOut += toolTranslator.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":' } }] } }] });
    toolOut += toolTranslator.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "1}" } }] } }] });
    toolOut += toolTranslator.finish();
    (toolOut.includes("response.function_call_arguments.delta") ? ok : fail)("回流：工具参数分片转成 function_call_arguments.delta");
    (toolOut.includes('"arguments":"{\\"a\\":1}"') ? ok : fail)("回流：收尾时工具参数拼接完整（引擎据此执行）");
    (toolOut.includes('"call_id":"c9"') ? ok : fail)("回流：工具 call_id 原样保留（下一轮 function_call_output 要对回它）");

    const json = chatJsonToResponses({ choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }, "m");
    (json.output?.[0]?.content?.[0]?.text === "hi" ? ok : fail)("回流：非流式 chat 响应也能转成 responses 输出项");
  }
}

// ---------- 【25】思考等级（09-16 用户定稿）：低/中/高/最高/极高 + 跟着模型保存 ----------

console.log(C.bold("\n【25】思考等级：展示 低/中/高/最高/极高，默认 低/中/高/极高，档案随模型持久化"));
{
  // 背景：用户实测两件事——① 菜单名要改成「低 中 高 最高 极高」，一般模型默认就是
  // 低/中/高/极高；② 档位「不是跟着模型保存生效的，每次都要二次保存」：过去只有无会话时
  // 才写档案，会话里选的档位新会话弹回旧值。守两头：档位规则（真跑 effort.ts 的导出函数，
  // Node 自带 type-stripping 毫秒级）+ 接线（applyEffort 无条件写档案、chooseModel 读档案、
  // 主进程 catalog 与 UI 同规则、桥对 chat 上游压档）。
  const effortSrc = join(ROOT, "src", "lib", "effort.ts");
  const effortUrl = pathToFileURL(effortSrc).href;
  let exported = null;
  try {
    const probe = spawnSync(process.execPath, [
      "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e",
      `import * as e from ${JSON.stringify(effortUrl)}; console.log(JSON.stringify({` +
      ` custom: e.CUSTOM_MODEL_EFFORTS, all: e.ALL_EFFORTS,` +
      ` und: e.declaredModelEfforts(undefined), empty: e.declaredModelEfforts([]),` +
      ` legacy: e.declaredModelEfforts(["low", "medium", "high"]),` +
      ` legacyUltra: e.declaredModelEfforts(["low", "medium", "high", "ultra"]),` +
      ` untouched: e.declaredModelEfforts(["high"]),` +
      ` norm: e.normalizeEffort("xhigh") }));`,
    ], { encoding: "utf8" });
    exported = JSON.parse(probe.stdout.trim().split("\n").at(-1));
  } catch { /* 下面统一判红 */ }
  (exported ? ok : fail)("effort.ts 可被 Node type-stripping 直接加载（守卫跑的是真代码，不是字符串）");
  if (exported) {
    (JSON.stringify(exported.custom) === JSON.stringify(["low", "medium", "high", "xhigh"]) ? ok : fail)("默认档位 = 低/中/高/极高（用户定稿，不再是旧三档）");
    (JSON.stringify(exported.all) === JSON.stringify(["minimal", "low", "medium", "high", "ultra", "xhigh", "max"]) ? ok : fail)("菜单顺序 = 极简,低,中,高,最高,极高,（max 追加在末尾）（ultra 在 xhigh 前；max 是 09-16 补的引擎内置档，追加不打乱已定稿顺序）");
    (JSON.stringify(exported.und) === JSON.stringify(["low", "medium", "high", "xhigh"]) && JSON.stringify(exported.empty) === JSON.stringify(exported.und) ? ok : fail)("未声明档位（含探测合并的空数组）→ 回退新默认四档");
    (JSON.stringify(exported.legacy) === JSON.stringify(["low", "medium", "high", "xhigh"]) ? ok : fail)("旧版默认三档声明自动补「极高」（老档案升版后菜单不少档、引擎 catalog 不缺档）");
    (JSON.stringify(exported.legacyUltra) === JSON.stringify(["low", "medium", "high", "ultra", "xhigh"]) ? ok : fail)("旧版自动生成的三档+最高声明也补「极高」（真机档案实测的存量形态）；菜单正好=低中高最高极高");
    (JSON.stringify(exported.untouched) === JSON.stringify(["high"]) ? ok : fail)("用户显式声明的档位列表不被迁移污染");
    (exported.norm === "xhigh" ? ok : fail)("normalizeEffort 认识新档位值");
  }

  // ---- 09-18「档位不被支持」的自动兜底：真跑 effort-support.ts 的纯函数（node type-stripping） ----
  {
    const supportSrc = join(ROOT, "src", "lib", "effort-support.ts");
    const supportUrl = pathToFileURL(supportSrc).href;
    let s = null;
    try {
      const probe = spawnSync(process.execPath, [
        "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e",
        `import * as m from ${JSON.stringify(supportUrl)}; console.log(JSON.stringify({` +
        ` pos1: m.isUnsupportedEffortError("unsupported value for reasoning_effort: max"),` +
        ` pos2: m.isUnsupportedEffortError("Invalid value 'max' for 'reasoning_effort'"),` +
        ` pos3: m.isUnsupportedEffortError("不支持该思考档位"),` +
        ` neg1: m.isUnsupportedEffortError("Invalid API key provided"),` +
        ` neg2: m.isUnsupportedEffortError("rate limit exceeded"),` +
        ` neg3: m.isUnsupportedEffortError(""),` +
        ` fbMax: m.pickEffortFallback("max", []),` +
        ` fbXhigh: m.pickEffortFallback("xhigh", []),` +
        ` fbHigh: m.pickEffortFallback("high", []),` +
        ` fbMin: m.pickEffortFallback("minimal", []),` +
        ` fbUnknown: m.pickEffortFallback("bogus", []),` +
        ` fbSkipBlocked: m.pickEffortFallback("max", ["xhigh", "ultra"]),` +
        ` fbAllBlocked: m.pickEffortFallback("high", ["medium", "low", "minimal"]) }));`,
      ], { encoding: "utf8" });
      s = JSON.parse(probe.stdout.trim().split("\n").at(-1));
    } catch { /* 下面统一判红 */ }
    (s ? ok : fail)("effort-support.ts 可被 Node type-stripping 直接加载（守卫跑的是真代码）");
    if (s) {
      (s.pos1 && s.pos2 && s.pos3 ? ok : fail)("档位不支持类错误能识别（英文 unsupported / invalid value / 中文「不支持」）");
      (!s.neg1 && !s.neg2 && !s.neg3 ? ok : fail)("非档位错误不误判（invalid api key / 限流 / 空串 都不能触发降档重发）");
      (s.fbMax === "xhigh" && s.fbXhigh === "ultra" && s.fbHigh === "medium" ? ok : fail)("降档链：max→极高、极高→最高、高→中（逐级保守）");
      (s.fbMin === null ? ok : fail)("已是最低档 → 返回 null（不再重发，改为提示用户手动选）");
      (s.fbUnknown === "high" ? ok : fail)("未知档位 → 回落安全档 high");
      (s.fbSkipBlocked === "high" ? ok : fail)("降档会跳过该模型已标记不支持的档位（max→跳过极高/最高→高）");
      (s.fbAllBlocked === null ? ok : fail)("更低档全被标记时返回 null（不会无限降）");
    }
  }

  const appTs = readFileSync(join(ROOT, "src", "App.tsx"), "utf8");
  const applyEffortBody = appTs.slice(appTs.indexOf("function applyEffort"), appTs.indexOf("function changeEffort"));
  (applyEffortBody.includes("setProviderEffort") ? ok : fail)("applyEffort 会把档位写进档案（跟着模型保存的写入端）");
  (!applyEffortBody.includes("!threadRef.current?.id && customModel") ? ok : fail)("写档案不再被「无会话」条件挡住（旧守卫 = 二次保存 bug 的根源）");
  (appTs.includes("const archiveEffort = (customModel?.models ?? []).find((m) => m.id === next?.model)?.effort") ? ok : fail)("chooseModel 切模型时读档案 models[].effort（读取端）");
  // 09-18：模型档位声明（models[].efforts）随模型配置里的勾选区一起删除 —— 档位是**会话级**选择，
  // 不再 upsert 补声明。副作用要守：旧实现每次选到"未声明档位"都重写 model-catalog.json，
  // 而 current 是过期闭包（09-16 真机定位的档案回退第二个根源）——现在整段逻辑没了，反而更安全。
  (!appTs.includes("efforts: [...(current.efforts ?? []), value]") ? ok : fail)("changeEffort 不再 upsert 补档位声明（09-18：档位不是模型属性，选不了就直接自动降档）");
  (appTs.includes('xhigh: "极高"') && appTs.includes('ultra: "最高"') && appTs.includes('low: "低"') && appTs.includes('medium: "中"') && appTs.includes('high: "高"') ? ok : fail)("展示名：低/中/高/最高/极高（极高=xhigh 顶格档，最高=ultra 扩展档）");
  (appTs.includes("极高: \"xhigh\"") ? ok : fail)("/effort 命令别名含「极高」");

  const mainTs = readFileSync(join(ROOT, "electron", "main.ts"), "utf8");
  (mainTs.includes('m.efforts?.length ? m.efforts : ["minimal", "low", "medium", "high", "ultra", "xhigh", "max"]') ? ok : fail)("catalog：空数组声明也回退全档位（探测合并会写 efforts: []，旧实现会声明出空档位表）");
  (mainTs.includes('["low", "medium", "high"].every((e) => efforts.includes') ? ok : fail)("catalog：旧版三档声明同步补「极高」（与 UI 同规则）");

  const bridgeTs = readFileSync(join(ROOT, "electron", "responses-bridge.ts"), "utf8");
  (bridgeTs.includes('effort === "xhigh" || effort === "ultra" ? "high" : effort') ? ok : fail)("桥：chat 上游把 xhigh/ultra 压到 high（网关不认扩展档）");
}

// ---------- 【26】打包瘦身：浏览器内核不随包 + 国内镜像按需下载 ----------
// 背景：安装包 900MB 的头号元凶是随包内置的两套 Chromium 内核（pw-browsers ~700MB +
// cloak-cache ~536MB 原始体积），而应用本来就有「开发工具」页的按需下载入口。
// 09-16 起内核不再打进包，改为下载时默认走国内镜像、失败回落官方源。这里守三件事：
// ① extraResources / mac copy 不得把内核目录又塞回包里（体积回潮守卫）；
// ② 镜像常量必须在（没有它，国内用户下载会退回龟速官方源）；
// ③ 主进程两条下载分支都必须走 runBrowserDownload（镜像优先 + 官方源回落），
//    谁直接 spawn 官方源 = 绕过加速，同样算回归。
{
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const extraFrom = (pkg.build?.extraResources ?? []).map((entry) => entry.from ?? entry);
  const unbundled = [
    "resources/tools/pw-browsers", "resources/tools/cloak-cache",
    "resources/tools/pwsh", "resources/tools/git", "resources/tools/python",
    "resources/tools/rg", "resources/tools/uv", "resources/tools/cmake",
    "resources/tools/ninja", "resources/tools/sevenzip", "resources/tools/jq",
  ];
  for (const source of unbundled) {
    (!extraFrom.includes(source) ? ok : fail)(`package.json extraResources 不随包内置 ${source.replace("resources/tools/", "")}（体积回潮守卫）`);
  }
  (extraFrom.includes("resources/tools/node") ? ok : fail)("node 仍随包内置（安装器引导运行时，缺了其余工具都装不了）");
  (Array.isArray(pkg.build?.files) && pkg.build.files.some((pattern) => String(pattern).includes("mermaid") && String(pattern).endsWith(".map")) ? ok : fail)("asar 打包排除 mermaid 的 sourcemap（-25MB 纯赚）");
  const copyMac = readFileSync(join(ROOT, "build", "copy-mac-tools.cjs"), "utf8");
  (copyMac.includes('NOT_BUNDLED = new Set(["pw-browsers", "cloak-cache"])') && copyMac.includes("NOT_BUNDLED.has(path.basename(entry))") ? ok : fail)("mac copy-mac-tools 复制 tools 时跳过两个内核目录");
  const toolchainTs = readFileSync(join(ROOT, "electron", "toolchain.ts"), "utf8");
  (toolchainTs.includes('PLAYWRIGHT_DOWNLOAD_HOST: "https://cdn.npmmirror.com/binaries/playwright"') ? ok : fail)("toolchain：Playwright 内核国内镜像源已配置（npmmirror binaries）");
  (toolchainTs.includes('CLOAKBROWSER_DOWNLOAD_URL: "https://ghfast.top/https://github.com/CloakHQ/cloakbrowser/releases/download"') ? ok : fail)("toolchain：CloakBrowser 内核走 gh 代理（归档与 SHA256SUMS 同源，校验不受影响）");
  (toolchainTs.includes("if (!process.env[key]) env[key] = value;") ? ok : fail)("toolchain：用户自设的下载源变量优先于镜像（不覆盖用户配置）");
  const mainTs26 = readFileSync(join(ROOT, "electron", "main.ts"), "utf8");
  (mainTs26.includes("attempts = mirrorKeys.length ? [mirrored, official] : [official]") ? ok : fail)("main.ts：内核下载是镜像优先 + 官方源回落的双轮尝试");
  (mainTs26.includes('await runBrowserDownload(id, node, cli, ["install", "chromium"], "浏览器内核")') ? ok : fail)("main.ts：Playwright 内核下载走 runBrowserDownload（不直接 spawn 官方源）");
  (mainTs26.includes('await runBrowserDownload(id, node, cli, ["install"], "Cloak 内核")') ? ok : fail)("main.ts：Cloak 内核下载走 runBrowserDownload（不直接 spawn 官方源）");
  (mainTs26.includes("devRuntimeSpecs") && !/pwsh: \{[^}]*builtIn: true/.test(mainTs26) && !/git: \{[^}]*builtIn: true/.test(mainTs26) && !/python: \{[^}]*builtIn: true/.test(mainTs26) ? ok : fail)("main.ts：pwsh/git/python 已转为按需下载（不再是 builtIn）");
  (mainTs26.includes("watchFs(toolsRoot(), { recursive: true }") && mainTs26.includes('message: "开发工具目录已更新", auto: true') ? ok : fail)("main.ts：tools 目录监视 → 引擎自己装工具后界面自动刷新");
  const installRuntimes = readFileSync(join(ROOT, "scripts", "install-runtimes.cjs"), "utf8");
  (installRuntimes.includes("https://cdn.npmmirror.com/binaries/node/") && installRuntimes.includes("https://cdn.npmmirror.com/binaries/python/") && installRuntimes.includes("https://cdn.npmmirror.com/binaries/git-for-windows/") ? ok : fail)("install-runtimes：node/python/git 走 npmmirror 国内镜像（有镜像源的不该是龟速官方源）");
  (installRuntimes.includes("if (mirror) attempts.push") && installRuntimes.includes("if (url.includes(\"github.com\")) attempts.push") ? ok : fail)("install-runtimes：下载通道 = 镜像 → (代理) → 直连 → gh-proxy 逐级回落");
  // 09-16 下午：自动化包与 ponytail 改为「随包预解压直装」（用户「直接内置，不用解压啥的」）——
  // npm-global 必须进 extraResources（缺了等于回到「要点安装才解压」），zip 保留作修复备用；
  // ponytail 启动自动种只在 config **没有**注册段时动手（否则用户卸载后下次启动又装回来，卸载失效）。
  (extraFrom.includes("resources/tools/npm-global") ? ok : fail)("package.json extraResources 随包预解压 npm-global（自动化包开箱即用，不用点安装解压）");
  (extraFrom.includes("resources/tools/automation-tools.zip") ? ok : fail)("automation-tools.zip 仍随包（修复备用：重新解压即可恢复）");
  (extraFrom.includes("resources/tools/ponytail-plugin") ? ok : fail)("ponytail-plugin 随包（启动自动种入引擎插件 cache）");
  (mainTs26.includes('!configText.includes(\'ponytail@ponytail\')') ? ok : fail)("ponytail 自动种只在 config 无注册段时执行（不破坏「卸载后不再自动装回」语义）");
  (mainTs26.includes("void ensurePonytailPlugin(codexHome, bundledPonytail)") ? ok : fail)("ponytail 启动自动种调 ensurePonytailPlugin（幂等，失败降级）");
  // ⛔ 09-16 实测教训：引擎对 config/value/write 要求**必填** mergeStrategy，缺了整条请求被拒
  //    （Invalid request: missing field `mergeStrategy`）。这些调用普遍带 .catch(() => undefined)
  //    静默吞掉 → 表现成「开关点了没生效」。这里按结构守：**只认真正的调用点**
  //    （`config/value/write", {` … `})`），注释里提到这个字符串的段落不算（否则误判）。
  {
    const callRe = /config\/value\/write",\s*\{([\s\S]*?)\n\s*\}\)/g;
    const bodies = [...mainTs26.matchAll(callRe)].map((m) => m[1]);
    const missing = bodies.filter((body) => !body.includes("mergeStrategy"));
    (!missing.length && bodies.length > 0 ? ok : fail)(`main.ts：全部 ${bodies.length} 处 config/value/write 调用都带 mergeStrategy（引擎必填，缺了静默失败）`);
  }
}

// ---------- 【27】自动化工具拆细 + CloakBrowser 剥离随包（09-16 下午） ----------
// 用户四句话定下的形态：
//   ① 「这三个内置」——Nuphus / Playwright CLI / ponytail 写代码模式插件随包；
//   ② 「CloakBrowser 不用内置，按需下载就行」——从包里剥离，走 npm 国内镜像按需装；
//   ③ 「默认用内置浏览器」——默认通道是内置浏览器视图 + playwright-cli，Cloak 只在需要时用；
//   ④ 「自动化工具拆开，拆详细一点」——开发工具页从一张大卡拆成逐条能力卡。
// 每条都同时守「实现」与「给模型的指令/给用户的文案」：只改一半就会出现
// 「包里已经没有它，指令却还说它内置」的错配（模型会去调一个不存在的模块）。
{
  const pkg27 = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const extraResources27 = pkg27.build?.extraResources ?? [];
  const npmGlobalSet = extraResources27.find((entry) => entry?.from === "resources/tools/npm-global");
  const npmFilter = Array.isArray(npmGlobalSet?.filter) ? npmGlobalSet.filter.map(String) : [];
  (npmFilter.some((pattern) => /^!node_modules(\/\*\*\/\*)?$/.test(pattern)) ? ok : fail)("package.json：npm-global 根级映射显式排除 node_modules（该层交给下面那条独立映射）");
  (npmFilter.some((pattern) => /^!cloakbrowser(\.cmd|\.ps1)?$/.test(pattern)) ? ok : fail)("package.json：filter 同时排除 npm-global 根下的 cloakbrowser shim");
  // ⛔ 09-16 实测踩坑（打包验证才暴露）：electron-builder 的 copyDir **无条件丢弃 extraResources `from`
  //    根级的 node_modules**（app-builder-lib/out/util/filter.js 写死 `if (relative === "node_modules") return false`，
  //    且 walk() 在目录节点被过滤时整棵剪掉）。所以只写一条 from=npm-global 的映射时，包里只有根级 shim，
  //    node_modules 是空的 → 装出来的应用 nuphus/playwright-cli 两张卡都显示「未安装」，得让用户点一次
  //    「修复安装」解 zip，与「随包内置、开箱即用」的承诺不符。
  //    必须**另加一条** from=.../npm-global/node_modules 的映射（那一层的相对路径不叫 node_modules，绕过剪枝）。
  const nodeModulesSet = extraResources27.find((entry) => entry?.from === "resources/tools/npm-global/node_modules");
  (nodeModulesSet && nodeModulesSet.to === "tools/npm-global/node_modules" ? ok : fail)("package.json：单独一条 from=resources/tools/npm-global/node_modules → tools/npm-global/node_modules 的映射（缺了它 builder 会把 node_modules 整个剪掉，「随包内置」落空）");
  const nodeModulesFilter = Array.isArray(nodeModulesSet?.filter) ? nodeModulesSet.filter.map(String) : [];
  (nodeModulesFilter.some((pattern) => /^!cloakbrowser(\/\*\*\/\*)?$/.test(pattern)) && nodeModulesFilter.some((pattern) => pattern.startsWith("!.bin/cloakbrowser")) ? ok : fail)("package.json：node_modules 映射同样排除 cloakbrowser 包体与 .bin shim");

  const packAutomation = readFileSync(join(ROOT, "scripts", "pack-automation.cjs"), "utf8");
  (packAutomation.includes('parts[1].startswith("cloakbrowser")') && packAutomation.includes('parts[2] == "cloakbrowser"') ? ok : fail)("pack-automation：打 zip 时排除 cloakbrowser（否则「修复安装」把它又装回包里）");

  const beforePack = readFileSync(join(ROOT, "scripts", "before-pack.cjs"), "utf8");
  (beforePack.includes("requiredShipped") && beforePack.includes('["@nuphus", "nuphus-mcp", "package.json"]') && beforePack.includes('["@playwright", "cli", "package.json"]') ? ok : fail)("before-pack：硬校验随包 npm-global 含 nuphus-mcp + @playwright/cli（坏包守卫盯着随包内容本身）");
  // ⛔ 断言的是**比较表达式本身**（去空白后匹配），不是两个松散标识符：
  //    反证实测过一次假绿——只留 const packScript/newestSource 的声明、把 Math.max(...) 摘掉，
  //    旧写法照样命中，守卫恒绿。这类守卫必须锚在真正的逻辑上。
  const bpFlat = beforePack.replace(/\s+/g, "");
  (bpFlat.includes("constnewestSource=Math.max(fs.statSync(modules).mtimeMs,fs.statSync(packScript).mtimeMs)") ? ok : fail)("before-pack：zip 新鲜度同时比对打包脚本 mtime（改了排除清单不会静默复用旧 zip）");
  // 产物层守卫：verify-packaged-tools 必须对「包体真的进包了」下断言（它是最靠近产物的那道网）。
  const verifyPackagedTools = readFileSync(join(ROOT, "scripts", "verify-packaged-tools.cjs"), "utf8");
  (verifyPackagedTools.includes("@nuphus/nuphus-mcp/package.json") && verifyPackagedTools.includes("@playwright/cli/package.json") && /from=resources\/tools\/npm-global\/node_modules/.test(verifyPackagedTools) ? ok : fail)("verify-packaged-tools：断言产物里真的有 nuphus-mcp 与 @playwright/cli（node_modules 没被打进包就红）");
  // 行为探针（不只看字符串）：给一个「有 npm-global 但没有那两个包」的假 tools 根，
  // 断言 before-pack 真的中止打包并点名缺什么；逃生阀仍可放行。
  {
    const probeRoot = join(ROOT, ".e2e-artifacts", "missing-shipped-probe");
    try { rmSync(probeRoot, { recursive: true, force: true }); } catch { /* 忽略 */ }
    mkdirSync(join(probeRoot, "npm-global", "node_modules"), { recursive: true });
    const invoke = `require(${JSON.stringify(join(ROOT, "scripts", "before-pack.cjs"))})().then(() => process.exit(0), (e) => { console.error(String((e && e.message) || e)); process.exit(1); });`;
    const strict = spawnSync(process.execPath, ["-e", invoke], {
      encoding: "utf8",
      env: { ...process.env, AUTOMATION_TOOLS_ROOT: probeRoot, AUTOMATION_ZIP_OPTIONAL: "" },
    });
    const relaxed = spawnSync(process.execPath, ["-e", invoke], {
      encoding: "utf8",
      env: { ...process.env, AUTOMATION_TOOLS_ROOT: probeRoot, AUTOMATION_ZIP_OPTIONAL: "1" },
    });
    try { rmSync(probeRoot, { recursive: true, force: true }); } catch { /* 忽略 */ }
    (strict.status !== 0 && /随包 npm-global 缺少/.test(String(strict.stderr || "")) ? ok : fail)("before-pack：npm-global 缺 nuphus/playwright-cli 时**中止打包**并点名缺哪个");
    (relaxed.status === 0 ? ok : fail)("before-pack：AUTOMATION_ZIP_OPTIONAL=1 仍可显式放行（发布链路不被卡死）");
  }

  const mainTs27 = readFileSync(join(ROOT, "electron", "main.ts"), "utf8");
  const idLine = /type DevRuntimeId = ([^;]+);/.exec(mainTs27)?.[1] ?? "";
  (!/\bautomation\b/.test(idLine) ? ok : fail)("main.ts：开发工具 id 里不再有合并的 automation 大卡");
  (idLine.includes('"nuphus"') && idLine.includes('"playwright-cli"') && idLine.includes('"cloakbrowser"') ? ok : fail)("main.ts：拆成 nuphus / playwright-cli / cloakbrowser 三条独立条目");
  (mainTs27.includes('nuphus: { name: "Nuphus 桌面自动化"') && mainTs27.includes('"playwright-cli": { name: "Playwright 浏览器自动化"') ? ok : fail)("main.ts：Nuphus / Playwright CLI 两条内置卡片在位");
  (mainTs27.includes('marker: "npm-global\\\\node_modules\\\\@nuphus\\\\nuphus-mcp\\\\package.json", bundled: true') && mainTs27.includes('marker: "npm-global\\\\node_modules\\\\@playwright\\\\cli\\\\package.json", bundled: true') ? ok : fail)("main.ts：两条内置卡片标为 bundled（界面显示「内置」，缺失才给「修复安装」）");
  (mainTs27.includes('marker: "ponytail-plugin", kind: "plugin", bundled: true, noUninstall: true') ? ok : fail)("main.ts：ponytail 也是 bundled（随包内置；缺失走「重种插件」，绝不能落进解压 zip 的分支）");
  (mainTs27.includes('cloakbrowser: { name: "CloakBrowser 指纹浏览器"') && !/cloakbrowser: \{[^}]*bundled: true/.test(mainTs27) ? ok : fail)("main.ts：CloakBrowser 是独立的按需下载卡片（不是 bundled）");
  (mainTs27.includes("async function runNpmInstall(") && mainTs27.includes('await runNpmInstall(id, "cloakbrowser", "CloakBrowser")') ? ok : fail)("main.ts：CloakBrowser 走 runNpmInstall（用内置 node 自带 npm，不依赖用户环境）");
  (mainTs27.includes('const registries = userRegistry ? [userRegistry] : [CHINA_NPM_REGISTRY, ""];') ? ok : fail)("main.ts：npm 安装是国内镜像优先 + 官方源回落（用户自设源时不覆盖）");
  (mainTs27.includes('if (id === "cloakbrowser") return path.join(npmGlobalRoot(), "cloakbrowser");') ? ok : fail)("main.ts：卸载 CloakBrowser 只删包体目录（按 marker 首段删会连 nuphus/playwright-cli 一起删光）");
  (mainTs27.includes('npmShimPaths("cloakbrowser")') ? ok : fail)("main.ts：卸载后清掉 npm shim（否则 PATH 留着指向空目录的 cloakbrowser.cmd）");
  (mainTs27.includes('if (spec.bundled) throw new Error("该工具随应用内置') ? ok : fail)("main.ts：bundled 条目拒绝卸载（删了没有可靠重取途径）");
  (mainTs27.includes("if (spec.bundled && runtimeInstalled(id, spec)) return { ok: true, runtimes: runtimeList() };") ? ok : fail)("main.ts：bundled 条目已就位时「修复安装」是幂等空操作（判定与清单同源 runtimeInstalled）");
  const toolchainTs27 = readFileSync(join(ROOT, "electron", "toolchain.ts"), "utf8");
  (toolchainTs27.includes('export const CHINA_NPM_REGISTRY = "https://registry.npmmirror.com";') ? ok : fail)("toolchain：npm 国内镜像常量在位（registry.npmmirror.com）");

  // 「默认用内置浏览器」：指令 / 技能 / 渲染层三处必须同向
  const devInstr = readFileSync(join(ROOT, "electron", "developer-instructions.ts"), "utf8");
  (devInstr.includes("DEFAULT browser channel") && devInstr.includes("CLOAKBROWSER_ENTRY") ? ok : fail)("developer_instructions：playwright-cli 是默认通道，cloakbrowser 要先探 CLOAKBROWSER_ENTRY");
  (!/The in-app browser panel is CloakBrowser/.test(devInstr) ? ok : fail)("developer_instructions：不再声称应用内面板就是 CloakBrowser（默认是内置浏览器视图）");
  const skillsTs = readFileSync(join(ROOT, "electron", "builtin-skills.ts"), "utf8");
  (!/本机内置的浏览器就是 CloakBrowser/.test(skillsTs) && skillsTs.includes("## 0. 默认用内置浏览器") ? ok : fail)("browser-automation 技能：默认用内置浏览器（CloakBrowser 仅在已安装且需过反爬时用）");
  const appTs = readFileSync(join(ROOT, "src", "App.tsx"), "utf8");
  (appTs.includes('const [browserMode] = useState<"cloak" | "internal">("internal")') ? ok : fail)("App.tsx：浏览器模式默认内置视图（不再是 cloak）");
  (appTs.includes('const autoIds = ["nuphus", "playwright-cli", "cloakbrowser", "playwright-browsers", "cloak-browsers", "ponytail"]') ? ok : fail)("App.tsx：开发工具分组按拆分后的条目 id 归类");

  // mac 侧两条链路与 Windows 同源（否则 mac 包又把 CloakBrowser 带回来）
  const macCopy = readFileSync(join(ROOT, "build", "copy-mac-tools.cjs"), "utf8");
  (macCopy.includes("isCloakPackage") && macCopy.includes("!isCloakPackage(entry)") ? ok : fail)("mac copy-mac-tools：复制 npm-global 时同样排除 cloakbrowser");
  const macPrepare = readFileSync(join(ROOT, "scripts", "prepare-mac-tools.cjs"), "utf8");
  (!macPrepare.includes('"cloakbrowser@') ? ok : fail)("mac prepare-mac-tools：不再安装 cloakbrowser（与 Windows 同源）");
  const verifyPackaged = readFileSync(join(ROOT, "scripts", "verify-packaged-tools.cjs"), "utf8");
  (verifyPackaged.includes("未随包内置") ? ok : fail)("verify-packaged-tools：CloakBrowser 缺席不再判失败（按需下载是预期形态）");
}

// ---------- 【28】config.toml 写入面 + 会话/rollout 面（09-16 审计 14 个 bug 的回归网） ----------
//
// 这一节存在的理由：`config.toml` 写错一个字节引擎就起不来，而此前的预检**没有任何**
// 真解析（那些 permissions / mcp_servers 命中都是源码文本断言，挡不住语法/语义错）。
// 这里：① 用内置 python 的 tomllib 真解析一份「按生成逻辑拼出来的样例」；
//      ② 直接 require dist-electron 的纯函数跑真行为（比 grep 源码强一个量级）。
{
  console.log(C.bold("\n【28】config.toml 写入面 + 会话/rollout 面（09-16 审计修复的回归网）"));
  const req = createRequire(import.meta.url);
  const cfg = req(join(ROOT, "dist-electron", "config-toml.js"));
  const backup = req(join(ROOT, "dist-electron", "thread-backup.js"));
  const mainTs = readFileSync(join(ROOT, "electron", "main.ts"), "utf8");
  const workerSrc = readFileSync(join(ROOT, "electron", "rollout-worker.cjs"), "utf8");
  const workerGen = readFileSync(join(ROOT, "electron", "rollout-worker-source.ts"), "utf8");
  const backupTs = readFileSync(join(ROOT, "electron", "thread-backup.ts"), "utf8");

  // ── Bug 5：TOML 字符串转义必须处理换行/控制字符（粘贴带尾换行就能写坏整份配置） ──
  const esc = cfg.escapeTomlString;
  (esc("a\nb") === "a\\nb" ? ok : fail)("【28】escapeTomlString：内嵌换行转成 \\n（TOML 单行字符串里裸换行非法）");
  (esc("a\rb\tc") === "a\\rb\\tc" ? ok : fail)("【28】escapeTomlString：回车/制表一并转义");
  (esc('a"b\\c') === 'a\\"b\\\\c' ? ok : fail)("【28】escapeTomlString：引号与反斜杠仍按原语义转义");
  (!/[\u0000-\u001f\u007f]/.test(esc("a\u0000b\u0007c\u007fd")) ? ok : fail)("【28】escapeTomlString：其余控制字符被剔除");

  // ── Bug 9：MCP 段名解析要支持引号（含空格/中文/@ : +），否则用户段被静默删除 ──
  const hdr = (line) => JSON.stringify(cfg.parseTableHeader(line));
  (hdr('[mcp_servers."my server"]') === '["mcp_servers","my server"]' ? ok : fail)("【28】parseTableHeader：带空格的引号段名");
  (hdr("[mcp_servers.'我的服务']") === '["mcp_servers","我的服务"]' ? ok : fail)("【28】parseTableHeader：中文引号段名");
  (hdr('[mcp_servers."@scope/pkg"]') === '["mcp_servers","@scope/pkg"]' ? ok : fail)("【28】parseTableHeader：@ 与 / 段名");
  (hdr("[projects.'d:\\2']") === '["projects","d:\\\\2"]' ? ok : fail)("【28】parseTableHeader：带盘符/反斜杠的字面量段名");
  (cfg.parseTableHeader("exclude = [") === null ? ok : fail)("【28】parseTableHeader：值行不是段头");
  const names9 = cfg.collectMcpServerNames(['[mcp_servers.files]', '[mcp_servers."my server"]', '[mcp_servers."我的服务"]', '[mcp_servers."@scope/pkg"]', '[mcp_servers."a:b"]'].join("\n"));
  (["files", "my server", "我的服务", "@scope/pkg", "a:b"].every((n) => names9.includes(n)) ? ok : fail)("【28】collectMcpServerNames：裸名与引号名全采到（旧实现漏掉带空格/中文/@/: 的那类）");

  // ── Bug 1：harness 不再写 [permissions.*]（引擎没有工具映射，且缺 default_permissions 会废掉整份配置） ──
  (cfg.HARNESS_CONFIG_SECTIONS.has("permissions") === false ? ok : fail)("【28】permissions 已从 HARNESS_CONFIG_SECTIONS 移出（用户自己的档位不再被删）");
  (!/function permissionsToml/.test(mainTs) ? ok : fail)("【28】permissionsToml 已删除（不再写出非法 permissions 段）");
  (mainTs.includes("injectMcpToolRules(") && mainTs.includes("mcpToolRulesOf(") ? ok : fail)("【28】工具级权限改走 injectMcpToolRules / mcpToolRulesOf（引擎真支持的键）");

  // ── Bug 10：数值键强校验（裸插值 = 本地配置文件到任意命令执行） ──
  (!/model_max_output_tokens = \$\{maxOut\}/.test(mainTs) && /Number\.isFinite\(maxOut\)/.test(mainTs) ? ok : fail)("【28】model_max_output_tokens 经 Number.isFinite 校验（不再裸插值）");

  // ── Bug 7：设置页「会话记录」占用量的必须是真实 rollout 目录 ──
  (!/path\.join\(codexHome, "rollouts"\)/.test(mainTs) ? ok : fail)("【28】storage-info 不再量不存在的 codexHome/rollouts");
  (/archived_sessions"\)\]/.test(mainTs) && /path\.join\(codexHome, "sessions"\)/.test(mainTs) ? ok : fail)("【28】storage-info 量 sessions + archived_sessions（真实落点）");

  // ── Bug 8：provider id 取引擎权威索引；会话「记录已丢失」要有标记 ──
  {
    const st = req(join(ROOT, "dist-electron", "session-tools.js"));
    const missingCase = st.markMissingRollouts(
      [{ id: "T1", path: "sessions/x/rollout-2026-09-16T00-00-00-01a09d64-23c8-7e80-9215-58ad1a647868.jsonl" }, { id: "T2", path: "p2" }, { id: "T3" }],
      new Set(["t2"]),
    );
    (missingCase[0].rolloutMissing === true ? ok : fail)("【28】markMissingRollouts：索引有 path、兜底扫描没找到 → 标记录丢失");
    (missingCase[1].rolloutMissing === undefined ? ok : fail)("【28】markMissingRollouts：磁盘上真存在的不标（避免误报）");
    (missingCase[2].rolloutMissing === undefined ? ok : fail)("【28】markMissingRollouts：没有 path 的条目不标（兜底独有项/极简索引）");
  }
  (mainTs.includes("markMissingRollouts(merged, present)") ? ok : fail)("【28】thread/list 调用 markMissingRollouts（点开前就能发现记录已丢）");
  (mainTs.includes('await server.request("thread/list", { limit: 200, archived') ? ok : fail)("【28】collectSessionProviderIds 以引擎线程索引为权威源（不看 rollout 文件内容，含归档会话）");
  ((await import("node:fs")).existsSync(join(ROOT, "src", "App.tsx")) && readFileSync(join(ROOT, "src", "App.tsx"), "utf8").includes("entry.rolloutMissing") ? ok : fail)("【28】渲染层用 rolloutMissing 拦下点击并显示「记录丢失」徽标");

  // ── Bug 13：导入的会话文件名必须 canonical（否则侧栏可见、点开报错） ──
  (!/rel = `sessions\/imported\/rollout-imported-\$\{id\}/.test(backupTs) && backupTs.includes("canonicalRolloutName(id,") ? ok : fail)("【28】thread-backup 写出的是 canonical 文件名（旧实现写 rollout-imported-<uuid> → 导入后打不开）");
  const CANON = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;
  const uuid13 = "01a09d64-23c8-7e80-9215-58ad1a647868";
  (CANON.test(backup.canonicalRolloutName(uuid13, Date.UTC(2026, 8, 16))) ? ok : fail)("【28】canonicalRolloutName 产出引擎认的文件名形态");
  const fixed13 = backup.canonicalizeRel(`sessions/imported/rollout-imported-${uuid13}.jsonl`);
  (typeof fixed13 === "string" && CANON.test(fixed13.split("/").pop()) ? ok : fail)("【28】canonicalizeRel 把老备份里的非 canonical 名就地修好（旧文件导入也能打开）");
  (backup.canonicalizeRel("sessions/x/notarollout.jsonl") === null ? ok : fail)("【28】canonicalizeRel 对没有线程 id 的文件名返回 null（宁可跳过也不写死文件）");

  // ── Bug 14：侧栏标题必须剥 harness 注入块（与 thread-backup 同口径） ──
  (workerSrc.includes("stripHarnessBlocks") && workerSrc.includes("looksInjected") ? ok : fail)("【28】rollout-worker 也剥注入块 / 用同一份前缀表");
  (workerGen.includes("stripHarnessBlocks") ? ok : fail)("【28】内联产物 rollout-worker-source.ts 已同步（生成物不能落后于 worker 源码）");
  {
    // 真跑一次 worker：首条用户消息是 [SYSTEM TASK] 包装 + AGENTS.md 注入，标题必须是包装里的用户原文
    const probe = spawnSync(process.execPath, ["-e", `
const fs=require("fs"),os=require("os"),path=require("path");
const {Worker}=require("worker_threads");
const root=fs.mkdtempSync(path.join(os.tmpdir(),"pw28-"));
const dir=path.join(root,"sessions","2026","09","16");
fs.mkdirSync(dir,{recursive:true});
const rows=[
 {type:"session_meta",payload:{cwd:"D:/x"}},
 {type:"response_item",payload:{type:"message",role:"user",content:[{type:"input_text",text:"# AGENTS.md instructions\\n\\n<INSTRUCTIONS>\\nxxx"}],internal_chat_message_metadata_passthrough:{content_item_kinds:["agents_md.instructions"]}}},
 {type:"response_item",payload:{type:"message",role:"user",content:[{type:"input_text",text:"[Harness 相关记忆，仅供参考]\\n记点东西\\n[记忆结束]\\n\\n[SYSTEM TASK abc] === 用户需求 ===\\n真实问题：帮我看看这个\\n=== END ==="}],internal_chat_message_metadata_passthrough:{content_item_kinds:["user.text"]}}},
];
fs.writeFileSync(path.join(dir,"rollout-2026-09-16T00-00-00-01a09d64-23c8-7e80-9215-58ad1a647868.jsonl"), rows.map(r=>JSON.stringify(r)).join("\\n")+"\\n");
const w=new Worker(${JSON.stringify(join(ROOT, "electron", "rollout-worker.cjs"))});
const done=(o)=>{process.stdout.write(JSON.stringify(o));try{w.terminate();}catch{}};
w.on("message",(m)=>done(m)); w.on("error",(e)=>done({err:String(e&&e.message)}));
w.postMessage({id:1,op:"list",root});
`], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
    let parsed14 = null;
    try { parsed14 = JSON.parse(probe.stdout || "null"); } catch { parsed14 = null; }
    const title14 = String(parsed14?.data?.[0]?.name ?? "");
    (title14 === "真实问题：帮我看看这个" ? ok : fail)(`【28】侧栏标题取到包装里的用户原文（实得：${JSON.stringify(title14.slice(0, 40))}）`);
  }

  // ── Bug 3 / 6 / 1 / 2：拼一份「按生成逻辑来的」样例配置，用 tomllib 真解析 ──
  const existing = [
    'model = "old-model"',
    'approval_policy = "never"',
    "default_permissions = \":workspace\"",
    "[model_providers.mine]",
    'name = "Mine"',
    '[features]',
    "browser_use = false",
    "memories = true",
    "[otel]",
    'exporter = "none"',
    'trace_exporter = "none"',
    "[permissions.my-profile]",
    'description = "我自己写的档位"',
    '[mcp_servers."我的服务"]',
    'command = "x"',
  ].join("\n");
  const preserved = cfg.preserveUserConfig(existing);
  (preserved.topLevel.includes("approval_policy") ? ok : fail)("【28】用户顶层键归入 topLevel（必须输出在第一个段头之前）");
  (!preserved.sections.includes("approval_policy") ? ok : fail)("【28】用户顶层键不再混进「用户段」文本（旧实现被拼到文件尾部 → 被 MCP 段吞掉）");
  (preserved.sections.includes("[permissions.my-profile]") ? ok : fail)("【28】用户自己的 [permissions.*] 档位整段保留");
  (preserved.sectionExtras["features"]?.includes("memories = true") ? ok : fail)("【28】段级共享表里用户的子键进 sectionExtras（features.memories）");
  (preserved.sectionExtras["otel"]?.some((line) => line.startsWith("trace_exporter")) ? ok : fail)("【28】段级共享表里用户的子键进 sectionExtras（otel.trace_exporter）");
  (!Object.values(preserved.sectionExtras).flat().some((line) => /^browser_use/.test(line)) ? ok : fail)("【28】harness 自己的子键不被当成用户键留下（features.browser_use）");

  const configText = [
    'model = "glm-5.3-flash"',
    'model_provider = "harness"',
    'developer_instructions = """',
    "line1",
    '"""',
    ...(preserved.topLevel ? [preserved.topLevel] : []),
    "[model_providers.harness]",
    'name = "内置统一通道"',
    `base_url = "${esc("https://x.example/v1\n")}"`,
    'env_key = "CODEX_HARNESS_API_KEY"',
    'wire_api = "responses"',
    "requires_openai_auth = false",
    "model_max_output_tokens = 393216",
    "[windows]",
    'sandbox = "unelevated"',
    "[tools]",
    "web_search = true",
    "[otel]",
    'exporter = "none"',
    "[sandbox_workspace_write]",
    "network_access = true",
    "[shell_environment_policy]",
    'inherit = "all"',
    "[shell_environment_policy.set]",
    'PATH = "C:\\\\x"',
    "[features]",
    "browser_use = true",
    "[mcp_servers.nuphus]",
    'command = "C:\\\\nuphus.exe"',
    "args = []",
    "startup_timeout_sec = 20",
    ...(preserved.sections ? [preserved.sections, ""] : []),
  ].join("\n");
  const finalText = cfg.injectMcpToolRules(
    cfg.injectSectionExtras(configText, preserved.sectionExtras),
    { nuphus: { deny: ["desktop_shell"], ask: ["desktop_mouse"], allow: ["desktop_screenshot"] } },
  );
  const PY28 = join(ROOT, "resources", "tools", "python", "python.exe");
  if (!existsSync(PY28)) {
    fail("【28】内置 python 缺席，无法做 config.toml 的 tomllib 真解析门禁");
  } else {
    const b64 = Buffer.from(finalText, "utf8").toString("base64");
    const run = spawnSync(PY28, ["-c", "import sys,base64,tomllib,json;print(json.dumps(tomllib.loads(base64.b64decode(sys.argv[1]).decode('utf-8'))))", b64], { encoding: "utf8", windowsHide: true });
    let doc = null;
    try { doc = JSON.parse(run.stdout || "null"); } catch { doc = null; }
    (doc ? ok : fail)(`【28】样例 config.toml 被 tomllib 真解析通过${doc ? "" : `（${String(run.stderr || "").trim().split("\n").pop()?.slice(0, 120)}）`}`);
    // ⚠️ 这里刻意**不用 `if (doc)` 包住**（09-16 反证时发现的设计缺陷）：解析失败时被包住的断言会
    // 「整块跳过」——报告里一条红都没有，看起来像全绿。改成逐条断言（`doc?.`），解析失败就让
    // 每一条都红，红得显眼。
    (doc?.approval_policy === "never" ? ok : fail)("【28】tomllib：用户顶层键**在顶层**（不再落进 mcp_servers 段 —— 修 Bug 3）");
    (doc?.default_permissions === ":workspace" ? ok : fail)("【28】tomllib：用户 default_permissions 保住（harness 不再写 permissions）");
    (doc?.permissions?.["my-profile"]?.description === "我自己写的档位" ? ok : fail)("【28】tomllib：用户自定义权限档位保住");
    (doc?.features?.browser_use === true && doc?.features?.memories === true ? ok : fail)("【28】tomllib：features 段 harness 子键 + 用户子键共存（修 Bug 6）");
    (doc?.otel?.exporter === "none" && doc?.otel?.trace_exporter === "none" ? ok : fail)("【28】tomllib：otel 段同理（用户 trace_exporter 不被删）");
    (JSON.stringify(doc?.mcp_servers?.nuphus?.disabled_tools) === '["desktop_shell"]' ? ok : fail)("【28】tomllib：deny 落到 disabled_tools（工具从引擎工具表移除 = 真阻断）");
    (doc?.mcp_servers?.nuphus?.tools?.desktop_mouse?.approval_mode === "prompt" ? ok : fail)("【28】tomllib：ask 落到 [mcp_servers.X.tools.<名>] approval_mode = prompt");
    (doc?.mcp_servers?.nuphus?.tools?.desktop_screenshot?.approval_mode === "auto" ? ok : fail)("【28】tomllib：allow 落到 approval_mode = auto");
    (typeof doc?.model_providers?.harness?.base_url === "string" && doc.model_providers.harness.base_url.includes("\n") ? ok : fail)("【28】tomllib：带换行的 base_url 转义后既合法又能往返（修 Bug 5）");
    (!Object.keys(doc?.permissions ?? {}).some((key) => key.startsWith("mcp__")) ? ok : fail)("【28】tomllib：harness 不再产出任何 mcp__ 工具权限键");
  }

  // ── Bug 12：max 档不再被静默丢弃/替换（用真实 effort.ts 编译后执行） ──
  try {
    const ts = req("typescript");
    const js = ts.transpileModule(readFileSync(join(ROOT, "src", "lib", "effort.ts"), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const mod = { exports: {} };
    new Function("module", "exports", js)(mod, mod.exports);
    const declared = mod.exports.declaredModelEfforts;
    (declared(["max"]).includes("max") ? ok : fail)("【28】effort：只声明 max 时不再回落成整套默认档（修 Bug 12）");
    (declared(["low", "medium", "high", "max"]).includes("max") ? ok : fail)("【28】effort：声明 max 的模型在 UI 里有 max 可选");
    (mod.exports.ALL_EFFORTS.includes("max") ? ok : fail)("【28】effort：ALL_EFFORTS 含 max（引擎内置 gpt-6-astra 就声明了它）");
    (declared(["low", "medium", "high"]).includes("xhigh") ? ok : fail)("【28】effort：旧的自动三档仍补极高（产品行为不得回退）");
  } catch (error) {
    fail(`【28】effort.ts 行为断言跑不起来：${String(error?.message ?? error).slice(0, 120)}`);
  }

  // ── Bug 11：被证伪的声明不得复活（引擎**不校验** effort） ──
  const effortTs = readFileSync(join(ROOT, "src", "lib", "effort.ts"), "utf8");
  (!/否则 turn\/start 被拒/.test(mainTs) && !/否则 turn\/start 被拒/.test(effortTs) ? ok : fail)("【28】不再声称「引擎按 catalog 校验 effort，否则 turn/start 被拒」（已证伪）");
  (mainTs.includes("引擎根本不校验") || mainTs.includes("不校验档位") ? ok : fail)("【28】main.ts 注释记录了实证结论（引擎读了 catalog 但不校验档位）");
}

// ═══════════════════════════════════════════════════════════════════
// 【29】SSH-only 发布流水线（09-16）
// 背景：本机远端是 SSH（deploy key），SSH 只能推代码/标签 —— 既不能建 Release 也不能传资产，
// 本机也没有 gh CLI / API token。所以「用 SSH 发版」的唯一形态是：推 tag → Actions 用仓库自带的
// GITHUB_TOKEN 构建三端包并发布。这里把这条链的契约钉死：任何一处漂移都会让用户端**静默**收不到
// 更新（更新器按资产名匹配，名字错了不报错、只显示「已是最新」）。
// ═══════════════════════════════════════════════════════════════════
{
  const wfDir = join(ROOT, ".github", "workflows");
  const release = readFileSync(join(wfDir, "release.yml"), "utf8");
  const buildMac = readFileSync(join(wfDir, "build-mac.yml"), "utf8");
  const buildWin = readFileSync(join(wfDir, "build-win.yml"), "utf8");
  const prepWin = readFileSync(join(ROOT, "scripts", "prepare-windows-tools.cjs"), "utf8");
  const updates = readFileSync(join(ROOT, "electron", "updates.ts"), "utf8");
  const pkg29 = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

  (/\n\s+push:\s*\n\s+tags:\s*\n\s+- "v\*"/.test(release) ? ok : fail)("【29】release.yml 由 tag 推送触发（SSH 推 tag 即完成发版）");
  (/permissions:\s*\n\s+contents: write/.test(release) ? ok : fail)("【29】release.yml 声明 contents: write（建 Release / 传资产必需，默认只读）");
  (release.includes("uses: ./.github/workflows/build-mac.yml") && release.includes("uses: ./.github/workflows/build-win.yml") ? ok : fail)("【29】release.yml 复用两个构建工作流（构建步骤只此一份，避免同口径漂移）");
  (/^\s*workflow_call:/m.test(buildMac) && /^\s*workflow_call:/m.test(buildWin) ? ok : fail)("【29】build-mac.yml / build-win.yml 都声明 workflow_call（可被 release 复用）");
  ((/needs:\s*\[mac,\s*win\]/.test(release) || /needs:\s*\[win,\s*mac\]/.test(release)) ? ok : fail)("【29】publish 依赖 mac + win 两个 job（三端不齐不发版）");

  // 构建侧 artifact 名 ⇄ 发布侧取件目录：改名不同步 = 发布 job 找不到文件（最易漂移处）
  (buildWin.includes("name: win-x64") && release.includes("pick artifacts/win-x64") ? ok : fail)("【29】Windows artifact 名（win-x64）在构建与发布两侧一致");
  (buildMac.includes("name: mac-${{ matrix.mac_target }}") && buildMac.includes("mac_target: arm64") && buildMac.includes("mac_target: x64") ? ok : fail)("【29】mac artifact 名由 matrix 产生（mac-arm64 / mac-x64）");
  (release.includes("pick artifacts/mac-arm64") && release.includes("pick artifacts/mac-x64") ? ok : fail)("【29】发布侧按 mac-arm64 / mac-x64 取件（与构建侧 matrix 对应）");

  // 资产命名 = 更新器的匹配契约（electron/updates.ts）：名字错 → 用户静默收不到更新
  (updates.includes('a.name.includes("mac") && a.name.endsWith(".zip") && a.name.includes(arch)') && updates.includes('a.name.endsWith(".exe")') ? ok : fail)("【29】更新器匹配规则仍是「Windows 认 .exe / mac 认 mac+.zip+架构名」");
  (release.includes("-win-x64.exe") && release.includes("-arm64-mac.zip") && release.includes("-x64-mac.zip") ? ok : fail)("【29】三个资产名同时满足更新器（mac x64 强制带架构名 —— electron-builder 原生产物不带 x64）");
  (release.includes("--clobber") ? ok : fail)("【29】资产上传用 --clobber（重跑失败 job 不会因子资产重名而失败）");

  // 更新说明：应用内「发现新版本」弹窗的内容来源，缺了必须直接失败
  (release.includes("docs/releases/v${VERSION}.md") && release.includes("缺少更新说明") ? ok : fail)("【29】release.yml 强制要求 docs/releases/v<版本>.md（缺则发布失败，不当静默无说明发布）");
  const currentNotes = join(ROOT, "docs", "releases", `v${pkg29.version}.md`);
  (existsSync(currentNotes) ? ok : fail)(`【29】当前版本 ${pkg29.version} 的更新说明已在位（docs/releases/v${pkg29.version}.md）`);

  // tag ⇄ 版本号：错配会让 Release 的 tag 与包内容对不上（用户装了 0.0.19 却被提示 0.0.18）。
  // ⛔ 同样锚定实际条件表达式（第一版只查 GITHUB_REF_NAME 与 `!= "v${VERSION}"` 两个片段，
  //    把条件首项改成 `"never"` 就恒假、守卫照样绿）。
  (/if \[ "\$\{GITHUB_REF_TYPE\}" = "tag" \] && \[ "\$\{GITHUB_REF_NAME\}" != "v\$\{VERSION\}" \]; then/.test(release) ? ok : fail)("【29】推送的 tag 必须与 package.json 版本一致（错配直接失败）");

  // Windows 随包工具链：CI 干净检出里 resources/tools/* 是空的（被 gitignore），必须能由脚本现造
  (buildWin.includes("node scripts/prepare-windows-tools.cjs") ? ok : fail)("【29】Windows job 会现造随包工具链（CI 检出里 resources/tools/* 为空）");
  (buildWin.includes("node scripts/verify-packaged-tools.cjs resources/tools") && buildWin.includes("node scripts/verify-packaged-tools.cjs release/win-unpacked/resources/tools") ? ok : fail)("【29】Windows job 打包前后都跑真 MCP 握手验收（缺随包能力=坏包）");
  const prepMarkers = [
    "npm-global/node_modules/@nuphus/nuphus-mcp/package.json",
    "npm-global/node_modules/@playwright/cli/package.json",
    // 引擎按 `nuphus-call …` 命令行调用桌面工具（35 个 schema 不进上下文）⇒ 这个桥必须在 PATH 上。
    // 它不是任何 npm 包的 bin（npm 不会生成），mac 侧由 prepare-mac-tools 写 bin/nuphus-call，
    // Windows 侧必须由本脚本写 npm-global/nuphus-call.cmd —— 漏了就是「README 有、用户用不了」。
    "npm-global/nuphus-call.cmd",
    "vscode-cli/code.exe",
    "cloudflared.exe",
    "ponytail-plugin/.codex-plugin",
    "pwsh-headless/pwsh.exe",
  ];
  const missingPrep = prepMarkers.filter((m) => !prepWin.includes(m));
  (missingPrep.length === 0 ? ok : fail)(`【29】prepare-windows-tools 硬校验覆盖随包能力${missingPrep.length ? "（缺：" + missingPrep.join(", ") + "）" : ""}`);
  // ⛔ 只查 marker 字符串不够：把 `writeNuphusCallShim(prefix)` / `buildHeadlessBridge()` 注释掉，
  //    marker 列表还在、硬校验反而会**正确地报缺**……但在「只注释调用、没跑脚本」的情形下预检
  //    照样绿（假绿）。这里锚定两个**副作用调用本身**必须出现在 main 流程里。
  (/^\s+writeNuphusCallShim\(prefix\);\s*$/m.test(prepWin) ? ok : fail)("【29】prepare-windows-tools 真的会写 nuphus-call 命令行桥（不是只在注释/校验表里提它）");
  (/^\s+buildHeadlessBridge\(\);\s*$/m.test(prepWin) && /csc\.exe/.test(prepWin) && /target:winexe/.test(prepWin) ? ok : fail)("【29】prepare-windows-tools 真的会编译 pwsh 无窗口桥（csc /target:winexe）");

  // extraResources 里每条 resources/tools 源，要么 prep 脚本能造、要么有明确出处
  // extraResources 里每条 resources/tools 源，要么 prep 脚本能造、要么有明确出处：
  //   - automation-tools.zip：before-pack.cjs 由 npm-global 现造
  //   - 三个 .mjs 助手：在 .gitignore 规则之前就已纳入版本控制，干净检出里就有
  const BY_DESIGN = new Set([
    "resources/tools/automation-tools.zip",
    "resources/tools/nuphus-call.mjs",
    "resources/tools/harness-media.mjs",
    "resources/tools/cloak-open.mjs",
  ]);
  const uncovered = [];
  for (const entry of pkg29.build?.extraResources ?? []) {
    const from = typeof entry === "string" ? entry : entry?.from;
    if (!from || !from.startsWith("resources/tools/")) continue;
    if (BY_DESIGN.has(from)) continue;
    const seg = from.slice("resources/tools/".length);
    if (!prepWin.includes(seg)) uncovered.push(from);
  }
  (uncovered.length === 0 ? ok : fail)(`【29】Windows 随包源全部可由 CI 现造${uncovered.length ? "（未覆盖：" + uncovered.join(", ") + "）" : ""}`);

  // pwsh 无窗口桥的源码必须在版本控制里（否则 CI 编译不出 pwsh-headless/pwsh.exe）
  const gitignore29 = readFileSync(join(ROOT, ".gitignore"), "utf8");
  (gitignore29.includes("!resources/tools/pwsh-headless/PwshHeadless.cs") && existsSync(join(ROOT, "resources", "tools", "pwsh-headless", "PwshHeadless.cs")) ? ok : fail)("【29】pwsh-headless 源码已纳入版本控制（CI 现场编译）");

  // ⛔ 打 zip 的执行体必须能独立于「随包 python」工作：09-16 安装包瘦身把 python 移出随包、
  //    资源目录又被 gitignore ⇒ CI 干净检出里没有 python，而 before-pack → pack-automation 在
  //    Windows job 里是打包前置步骤。只用 python 的实现会让整条发布流水线在 CI 上直接失败。
  const packScript = readFileSync(join(ROOT, "scripts", "pack-automation.cjs"), "utf8");
  // ⛔ 断言要锚定**实际分支条件**，不能只查标识符存在 —— 第一版只查 "System32"/packWithTar/--exclude
  //    三个名字，把 `if (tarBin)` 改成 `if (false && tarBin)` 照样绿（假绿，反证时才发现）。
  (/\nif \(tarBin\) \{\n {2}try \{ packWithTar\(tarBin\); packed = true; \}/.test(packScript) ? ok : fail)("【29】pack-automation 优先用 bsdtar（Windows 自带 tar.exe，CI 无随包 python 也能打 zip）");
  (packScript.includes("npm-global/node_modules/cloakbrowser") && packScript.includes("npm-global/node_modules/.bin/cloakbrowser") ? ok : fail)("【29】bsdtar 分支的排除清单与 python 分支同源（含 .bin shim，否则「修复安装」把 CloakBrowser 装回来）");
  (packScript.includes("npm-global/cloakbrowser.cmd") ? ok : fail)("【29】排除清单覆盖顶层 cloakbrowser shim 三件套");
}

// ---------- 汇总 ----------

// ---------- 【29】发送动画交接 + 浮层动画位移 + 插队退化（09-17 三起实测事故的回归网） ----------
{
  const app = readFileSync(join(ROOT, "src", "App.tsx"), "utf8");
  const css = readFileSync(join(ROOT, "src", "styles.css"), "utf8");
  // ⛔ 必须剥注释再断言：本轮首版守卫就被自己的**注释**喂成假绿 —— `no active turn`、
  //    `compact-toast-in` 这些词在解释性注释里也会出现，只查字符串存在等于没查（AGENTS.md 已点名）。
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const appCode = stripComments(app);
  const cssCode = stripComments(css);

  // ① 入场动画必须由真实消息「认领」
  //   事故：动画只登记在乐观气泡上，真实消息几十毫秒内接管、气泡卸载 → 动画被腰斩
  //   （实测 t+13ms opacity 0.24 → t+34ms 节点已消失），消息"啪"地跳到位、没有过渡。
  /function claimSendAnimation\(/.test(appCode) && /function armSendAnimationClaim\(/.test(appCode)
    ? ok("发送入场动画交接机制在（armSendAnimationClaim / claimSendAnimation 成对）")
    : fail("缺少 arm/claimSendAnimation —— 真实消息接管时动画被腰斩（消息没有过渡到落点）");
  /claimSendAnimation\(itemText\(item\)\)/.test(appCode)
    ? ok("真实消息挂载时认领动画（UserMessageView lazy 初始化里）")
    : fail("UserMessageView 没有认领动画 —— 乐观气泡卸载后动画不会接手");
  (/armSendAnimationClaim\(messageText\)/.test(appCode) && /armSendAnimationClaim\(text\)/.test(appCode))
    ? ok("发送处（普通发送 + 编辑重发）都登记了待认领动画")
    : fail("发送处缺少 armSendAnimationClaim —— 认领永远不命中，动画又会被腰斩");

  // ② 带 translate(-50%) 的入场动画只能给「left:50% 居中定位」的元素用
  //   事故：限流条借用 compact-toast-in → 整体左移自身宽度一半（实测 tx=-237px = 474.8/2），
  //   表现为「靠左、越出输入框左缘、右边被切」。
  const toastAt = cssCode.indexOf("@keyframes compact-toast-in");
  const toastBlock = toastAt < 0 ? "" : cssCode.slice(toastAt, toastAt + 400);
  /translate\(\s*-50%/.test(toastBlock)
    ? (/\.rate-limit-retry-bar\s*\{[^}]*compact-toast-in/.test(cssCode)
        ? fail("限流条又借用了 compact-toast-in（含 translate(-50%)）—— 会左移半个宽度、越出输入框被切")
        : ok("限流条没有借用带 -50% 位移的动画（不会整体左移）"))
    : ok("compact-toast-in 不含横向位移（借用安全）");
  /@keyframes\s+rate-limit-bar-in/.test(cssCode)
    ? ok("限流条专用入场动画 rate-limit-bar-in 在")
    : fail("rate-limit-bar-in 缺失 —— 限流条入场动画会被换回带位移的那套");

  // ③ 插队（turn/steer）必须先判定「真的有回合在跑」，并在引擎回 no active turn 时退化
  //   事故（用户实测「插队消息每次都报错」）：原实现只认 activeTurnId，上一轮 429/中断/跑完后
  //   它仍是旧值 → 引擎回 `no active turn to steer`，消息卡在队列里永远发不出去。
  const startIdx = appCode.indexOf("async function startQueued");
  const queuedFn = startIdx < 0 ? "" : appCode.slice(startIdx, startIdx + 3200);
  // 锚定「运行中回合」判定必须由 isTurnRunning 驱动、且 steer 用的是这个结果（不是裸 activeTurnId）
  (/const runningTurnId = [^\n]*isTurnRunning\(turn\)/.test(queuedFn) && /expectedTurnId: steerTurnId/.test(queuedFn))
    ? ok("插队前按 isTurnRunning 判定运行中回合（不再只看陈旧的 activeTurnId）")
    : fail("插队只看 activeTurnId —— 上一轮结束后插队必报 no active turn（用户实测「每次都报错」）");
  (/if \(!\/no active turn\/i\.test\(message\)\)/.test(queuedFn) && /thread\/queue\/start/.test(queuedFn))
    ? ok("引擎回 no active turn 时退化为开始新回合（消息不会卡在队列里）")
    : fail("no active turn 没有退化路径 —— 排队消息会卡在队列里发不出去");

  // ④ 相位续播：这是「不再两步」的核心时序判定（纯函数在 src/lib/send-anim.mjs）
  {
    const { createSendAnimClaim, armSendAnimationClaim, claimSendAnimation, SEND_ANIM_DURATION_MS, SEND_CLAIM_TTL_MS } = await import("../src/lib/send-anim.mjs");
    const T0 = 1_000_000;
    const TEXT = "你好世界这是一条测试消息";
    const run = (elapsed, realText = TEXT) => {
      const store = createSendAnimClaim();
      armSendAnimationClaim(store, TEXT, T0);
      return claimSendAnimation(store, realText, T0 + elapsed);
    };
    const fast = run(30);
    (fast.kind === "continue" && fast.delayMs === 30)
      ? ok("快回声（30ms）：认领并给出续播相位 30ms（真实节点不再从 0% 重起）")
      : fail(`快回声应续播 30ms，实际 ${JSON.stringify(fast)}`);
    const slow = run(SEND_ANIM_DURATION_MS + 50);
    slow.kind === "skip"
      ? ok("慢回声（≥动画时长）：跳过补播（消息早已在屏上，不再「飞」一下）")
      : fail(`慢回声应 skip，实际 ${JSON.stringify(slow)}`);
    const prefixed = run(40, `[记忆] ${TEXT} 补充说明`);
    prefixed.kind === "continue"
      ? ok("真实正文带记忆/引用前缀仍能认领（前缀匹配）")
      : fail(`带前缀应 continue，实际 ${JSON.stringify(prefixed)}`);
    const wrong = run(40, "完全不相干的内容");
    wrong.kind === "none"
      ? ok("文本对不上不认领（历史/其它消息不会误播）")
      : fail(`文本不匹配应 none，实际 ${JSON.stringify(wrong)}`);
    const expired = run(SEND_CLAIM_TTL_MS + 1);
    expired.kind === "none"
      ? ok("超过 TTL 不认领（切会话重挂载不误播）")
      : fail(`超时应 none，实际 ${JSON.stringify(expired)}`);
    const onceStore = createSendAnimClaim();
    armSendAnimationClaim(onceStore, TEXT, T0);
    const first = claimSendAnimation(onceStore, TEXT, T0 + 10);
    const second = claimSendAnimation(onceStore, TEXT, T0 + 20);
    (first.kind === "continue" && second.kind === "none")
      ? ok("认领是一次性的（第二次不再播）")
      : fail(`认领应一次性，实际 ${first.kind} / ${second.kind}`);
    claimSendAnimation(createSendAnimClaim(), TEXT, T0).kind === "none"
      ? ok("没有登记时不认领（不凭空播动画）")
      : fail("没登记也认领了 —— 会凭空播动画");
    // 接线：delayMs 必须真的落到 DOM 的 inline animation-delay
    /style=\{sendAnimDelay \? \{ animationDelay: `-\$\{sendAnimDelay\}ms` \} : undefined\}/.test(app)
      ? ok("续播相位落到 DOM（inline animation-delay 接线在）")
      : fail("App.tsx 没有把续播相位写成 inline animation-delay —— 认领到的相位被丢掉，仍会从 0% 重起");
  }

  // ⑤ 乐观气泡安全阀的判据（09-17 用户实测：「消息发出去，先是旧内容+生成条，过一会才看到我的消息」）
  //   事故：原判据「当前没有任何 running 回合」在**正常发送**时同样成立 —— 气泡上屏后本轮 turn 还没建
  //   （要等 turn/start 往返 + 记忆召回），条件立刻命中 → 探针实测气泡**只活 6~8ms**，而真实消息
  //   1.7~3.3s 才到 ⇒ 用户自己的消息有 2~3 秒**完全不在界面上**（只剩「正在生成回复」状态条，
  //   也就是用户截图里问的"中间那个"）。修好后同一探针：气泡存活 1344ms、直到真实消息接管才消失。
  {
    /const sawRunningTurnRef = useRef\(false\)/.test(appCode)
      ? ok("【29】乐观气泡安全阀有「本轮曾出现过运行中回合」判据（sawRunningTurnRef）")
      : fail("【29】安全阀没有 sawRunningTurnRef —— 气泡会在本轮 turn 建立前被误回收（消息消失 2~3 秒）");
    /if \(running\) sawRunningTurnRef\.current = true;/.test(appCode)
      ? ok("【29】检测到运行中回合时置位判据（回合结束后才允许回收）")
      : fail("【29】判据没有被置位 —— 回收条件永远不成立 / 或气泡会赖着");
    /if \(!running && sawRunningTurnRef\.current\)/.test(appCode)
      ? ok("【29】回收条件要求「曾出现过运行中回合」（不再是裸 !running）")
      : fail("【29】回收条件仍是裸 !running —— 正常发送时气泡被秒回收（实测 6~8ms）");
    /setTimeout\(\(\) => \{[\s\S]{0,220}isTurnRunning\(turn\)[\s\S]{0,140}\}, 15_000\)/.test(appCode)
      ? ok("【29】有 15s 超时兜底（引擎始终不回时气泡不会一直赖在聊天区）")
      : fail("【29】缺超时兜底 —— 引擎不回应时气泡会永久赖在聊天区（09-13 修过的老问题）");
    ((appCode.match(/sawRunningTurnRef\.current = false;/g) || []).length >= 4)
      ? ok("【29】判据在两处回收 + 两处发送点都复位（走旧值会让本轮气泡活不下来）")
      : fail("【29】sawRunningTurnRef 复位点不足 —— 上一轮的置位会污染本轮");
  }

  // ⑥ 生成状态条的渲染顺序（09-17 用户实测：「这个怎么到这个位置了」）
  //   事故：run-activity-bar 排在 #chat-anchor（乐观气泡）**之前** → 发送后那段「消息已上屏、
  //   引擎还没回声」的窗口里，状态条显示在刚发出的消息**上方**。
  //   运行时反证：改回原顺序 → 气泡 top=80 / 状态条 top=51，与用户截图的比例一致。
  //   ⛔ 必须按**源码顺序**断言（indexOf 比较），只查「两个类名都存在」等于没查。
  {
    const anchorIdx = appCode.indexOf('id="chat-anchor"');
    const barIdx = appCode.indexOf('className="run-activity-bar"');
    (anchorIdx >= 0 && barIdx >= 0 && anchorIdx < barIdx)
      ? ok("【29】生成状态条排在乐观气泡**之后**（不会显示在你的消息上方）")
      : fail("【29】run-activity-bar 排在 #chat-anchor 之前 —— 发送后状态条会出现在你消息的上方（用户实测）");
    ((appCode.match(/className="run-activity-bar"/g) || []).length === 1)
      ? ok("【29】状态条只渲染一处（多份会让它上下各出现一次）")
      : fail("【29】run-activity-bar 渲染点不唯一");
  }

  // ⑦ mac「不使用项目地址」+ 快捷键平台分叉（09-17 用户报：「mac 的不使用项目地址功能用不了，没有适配」）
  //   三个独立死因（任一都足以让 mac 用不了）：
  //   ① 发送路径条件是裸 `!workspace` —— mac 全新机器从没设过项目地址，于是用户明确选了
  //      「不使用项目地址」也照样被清掉 + 强制弹目录选择框（运行时反证：消息被目录框拦住、永不上屏）。
  //   ② 全局 keydown 写死 `!event.ctrlKey || … || event.metaKey` —— mac 的命令键是 ⌘，
  //      这句把 mac 的**所有**快捷键 return 掉（⌘O 打开工作区就在其中）。
  //   ③ scratch 目录优先写 app 安装目录 —— mac 上那是 .app/Contents/MacOS，写进去破坏代码签名。
  {
    const mainSrc = readFileSync(join(ROOT, "electron", "main.ts"), "utf8");
    /if \(!workspace && !welcomeScratchDir\) \{/.test(appCode)
      ? ok("【30】欢迎页发送路径：有 scratch 时不弹目录选择框（mac 上该选项才真的能用）")
      : fail("【30】发送路径条件缺 !welcomeScratchDir —— mac 全新机器上「不使用项目地址」会被清掉并弹框");
    /if \(welcomeScratchDir\) setWelcomeScratchDir\(null\);\s*\n\s*await chooseWorkspace\(\)/.test(appCode)
      ? fail("【30】旧写法回归 —— 发送时会把用户刚选的临时目录清掉")
      : ok("【30】已无「无条件清 scratch 再弹框」的旧写法");

    /const mod = mac \? event\.metaKey : event\.ctrlKey;/.test(appCode)
      ? ok("【30】快捷键命令键按平台分叉（mac = ⌘）")
      : fail("【30】快捷键写死 ctrlKey —— mac 上所有快捷键失效（⌘O 打开工作区也废）");
    // ⛔ 不能只匹配旧字面串（`!event.ctrlKey || … || event.metaKey`）—— 换成等价的
    //    `!mod || event.altKey || event.metaKey` 就漏检（反证实测为假绿）。改为**结构性**判据：
    //    分叉是**成对**的两行（mod / otherMod），所以 handler 体里 `event.metaKey` 恰好出现 2 次；
    //    再把它当干扰键拦一次（旧写法）就会变成 3 次，守卫立刻红。
    {
      const onKeyIdx = appCode.indexOf("function onKey(event: globalThis.KeyboardEvent) {");
      const onKeyBody = onKeyIdx < 0 ? "" : appCode.slice(onKeyIdx, onKeyIdx + 1200);
      const metaCount = (onKeyBody.match(/event\.metaKey/g) || []).length;
      (/const mod = mac \? event\.metaKey : event\.ctrlKey;/.test(onKeyBody)
        && /const otherMod = mac \? event\.ctrlKey : event\.metaKey;/.test(onKeyBody)
        && metaCount === 2)
        ? ok("【30】handler 里 metaKey 只用于成对平台分叉（没被当干扰键拦掉）")
        : fail(`【30】metaKey 用法异常（分叉缺失或出现 ${metaCount} 次）—— mac 的 ⌘ 会被 return 掉`);
    }

    /if \(process\.platform === "darwin"\) return make\(app\.getPath\("userData"\)\)/.test(mainSrc)
      ? ok("【30】scratch:create 在 mac 上落 userData（不写 .app bundle）")
      : fail("【30】scratch:create 无 darwin 分支 —— mac 上会去写 .app（破坏签名 / 只读卷）");

    // 展示层：快捷键标签平台化必须走 src/lib/hotkey.mjs 的纯函数（本机是 Windows 跑不到 mac 分支，
    // 只有纯函数断言能证明「mac 上显示成 ⌘」而不是靠猜）
    /import \{ macHotkeyLabel \} from "\.\/lib\/hotkey\.mjs";/.test(appCode)
      ? ok("【30】App 已接线 macHotkeyLabel（标签平台化）")
      : fail("【30】App 没有接 macHotkeyLabel —— 快捷键提示在 mac 上仍显示 Ctrl");
  }

  // ⑧ 快捷键标签转换的**行为**断言（纯函数，与平台探测解耦）
  {
    const { macHotkeyLabel, hotkeyLabel } = await import("../src/lib/hotkey.mjs");
    const rows = [
      ["Ctrl+Shift+F", "⌘⇧F"],
      ["Ctrl+O", "⌘O"],
      ["Shift+Enter", "⇧Enter"],
      ["Ctrl+Z / Ctrl+Y", "⌘Z / ⌘Y"],
      ["Esc", "Esc"],
    ];
    const bad = rows.filter(([input, expected]) => macHotkeyLabel(input) !== expected);
    (bad.length === 0 ? ok : fail)(`【30】mac 标签转换规则正确（${rows.length} 条${bad.length ? "，错：" + bad.map(([i]) => i).join(",") : ""}）`);
    (hotkeyLabel("Ctrl+O", "win32") === "Ctrl+O" && hotkeyLabel("Ctrl+O", "darwin") === "⌘O" ? ok : fail)("【30】Windows 侧标签原样不变（只 mac 转换）");
    // 接线：快捷键一览与命令面板都过 hk()
    (/keys: item\.keys\.map\(hk\)/.test(appCode) && /\{row\.shortcut && <kbd>\{hk\(row\.shortcut\)\}<\/kbd>\}/.test(appCode))
      ? ok("【30】快捷键一览 + 命令面板都走 hk()（不再是写死的 Ctrl 文案）")
      : fail("【30】有展示点没走 hk() —— mac 上仍会看到 Ctrl 文案");
  }

  // ⑨ 产物可启动性（09-17 用户报「启动就白屏」后补的网）
  //   用户白屏时我做的第一件事是「回退源码重建」——说明**产物层面**也要能自证：
  //   构建被打断 / 被别的进程占用时，会留下「index.html 引用不存在的 chunk」或
  //   「0 字节的 main.js」，这两种都会让应用**白屏**，而源码侧完全看不出来。
  //   ⛔ 排查经验：白屏时 CDP 求值/截图会**整体超时**，别据此断言「代码坏了」——
  //   正确姿势是 `electron --enable-logging <appDir>` 抓渲染层 console，或换隔离 profile 复测。
  {
    const distHtml = join(ROOT, "dist", "index.html");
    const html = existsSync(distHtml) ? readFileSync(distHtml, "utf8") : "";
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((r) => !/^(https?:|data:)/.test(r));
    const missing = refs.filter((r) => !existsSync(join(ROOT, "dist", r.replace(/^\.?\//, ""))));
    (missing.length === 0 ? ok : fail)(`【31】dist/index.html 引用的 ${refs.length} 个资源都在${missing.length ? "（缺：" + missing.join(", ") + "）" : ""}`);
    const artifacts = ["dist-electron/main.js", "dist-electron/preload.js", ...refs.map((r) => join("dist", r.replace(/^\.?\//, "")))];
    const bad = artifacts.filter((p) => { try { return readFileSync(join(ROOT, p)).length < 64; } catch { return true; } });
    (bad.length === 0 ? ok : fail)(`【31】关键产物非空且可读（${artifacts.length} 个）${bad.length ? "（异常：" + bad.join(", ") + "）" : ""}`);
  }

  // ⑩ 调度锁「孤儿持有者」+ 一键释放（09-17 用户实测「都关掉了，怎么还提示被锁住了」）
  //    事故：锁持有者是**从 thread-runtime 记录派生的**（第一个 dispatch.enabled 的线程），而会话被
  //    归档/删除时**没有任何地方清这条记录** —— store 里那句「记录被清掉时锁会自动释放」当年只是设想，
  //    实现里连 remove 都没有 ⇒ 孤儿记录永久占着全局唯一的调度权，而那条会话在侧栏上已找不到，
  //    用户**没有任何入口**能关它（实测：记录里 enabled=true，其 threadId 在引擎 state 库里已不存在）。
  {
    const mainCode = stripComments(readFileSync(join(ROOT, "electron", "main.ts"), "utf8"));
    const storeCode = stripComments(readFileSync(join(ROOT, "electron", "thread-runtime-store.ts"), "utf8"));

    // 防线一：主进程必须真的有清理**调用点**（有方法不等于有人调，这正是当初的坑）
    (/threadRuntimeStore\.remove\(/.test(mainCode) && /threadRuntimeStore\.releaseDispatch\(/.test(mainCode))
      ? ok("【29】主进程有调度记录清理调用点（remove / releaseDispatch）")
      : fail("【29】没有任何地方清调度记录 —— 归档/删除会话会留下孤儿记录永久占锁");

    // 防线二：清理挂在引擎 thread/archived | thread/deleted 事件上（覆盖所有删除/归档路径，不靠 UI 自觉）
    const evIdx = mainCode.indexOf('event.method === "thread/archived"');
    const evSlice = evIdx < 0 ? "" : mainCode.slice(evIdx, evIdx + 900);
    (evIdx >= 0 && /thread\/deleted/.test(evSlice) && /threadRuntimeStore\.(remove|releaseDispatch)\(/.test(evSlice))
      ? ok("【29】归档/删除事件触发记录清理（覆盖所有路径）")
      : fail("【29】thread/archived|deleted 事件没接记录清理 —— 会话消失后锁仍被占");

    // 防线三：store 真的实现了这两个方法（旧版连 remove 都没有）
    (/async releaseDispatch\(threadId: string\): Promise<boolean>/.test(storeCode) && /async remove\(threadId: string\): Promise<boolean>/.test(storeCode))
      ? ok("【29】store 实现 releaseDispatch / remove")
      : fail("【29】store 缺 releaseDispatch/remove —— 清理调用点会全部落空");

    // 防线四：渲染层自愈 —— 持有者不在会话列表里就自动释放（覆盖历史坏数据，用户不必手改 json）
    const healIdx = appCode.indexOf("window.codex.releaseDispatch(");
    const healSlice = healIdx < 0 ? "" : appCode.slice(Math.max(0, healIdx - 700), healIdx + 220);
    (/threads\.some\(\(entry\) => entry\.id === dispatchOwnerId\)/.test(healSlice) && /if \(!dispatchOwnerId \|\| threads\.length === 0\) return;/.test(healSlice))
      ? ok("【29】渲染层自愈：持有者不在会话列表时自动释放（历史坏数据也能解）")
      : fail("【29】缺少「持有者已消失」自愈 —— 孤儿锁只能靠用户手改 json");

    // 防线五：一键释放（用户 09-17 要求「在调度里面加一个主动释放功能，一键释放后删除旧的调度会话」）
    const releaseIdx = appCode.indexOf("async function releaseDispatchHolder()");
    const releaseFn = releaseIdx < 0 ? "" : appCode.slice(releaseIdx, releaseIdx + 2200);
    (/openAppConfirm\(/.test(releaseFn) && /window\.codex\.releaseDispatch\(holderId\)/.test(releaseFn) && /deleteThreadCore\(holderId\)/.test(releaseFn))
      ? ok("【29】一键释放：确认 → 释放锁 → 删除旧会话（三步齐）")
      : fail("【29】一键释放不完整（缺确认 / 缺释放 / 缺删除）");
    // 顺序必须是「先释放、后删除」：删失败时用户至少已经拿回调度权
    (releaseFn.indexOf("window.codex.releaseDispatch(holderId)") > -1
      && releaseFn.indexOf("window.codex.releaseDispatch(holderId)") < releaseFn.indexOf("deleteThreadCore(holderId)"))
      ? ok("【29】一键释放顺序 = 先释放、后删除（删除失败也不丢调度权）")
      : fail("【29】一键释放顺序反了或缺失 —— 删除失败会把调度权一起卡住");

    // 防线六：删除只有一条内核（普通删除与一键释放共用）——别处再写简版删除必漏衍生状态
    const coreIdx = appCode.indexOf("async function deleteThreadCore(id: string)");
    const coreFn = coreIdx < 0 ? "" : appCode.slice(coreIdx, coreIdx + 900);
    const coreCallers = (appCode.match(/await deleteThreadCore\(/g) || []).length;
    (coreIdx >= 0 && coreCallers >= 2)
      ? ok("【29】删除会话走唯一内核 deleteThreadCore（普通删除 / 一键释放共用）")
      : fail(`【29】deleteThreadCore 缺失或调用点不足（${coreCallers} 处）—— 会出现漏清衍生状态的简版删除`);
    (/threadCacheRef\.current\.delete\(id\)/.test(coreFn) && /threadProviderRef\.current\.delete\(id\)/.test(coreFn))
      ? ok("【29】删除内核清理衍生状态（会话缓存 + 供应商登记）")
      : fail("【29】删除内核漏清衍生状态（会话缓存 / 供应商登记）");

    // 接线：按钮在面板里，父组件把回调传了下去
    (/className="dispatch-release"/.test(appCode) && /onReleaseHolder=\{/.test(appCode) && /onReleaseHolder\?: \(\) => void;/.test(appCode))
      ? ok("【29】面板里有「释放并删除该会话」按钮且已接线（onReleaseHolder）")
      : fail("【29】一键释放按钮缺失或没接线（onReleaseHolder）");
  }
}

// ---------- 【32】mac 全面适配（09-17 审计：15 项真缺失的回归网） ----------
//  用户原话「MAC 的适配要做全，全方面适配」。这里每条都对应一个**实测过的真问题**，
//  且都是 Windows 上跑预检看不到的（本机是 Windows ⇒ 只能靠结构性断言锁定，靠 mac CI 出包时兜底）。
{
  const stripC = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const mainC = stripC(readFileSync(join(ROOT, "electron", "main.ts"), "utf8"));
  const toolchainC = stripC(readFileSync(join(ROOT, "electron", "toolchain.ts"), "utf8"));
  const terminalC = stripC(readFileSync(join(ROOT, "electron", "terminal.ts"), "utf8"));
  const remoteC = stripC(readFileSync(join(ROOT, "electron", "remote.ts"), "utf8"));
  const updaterC = stripC(readFileSync(join(ROOT, "electron", "engine-updater.ts"), "utf8"));
  const voiceSettingsC = stripC(readFileSync(join(ROOT, "electron", "voice", "voice-settings.ts"), "utf8"));
  const voiceSectionC = stripC(readFileSync(join(ROOT, "src", "components", "VoiceSettingsSection.tsx"), "utf8"));
  const hotkeyMatchC = stripC(readFileSync(join(ROOT, "src", "voice", "hotkey-match.ts"), "utf8"));
  const macCfg = readFileSync(join(ROOT, "build", "electron-builder.mac.cjs"), "utf8");
  const prepMac = readFileSync(join(ROOT, "scripts", "prepare-mac-tools.cjs"), "utf8");
  const verifyTools = readFileSync(join(ROOT, "scripts", "verify-packaged-tools.cjs"), "utf8");
  const sliceFn = (src, needle, len) => { const i = src.indexOf(needle); return i < 0 ? "" : src.slice(i, i + len); };

  // ① 麦克风用途声明：macOS 缺这条不是「弹不出授权框」，是**进程被系统直接杀掉**（取麦即闪退）
  /NSMicrophoneUsageDescription/.test(macCfg)
    ? ok("【32】mac Info.plist 声明麦克风用途（缺了语音首次取麦必闪退）")
    : fail("【32】electron-builder.mac.cjs 缺 NSMicrophoneUsageDescription —— mac 上语音通话/听写取麦即被系统杀进程");

  // ② mac 关窗 ≠ 退出：window-all-closed 里若照 Windows 清理服务，点 Dock 重开得到「窗口在、功能全哑」
  {
    const body = sliceFn(mainC, 'app.on("window-all-closed"', 520);
    (/process\.platform === "darwin"\) return;/.test(body) && /cleanupAll\(\)/.test(body) && /app\.quit\(\)/.test(body))
      ? ok("【32】window-all-closed 在 mac 上保留服务（关窗后 Dock 重开仍可用）")
      : fail("【32】window-all-closed 没做 darwin 分叉 —— mac 关窗后重开窗口引擎/服务/调度器全哑");
    // 但要确认清理没被整体删掉：before-quit 仍必须 cleanupAll（否则 mac 永不清理）
    const quitBody = sliceFn(mainC, 'app.on("before-quit"', 420);
    /cleanupAll\(\)/.test(quitBody)
      ? ok("【32】before-quit 仍然 cleanupAll（mac 上服务保活但不泄漏）")
      : fail("【32】before-quit 不再 cleanupAll —— mac 关窗保活后永远不释放引擎/端口");
  }

  // ③ cloudflared（手机配对的公网隧道）：路径必须走内置工具目录 + 平台化文件名，且 mac 包要真的带上
  {
    const fnBody = sliceFn(remoteC, "function resolveCloudflaredBin", 760);
    // 判据必须精确：Windows 分支**本来就该**叫 cloudflared.exe（不能笼统禁止 .exe），
    // 要锁的是「mac 也有对应布局」+「解析基于内置工具目录而不是 process.cwd()」。
    (fnBody && /toolsRoot\(\)/.test(fnBody) && /\["cloudflared", "cloudflared"\]/.test(fnBody) && !/\.cwd\(\)/.test(fnBody))
      ? ok("【32】cloudflared 走 toolsRoot + 平台化文件名（不再写死 cwd/…exe）")
      : fail("【32】remote.ts 的 cloudflared 解析仍依赖 process.cwd / 缺 mac 布局 —— mac 上手机配对隧道永不启动");
    /cloudflared-darwin-\$\{arch === "arm64" \? "arm64" : "amd64"\}\.tgz/.test(prepMac)
      ? ok("【32】prepare-mac-tools 现造 cloudflared(darwin) 并补执行位")
      : fail("【32】prepare-mac-tools 不造 cloudflared —— mac 包里没有隧道二进制");
    /path\.join\(root, "cloudflared", "cloudflared"\)/.test(verifyTools)
      ? ok("【32】mac 产物校验断言 cloudflared 存在且有执行位")
      : fail("【32】mac 产物校验没有 cloudflared 断言 —— 缺了要到用户那儿才发现");
  }

  // ④ ffmpeg：渠道语音转码依赖它，mac 布局是 tools/ffmpeg/bin/ffmpeg（无后缀），旧实现只找 .exe + 用 cwd
  {
    const fnBody = sliceFn(mainC, "function resolveFfmpegPath", 800);
    (/process\.platform === "win32" \? \["ffmpeg", "ffmpeg\.exe"\] : \["ffmpeg", "bin", "ffmpeg"\]/.test(fnBody) && !/\.cwd\(\)/.test(fnBody))
      ? ok("【32】ffmpeg 路径平台化（mac = tools/ffmpeg/bin/ffmpeg，不依赖 cwd）")
      : fail("【32】resolveFfmpegPath 仍只找 ffmpeg.exe / 依赖 cwd —— mac 上渠道语音转码必失败");
  }

  // ⑤ 系统级探测：mac 上 Docker Desktop 装在 /Applications，CLI 在 /usr/local|/opt/homebrew；PATH 分隔符也不能写死
  {
    const fnBody = sliceFn(mainC, "function runtimeInstalledBySystem", 1400);
    (/\/Applications\/Docker\.app/.test(fnBody) && /opt\/homebrew\/bin\/docker/.test(fnBody))
      ? ok("【32】mac 上探测 Docker Desktop（装了不再显示「未安装」）")
      : fail("【32】darwin 分支没有 docker 探测 —— mac 装了 Docker 也一直显示「未安装」");
    /split\(path\.delimiter\)/.test(fnBody)
      ? ok("【32】docker 的 PATH 探测用 path.delimiter（不再写死「;」）")
      : fail("【32】docker 的 PATH 探测写死「;」 —— POSIX 上永远探不到");
  }

  // ⑥ npm 全局 shim 清理：POSIX 落在 <prefix>/bin/<pkg>，旧清单只有 Windows 的 .cmd/.ps1
  {
    const fnBody = sliceFn(mainC, "function npmShimPaths", 800);
    /path\.join\(globalDir, "bin", pkg\)/.test(fnBody)
      ? ok("【32】npm 全局 shim 清理覆盖 POSIX 的 bin/<pkg>")
      : fail("【32】npmShimPaths 缺 bin/<pkg> —— mac 上卸载 npm 包后 shim 残留指向空目录");
  }

  // ⑦ CODEX_REAL_PWSH：mac 的 pwsh 无 .exe，写死路径会让这个环境变量永不设置
  {
    const fnBody = sliceFn(toolchainC, "export function toolchainEnv", 1400);
    (/const realPwsh = bundledPwsh\(\);/.test(fnBody) && !/pwsh", "pwsh\.exe"/.test(fnBody))
      ? ok("【32】CODEX_REAL_PWSH 走 bundledPwsh()（平台解析）")
      : fail("【32】toolchainEnv 仍写死 pwsh.exe —— mac 上 CODEX_REAL_PWSH 永不设置");
  }

  // ⑧ 引擎更新用 tar：darwin 给绝对路径（GUI 进程 PATH 是 launchd 最小集）
  {
    const fnBody = sliceFn(updaterC, "function tarExecutable", 420);
    /\/usr\/bin\/tar/.test(fnBody)
      ? ok("【32】engine-updater 在 darwin 用 /usr/bin/tar")
      : fail("【32】engine-updater 的 tarExecutable 没有 darwin 分支 —— mac 上靠裸名 tar，PATH 被改过就落空");
  }

  // ⑨ 终端面板：PATH 分隔符 / 路径拼接 / 自绘提示符 三处都得平台化
  {
    (/split\(path\.delimiter\)/.test(terminalC) && /path\.join\(dir, name\)/.test(terminalC) && !/split\(";"\)/.test(terminalC))
      ? ok("【32】终端查找用 path.delimiter + path.join（不再反斜杠拼接 / 写死「;」）")
      : fail("【32】terminal.ts 仍用反斜杠拼接或 split(\";\") —— POSIX 上候选目录解析全错");
    /process\.platform === "win32" \? `PS \$\{this\.cwd\}> ` : `\$\{this\.cwd\} \$ `/.test(terminalC)
      ? ok("【32】自绘提示符平台化（mac 不再显示 PowerShell 风格的「PS …>」）")
      : fail("【32】终端提示符没平台化 —— mac 上显示「PS /Users/x>」");
  }

  // ⑩ 语音快捷键：默认键用 CommandOrControl；匹配与录入/显示都要按平台分叉
  {
    /accelerator: "CommandOrControl\+Shift\+M"/.test(voiceSettingsC)
      ? ok("【32】默认呼叫快捷键 = CommandOrControl+Shift+M（Windows 仍是 Ctrl，mac 是 ⌘）")
      : fail("【32】默认呼叫键写死 Ctrl+… —— mac 上不符合直觉（且不该记成 Super）");
    (/const cmdOrCtrl = parts\.includes\("cmdorctrl"\);/.test(hotkeyMatchC) && /needsCtrl = cmdOrCtrl \? !mac/.test(hotkeyMatchC))
      ? ok("【32】hotkey-match 按平台解析 CommandOrControl（mac → metaKey）")
      : fail("【32】hotkey-match 把 CommandOrControl 一律当 ctrlKey —— mac 上 ⌘⇧M 永远匹配不上");
    (/IS_MAC_UI \? "Command" : "Super"/.test(voiceSectionC) && /showHotkey\(/.test(voiceSectionC))
      ? ok("【32】语音快捷键录入/显示平台化（mac 记 Command、显示 ⌘⇧M）")
      : fail("【32】语音快捷键仍一律记 Super / 原样打印 accelerator —— mac 用户看到「Super+Shift+M」");
  }

  // ⑪ 开发工具卡文案：specs 是按 Windows 写的，mac 上「装 Git 约 90 MB」这类说法会误导
  {
    (/const DARWIN_SPEC_TEXT/.test(mainC) && /specFor\(id, spec\)/.test(mainC))
      ? ok("【32】开发工具卡文案按平台覆盖（git/openssl/docker 在 mac 上不再照搬 Windows 口径）")
      : fail("【32】缺少 DARWIN_SPEC_TEXT/specFor —— mac 上开发工具卡仍在说「装 Git / 约 90 MB」");
  }

  // ⑫ 行为断言：accelerator 原文 → mac 写法（纯函数，与平台探测解耦；mac 上显示什么这里说了算）
  {
    const { macHotkeyLabel } = await import("../src/lib/hotkey.mjs");
    const rows = [
      ["CommandOrControl+Shift+M", "⌘⇧M"],
      ["Command+Shift+M", "⌘⇧M"],
      ["Super+Space", "⌘Space"],
      ["Option+Space", "⌥Space"],
      ["Ctrl+Shift+F", "⌘⇧F"],
    ];
    const bad = rows.filter(([input, expected]) => macHotkeyLabel(input) !== expected);
    (bad.length === 0 ? ok : fail)(`【32】accelerator → mac 写法（${rows.length} 条${bad.length ? "，错：" + bad.map(([i, e]) => `${i}→${macHotkeyLabel(i)}(期望${e})`).join(",") : ""}）`);
  }

  // ⑬ 「成功绿」必须是真绿：--green 曾被写成 #1e1e1c（近黑），导致全系统 299 处成功态视觉
  //   全部失效成中性色（用户实测「内置插件启用跟禁用一个状态，没有颜色区分」的根因之一）。
  //   判定：两套主题的 --green 其 G 通道必须显著高于 R/B（中性色三通道几乎相等）。
  {
    const cssC = readFileSync(join(ROOT, "src", "styles.css"), "utf8");
    const greens = [...cssC.matchAll(/--green:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1]);
    const isGreen = (hex) => {
      const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
      return g - Math.max(r, b) >= 40;   // G 通道至少高出 40 才算绿
    };
    const uses = (cssC.match(/var\(--green\)/g) || []).length;
    (greens.length >= 2 && greens.every(isGreen))
      ? ok(`【32】--green 是真绿（${greens.join(" / ")}；影响 ${uses} 处成功态视觉）`)
      : fail(`【32】--green 回归成中性色（当前：${greens.join(" / ") || "未找到"}）—— ${uses} 处成功态视觉全部失效`);
  }

  // ⑭ 启动加载页（09-17）：实测挂载后还要 1.3~2.1s 才拿到首屏数据，此前无任何反馈。
  //   三条硬约束：① 覆盖层必须活到数据就绪（React 一挂载就消失 = 回到空窗）
  //              ② 样式定义在 index.html（JS 未加载时也要能显示）+ 图标用蓝色原版
  //              ③ 背景跟主题（固定深黑会在亮色主题下黑闪）
  {
    const boot = readFileSync(join(ROOT, "src", "components", "BootSplash.tsx"), "utf8");
    const bootCode = boot.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const html = readFileSync(join(ROOT, "index.html"), "utf8");
    const appBoot = readFileSync(join(ROOT, "src", "App.tsx"), "utf8");
    (/export function BootSplash/.test(bootCode) && /done\b/.test(bootCode) && /boot-splash-leaving/.test(bootCode))
      ? ok("【32】启动加载页存在且带淡出（BootSplash + boot-splash-leaving）")
      : fail("【32】BootSplash 缺失或没有淡出 —— 启动空窗回归（挂载后有 1.3~2.1s 无反馈）");
    (/<BootSplash/.test(appBoot) && /done=\{bootReady \|\| Boolean\(showLogin\)\}/.test(appBoot))
      ? ok("【32】启动页活到首屏数据就绪才退场（done=bootReady，不是挂载即退）")
      : fail("【32】BootSplash 的 done 没绑首屏数据 —— 挂载即退场，等于没做");
    (/\.boot-splash\s*\{/.test(html) && /data-theme="dark"\]\s*\.boot-splash/.test(html) && /boot-splash-logo/.test(html) && /icon\.png/.test(html))
      ? ok("【32】启动页样式内联在 index.html（含主题分叉 + 蓝图标）")
      : fail("【32】index.html 缺启动页内联样式/主题分叉/蓝图标 —— 首帧会黑闪或用错图标");
    (!/boot-splash-logo">CH</.test(html) && !/>CH<\/div>/.test(html))
      ? ok("【32】启动页不再用 CH 黑块（与侧栏徽标一致改为蓝图标）")
      : fail("【32】启动页仍是 CH 黑块 —— 与侧栏已改的蓝图标不一致");
    (/performance\.now\(\) >= MIN_SHOW_MS/.test(bootCode))
      ? ok("【32】启动过快时跳过启动页（避免一闪而过）")
      : fail("【32】缺少最短显示阈值判定 —— 快机器上会闪一下");
  }

  // ⑮ 设置页「使用帮助」（09-17 用户要求：模型/插件/技能/MCP/专家团/语音/开发工具面向新手）。
  //   痛点：帮助是"加了但挂错页/少挂一页"最容易复发的问题（每页各写一个按钮，删改时容易漏）。
  //   所以断言分两层：内容库 key 齐全 + 页面挂载数量达标 + 弹窗真的在渲染树里。
  {
    const helpC = readFileSync(join(ROOT, "src", "components", "HelpDialog.tsx"), "utf8");
    const appC = readFileSync(join(ROOT, "src", "App.tsx"), "utf8");
    const voiceC = readFileSync(join(ROOT, "src", "components", "VoiceSettingsSection.tsx"), "utf8");
    const HELP_KEYS = ["model", "plugins", "skills", "mcp", "agentteam", "voice", "devtools"];
    const missingKeys = HELP_KEYS.filter((key) => !new RegExp(`\\b${key}:\\s*\\{`).test(helpC));
    (missingKeys.length === 0)
      ? ok(`【32】帮助内容库覆盖 ${HELP_KEYS.length} 个主题（模型/插件/技能/MCP/专家团/语音/开发工具）`)
      : fail(`【32】帮助内容库缺主题：${missingKeys.join(", ")} —— 对应页面点帮助会打不开或空白`);
    // ? 号（09-17 用户：「文字赘述过多，都改成 ? 号，鼠标放上去展示」「帮助展示的位置放的
    // 都不好看」）：各页那个占位的「帮助」按钮已退休、长说明收进标题旁的 ?。所以断言从
    // "帮助按钮数"改成三层：① ? 挂载数 ② 兼作帮助入口的 ? 数 ③ 「赘述回潮」判据。
    const hintCount = (appC.match(/<PageInfo\b/g) || []).length;
    (hintCount >= 15)
      ? ok(`【32】设置页挂了 ${hintCount} 处 ? 号（说明收进 ?，头部恒为一行）`)
      : fail(`【32】? 号只有 ${hintCount} 处 —— 说明又被摊回标题下了（赘述回潮）`);
    const keyedHints = (appC.match(/helpKey="/g) || []).length;
    (keyedHints >= 6)
      ? ok(`【32】${keyedHints} 处 ? 兼作「完整帮助」入口（HelpButton 退休后入口没丢）`)
      : fail(`【32】兼帮助入口的 ? 只有 ${keyedHints} 处 —— 有页面的完整帮助从此打不开`);
    // ⛔ 比"数量够"更强的判据：**每个帮助主题都必须有 ? 入口**。数量达标不代表没有孤儿 ——
    //    「模型」页（标题是 provider-list-head、不是 settings-copy）与「专家和专家团」页
    //    （说明只有一句短话、不在收编名单里）的入口就真被漏掉了：内容库还在，用户点不到。
    //    这正是本条守卫要防的形态（本轮 code review 抓到的两个真问题之一）。
    const orphanKeys = HELP_KEYS.filter((key) => !new RegExp(`helpKey="${key}"`).test(appC + voiceC));
    (orphanKeys.length === 0)
      ? ok(`【32】${HELP_KEYS.length} 个帮助主题都有 ? 入口（无"内容库在、入口丢了"的孤儿）`)
      : fail(`【32】这些主题的帮助入口丢了：${orphanKeys.join(", ")} —— 内容库还在，但用户点不到`);
    // ⛔ 赘述回潮的可证伪判据：settings-copy 区块里不该再有 >40 字的内联段落。
    //    短句（≤40 字）允许内联 —— 它只占一行，硬收进 ? 反而让用户多点一次。
    const longCopies = appC.split(/\r?\n/)
      .filter((line) => line.includes("settings-copy"))
      .map((line) => {
        const m = line.match(/<p>([\s\S]*?)<\/p>/);
        return m ? m[1].replace(/<[^>]+>/g, "").replace(/\{[^}]*\}/g, "").length : 0;
      })
      .filter((n) => n > 40);
    (longCopies.length === 0)
      ? ok("【32】设置页说明都已收进 ?（settings-copy 里没有 >40 字的内联段落）")
      : fail(`【32】有 ${longCopies.length} 处说明又摊回标题下（${longCopies.join("/")} 字）—— 应收进 ?`);
    (/<HelpDialog\b/.test(appC))
      ? ok("【32】HelpDialog 挂在渲染树里（弹窗能真正打开）")
      : fail("【32】HelpDialog 没挂到渲染树 —— 点帮助不会有任何反应");
    // ⛔ ? 里的「查看完整帮助」靠 context 拿 setHelpKey：没注入 = 点了没反应，且是静默失效
    (/HelpOpenContext\.Provider/.test(appC) && /value=\{setHelpKey\}/.test(appC))
      ? ok("【32】? 的帮助出口已注入（HelpOpenContext.Provider value=setHelpKey）")
      : fail("【32】HelpOpenContext 没注入 —— ? 里点「查看完整帮助」没有任何反应");
    (/PageInfo[\s\S]{0,220}?helpKey="voice"/.test(voiceC))
      ? ok("【32】语音页 ? 在（在子组件里，最容易漏改的一页）")
      : fail("【32】语音页缺 ? 入口 —— 用户点名的页面之一是它");
    // ? 的气泡必须 portal + fixed：设置内容是滚动容器，absolute 浮层会被裁掉下半截
    const headC = readFileSync(join(ROOT, "src", "components", "SettingsHead.tsx"), "utf8");
    const cssAll = readFileSync(join(ROOT, "src", "styles.css"), "utf8");
    (/\.page-info-pop[\s\S]{0,220}?position:\s*fixed/.test(cssAll))
      ? ok("【32】? 气泡 fixed 定位（不会被设置页滚动容器裁切）")
      : fail("【32】? 气泡不是 fixed 定位 —— 会被滚动容器裁掉下半截（内容读不全）");
    (/createPortal/.test(headC) && /getBoundingClientRect/.test(headC))
      ? ok("【32】? 气泡走 portal + 实测定位（宽气泡不会溢出屏幕右侧）")
      : fail("【32】? 气泡没走 portal —— 会被祖先容器的 overflow 裁切");
    // 新手帮助必须写清「怎么开始」，不能只有概念说明
    const thin = HELP_KEYS.filter((key) => {
      const at = helpC.indexOf(`${key}: {`);
      if (at < 0) return true;
      const block = helpC.slice(at, helpC.indexOf("\n  },", at));
      return (block.match(/^\s{10}"/gm) || []).length < 3;
    });
    (thin.length === 0)
      ? ok("【32】每个帮助主题都有 ≥3 条操作步骤（不是概念说明）")
      : fail(`【32】这些主题的步骤太少（不足 3 条）：${thin.join(", ")}`);

    // ⑯ 设置总览（09-17 用户要求：标题栏加「设置总览」，让新手快速熟悉整个设置界面）
    //   最容易复发的失效形态：**新增设置页但总览没同步**——新手照总览找不到那页，比没有总览更糟。
    //   所以核心断言是「总览页名集合 ⊇ settingsNav 的展示文案集合」。
    const overviewAt = helpC.indexOf("export const OVERVIEW_GROUPS");
    const overviewBlock = overviewAt < 0 ? "" : helpC.slice(overviewAt, helpC.indexOf("\n];", overviewAt));
    const navBlock = (() => {
      const at = appC.indexOf("const settingsNav");
      return at < 0 ? "" : appC.slice(at, appC.indexOf("\n];", at));
    })();
    const overviewPages = [...overviewBlock.matchAll(/page:\s*"([^"]+)"/g)].map((m) => m[1]);
    const navLabels = [...navBlock.matchAll(/\["[a-z]+",\s*"([^"]+)"/g)].map((m) => m[1]);
    (overviewPages.length > 0)
      ? (() => {
        const missing = navLabels.filter((label) => !overviewPages.includes(label));
        missing.length === 0
          ? ok(`【32】设置总览覆盖导航全部 ${navLabels.length} 页（无遗漏）`)
          : fail(`【32】总览漏了这些设置页：${missing.join("、")} —— 新手照总览找不到它们`);
      })()
      : fail("【32】OVERVIEW_GROUPS 为空 —— 设置总览没有内容");
    (/<HelpDialog[\s\S]{0,400}?onNavigate=/.test(appC) && /settingsNav\.flatMap/.test(appC))
      ? ok("【32】总览页名可点击跳转（页名 → settingsNav 反查页面 key）")
      : fail("【32】总览的 onNavigate 缺失 —— 页名点不动，总览只能看不能用");
    (/className="settings-header-actions"/.test(appC) && /setHelpKey\("overview"\)/.test(appC))
      ? ok("【32】设置标题栏有「设置总览」入口")
      : fail("【32】设置弹窗标题栏缺总览入口 —— 用户看不到这个帮助");
    // 简介里的「共 N 页」若写成固定数字，新增页后会与事实不符；必须是动态计算
    (/共 \$\{OVERVIEW_GROUPS\.reduce/.test(helpC))
      ? ok("【32】总览页数是动态计算的（新增页不会与简介数字打架）")
      : fail("【32】总览简介里的页数写成了固定数字 —— 新增设置页后会误导用户");
  }

  // ⑰ 增强按钮提示气泡（09-17 用户要求：输入内容后在图标上方小气泡，词库 15~20 条；
  //   触发条件三条叠加：① 每次启动后第一次输入必弹 ② 每 5 次发送 ③ 输入长需求）。
  {
    const hints = await import("../src/lib/enhance-hints.mjs");
    const { ENHANCE_HINTS, pickEnhanceHint, shouldShowHintThisRun, markHintShownThisRun, shouldShowHintAfterSends, isLongPrompt, HINT_AUTO_HIDE_MS } = hints;
    (ENHANCE_HINTS.length >= 15 && ENHANCE_HINTS.length <= 25)
      ? ok(`【32】增强提示词库 ${ENHANCE_HINTS.length} 条（用户要求 15~20）`)
      : fail(`【32】提示词库 ${ENHANCE_HINTS.length} 条，超出 15~25 区间`);
    (ENHANCE_HINTS.every((hint) => typeof hint === "string" && hint.trim().length >= 8 && hint.length <= 30))
      ? ok("【32】每条提示都是 8~30 字的完整句子（气泡宽度可控）")
      : fail("【32】有提示过短/过长 —— 过短没信息量，过长气泡会换行成块");
    // 条件①：语义是「本次启动内弹一次」——启动归零靠模块级变量，用 localStorage 就违背了
    // "每次启动都弹"，所以额外断言不落盘（下面那条静态守卫负责"初值 = 未弹过"）。
    // ⛔ 断言必须**幂等**：它内部要调 markHintShownThisRun（改模块状态），若同一进程里被执行
    //    第二次，`before` 就会是 false。所以**只验"标记之后必须为假"**，不去比较 before
    //    （写成 `before===true || before===false` 是恒真、等于废掉断言）。
    const runSemantics = (() => {
      markHintShownThisRun();
      return shouldShowHintThisRun() === false;
    })();
    (runSemantics)
      ? ok("【32】条件①：标记后转假（幂等，重复执行不假红）")
      : fail("【32】markHintShownThisRun 没生效 —— 会导致每次输入都弹");
    const hintSrcRaw = readFileSync(join(ROOT, "src", "lib", "enhance-hints.mjs"), "utf8");
    const hintSrc = hintSrcRaw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    (!/localStorage/.test(hintSrc) && /let shownThisRun = false/.test(hintSrc))
      ? ok("【32】条件①用模块级变量（每次启动归零），不落盘")
      : fail("【32】条件①落了盘 —— 用户要的是「每次启动后第一次输入必弹」，落盘会让老用户永远看不到");
    // 条件②③
    (shouldShowHintAfterSends(5) === true && shouldShowHintAfterSends(10) === true && shouldShowHintAfterSends(4) === false && shouldShowHintAfterSends(0) === false)
      ? ok("【32】条件②：每 5 次发送弹一次（5/10 真，4/0 假）")
      : fail("【32】条件②节奏判定错误");
    // 条件③：必须是**精确阈值** 50 —— 只测「50 字真、3 字假」测不出阈值被改成 10（50 仍 ≥ 10），
    // 所以补 49/50 的边界（反证时发现的守卫弱点，见 memory 09-17）。
    (isLongPrompt("甲".repeat(50)) === true && isLongPrompt("甲".repeat(49)) === false && isLongPrompt("短需求") === false)
      ? ok("【32】条件③：长输入阈值为 50 字（含 49/50 边界）")
      : fail("【32】长输入阈值不是 50（或边界判定错）—— 长需求提醒会失效或误触发");
    (HINT_AUTO_HIDE_MS === 6000)
      ? ok("【32】气泡 6 秒自动消失（用户指定）")
      : fail(`【32】自动消失时间被改动：${HINT_AUTO_HIDE_MS}ms`);
    let dup = 0, last;
    for (let i = 0; i < 300; i++) { const next = pickEnhanceHint(last); if (next === last) dup++; last = next; }
    (dup === 0)
      ? ok("【32】连续两次不会抽到同一条（300 次抽样 0 重复）")
      : fail(`【32】提示会连续重复（300 次里 ${dup} 次）—— 词库小更要避免原地重复`);
    // 结构性守卫：展示条件必须与锚点按钮的渲染条件一致（否则 pending 被白清，气泡永远看不见）
    const appC2 = readFileSync(join(ROOT, "src", "App.tsx"), "utf8");
    (/const enhanceAnchorVisible = Boolean\(prompt\.trim\(\) \|\| hasEnhanceBackup\) && !activeThreadRunning;/.test(appC2))
      ? ok("【32】气泡展示条件与锚点按钮渲染条件一致（防 pending 白清）")
      : fail("【32】enhanceAnchorVisible 缺失或与按钮条件不一致 —— 回合运行中会白清掉这次提示");
    // 长输入节流必须与标记**耦合**在同一个表达式里 —— 只查两处文本各自存在，
    // 测不出 `&& !enhanceLongFiredRef.current` 被摘掉（反证发现的守卫弱点）。
    (/const longPromptDue = isLongPrompt\(prompt\) && !enhanceLongFiredRef\.current;/.test(appC2))
      ? ok("【32】长输入提醒按「编辑会话」节流（清空后重置，不会边打字边弹）")
      : fail("【32】长输入缺少节流 —— 每敲一个字都可能弹，会变成骚扰");
    (/Date\.now\(\) - enhanceHintFiredAtRef\.current < HINT_COOLDOWN_MS/.test(appC2))
      ? ok("【32】多条件叠加时有冷却窗口（防连弹）")
      : fail("【32】缺少冷却 —— 三条触发条件叠在一起时会连弹");
    // 增强结果可撤销：取消令牌 + 还原原文（用户 09-17 明确要求"支持取消增强，返回原输入"）
    // ⛔ 判据必须锚在**成功路径上紧跟请求之后**的校验：只查 `runId !== ...` 文本存在测不出
    //    成功路径那处被删（catch 里还有一处同名判断，会顶成假绿 —— 反证发现的守卫弱点）。
    (/await window\.codex\.enhancePrompt\(raw\);[\s\S]{0,240}?if \(runId !== enhanceRunIdRef\.current\) return;/.test(appC2))
      ? ok("【32】增强中取消会作废在飞请求（结果回来后先验令牌再写输入框）")
      : fail("【32】成功路径没有验取消令牌 —— 用户取消后内容仍会被替换（真 bug）");
    (/cancelPromptEnhance\(\)/.test(appC2) && /setPrompt\(enhanceBackupRef\.current\)/.test(appC2))
      ? ok("【32】增强结果可还原为原文（revert 路径在）")
      : fail("【32】还原原文路径缺失 —— 用户对增强结果不满意就回不去了");
    // 气泡宽度：绝对定位在窄容器里 shrink-to-fit 会压成竖排窄条（截图实测踩到）
    // ⛔ 必须先去注释再判 —— 注释里也提到了这个属性名，直接正则会被注释顶成假绿（本轮踩到）。
    const cssC2 = readFileSync(join(ROOT, "src", "styles.css"), "utf8");
    const hintBlock = cssC2
      .slice(cssC2.indexOf(".enhance-hint {"), cssC2.indexOf(".enhance-hint:hover"))
      .replace(/\/\*[\s\S]*?\*\//g, "");
    (/width:\s*max-content/.test(hintBlock))
      ? ok("【32】气泡有 width:max-content（防被压成竖排窄条）")
      : fail("【32】.enhance-hint 缺 width:max-content —— 绝对定位在 32px 窄容器里会被压成竖排");
  }

  // ⑰b assistant 消息头的「头像 + 名字」必须真的显示（09-17 用户报「头像我也没看展示出来」）：
  //   历史遗留的 `.codex-turn .assistant-message{grid-template-columns:minmax(0,1fr)}` +
  //   `.avatar{display:none}` 是为"assistant 消息左侧不放图标"的老设计服务的 —— 加了名字之后，
  //   它把整个头像列隐掉，用户只看得到名字。改消息头样式时极容易再踩回去。
  //   ⛔ 判 CSS 前先剥注释：注释里也写着 display:none，不剥会被顶成假绿（本项目老坑）。
  //   ③ 09-17 二次反馈后的**最终形态**：「一轮会话就一个 Codex 名字和 Codex 头像就行，就在会话
  //      上面就行」+「名字和头像没有第一时间出来」→ 头从「每条 agent 消息一份」提到**回合级一份**
  //      （`.turn-head`，TurnView 渲染），且回合建立即渲染（不等首个 token）。
  //      三种失效形态都静默：回合头没了 / 消息里又长出头像（一轮重复多份）/ 回合头退回"等有内容"。
  {
    const cssNC = readFileSync(join(ROOT, "src", "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const appC3 = readFileSync(join(ROOT, "src", "App.tsx"), "utf8");
    // 结构判据要**先剥注释**再判：注释里也写着 turn-head-avatar 这类字面量（不剥会假绿）；
    // 而注释还占满了窗口长度（不剥又会假红 —— 09-17 实测「乐观阶段也有回合头」那条：
    // 原始距离 753 > 窗口 700，剥注释后只有 367。窗口是给代码留的，不是给注释留的）。
    const appNC = appC3.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    // 头像+名字的最终形态：**回合级一份**（.turn-head），不再是「每条 agent 消息一份」
    const turnHead = appC3.slice(appC3.indexOf("回合标识：一轮会话只有一份"), appC3.indexOf("占位头必须等回合内已有 userMessage"));
    (/className="turn-head-avatar"/.test(turnHead) && /<CodexAvatar size=\{22\} \/>/.test(turnHead))
      ? ok("【32】回合级渲染「头像 + 名字」（.turn-head，一轮只一份）")
      : fail("【32】回合级头没了 —— 用户看不到 Codex 名字头像");
    (/userItems\.length > 0 && \(running \|\| responseItems\.length > 0\)/.test(turnHead))
      ? ok("【32】回合头不依赖首个 token（用户气泡上屏即出现）")
      : fail("【32】回合头的显示条件变了 —— 可能又回到「名字头像没第一时间出来」");
    (!/className="message assistant-message"[\s\S]{0,220}className="avatar agent"/.test(appNC))
      ? ok("【32】agent 消息里不再带头像（一轮不会重复多份）")
      : fail("【32】agent 消息里又长出头像 —— 一轮多段回复会重复多份（用户要求「就一个」）");
    (/\.turn-head\s*\{/.test(cssNC) && /\.turn-head-avatar\s*\{/.test(cssNC) && /\.turn-head-name\s*\{/.test(cssNC))
      ? ok("【32】.turn-head / 头像 / 名字三条样式都在")
      : fail("【32】.turn-head 样式缺 —— 回合头会没尺寸或没对齐");
    const procIdx = appC3.indexOf("{running && userItems.length > 0 && <RunningProcessTime />}");
    const cardIdx = appC3.indexOf('{running && !hasVisible && userItems.length > 0 && <header className="turn-card-header">');
    (procIdx > 0)
      ? ok("【32】「正在处理 N 秒 + 灰线」不再依赖工具调用（回合内 userMessage 一到就显示）")
      : fail("【32】RunningProcessTime 的条件又被改掉（缺 userItems 会顶到用户消息上方；挂回 isTaskTurn 则纯聊天看不到）");
    (procIdx > 0 && cardIdx > 0 && procIdx < cardIdx)
      ? ok("【32】顺序：正在处理 + 灰线在「生成中」之上（用户 09-17 明确定的顺序）")
      : fail("【32】「生成中」跑到灰线上面了 —— 用户明确否过这个顺序「你这顺序不对吧」");
    (/\{optimisticInput && !optimisticConfirmed && <>[\s\S]{0,700}?turn-head-avatar/.test(appNC))
      ? ok("【32】乐观阶段也渲染回合头（引擎回声前就有头像 + 名字）")
      : fail("【32】乐观阶段没有回合头 —— 头像名字要等引擎回声（正是用户报的「没第一时间出来」）");
    // 「你」（用户）的头部（09-17 用户「人也要有名字和头像，位置跟 Codex 一样」）
    (/className="user-head"/.test(appC3) && /<UserAvatar size=\{22\} \/>/.test(appC3))
      ? ok("【32】用户消息也有「名字 + 头像」头（.user-head）")
      : fail("【32】用户消息缺名字 + 头像 —— 用户要求「人也要有名字和头像」");
    (/setUserIdentity\(\{[\s\S]{0,260}?\}, \[username, userAvatar\]\)/.test(appC3))
      ? ok("【32】用户身份灌进外部 store（消息头取得到，不必逐层传 props）")
      : fail("【32】用户身份没灌进 store —— 用户消息头拿不到名字/头像");
    (/\.user-head\s*\{/.test(cssNC) && /\.user-head-name\s*\{/.test(cssNC) && /\.user-avatar\s*\{/.test(cssNC))
      ? ok("【32】.user-head / 名字 / 头像三条样式都在")
      : fail("【32】.user-head 样式缺 —— 名字头像行会没对齐");
    // 头像健壮性（09-17 用户报「Codex 头像又不见了」）：这个症状**在 DOM 上看不出来** ——
    // <img> 加载失败时尺寸/可见性/透明度全正常，就是没有像素。三种来源都要兜住：
    // 坏 base64 / 上传太大写不进 localStorage / 用户传了坏图。判据 = 必须有 onError 回退。
    const codexAv = readFileSync(join(ROOT, "src", "components", "CodexAvatar.tsx"), "utf8");
    const userAvC = readFileSync(join(ROOT, "src", "components", "UserAvatar.tsx"), "utf8");
    const userCenterC = readFileSync(join(ROOT, "src", "components", "UserCenter.tsx"), "utf8");
    (/onError=\{\(\) => setBroken\(true\)\}/.test(codexAv) && /DefaultCodexAvatar size=\{size\}/.test(codexAv))
      ? ok("【32】Codex 头像加载失败回退默认头像（不留空白）")
      : fail("【32】Codex 头像没有 onError 回退 —— 坏图渲染成一片空白，用户只会说「头像不见了」");
    (/onError=\{\(\) => setBroken\(true\)\}/.test(userAvC))
      ? ok("【32】用户头像加载失败回退名字首字")
      : fail("【32】用户头像没有 onError 回退 —— 坏图渲染成一片空白");
    ((userCenterC.match(/fileToAvatarDataUrl\(file\)/g) || []).length === 2)
      ? ok("【32】两处头像上传都走 128×128 压缩（防写不进 localStorage → 重启丢头像）")
      : fail("【32】头像上传没走压缩 —— 大图 base64 静默写不进 localStorage，重启后头像丢失");
    // 默认头像的**第二种**「凭空消失」（09-17 用户二次反馈「运行完成，头像又不见了，运行的时候还有」）：
    // 底色原先用 SVG `<linearGradient id="codex-avatar-bg">` + `url(#codex-avatar-bg)` ——
    // SVG 引用是**文档级**的：同页每个头像实例都带一份同 id defs（回合头 + 乐观头 + 各历史回合的头），
    // 引用只解析到文档里**第一个**；它一旦落在 `content-visibility: auto` 被跳过的子树里
    // （.turn-group / .turn-card 都带这条：视口外回合跳过布局与绘制）或已被卸载，就解析不到
    // paint server → **整块渲染成空白**；而尺寸 / display / visibility / opacity 全都正常，
    // 从 DOM 上根本查不出来（上一轮就是这么误判成"一切正常"的）。
    // 改成 CSS 渐变后每个实例自给自足。⛔ 同样先剥注释再判（注释里就写着 `url(#id)`）。
    const defAv = readFileSync(join(ROOT, "src", "components", "DefaultCodexAvatar.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    (!/linearGradient|radialGradient|url\(#/.test(defAv))
      ? ok("【32】默认头像不带 SVG url(#id) 引用（多实例撞 id 时会整块渲染成空白）")
      : fail("【32】默认头像又用回 SVG 渐变引用了 —— 同页多实例撞 id 时头像会凭空消失");
    (/\.codex-avatar-default\s*\{[\s\S]{0,320}?linear-gradient/.test(cssNC))
      ? ok("【32】.codex-avatar-default 用 CSS 渐变作底色（实例各自独立，引用失效不影响）")
      : fail("【32】.codex-avatar-default 缺 CSS 渐变 —— 默认头像会渲染成一块空白");
    (!/id="codex-avatar/.test(codexAv + defAv + userAvC))
      ? ok("【32】头像组件里没有 id=\"codex-avatar…\"（不存在跨实例引用）")
      : fail("【32】头像组件里出现 id —— 多实例会撞 id，引用可能解析失败（渲染成空白）");
    // 思考强度：底栏按钮 +「宽彩色动态条」弹窗（09-17 用户两次要求：先「改成彩色横向拖动进度条，
    // 每个等级颜色都不一样」，再「弹窗拖动，不是输入框直接一个长条，gpt 那种宽的彩色动态条」）
    const effortPickerC = readFileSync(join(ROOT, "src", "components", "EffortPicker.tsx"), "utf8");
    (/<EffortPicker\b/.test(appC3))
      ? ok("【32】思考强度用「底栏按钮 + 弹窗宽条」渲染")
      : fail("【32】composer 底栏没有 EffortPicker —— 思考强度没做成弹窗拖动条");
    (!/<ComposerMenu icon=\{Zap\} label="思考"/.test(appC3))
      ? ok("【32】旧的「思考」下拉已移除（不会并存两份）")
      : fail("【32】旧的「思考」下拉又回来了 —— 会与拖动条并存两份");
    (!/EffortSlider/.test(appC3) && !existsSync(join(ROOT, "src", "components", "EffortSlider.tsx")))
      ? ok("【32】上一版的底栏细长条已彻底移除（不留死组件）")
      : fail("【32】EffortSlider 还在（组件或引用）—— 用户明确否掉了「输入框直接一个长条」");
    // ⛔ 用户要的是「每个等级颜色都不一样」：色值必须两两不同，不能有重复
    const effortColors = [...effortPickerC.matchAll(/\w+:\s*"(#[0-9a-fA-F]{6})"/g)].map((m) => m[1].toLowerCase());
    (effortColors.length >= 5 && new Set(effortColors).size === effortColors.length)
      ? ok(`【32】每档颜色互不相同（${effortColors.length} 档 / ${new Set(effortColors).size} 种色）`)
      : fail(`【32】档位颜色有重复或不足（${effortColors.length} 档 / ${new Set(effortColors).size} 种色）—— 用户要「每个等级颜色都不一样」`);
    // 拖动中绝不落库：changeEffort 会 upsertProviderModel（IPC + 重写 catalog），
    // 挂在 onChange 上会在拖动经过中间档位时反复触发、还会把选中的档位覆盖回去。
    (/onPointerUp=\{\(\) => commit\(\)\}/.test(effortPickerC) && /onChange=\{\(event\) => setDraft\(Number\(event\.target\.value\)\)\}/.test(effortPickerC))
      ? ok("【32】拖动中只跟手、释放才提交（onChange 不落库）")
      : fail("【32】EffortPicker 的 onChange 直接提交了 —— 拖动经过中间档位会反复 upsert 落库");
    // 弹窗必须 portal + fixed：底栏在滚动容器里，absolute 浮层会被裁掉上半截（设置页气泡踩过同款）
    const popBlock = cssNC.slice(cssNC.indexOf(".effort-picker-pop {"), cssNC.indexOf("@keyframes effort-pop-in"));
    (/createPortal\(/.test(effortPickerC) && /position:\s*fixed/.test(popBlock))
      ? ok("【32】思考强度弹窗用 portal + fixed（不会被底栏容器裁掉）")
      : fail("【32】思考强度弹窗不是 portal + fixed —— 底栏滚动容器会把上半截裁掉");
    // 「动态条」要真的在动：扫光 + 光晕跟随
    (/@keyframes effort-sheen/.test(cssNC) && /animation:\s*effort-sheen/.test(cssNC) && /\.effort-picker-glow\s*\{/.test(cssNC))
      ? ok("【32】宽条有流光扫过 + 光晕跟随（用户要的「动态」）")
      : fail("【32】宽条没有流光/光晕 —— 只是静态条，用户要「动态」的");
    // ⛔ 色带不许放大：background-size > 100% 会让看到的部分与档位位置错位、分段被抹成渐变
    //    （第一版用 220% + 平移做流光，实测就是这个症状 —— 反而看不清「每档一色」）
    const bandBlock = cssNC.slice(cssNC.indexOf(".effort-picker-bands {"), cssNC.indexOf(".effort-picker-glow {"));
    (/background-size:\s*100%\s+100%/.test(bandBlock) && !/background-size:\s*(?:1[1-9]\d|2\d\d)%/.test(bandBlock))
      ? ok("【32】分段色带保持 100%（颜色与档位位置不错位）")
      : fail("【32】色带被放大了 —— 各档颜色与位置会错位、看起来变渐变（实测踩过）");
    (/\.effort-trigger\s*\{/.test(cssNC) && /\.effort-picker-bands\s*\{/.test(cssNC) && /\.effort-picker-range/.test(cssNC))
      ? ok("【32】样式齐（触发按钮 / 分段色带 / 拖动条 / 档位标签）")
      : fail("【32】拖动条样式缺 —— 色带或滑块不会显示");
    // 09-18 新形态（用户：「把模型配置里面思考选择删了，每个独立会话选择那个就生效那个」）：
    //   档位**不再是模型条目的属性** —— 模型配置里没有勾选区，菜单恒为全集，
    //   选哪个只落**当前会话**；模型/网关真不支持某档 → 发送失败自动学会 + 降档重发。
    //   三种回潮形态：① 模型配置里又长出档位勾选；② 菜单又按模型声明过滤（用户选不到想选的档）；
    //   ③ 选档又写全局默认（A 会话的选择污染 B 会话）。
    const modelEditorC = appNC.slice(appNC.indexOf("const openModelEditor"), appNC.indexOf("const targetProviderHint"));
    // ⛔ 判据要**精确**：只看模型编辑器弹窗 JSX 那一小段（从 .model-editor-modal 到它的 footer），
    //   并且**块注释与行注释都要剥** —— 全局搜「efforts」会命中别处的档案字段，而注释里
    //   提一句「思考档位」也会被判成回潮（09-18 连踩两次：先假红于行注释，再假红于全局搜）。
    const appCode = appNC.replace(/^\s*\/\/.*$/gm, "");
    const editorStart = appCode.indexOf("model-editor-modal");
    const editorJsx = editorStart < 0 ? "" : appCode.slice(editorStart, appCode.indexOf("</footer>", editorStart));
    (editorJsx.length > 0 ? ok : fail)("模型编辑器弹窗 JSX 可定位（守卫判据有效）");
    (!/思考档位/.test(editorJsx) && !/modelEditor\.draft\.efforts/.test(editorJsx))
      ? ok("【32】模型编辑器里没有档位勾选区（档位不是模型属性）")
      : fail("【32】模型配置里又出现档位勾选 —— 用户明确要求删掉（档位应纯会话级）");
    (!/勾选思考档位/.test(appNC))
      ? ok("【32】没有指向已删除勾选区的过时文案（模型下拉的「更多设置…」）")
      : fail("【32】有文案还让用户去模型配置「勾选思考档位」—— 入口已经不存在了");
    (/levels=\{\[\.\.\.ALL_EFFORTS\]\}/.test(appNC))
      ? ok("【32】思考菜单档位恒为全集（不再按模型声明过滤）")
      : fail("【32】菜单档位又按模型声明过滤了 —— 用户会选不到想选的档（09-18 已删除声明机制）");
    const applyBody = appNC.slice(appNC.indexOf("function applyEffort"), appNC.indexOf("function changeEffort"));
    (/if \(threadRef\.current\?\.id\) saveThreadEffort\(threadRef\.current\.id, value\)/.test(applyBody)
      && /else localStorage\.setItem\("default-effort", value\)/.test(applyBody)
      && /void updateThreadSettings\(\{ effort: value \}\)/.test(applyBody))
      ? ok("【32】选档位只落**当前会话**（有会话写 thread-runtime，无会话才写全局默认）")
      : fail("【32】选档位的作用域被改了 —— 会跨会话互相污染（09-13 修过的老坑）");
    (/if \(isUnsupportedEffortError\(error\?\.message\) && effort\)/.test(appNC)
      && /markEffortUnsupported\(/.test(appNC)
      && /executeEffortFallbackRetry\(\)/.test(appNC))
      ? ok("【32】档位不被支持时自动降档重发（删掉手动声明后的兜底）")
      : fail("【32】没有「档位不支持 → 自动降档重发」的兜底 —— 用户选到不支持的档位只能干瞪眼");
    (/modelId=\{currentModelId\}/.test(appNC)
      && /blockedEffortsOf\(modelId\)/.test(effortPickerC)
      && /effort-tick\$\{on \? " on" : ""\}\$\{blockedSet\.has\(level\) \? " blocked" : ""\}/.test(effortPickerC)
      && /\.effort-tick\.blocked\s*\{/.test(cssNC))
      ? ok("【32】菜单把「该模型不支持」的档位标灰，且**每次打开弹窗重读**（刚降档的立刻可见）")
      : fail("【32】已知不支持的档位没有标记或不是打开时读 —— 用户会反复踩同一档");
    (!/\.(?:codex-turn|process-content) \.assistant-message \.avatar[\s\S]{0,140}?display:\s*none/.test(cssNC))
      ? ok("【32】没有规则把 assistant 头像 display:none 掉")
      : fail("【32】有规则把 assistant 头像 display:none 了 —— 用户只会看到名字");
  }

  // ⑰c 首次启动「环境体检」（09-17 用户：「新用户不知道该装什么，不装 Codex 啥也干不了」）。
  //   最容易复发的四种失效形态（全部有可证伪的静态判据）：
  //   ① 体检项被悄悄改少（用户拍板的是「必备 4 + 常用 3」共 7 项）
  //   ② 弹窗没挂进渲染树 → 缺工具的新用户永远等不到提示（功能等于没做）
  //   ③「一键安装」没接 installRuntime → 按钮是摆设
  //   ④ installableIds 把 model/workspace 也当成可安装项 → 调 installRuntime("model") 必失败
  {
    const envC = readFileSync(join(ROOT, "src", "components", "EnvCheckDialog.tsx"), "utf8");
    const appEnv = readFileSync(join(ROOT, "src", "App.tsx"), "utf8");
    const specCount = (envC.match(/\{ id: "(?:model|workspace|git|rg|python|jq|sevenzip)"/g) || []).length;
    (specCount === 7)
      ? ok("【32】环境体检 7 项齐全（模型/工作区/Git/ripgrep + Python/jq/7-Zip）")
      : fail(`【32】体检项变成 ${specCount} 项 —— 用户拍板的是「必备 4 + 常用 3」`);
    const coreCount = (envC.match(/core: true/g) || []).length;
    (coreCount === 4)
      ? ok("【32】必备项 4 项（缺了干不了活的那批）")
      : fail(`【32】必备项变成 ${coreCount} 项 —— 弹窗触发条件会跟着偏`);
    (/<EnvCheckDialog/.test(appEnv))
      ? ok("【32】体检弹窗挂在渲染树里（缺工具时真的会弹）")
      : fail("【32】体检弹窗没挂进渲染树 —— 缺工具的新用户永远等不到提示");
    (/await window\.codex\.installRuntime\(id\)/.test(appEnv))
      ? ok("【32】「一键安装」真的调了 installRuntime")
      : fail("【32】一键安装没接 installRuntime —— 按钮是摆设");
    (/const MANUAL_IDS = new Set\(\["model", "workspace"\]\)/.test(envC))
      ? ok("【32】installableIds 排除了 model/workspace（它们不是可安装的运行时）")
      : fail("【32】installableIds 没排除 model/workspace —— 一键安装会拿它们调 installRuntime 并失败");
    (/ENV_CHECK_OPTOUT_KEY/.test(envC) && /localStorage\.getItem\(ENV_CHECK_OPTOUT_KEY\)/.test(appEnv))
      ? ok("【32】「不再提示」真的被读（勾了就不再弹）")
      : fail("【32】optout 标记没被读 —— 用户勾了「不再提示」还会每次被弹");
  }

  // ⑰d 引导弹窗的「出场时机」（09-17 用户明确定规则：「只在进入主界面的时候才弹配置引导和
  //   工具安装检测自动安装；如果已经配置模型，就不引导模型配置，直接做开发工具检测安装」）。
  //   三种失效形态都**静默**（不报错，只是该弹的不弹 / 不该弹的弹了）：
  //   ① 登录页期间弹 → 打断登录（那是用户看到的第一屏）
  //   ② 已配模型还引导 → 每次启动都被"教"一遍怎么配模型
  //   ③ 体检被模型引导永久挡住 → 没配模型的用户关掉引导后永远看不到体检（直到重启）
  {
    const appEnv = readFileSync(join(ROOT, "src", "App.tsx"), "utf8");
    // 按注释锚点切出两个 effect 的块：在全文里裸正则容易误命中别处的同名字符串
    const guideStart = appEnv.indexOf("模型配置引导（09-17 用户要求）");
    const envStart = appEnv.indexOf("体检项（必备：模型");
    const envEnd = appEnv.indexOf("设置弹窗「骨架先行」");
    const guideBlock = guideStart >= 0 && envStart > guideStart ? appEnv.slice(guideStart, envStart) : "";
    const envBlock = envStart >= 0 && envEnd > envStart ? appEnv.slice(envStart, envEnd) : "";
    (guideBlock && /if \(showLogin\) return;/.test(guideBlock))
      ? ok("【32】模型引导在登录页不弹（只在主界面弹）")
      : fail("【32】模型引导没有登录页判断 —— 登录时会被引导打断");
    (/if \(!customModel\) setShowModelGuide\(true\)/.test(guideBlock))
      ? ok("【32】已配模型时不弹模型引导（直接走工具检测）")
      : fail("【32】模型引导的判据变了 —— 已配好模型的用户会被再引导一遍");
    (envBlock && /\[threadsLoading, showLogin, showModelGuide, customModel, workspace\]/.test(envBlock))
      ? ok("【32】体检依赖含 showModelGuide —— 模型引导关掉后体检会补上")
      : fail("【32】体检 effect 依赖里没有 showModelGuide —— 没配模型时关掉引导后体检永远不弹");
    (/setEnvCheckOpen\(false\);[\s\S]{0,60}?setShowModelGuide\(false\);[\s\S]{0,60}?setShowLogin\(true\);/.test(appEnv))
      ? ok("【32】登出时两个引导弹窗一起收起（重登不重现）")
      : fail("【32】登出没收起引导弹窗 —— 重新登录后旧弹窗会突然冒出来");
  }

  // ⑱ src/lib/*.mjs 是**纯 JS**（node 直接 import 执行），不得出现 TS 语法。
  //    ⛔ 这条守卫的由来：`export type X = …` / `(a: string): void` 这类标注会让 rolldown 直接
  //    PARSE_ERROR 构建失败，而我在 09-17 的 enhance-hints.mjs 与 codex-identity.mjs 上**各踩一次**
  //    （第二次是因为第一次的教训只写进了记忆、没变成守卫）。类型一律放同目录 .d.mts。
  {
    const libDir = join(ROOT, "src", "lib");
    const mjsFiles = readdirSync(libDir).filter((f) => f.endsWith(".mjs"));
    const offenders = [];
    for (const file of mjsFiles) {
      const code = readFileSync(join(libDir, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const hits = [];
      if (/export\s+type\s/.test(code)) hits.push("export type");
      // 参数/变量类型标注。⛔ 前缀要覆盖 const/let/var —— 只写 `^|,|(` 会漏掉 `const y: number`
      // （反证时发现的漏检）。
      if (/(?:^|[,(]\s*|\b(?:const|let|var)\s+)\w+\s*:\s*(?:string|number|boolean|void|unknown|any)\b/m.test(code)) hits.push("类型标注");
      if (/\)\s*:\s*(?:string|number|boolean|void|unknown|any|\w+\[\])\s*\{/.test(code)) hits.push("返回类型标注");
      if (/\bas\s+\{/.test(code)) hits.push("as 断言");
      // 泛型也是 TS 专有：new Set<() => void>() 会被 JS 当成比较运算
      // ⛔ 不能写 `[^>]*` —— 箭头函数的 `=>` 里就有 `>`，正则会提前截断（反证时发现的漏检）。
      if (/new\s+\w+\s*</.test(code)) hits.push("泛型语法");
      if (hits.length) offenders.push(`${file}(${hits.join("/")})`);
    }
    (offenders.length === 0)
      ? ok(`【32】src/lib 下 ${mjsFiles.length} 个 .mjs 均为纯 JS（无 TS 语法，类型在 .d.mts）`)
      : fail(`【32】这些 .mjs 含 TS 语法会直接构建失败：${offenders.join("、")} —— 类型请移到同目录 .d.mts`);
  }
}

console.log("");
if (hardFails === 0) {
  console.log(C.green(`预检通过${warns ? `（${warns} 条告警，见上）` : ""}`));
} else {
  console.log(C.red(`预检失败：${hardFails} 项硬失败${warns ? `，${warns} 条告警` : ""}`));
}
console.log(C.gray("下一步：npm run accept（拉起应用，在带历史的持久 profile 上跑本轮验收）"));
process.exit(hardFails === 0 ? 0 : 1);
