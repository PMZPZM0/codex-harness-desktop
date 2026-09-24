#!/usr/bin/env node
/**
 * gen-ipc-bridge —— IPC 桥的单一真相源 + 代码生成（09-23 落地 docs/ARCHITECTURE.md §6 第 4 条）。
 *
 * 解决的问题（体检报告「最大瓶颈」）：加一个 IPC 接口要**手写多处**（main handler + preload 方法 +
 * vite-env.d.ts 签名 + ipc-registry 登记），纯靠人肉同步，漏一处只能靠预检【2】事后报红 —— 且渲染层
 * 从不跑 tsc，签名漏了连红都没有（本次提取实测暴露 10 个历史欠账 + 2 个死方法）。
 *
 * 现在的口径：
 *   单一真相源 = `electron/ipc-channels.manifest.json`（一个方法一条：name / channel / 参数 / 返回类型 / 备注）。
 *   生成物     = `electron/preload.ts` 内 `gen:begin…gen:end` 标记之间的 invoke 方法段（**内联，不是独立文件**：
 *              ⛔ 沙箱化 preload 不许 require 相对模块 —— 生成物放独立文件会让 preload 加载失败、
 *              window.codex 整个不存在，见 09-23 voiceSettingsGet 白屏事故）
 *              + `src/vite-env.d.ts` 的 `codex: {` 块内标记之间的签名段。
 *   手写保留   = 非 invoke 成员（事件订阅 on* 等）与 d.ts 里标记之外的签名。生成器**永不触碰**标记之外的内容。
 *
 * 用法：
 *   node scripts/gen-ipc-bridge.mjs extract    # 一次性：从现行 preload/vite-env 抽出 manifest（bootstrap）
 *   node scripts/gen-ipc-bridge.mjs generate   # manifest → 生成物（日常用；改 manifest 后跑）
 *   node scripts/gen-ipc-bridge.mjs check      # 生成物与 manifest 比对，不一致退出 1（预检/CI 用）
 *   node scripts/gen-ipc-bridge.mjs verify     # 等价性验证：重新解析生成物，逐方法与 manifest 比对
 *
 * ⛔ 纪律：改了 manifest 必须 `npm run gen:ipc`；预检【2】会跑 check。
 * 解析器是**深度扫描**（括号/字符串/注释感知）而不是正则：成员参数里有函数类型（内含括号与逗号）、
 * invoke 后可能带 `as Promise<…>` 尾转换、成员前可能黏着多行注释 —— 正则必错切。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GEN_BEGIN, GEN_END, MANIFEST_PATH, PRELOAD_PATH, TYPES_PATH, generatePreloadRegion, generateTypesRegion, normalizeEol, regionOf, withEol } from "./lib/gen-ipc-core.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRELOAD = PRELOAD_PATH;
const TYPES = TYPES_PATH;
const MANIFEST = MANIFEST_PATH;

/* ── 深度扫描：把一段文本按顶层分隔符切片（感知 () {} [] 、引号、行/块注释）──────── */
function splitTopLevel(text, sep) {
  const parts = [];
  let depth = 0, cur = "", i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch; cur += ch; i++;
      while (i < text.length) {
        if (text[i] === "\\") { cur += text[i] + (text[i + 1] ?? ""); i += 2; continue; }
        cur += text[i];
        if (text[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") cur += text[i++]; continue; }
    if (ch === "/" && text[i + 1] === "*") {
      cur += text[i] + text[i + 1]; i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) cur += text[i++];
      cur += "*/"; i += 2; continue;
    }
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) depth--;
    if (depth === 0 && ch === sep) { parts.push(cur); cur = ""; i++; continue; }
    cur += ch; i++;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/** 取平衡括号内文本：text[from] 必须是 "("，返回 { inner, end }（end = ")" 下标）。 */
function balancedParen(text, from) {
  if (text[from] !== "(") throw new Error(`balancedParen：位置 ${from} 不是 "("`);
  let depth = 0, i = from;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch; i++;
      while (i < text.length) {
        if (text[i] === "\\") { i += 2; continue; }
        if (text[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") { depth--; if (depth === 0) return { inner: text.slice(from + 1, i), end: i }; }
    i++;
  }
  throw new Error("balancedParen：括号不平衡");
}

function cleanComment(text) {
  return text.replace(/\/\*+|\*+\//g, "").replace(/^\s*\/\/\s?/, "").replace(/\s+/g, " ").trim();
}

/** 剥掉一段文本**开头的**注释（// 行注释与独立 /* *​/ 块注释），返回 { code, notes }。
 *  ⛔ 成员前的注释与成员之间没有逗号 ⇒ 它们在同一个 chunk 里，必须先剥出来才算得出方法名。 */
function peelLeadingComments(chunk) {
  const notes = [];
  let rest = chunk.replace(/^\s+/, "");
  for (;;) {
    if (rest.startsWith("//")) {
      const nl = rest.indexOf("\n");
      notes.push(cleanComment(nl < 0 ? rest : rest.slice(0, nl)));
      rest = nl < 0 ? "" : rest.slice(nl + 1).replace(/^\s+/, "");
      continue;
    }
    if (rest.startsWith("/*")) {
      const e = rest.indexOf("*/");
      if (e < 0) { notes.push(cleanComment(rest)); rest = ""; break; }
      notes.push(cleanComment(rest.slice(0, e + 2)));
      /* ⛔ 剥完注释必须**再 trim 一次**：注释与成员之间隔着换行缩进，
         不重 trim 的话 rest 以 "\n  名字:" 开头 ⇒ 名字正则 ^([\w$]+) 失配（09-23 实测：恰好只有
         带注释的成员全部解析失败）。 */
      rest = rest.slice(e + 2).replace(/^\s+/, "");
      continue;
    }
    break;
  }
  return { code: rest.replace(/\s+$/, ""), notes };
}

/* ── 解析 preload.ts 的 exposeInMainWorld 对象 ───────────────────── */
function parsePreloadBlock(src) {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => /exposeInMainWorld\(\s*["'`]codex["'`]/.test(l));
  if (start < 0) throw new Error('preload.ts 里找不到 exposeInMainWorld("codex")');
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) if (/^\}\);/.test(lines[i])) { end = i; break; }
  if (end < 0) throw new Error("preload.ts 的 exposeInMainWorld 对象没有结束行 `});`");

  const members = [];
  let pending = [];
  for (const chunk of splitTopLevel(lines.slice(start + 1, end).join("\n"), ",")) {
    const { code, notes } = peelLeadingComments(chunk);
    const allNotes = [...pending, ...notes];
    pending = [];
    if (!code.trim()) { pending = allNotes; continue; }
    const nm = code.match(/^([A-Za-z_$][\w$]*)\s*:/);
    members.push({
      name: nm ? nm[1] : null,
      spread: /^\.\.\./.test(code),
      text: code,
      comment: allNotes,
    });
  }
  return { start, end, members, trailing: pending };
}

/** 从成员解析 `name: (params) => ipcRenderer.invoke("ch"[, args])[as Type]`；不是这种形态返回 null。 */
function parseInvokeMember(member) {
  const text = member.text;
  /* ⛔ 成员文本带**前导缩进**（splitTopLevel 保留原样），名字不在 0 号位 —— 必须 \s* 放行 */
  const head = text.match(/^\s*([\w$]+)\s*:\s*\(/);
  if (!head) return null;
  let params, rest;
  try {
    const p = balancedParen(text, text.indexOf("(", head[0].length - 1));
    params = p.inner.trim().replace(/\s+/g, " ");
    rest = text.slice(p.end + 1);
  } catch { return null; }
  const arrow = rest.match(/^\s*=>\s*/);
  if (!arrow) return null;
  rest = rest.slice(arrow[0].length);
  /* 09-24 起生成物走 `__ipc("ch", minArgs, [args])`；旧形态 `ipcRenderer.invoke("ch", args)` 仍兼容 */
  const call = rest.match(/^\s*(?:ipcRenderer\.invoke|__ipc)\s*\(/);
  if (!call) return null;
  let inner, after;
  try {
    const p = balancedParen(rest, call[0].length - 1);
    inner = p.inner; after = rest.slice(p.end + 1);
  } catch { return null; }
  const parts = splitTopLevel(inner, ",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length || !/^["'`]/.test(parts[0])) return null;
  const viaHelper = /__ipc\s*\(/.test(call[0]);
  let invokeArgs;
  if (viaHelper) {
    /* __ipc 形态：parts = [channel, minArgs, [args...]] —— 取第三个参数的数组内部 */
    if (parts.length < 3 || !/^\[[\s\S]*\]$/.test(parts[2])) return null;
    invokeArgs = parts[2].slice(1, -1).trim();
  } else {
    invokeArgs = parts.slice(1).join(", ");
  }
  const castMatch = after.match(/^\s*as\s+([\s\S]+?)\s*,?\s*$/);
  let cast = null;
  if (castMatch) {
    cast = castMatch[1].trim();
    if (/[;]/.test(cast)) return null;
  } else if (!/^\s*,?\s*$/.test(after)) {
    return null; // invoke 之后还有别的逻辑（.then 等）⇒ 不收
  }
  return {
    name: head[1],
    channel: parts[0].slice(1, -1),
    params,
    invokeArgs,
    cast,
  };
}

/* ── 解析 vite-env.d.ts 的 codex 类型块 ─────────────────────────── */
function parseTypesBlock(src) {
  const lines = src.split("\n");
  const blockStart = lines.findIndex((l) => /^  codex: \{$/.test(l));
  if (blockStart < 0) throw new Error("vite-env.d.ts 里找不到 `  codex: {`");
  let blockEnd = -1;
  for (let i = blockStart + 1; i < lines.length; i++) if (/^  \};$/.test(lines[i])) { blockEnd = i; break; }
  if (blockEnd < 0) throw new Error("vite-env.d.ts 的 codex 类型块没有结束行");

  const statements = [];
  for (const chunk of splitTopLevel(lines.slice(blockStart + 1, blockEnd).join("\n"), ";")) {
    const { code, notes } = peelLeadingComments(chunk);
    if (!code.trim()) { if (notes.length) statements.push({ name: null, text: chunk, note: notes.join(" ") }); continue; }
    const bare = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").trim();
    const m = bare.match(/^([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)\s*:\s*([\s\S]+)$/);
    if (!m) { statements.push({ name: null, text: chunk, note: notes.join(" ") }); continue; }
    statements.push({
      name: m[1],
      text: chunk,
      params: m[2].trim().replace(/\s+/g, " "),
      returns: m[3].trim().replace(/\s+/g, " "),
      note: notes.join(" "),
    });
  }
  return { blockStart, blockEnd, statements };
}

/* ── extract ────────────────────────────────────────────────────── */
function doExtract() {
  const preloadSrc = readFileSync(PRELOAD, "utf8").replace(/\r/g, "");
  const typesSrc = readFileSync(TYPES, "utf8").replace(/\r/g, "");
  const block = parsePreloadBlock(preloadSrc);
  const types = parseTypesBlock(typesSrc);
  /* ⛔ 重名声明**首见优先**：d.ts 历史上存在同一方法两处声明（如 saveIdentity 一宽 Record<string,string>
     一窄 3 字段），取后者会让宽口径丢失 ⇒ identity_onboard 的 8 字段调用点爆 excess-property。
     重复不静默吞，打印出来让人知道这份类型面有历史漂移。 */
  const sigByName = new Map();
  const dupDecls = [];
  for (const s of types.statements) {
    if (!s.name) continue;
    if (sigByName.has(s.name)) { dupDecls.push(s.name); continue; }
    sigByName.set(s.name, s);
  }
  if (dupDecls.length) console.warn(`⚠️ d.ts 有重复声明（取首见）：${[...new Set(dupDecls)].join(", ")}`);

  const entries = [];
  const handwritten = [];
  const missing = [];
  for (const member of block.members) {
    if (member.spread || member.name === null) { handwritten.push(member); continue; }
    const inv = parseInvokeMember(member);
    if (!inv) { handwritten.push(member); continue; }
    const sig = sigByName.get(inv.name);
    if (!sig) { missing.push(`${inv.name}   → ${inv.channel}`); continue; }
    entries.push({
      name: inv.name,
      channel: inv.channel,
      paramsImpl: inv.params,
      paramsDecl: sig.params,
      returns: sig.returns,
      invokeArgs: inv.invokeArgs,
      cast: inv.cast,
      note: (member.comment.length ? member.comment.join(" ") : sig.note) || null,
    });
  }

  if (missing.length) {
    console.error(`✗ preload 有 ${missing.length} 个方法在 vite-env.d.ts 里没有签名（历史三处不同步，先补齐再提取）：`);
    for (const m of missing) console.error("   - " + m);
    process.exit(1);
  }
  /* ⛔ 防呆：0 提取 = 解析器与文件形态对不上，**绝不**在此状态下重排 preload（会把 invoke 全删光） */
  if (!entries.length) {
    console.error("✗ extract 一个 invoke 方法都没解析出来 —— 解析器与文件形态不匹配，拒绝写盘。");
    for (const member of block.members.slice(0, 3)) {
      console.error("   成员样例 name=" + member.name + " text=" + JSON.stringify(member.text.slice(0, 120)));
    }
    process.exit(1);
  }

  /* 无损自检：重名 */
  const names = entries.map((e) => e.name);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  if (dup.length) throw new Error(`preload 里有重名方法：${[...new Set(dup)].join(", ")}`);

  const manifest = {
    _comment: "IPC 桥的单一真相源。加/改接口只改这里，然后跑 `npm run gen:ipc`。字段：paramsImpl=preload 实现参数（含默认值），paramsDecl=d.ts 声明参数，returns=返回类型，cast=invoke 后的 as 尾转换（没有则 null），note=显示在生成物里的备注。事件订阅等非 invoke 成员不在这里（仍在 preload.ts 手写）。",
    generatedAt: new Date().toISOString().slice(0, 10),
    count: entries.length,
    channels: entries,
  };
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

  /* 重排 preload.ts：invoke 成员迁出，留手写成员（带各自注释）+ 展开 */
  const lines = preloadSrc.split("\n");
  const extractable = new Set(entries.map((e) => e.name));
  const keep = [];
  for (const member of block.members) {
    if (member.name !== null && !member.spread && extractable.has(member.name)) continue;
    keep.push((member.comment.length ? member.comment.map((c) => "  // " + c).join("\n") + "\n" : "") + member.text + ",");
  }
  const newPreload = [
    ...lines.slice(0, block.start + 1),
    "  /* ⛔ invoke 方法由 scripts/gen-ipc-bridge.mjs 从 ipc-channels.manifest.json 生成（本文件 gen 标记区内联，",
    "     加/改接口改 manifest 后跑 `npm run gen:ipc`。下面展开之外的是手写成员（事件订阅等）。 */",
    "  ...generatedIpcBridge,",
    "",
    ...keep,
    ...lines.slice(block.end),
  ].join("\n");
  writeFileSync(PRELOAD, newPreload);

  /* 重排 vite-env.d.ts：codex 块 = 手写签名（非 manifest 的，保留原注释）+ gen 标记区 */
  const inManifest = new Set(entries.map((e) => e.name));
  const typeLines = typesSrc.split("\n");
  const leftoverSigs = [];
  for (const s of types.statements) {
    if (s.name !== null && inManifest.has(s.name)) continue;
    leftoverSigs.push(s.text + ";");
  }
  const region = generateTypesRegion(entries);
  const newTypes = [
    ...typeLines.slice(0, types.blockStart + 1),
    "    /* ⛔ invoke 方法签名由 scripts/gen-ipc-bridge.mjs 生成（两标记之间勿手改）。 */",
    ...region.split("\n"),
    "",
    ...leftoverSigs,
    ...typeLines.slice(types.blockEnd),
  ].join("\n");
  writeFileSync(TYPES, newTypes);

  console.log(`extract 完成：${entries.length} 个 invoke 方法进 manifest；preload 手写成员 ${handwritten.length} 块、d.ts 手写签名 ${leftoverSigs.length} 条。`);
}

/* ── generate ───────────────────────────────────────────────────── */
function doGenerate() {
  if (!existsSync(MANIFEST)) throw new Error("manifest 不存在，先跑 extract");
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const entries = manifest.channels;

  /* count 字段自维护（09-24）：它是 manifest 自洽性字段（守卫【2】断言 channels.length === count）。
     手写成员迁入时曾忘了同步 ⇒ 生成时顺手写回，避免"加了条目却红在 count"。 */
  if (manifest.count !== entries.length) {
    manifest.count = entries.length;
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`manifest.count 已同步为 ${entries.length}`);
  }

  /* preload.ts：把 gen 区内联替换（⛔ 必须内联 —— 沙箱 preload 不许 require 相对模块，
     独立生成文件会让 preload 整体加载失败、window.codex 不存在，见文件头 09-23 事故记录） */
  const preloadSrc = readFileSync(PRELOAD, "utf8");
  const region = generatePreloadRegion(entries);
  if (regionOf(preloadSrc) === null) {
    throw new Error("electron/preload.ts 缺少 gen:begin/gen:end 标记区 —— preload.ts 必须保留这对标记");
  }
  writeFileSync(PRELOAD, replaceRegion(preloadSrc, region));

  /* 旧方案遗留：独立生成文件已废弃，源与编译产物一起清掉（留着会被误用回两文件形态） */
  const legacySrc = join(ROOT, "electron", "preload.generated.ts");
  if (existsSync(legacySrc)) { writeFileSync(legacySrc, ""); console.log("已清空废弃的 electron/preload.generated.ts（请删除该文件）"); }

  const typesSrc = readFileSync(TYPES, "utf8");
  if (regionOf(typesSrc) === null) throw new Error("src/vite-env.d.ts 缺少 gen:begin/gen:end 标记区");
  writeFileSync(TYPES, replaceRegion(typesSrc, generateTypesRegion(entries)));

  /* 评估报告 P1-4（09-24）：拓展页显示的通道数不再手写 —— 生成器顺带同步，
     加接口从「同轮改 5 处」降为「manifest 一处 + gen:ipc」。守卫【128】继续单向校验。 */
  const catalogPath = join(ROOT, "src", "lib", "extensibility-catalog.mjs");
  if (existsSync(catalogPath)) {
    const catalogSrc = readFileSync(catalogPath, "utf8");
    if (!/export const IPC_CHANNEL_COUNT = \d+;/.test(catalogSrc)) {
      throw new Error("extensibility-catalog.mjs 里找不到 IPC_CHANNEL_COUNT 常量（常量名变了？）");
    }
    writeFileSync(catalogPath, catalogSrc.replace(/export const IPC_CHANNEL_COUNT = \d+;/, `export const IPC_CHANNEL_COUNT = ${entries.length};`));
  }

  console.log(`generate 完成：preload.ts 内联段 + vite-env.d.ts 生成段（${entries.length} 方法）。`);
  reportUnregistered(entries);
}

/**
 * 生成后体检「账本登记」（09-24 加，扩展成本实测得出）：新增 channel 除了 manifest 还要在
 * `electron/ipc-registry.ts` 记账，否则预检【2】才报红 —— 而现在生成时就告诉你缺哪些、
 * 并打印可直接粘贴的条目（**不自动改文件**：账本是手写表，带 status/file/note，自动改容易写坏）。
 */
function reportUnregistered(entries) {
  const regPath = join(ROOT, "electron", "ipc-registry.ts");
  if (!existsSync(regPath)) return;
  const regSrc = readFileSync(regPath, "utf8");
  const known = new Set([...regSrc.matchAll(/["']([\w-]+(?::[\w-]+)+)["']/g)].map((x) => x[1]));
  const missing = [...new Set(entries.map((c) => c.channel))].filter((c) => !known.has(c));
  if (!missing.length) return;
  const byPrefix = new Map();
  for (const ch of missing) {
    const prefix = ch.split(":")[0];
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(ch);
  }
  console.log(`\n⚠ ${missing.length} 个通道未在 electron/ipc-registry.ts 登记（预检【2】会红）—— 把下面条目加进账本：`);
  for (const [prefix, list] of byPrefix) {
    console.log(`  { prefix: ${JSON.stringify(prefix)}, count: ${list.length}, status: "in-features", file: "features/xxx.ts",`);
    console.log(`    channels: [${list.map((c) => JSON.stringify(c)).join(", ")}] },`);
  }
}

/** 把 src 的 gen:begin…gen:end 区间替换为 next（两文件共用同一逻辑）。
 *  ⛔ 写入时**跟随文件原有行尾**：git autocrlf 恢复出来的文件是 CRLF，生成器若坚持 LF 就会
 *     制造混合行尾，且在「被 git 恢复过但没重跑生成」时报假红（见 normalizeEol 注释）。 */
function replaceRegion(src, next) {
  const a = src.indexOf(GEN_BEGIN);
  const b = src.indexOf(GEN_END);
  return src.slice(0, a) + withEol(next, src) + src.slice(b + GEN_END.length);
}

function doCheck() {
  if (!existsSync(MANIFEST)) { console.error("✗ check 失败：manifest 不存在"); process.exit(1); }
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const problems = [];
  const preloadSrc = readFileSync(PRELOAD, "utf8");
  if (regionOf(preloadSrc) === null) problems.push("electron/preload.ts 缺少 gen:begin/gen:end 标记区（跑 npm run gen:ipc）");
  else if (normalizeEol(regionOf(preloadSrc)) !== normalizeEol(generatePreloadRegion(manifest.channels))) problems.push("electron/preload.ts 生成段与 manifest 不一致（跑 npm run gen:ipc）");
  /* ⛔ 沙箱 preload 必须自包含：preload.ts 不许有运行时相对 import（import type 会在编译期擦掉，安全） */
  const runtimeRel = preloadSrc.match(/^import (?!type )[^\n]*from ["']\.\//m);
  if (runtimeRel) problems.push(`electron/preload.ts 有运行时相对 import（${runtimeRel[0].trim()}）—— 沙箱 preload 无法加载相对模块（09-23 白屏事故根因）`);
  const typesSrc = readFileSync(TYPES, "utf8");
  if (regionOf(typesSrc) === null) problems.push("src/vite-env.d.ts 缺少 gen:begin/gen:end 标记区（跑 npm run gen:ipc）");
  else if (normalizeEol(regionOf(typesSrc)) !== normalizeEol(generateTypesRegion(manifest.channels))) problems.push("src/vite-env.d.ts 生成段与 manifest 不一致（跑 npm run gen:ipc）");
  if (problems.length) {
    for (const p of problems) console.error("✗ " + p);
    process.exit(1);
  }
  console.log(`check 通过：${manifest.channels.length} 个方法，preload 内联段与 d.ts 生成段均与 manifest 一致。`);
}

/* ── verify：重新解析 preload 内联段，逐方法与 manifest 比对（等价性证明）────── */
function doVerify() {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const preloadSrc = normalizeEol(readFileSync(PRELOAD, "utf8"));
  const inner = regionOf(preloadSrc);
  if (inner === null) { console.error("✗ preload.ts 没有 gen 标记区"); process.exit(1); }
  /* 把内联段包成可解析的对象字面量形态，复用同一解析器 */
  const fake = 'contextBridge.exposeInMainWorld("codex", {\n' + inner.slice(GEN_BEGIN.length, inner.length - GEN_END.length) + "\n});";
  const gen = parsePreloadBlock(fake);
  const types = parseTypesBlock(normalizeEol(readFileSync(TYPES, "utf8")));
  let bad = 0;
  for (const e of manifest.channels) {
    const member = gen.members.find((mm) => mm.name === e.name);
    if (!member) { console.error(`✗ ${e.name}：生成物里没有`); bad++; continue; }
    const inv = parseInvokeMember(member);
    if (!inv) { console.error(`✗ ${e.name}：生成物成员不是标准 invoke 形态`); bad++; continue; }
    if (inv.channel !== e.channel || inv.params !== e.paramsImpl || (inv.invokeArgs || "") !== (e.invokeArgs || "") || (inv.cast || null) !== (e.cast || null)) {
      console.error(`✗ ${e.name}：channel/params/args/cast 与 manifest 不一致`); bad++; continue;
    }
    const sig = types.statements.find((s) => s.name === e.name);
    if (!sig) { console.error(`✗ ${e.name}：d.ts 里没有签名`); bad++; continue; }
    if (sig.params !== e.paramsDecl || sig.returns !== e.returns) {
      console.error(`✗ ${e.name}：d.ts 签名与 manifest 不一致`); bad++; continue;
    }
  }
  console.log(bad ? `verify 失败：${bad} 处不一致` : `verify 通过：manifest ${manifest.channels.length} 个方法与两个生成物逐字段一致。`);
  process.exit(bad ? 1 : 0);
}

const mode = process.argv[2];
if (mode === "debug") {
  /* 临时调试：解析指定文件并打印成员名清单（用法：debug <文件路径>） */
  const target = process.argv[3] ?? PRELOAD;
  const raw = readFileSync(target, "utf8")
    .replace("export const generatedIpcBridge = {", 'contextBridge.exposeInMainWorld("codex", {')
    .replace(/\}\);\s*$/, "});").replace(/\n\};\s*$/, "\n});");
  const b = parsePreloadBlock(raw);
  console.log("成员数:", b.members.length);
  console.log(b.members.map((m) => m.name ?? "(无名:" + JSON.stringify(m.text.slice(0, 40)) + ")").join("\n"));
} else if (mode === "extract") doExtract();
else if (mode === "generate") doGenerate();
else if (mode === "check") doCheck();
else if (mode === "verify") doVerify();
else {
  console.error("用法：node scripts/gen-ipc-bridge.mjs extract|generate|check|verify");
  process.exit(2);
}
