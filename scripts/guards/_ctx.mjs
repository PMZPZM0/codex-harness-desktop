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

import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, rmSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

// ⛔ 架构改造期（09-21）：UI 代码正按域从 src/App.tsx 搬进 src/features/**，
//    两边共用的符号则下沉到 src/lib/*.ts。
//    「按文件内容写」的断言若只读 App.tsx，会在每次搬家时假红（不是功能退化，是代码搬走了）。
//    统一口径：readAppUi() = App.tsx + src/features/** + src/lib/*.ts 的并集。
//    判据语义不变 —— 盯的是「这段内容存在于应用代码里」，不关心落在哪个文件。
//    ⚠️ 负面断言（!/…/）因此变得更严格（范围为超集），是安全方向。
//    ⚠️ 只并 .ts 不并 .mjs：.mjs 是既有纯函数模块，另有专门的动态 import 断言覆盖。
const readAppUi = () => {
  const base = readFileSync(join(ROOT, "src", "App.tsx"), "utf8");
  const parts = [base];
  const fdir = join(ROOT, "src", "features");
  if (existsSync(fdir)) {
    /* ⛔ 必须**递归**：09-21 把巨型 hook 按序切成 features/app-state/parts/partNN.tsx，
       那是 features/<域>/<文件> 的**下一层**；只扫一层会让 200+ 项"按内容写"的断言集体假红
       （A/B 实测：切分后 210 项失败 vs 回滚后 1 项，而代码本身 0 类型错、hook 顺序逐位一致）。
       判据语义不变，只是把深层文件也算进"应用代码"这个超集。 */
    const walkFeat = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return walkFeat(p);
      if (!/\.(tsx|ts)$/.test(e.name) || /\.d\.mts$/.test(e.name)) return [];
      let t = readFileSync(p, "utf8");
      /* ⛔⛔ 切分产物里，**跨段引用**被加了 `bag.` 前缀（bag 是切分引入的共享上下文对象；
         选这个名字正因为它不与原代码任何局部变量冲突）。
         而大量断言按**原样字面量**找调用（如 `void syncThreadRuntimeWithMain(id)`），
         带前缀必然失配；另有断言用 `slice(indexOf(名字), +2200)` 这类**固定字符窗口**，
         代码变长也会截断。在**聚合视图**里剥掉前缀 ⇒ 文本回到"像原文件"的形态，
         两类假红一并消除（只影响预检的阅读口径，不动真实代码）。 */
      if (/[\\/]app-state[\\/]parts[\\/]/.test(p)) {
        /* ① 先剥 `bag.X!` → `X`：fix-notnull.cjs 给 12 处原依赖**局部变量窄化**的位置
              补了非空断言（属性访问不窄化），而断言是按原样找 `threadId: thread.id` 的。
           ② 再剥 `bag.` 前缀本身。 */
        t = t.replace(/\bbag\.([A-Za-z_$][\w$]*)!/g, "$1").replace(/\bbag\./g, "");
      }
      return [t];
    });
    parts.push(walkFeat(fdir).join("\n"));
  }
  // ⛔ 不要并 src/components/**：那 34+ 个是既有通用组件，从来不在 App.tsx 里，
  //    并进来会让「计数类」断言（如【73】notice 槽位数）无端变红。
  //    改造期新产生的共享组件/钩子统一落 src/features/shared/，天然被上面的 features/** 覆盖。
  for (const sub of ["lib", "hooks"]) {
    const dir = join(ROOT, "src", sub);
    if (!existsSync(dir)) continue;
    parts.push(readdirSync(dir)
      .filter((f) => /\.tsx?$/.test(f) && !/\.d\.mts$/.test(f))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n"));
  }
  return parts.join("\n");
};
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolveModelForOpen, shouldSyncOpenThread } from "../../src/lib/model-scope.mjs";
// 并发闸门判据（纯函数：预检直接跑真实现，覆盖"想当然会写错"的边界）
import { concurrencyExceeded, DEFAULT_MAX_CONCURRENCY, normalizeMaxConcurrency } from "../../src/lib/concurrency.mjs";
import { ALIGN_RESULT, CONTINUITY_TEXT, shouldAlignProvider } from "../../src/lib/provider-continuity.mjs";
import { SESSION_SCOPE_HEADING, composeScopeInstructions, sessionScopeBlock, sessionScopeSignature, stripScopeBlock } from "../../src/lib/session-scope.mjs";
import { MOOD_HEADING, applyMoodSignal, composeMoodInstructions, decayMood, emptyMood, moodBlock, moodSignature, moodTone, normalizeMood, stripMoodBlock } from "../../src/lib/agent-mood.mjs";
import { OWN_WRITE_TTL_MS, emptyRuntime, isOwnEcho, legacyMirror, migrateRuntime, normalizeRuntime, patchRuntime, rememberOwnWrite, runtimeSignature } from "../../src/lib/thread-runtime.mjs";
import { planCompletedFold } from "../../src/lib/turn-fold-plan.mjs";
import { createAec, createEchoGate, createSentenceChunker, resampleLinear, rmsOf } from "../../src/lib/voice-aec.mjs";
import { TRUNCATE_REASONING_MIN_CHARS, TRUNCATE_OUTPUT_MAX_CHARS, AUTO_CONTINUE_MAX_ATTEMPTS, AUTO_CONTINUE_WINDOW_MS, isTruncatedEmptyTurn, truncationNotice, turnOutputStats } from "../../src/lib/turn-truncation.mjs";
import { createSpeakFilter, normalizeNumbers, numberToChinese, toSpeakableText } from "../../src/lib/speak-text.mjs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

let hardFails = 0;
/** 失败消息（含环境类），供 finish() 自检区分「环境异常导致不执行」与「断言静默消失」 */
const failMessages = [];
let warns = 0;
let checks = 0;

// ⛔ 崩溃必须显式报红（09-18 实测的假绿来源）：预检是"跑到哪算哪"的平坦脚本，中途一处
//    ReferenceError 会让**后面所有断言静默不执行**，而进程只以 exit 1 退出；外部脚本若只
//    过滤「✗ 行」就会得出"只有预期那几条红"的**错误结论**（当天就发生过：我删了一个局部变量
//    的定义却漏改引用，【46】后半与整个【47】从未执行，却被我读成"除产物过期外全绿"）。
//    兜底：① 捕获异常并打一条显式的 ✗；② 末尾打印断言计数，截断一眼可见。
for (const ev of ["uncaughtException", "unhandledRejection"]) {
  process.on(ev, (err) => {
    console.log(`  \x1b[31m✗\x1b[0m 预检自身异常（断言未跑完，后面的检查项全部未执行）：${err && err.message ? err.message : String(err)}`);
    console.log(`\x1b[90m已执行断言数：${checks}\x1b[0m`);
    process.exit(1);
  });
}

function ok(msg) {
  checks++;
  console.log(`  ${C.green("✓")} ${msg}`);
}
function fail(msg) {
  checks++;
  hardFails++;
  failMessages.push(String(msg ?? ""));
  console.log(`  ${C.red("✗")} ${msg}`);
}
function warn(msg) {
  checks++;
  warns++;
  console.log(`  ${C.yellow("!")} ${msg}`);
}

/** 只留"真实代码"：剥掉 `//` 行注释、`/* *\/` 块注释、以及 JSX 的 `{/* … *\/}` 注释块。
 *
 *  ⛔ 为什么必须有它（09-18 同一天踩了三次）：结构守卫常写成「源码里不该再出现某个写法」，
 *  而**注释里解释这个隐患时会原样写出那个字符串**（"原先那条 .attachment-strip 已删除，别再恢复"），
 *  于是守卫报红、我去改本来正确的代码。
 *  反面教材（当天三次）：`startsWith("http") ? … : imageUrl(…)`、`.attachment-strip`、
 *  `getBoundingClientRect().top` —— 全是注释命中造成的假红/假绿。
 *  **任何"不许出现 X"的结构断言，匹配前都要先过这一层。** */
function codeOnly(source) {
  return String(source)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")     // JSX 注释块 {/* … */}
    .replace(/\/\*[\s\S]*?\*\//g, "")          // 块注释 /* … */
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))  // 整行 // 注释
    .map((line) => line.replace(/\s\/\/[^'"`]*$/, ""))  // 行尾 // 注释（不碰字符串里的 //）
    .join("\n");
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

// ============================================================================
// 拆分后从各分节提升上来的共享声明（原文件里它们写在【2】等分节体内，
// 被后面十几节引用 ⇒ 提升到共享上下文；正文逐字未改）
// ============================================================================
function readVoiceSettingsSrc() {
  const base = readFileSync(join(ROOT, "src", "components", "VoiceSettingsSection.tsx"), "utf8");
  const dir = join(ROOT, "src", "components", "VoiceSettingsSection");
  if (!existsSync(dir)) return base;
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = join(d, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(e.name) ? [readFileSync(p, "utf8")] : [];
  });
  return base + "\n" + walk(dir).join("\n");
}
function readVoiceCallFloatSrc() {
  const base = readFileSync(join(ROOT, "src", "components", "VoiceCallFloat.tsx"), "utf8");
  const dir = join(ROOT, "src", "components", "VoiceCallFloat");
  if (!existsSync(dir)) return base;
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = join(d, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(e.name) ? [readFileSync(p, "utf8")] : [];
  });
  return base + "\n" + walk(dir).join("\n");
}
function readMainSource() {
  const base = readFileSync(join(ROOT, "electron", "main.ts"), "utf8");
  const dir = join(ROOT, "electron", "features");
  if (!existsSync(dir)) return base;
  /* ⛔ 必须**递归**：09-22 把若干大域文件（engine-ipc 等）按顶层声明又切进
     electron/features/<域>/NN-*.ts；只扫一层会让 73 项「按内容写」的断言集体假红
     （实测：切分后 73 项 ✗ vs 切分前 0 项，而 build 通过、保真校验逐字符一致）。 */
  const walk = (d) => readdirSync(d, { withFileTypes: true })
    .flatMap((e) => {
      const p = join(d, e.name);
      if (e.isDirectory()) return walk(p);
      return /\.ts$/.test(e.name) ? [readFileSync(p, "utf8")] : [];
    });
  /* ⛔ 09-22 起 main.ts 的若干函数簇也按顶层声明搬进了 electron/main/**（model-catalog / git-bin /
     turn-summary / connector-config）。这一层同样要算进「主进程源码」这个超集，
     否则 5 条「在 main.ts 里按文本定位」的断言会假红（实测：5 ✗，而 build 通过、语句多重集逐字符一致）。 */
  const dir2 = join(ROOT, "electron", "main");
  const extra = existsSync(dir2) ? "\n" + walk(dir2).join("\n") : "";
  /* ⛔ 09-24 补：P2-9 把共享运行时符号下沉到了 electron/runtime-refs.ts —— 它在**顶层**
     electron/*.ts 里，而上面两处聚合面都看不到这一层。漏了它，任何跟着搬过去的符号
     都会让「按文本定位」的断言集体假红（实测：【52】engineActiveTurnIds、【123】
     closeToTrayEnabled 两条当场变红，而代码是对的）。
     ⇒ 「主进程源码」这个超集必须含顶层 electron/*.ts。
     ⛔ 排除 preload.ts / overlay-preload.ts：它们各有独立的 preloadSrc 面，
        混进来会让「必须出现在主进程」类断言从 preload 文本里假绿。
     ⛔ 排除 rollout-worker-source.ts：它是由 rollout-worker.cjs 生成的字符串常量副本，
        正文已由 .cjs 覆盖，重复计入只会掩盖「真源码没改」的情况。 */
  const TOP_SKIP = new Set(["preload.ts", "overlay-preload.ts", "rollout-worker-source.ts"]);
  const topExtra = readdirSync(join(ROOT, "electron"), { withFileTypes: true })
    .filter((e) => e.isFile() && /\.ts$/.test(e.name) && !TOP_SKIP.has(e.name))
    .map((e) => e.name)
    .sort()
    .map((name) => readFileSync(join(ROOT, "electron", name), "utf8"))
    .join("\n");
  return base + "\n" + walk(dir).join("\n") + extra + "\n" + topExtra;
}
function readModuleWithDir(relBase) {
  const base = join(ROOT, relBase + ".ts");
  const parts = [];
  if (existsSync(base)) parts.push(readFileSync(base, "utf8"));
  const dir = join(ROOT, relBase);
  if (existsSync(dir)) {
    const walk = (d) => readdirSync(d, { withFileTypes: true })
      .flatMap((e) => {
        const p = join(d, e.name);
        if (e.isDirectory()) return walk(p);
        return /\.ts$/.test(e.name) ? [readFileSync(p, "utf8")] : [];
      });
    parts.push(...walk(dir));
  }
  return parts.join("\n");
}
const readBuiltinSkillsSource = () => readModuleWithDir("electron/builtin-skills");
const readResponsesBridgeSource = () => readModuleWithDir("electron/responses-bridge");
function readStyles() {
  const base = readFileSync(join(ROOT, "src", "styles.css"), "utf8");
  const dir = join(ROOT, "src", "styles");
  if (!existsSync(dir)) return base;
  const extra = readdirSync(dir).filter((f) => /\.css$/.test(f)).sort().map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
  return base + "\n" + extra;
}
const mainSrc = readMainSource();
/* preload 面 = 自包含单文件 preload.ts（09-23 深夜改内联：invoke 方法在 gen 标记区里，沙箱 preload 不许 require 相对模块）。
 *  两份拼在一起 ⇒ 守卫【2】原有的通道/方法断言不用改就能看到全部方法。 */
const preloadSrc = existsSync(join(ROOT, "electron", "preload.ts"))
  ? readFileSync(join(ROOT, "electron", "preload.ts"), "utf8")
  : "";
const typesPath = join(ROOT, "src", "vite-env.d.ts");
const typesSrc = existsSync(typesPath) ? readFileSync(typesPath, "utf8") : "";

/* 守卫共享面：ESM 活绑定导出（守卫只读，不写这些名字） */
export {
  ALIGN_RESULT, AUTO_CONTINUE_MAX_ATTEMPTS, AUTO_CONTINUE_WINDOW_MS, C, CONTINUITY_TEXT, DEFAULT_MAX_CONCURRENCY, MOOD_HEADING, OWN_WRITE_TTL_MS, ROOT, SESSION_SCOPE_HEADING, SKIP_DIRS, TRUNCATE_OUTPUT_MAX_CHARS, TRUNCATE_REASONING_MIN_CHARS, applyMoodSignal, checks, codeOnly, composeMoodInstructions, composeScopeInstructions, concurrencyExceeded, createAec, createEchoGate, createHash, createRequire, createSentenceChunker, createSpeakFilter, decayMood, dirname, emptyMood, emptyRuntime, existsSync, fail, fileURLToPath, hardFails, homedir, isOwnEcho, isTruncatedEmptyTurn, join, legacyMirror, mainSrc, migrateRuntime, mkdirSync, mkdtempSync, moodBlock, moodSignature, moodTone, normalizeMaxConcurrency, normalizeMood, normalizeNumbers, normalizeRuntime, numberToChinese, ok, patchRuntime, pathToFileURL, planCompletedFold, preloadSrc, readAppUi, readBuiltinSkillsSource, readFileSync, readMainSource, readModuleWithDir, readResponsesBridgeSource, readStyles, readVoiceCallFloatSrc, readVoiceSettingsSrc, readdirSync, relative, rememberOwnWrite, resampleLinear, resolveModelForOpen, rmSync, rmsOf, runtimeSignature, sessionScopeBlock, sessionScopeSignature, shouldAlignProvider, shouldSyncOpenThread, spawnSync, statSync, stripMoodBlock, stripScopeBlock, tmpdir, toSpeakableText, topLevelKeys, truncationNotice, turnOutputStats, typesPath, typesSrc, walk, warn, warns, writeFileSync,
};

/** 汇总与退出码（原文件尾部逐字搬入） */
export function finish() {
// 评估报告 P2（09-24）：守卫自检 —— 曾发生过 `(cond ? ok : fail)("msg")` 写错导致整条断言
// 静默不执行（计数一眼可见但进程照常退出）。现在把计数变成**闸门**。
//
// ⛔ 09-24 收紧：原先的判据是 `checks < 2000`，而实际规模已到 2,215 —— **容忍 215 条（9.7%）
//    断言凭空消失**，上面那类事故正好从这条缝里漏过去。现在改成**贴着实测值的精确区间**：
//    下界 = EXPECTED_CHECKS − TOLERANCE（守卫里有少量条件分节，跨平台会差几条），
//    上界不设（新增守卫不该被拦）。
// ⛔ 同步义务：**改动守卫后必须同步 EXPECTED_CHECKS**（含新增/删除断言）。数字对不上时
//    报错信息会直接把实测值打出来，照抄回填即可 —— 这是刻意的「必须动手同步」设计。
const EXPECTED_CHECKS = 2300;
const TOLERANCE = 5;
// ⛔ 09-24 二次修正：**环境类失败会让整组分节不执行**，此时「断言数变少」是环境的锅、不是断言消失。
//    原先无条件卡精确区间 ⇒ 宿主封锁嵌套 spawn 期间预检永远红，且报错把人引向"守卫损坏"这个
//    错误方向。现在：环境类失败存在时**只告警**并给出待复核提示；环境正常才用精确区间硬卡。
const ENV_FAIL_KEYS = /EBUSY|spawnSync|type-stripping|tomllib|AUTOMATION_ZIP|before-pack|【28】/i;
const envFails = failMessages.filter((m) => ENV_FAIL_KEYS.test(m)).length;
if (envFails > 0) {
  console.log(`\x1b[33m! 守卫自检跳过精确比对：检测到 ${envFails} 条环境类失败（宿主封锁子进程 / 缺 python 等），它们会让同组后续断言不执行 ⇒ 实测 ${checks} 条 < 基准 ${EXPECTED_CHECKS} 属预期。环境恢复后请复核计数是否回到 ${EXPECTED_CHECKS} ± ${TOLERANCE}。\x1b[0m`);
} else if (checks < EXPECTED_CHECKS - TOLERANCE) {
  console.log(`\x1b[31m✗ 守卫自检失败：只执行了 ${checks} 条断言（期望 ≥ ${EXPECTED_CHECKS - TOLERANCE}，实测基准 ${EXPECTED_CHECKS}）—— 有断言凭空消失（守卫文件损坏 / 分节被误删 / 写成 cond ? ok : fail("…") 而静默不打印）。确认无误后同步 _ctx.mjs 的 EXPECTED_CHECKS。\x1b[0m`);
  hardFails++;
}
if (hardFails === 0) {
  console.log(C.green(`预检通过${warns ? `（${warns} 条告警，见上）` : ""}`));
} else {
  console.log(C.red(`预检失败：${hardFails} 项硬失败${warns ? `，${warns} 条告警` : ""}`));


}
console.log(C.gray("下一步：npm run accept（拉起应用，在带历史的持久 profile 上跑本轮验收）"));
process.exit(hardFails === 0 ? 0 : 1);

}
