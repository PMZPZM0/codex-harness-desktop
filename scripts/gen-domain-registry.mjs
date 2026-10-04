/**
 * 组合表生成器（P1，2026-10-03）：`electron/composition.json` → `electron/composition.gen.ts`。
 *
 *   node scripts/gen-domain-registry.mjs            # 生成（过期则覆盖）
 *   node scripts/gen-domain-registry.mjs --check    # 只校验，不写（CI/预检可用）
 *
 * ⛔ 生成物禁手改（守卫【253】逐字节比对 `renderRegistry()` 的产物）。
 * ⛔ `renderRegistry()` 是**纯函数**：预检直接 import 它比对磁盘内容，不开子进程
 *    （AGENTS.md 有记：agent 沙箱里嵌套 spawn 会被拒，守卫必须零 spawn）。
 *
 * 为什么是"生成静态表"而不是运行时读 JSON：本项目 harness 打的是离线的 Electron 包，
 * 静态 import 才能让打包期可达闭包**看见**每个被启用的域并打进包；
 * 运行时读 JSON 会造出"配置启用了、包里却没有"的静默失效（P5 再引入运行时装载）。
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const COMPOSITION = join(ROOT, "electron", "composition.json");
const PROFILES_DIR = join(ROOT, "electron", "profiles");
const OUT = join(ROOT, "electron", "composition.gen.ts");

/**
 * 合成 profile（10-04 阶段 4，参照 dsh 的 profile → bundle → patch 三层）。
 *
 * ⛔ **纯函数**（不得读文件、不得 spawn）：守卫【253】直接 import 本模块做逐字节比对，
 *    沙箱里嵌套 spawn 会被拒。
 *
 * 语义：`default` = composition.json 原样；其余 profile = default **减去** disable 列表
 *（子集语义，不独立维护完整清单 —— 两份清单漂移时"少了域"与"配置写错"两种故障长得一样）。
 * `patch` 保留给将来需要「加域 / 改 config」的场景，当前未启用（没有使用方就写 = 死代码）。
 */
export function resolveProfile(composition, profileId) {
  const base = (composition.domains || []).filter((d) => d && d.enabled);
  if (!profileId || profileId === "default") {
    return { profile: "default", domains: base, disabled: [] };
  }
  const profilePath = join(PROFILES_DIR, `${profileId}.json`);
  let profile;
  try {
    profile = JSON.parse(readFileSync(profilePath, "utf8"));
  } catch {
    throw new Error(`[gen] profile 不存在或不是合法 JSON：electron/profiles/${profileId}.json`);
  }
  if (profile.$extends && profile.$extends !== "default") {
    throw new Error(`[gen] 目前只支持 $extends: "default"（${profileId} 声明了 ${profile.$extends}）`);
  }
  const known = new Set(base.map((d) => d.id));
  // ⛔ 不在 default 表里的 id **直接报错**不静默忽略：打错一个 id 会让 profile
  //    看起来生效了、实际没少任何东西 —— 那种静默失效最难查。
  const unknown = (profile.disable || []).filter((id) => !known.has(id));
  if (unknown.length) {
    throw new Error(`[gen] profile ${profileId} 的 disable 里有 default 表不存在的域：${unknown.join(" / ")}`);
  }
  const disabled = new Set(profile.disable || []);
  return { profile: profileId, domains: base.filter((d) => !disabled.has(d.id)), disabled: [...disabled] };
}

/** 列出可用 profile id（default + electron/profiles/*.json）。 */
export function listProfiles() {
  let files = [];
  try { files = readdirSync(PROFILES_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")); } catch { /* 目录不存在 */ }
  return ["default", ...files.sort()];
}

/** 从命令行 / 环境变量取 profile id（默认 default，保持既有行为不变）。 */
export function pickProfileId(argv = [], env = {}) {
  const flag = argv.find((a) => a.startsWith("--profile="));
  return flag ? flag.slice("--profile=".length) : (env.CODEX_HARNESS_PROFILE || "default");
}

/** 生成物的固定抬头（守卫同时锚这三行，改格式必须同轮改断言）。 */
export const HEADER = `/* ⛔ 本文件由 scripts/gen-domain-registry.mjs 生成，禁手改。
   改"启用哪些域"请改 electron/composition.json，然后跑：npm run gen:domains
   守卫【253】逐字节比对生成物与 renderRegistry() 的产物 —— 手改过、或改了配置没重跑，都会红。 */
`;

/** 纯函数：把组合配置渲染成生成物全文（守卫直接 import 这个函数做逐字节比对）。 */
export function renderRegistry(composition) {
  const rows = (composition.domains || []).filter((d) => d && d.enabled);
  const imports = rows.map((d) => {
    const varName = `feat_${String(d.id).replace(/-/g, "_")}`;
    const fileNoExt = String(d.file).replace(/\.tsx?$/, "");
    return `import { ${d.export} as ${varName} } from "./${fileNoExt}";`;
  });
  const entries = rows.map((d) => {
    const varName = `feat_${String(d.id).replace(/-/g, "_")}`;
    return `  { id: ${JSON.stringify(d.id)}, plugin: ${varName} as Plugin<unknown>, config: ${JSON.stringify(d.config ?? null)} },`;
  });
  return `${HEADER}// ⛔ 下面两行是**接缝的 provide**，必须排在所有域 import 之前（域的 inject 依赖它们）：
//   "ipc"  —— 注册通道（electron/ipc-host.ts）；"host" —— app/secure/shell/dialog/window 五条宿主能力接缝。
//   顺序即契约：把接缝 import 挪到域 import 之后 ⇒ 域 setup 里 ctx.get("host") 得 undefined。
import "./ipc-host";
import "./runtime/seams";
import type { Plugin } from "./context";
import { mountFeature } from "./context";
${imports.join("\n")}

export type EnabledDomain = { id: string; plugin: Plugin<unknown>; config: unknown };

/** 已启用的域（顺序 = composition.json 里的顺序 = 挂载顺序）。
 *  ⛔⛔ 依赖方向恒为 **本生成物 → 域**：域**绝不 import 本文件** —— 反向就是环，
 *     CJS 下 domain 还没求值完 ⇒ plugin 为 undefined ⇒ 启动即崩（10-03 实测事故）。
 *     挂载在**模块作用域**执行 = 与原 import "./features/xxx" 同时机，不改变启动顺序。
 *  ⛔⛔ 本函数体是**模板字符串**：里面**绝不能出现反引号**（会把模板提前闭合 ⇒ 生成器语法错误）。 */
export const ENABLED: EnabledDomain[] = [
${entries.join("\n")}
];

for (const row of ENABLED) mountFeature(row.plugin, row.config);
`;
}

/** 校验（配置错要在生成期就炸，别等运行时）：id kebab、file 存在、export 真的导出、id 不重复。 */
export function validate(composition, root = ROOT) {
  const problems = [];
  const seen = new Set();
  for (const d of composition.domains || []) {
    if (!d || typeof d.id !== "string" || !/^[a-zA-Z][\w-]*$/.test(d.id)) {
      // ⛔ 字符集必须跟着 ipc-registry.ts 的真实前缀走：那里有驼峰前缀（如 `dataDir`），
      //    只允许 kebab 会把合法域挡在门外（10-03 实测）。
      problems.push(`id 不是合法域前缀（字母开头，字母/数字/_/-）：${JSON.stringify(d && d.id)}`);
      continue;
    }
    if (seen.has(d.id)) problems.push(`id 重复：${d.id}`);
    seen.add(d.id);
    const abs = join(root, "electron", String(d.file || ""));
    let ok = false;
    try { ok = statSync(abs).isFile(); } catch { ok = false; }
    if (!ok) { problems.push(`${d.id}: 文件不存在 electron/${d.file}`); continue; }
    const src = readFileSync(abs, "utf8");
    if (!new RegExp(`export\\s+(const|function)\\s+${d.export}\\b`).test(src)) {
      problems.push(`${d.id}: electron/${d.file} 里没有导出 ${d.export}`);
    }
    if (!src.includes("defineFeature(") && !src.includes("defineFeature<")) {
      problems.push(`${d.id}: electron/${d.file} 不是插件形态（未见 defineFeature）`);
    }
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("gen-domain-registry.mjs")) {
  const composition = JSON.parse(readFileSync(COMPOSITION, "utf8"));
  const profileId = pickProfileId(process.argv, process.env);
  // ⛔ 合成失败（profile 不存在 / disable 含未知域）必须**在这里炸**，不生成半成品
  let resolved;
  try {
    resolved = resolveProfile(composition, profileId);
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(2);
  }
  const effective = { domains: resolved.domains };
  const problems = validate(effective);
  if (problems.length) {
    console.error("组合配置有问题，未生成：\n  - " + problems.join("\n  - "));
    process.exit(2);
  }
  // dump-config：打印**实际会挂载什么**（含顺序）—— 对标 dsh 的 --dump-config，
  // 用来回答"我以为启用了 X，为什么没有？"而不必去翻生成物。
  if (process.argv.includes("--dump-config")) {
    const out = {
      profile: resolved.profile,
      availableProfiles: listProfiles(),
      mounted: resolved.domains.length,
      disabled: resolved.disabled,
      domains: resolved.domains.map((d, i) => ({ order: i + 1, id: d.id, file: d.file, export: d.export })),
    };
    console.log(JSON.stringify(out, null, 2));
    process.exit(0);
  }
  const next = renderRegistry(effective);
  const checkOnly = process.argv.includes("--check");
  let current = "";
  try { current = readFileSync(OUT, "utf8"); } catch { /* 首次生成 */ }
  const tag = resolved.profile === "default" ? "" : `（profile=${resolved.profile}）`;
  if (current === next) { console.log(`composition.gen.ts 已是最新（${resolved.domains.length} 个启用域${tag}）`); process.exit(0); }
  if (checkOnly) { console.error(`composition.gen.ts 过期：请跑 npm run gen:domains${profileId === "default" ? "" : " -- --profile=" + profileId}`); process.exit(1); }
  writeFileSync(OUT, next, "utf8");
  console.log(`已生成 electron/composition.gen.ts（${resolved.domains.length} 个启用域${tag}）`);
}
