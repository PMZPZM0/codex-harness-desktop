/**
 * 预检守卫组：09-structural
 * 分节：【92】【95】【97】【98】【99】【100】【101】（原 L8000–L8389）
 *
 * 09-22 从 scripts/check-preflight.mjs（8,997 行单文件）按域拆出，正文逐字未改；
 * 共享面由 ./_ctx.mjs 注入（同名导入）。动机：多路并行写者往同一文件加守卫会互相覆盖（已发生）。
 */
import {
  C, ROOT, codeOnly, dirname, existsSync, fail, join, ok, pathToFileURL, readFileSync, readdirSync, relative, statSync, warn,
} from "./_ctx.mjs";
import { resolve as resolvePath } from "node:path";
import { createRequire } from "node:module";

export async function run() {

  /* ══ 【92】原 L8000–L8132 ══ */
  {
{
  console.log(C.bold("\n【92】part 组合根：子模块 return 面自洽（互不重叠 / 名字同文件声明 / bag 镜像不丢）"));
  const partsDir = join(ROOT, "src/features/app-state/parts");
  // 从解构元素里取【局部绑定名】：对象解构 prop: local 取 local；数组无别名；都支持默认 a = 1
  const bindingLocal = (el) => {
    const s = el.trim();
    if (!s || s === "...") return null;
    const colon = s.indexOf(":");
    let name = colon >= 0 ? s.slice(colon + 1) : s;
    const eq = name.indexOf("=");
    if (eq >= 0) name = name.slice(0, eq);
    name = name.trim();
    return /^[A-Za-z0-9_$]+$/.test(name) ? name : null;
  };
  const lastReturnKeys = (src) => {
    // 取最后一个 `return { … }`，括号配平（容忍值里嵌套 {} / () / []），避免回溯截断
    const openRe = /^[ \t]*return\s*\{/gm;
    let m, lastBody = null;
    while ((m = openRe.exec(src))) {
      const start = m.index + m[0].length - 1; // “{” 位置
      let depth = 0, end = -1;
      for (let i = start; i < src.length; i++) {
        const ch = src[i];
        if (ch === "{") depth++;
        else if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end >= 0) lastBody = src.slice(start + 1, end);
    }
    if (lastBody == null) return null;
    const topKey = (seg) => {
      const s = seg.trim();
      if (!s || s.startsWith("...") || s.startsWith("[")) return null; // 跳过展开 / 计算属性名
      const colon = s.indexOf(":");
      const name = colon >= 0 ? s.slice(0, colon) : s;
      const n = name.trim().split(/\s+/)[0].replace(/[^A-Za-z0-9_$].*$/, "");
      return n || null;
    };
    const keys = [];
    let buf = "", depth = 0;
    for (let i = 0; i < lastBody.length; i++) {
      const ch = lastBody[i];
      if (ch === "{" || ch === "(" || ch === "[") depth++;
      else if (ch === "}" || ch === ")" || ch === "]") depth--;
      if (ch === "," && depth === 0) { const k = topKey(buf); if (k) keys.push(k); buf = ""; }
      else buf += ch;
    }
    const k = topKey(buf);
    if (k) keys.push(k);
    return keys;
  };
  const declaredNames = (code) => {
    const out = new Set();
    // 简单声明：const|let|var NAME [可选类型注解] =（注解里可能有 () => T 等，用 [^=;{]* 跳到赋值号）
    for (const m of code.matchAll(/(?:^|\s)(?:const|let|var)\s+([A-Za-z0-9_$]+)[^=;{]*=/g)) out.add(m[1]);
    // 数组解构：收集每个元素的局部名（支持默认 a = 1）
    for (const m of code.matchAll(/(?:^|\s)(?:const|let|var)\s*\[([^\]]+)\]/g))
      for (const part of m[1].split(",")) { const n = bindingLocal(part); if (n) out.add(n); }
    // 对象解构：收集【别名/局部名】（prop: local 收 local；plain 收 plain），不再是 propertyName
    for (const m of code.matchAll(/(?:^|\s)(?:const|let|var)\s*\{([^}]+)\}/g))
      for (const part of m[1].split(",")) { const n = bindingLocal(part); if (n) out.add(n); }
    for (const m of code.matchAll(/\bfunction\s+([A-Za-z0-9_$]+)/g)) out.add(m[1]);
    return out;
  };
  const roots = [];
  if (existsSync(partsDir)) {
    for (const name of readdirSync(partsDir)) {
      if (!name.endsWith(".tsx")) continue;
      const base = name.slice(0, -4);
      let entries = null;
      try { entries = readdirSync(join(partsDir, base)); } catch { /* 不是目录 = 未拆，跳过 */ }
      if (entries) roots.push({ base, entries: entries.filter((e) => e.endsWith(".tsx")) });
    }
  }
  (roots.length > 0 ? ok : fail)(
    `【92】发现 ${roots.length} 个 part 组合根${roots.length ? "：" + roots.map((r) => r.base).join(", ") : "（本约定已建立，被拍平须同步改本守卫）"}`,
  );
  const seenKey = new Map();
  for (const { base, entries } of roots) {
    const rootSrc = codeOnly(readFileSync(join(partsDir, base + ".tsx"), "utf8"));
    const imports = [...rootSrc.matchAll(/import\s*\{\s*([A-Za-z0-9_$]+)\s*\}\s*from\s*"\.\/[^/"]+\/([^"]+)"\s*;/g)]
      .map((m) => ({ fn: m[1], file: m[2] }));
    const calls = [...rootSrc.matchAll(/^\s*const\s+([A-Za-z0-9_$]+)\s*=\s*([A-Za-z0-9_$]+)\s*\(/gm)].map((m) => ({ v: m[1], fn: m[2] }));
    const spreadMatch = [...rootSrc.matchAll(/^\s*return\s*\{\s*((?:\.\.\.[A-Za-z0-9_$]+)(?:\s*,\s*\.\.\.[A-Za-z0-9_$]+)*)\s*\};$/gm)].pop();
    const spreadVars = spreadMatch ? spreadMatch[1].split(",").map((s) => s.trim().replace(/^\.\.\./, "")) : [];
    const importedFiles = new Set(imports.map((i) => i.file + ".tsx"));
    const notImported = entries.filter((e) => !importedFiles.has(e));
    (imports.length === entries.length && calls.length === entries.length && notImported.length === 0 ? ok : fail)(
      `【92】${base}：子模块 ${entries.length} 个 / 组合根 import ${imports.length} 个 / 调用 ${calls.length} 个` +
        (notImported.length ? `（未 import：${notImported.join(", ")}）` : ""),
    );
    (JSON.stringify([...spreadVars].sort()) === JSON.stringify([...calls.map((c) => c.v)].sort()) && new Set(spreadVars).size === spreadVars.length ? ok : fail)(
      `【92】${base}：return 展开的变量 == 逐个调用得到的变量（展开 [${spreadVars.join(", ")}] / 调用 [${calls.map((c) => c.v).join(", ")}]）`,
    );
    /* ⛔ 调用顺序 = 契约（hook 靠调用顺序绑定 state）。文件名前缀（01/02/…）就是搬迁时的原始顺序，
       组合根必须① 按文件名排序 import、② 按同一顺序调用、③ 按同一顺序展开。
       三者任一被重排 ⇒ 这里报红。这是本文件唯一能静态钉住「hook 顺序」的地方。 */
    const sortedEntries = [...entries].sort();
    const orderOK =
      JSON.stringify(imports.map((i) => i.file + ".tsx")) === JSON.stringify(sortedEntries) &&
      JSON.stringify(calls.map((c) => c.fn)) === JSON.stringify(imports.map((i) => i.fn)) &&
      JSON.stringify(spreadVars) === JSON.stringify(calls.map((c) => c.v));
    (orderOK ? ok : fail)(
      `【92】${base}：import / 调用 / 展开 三者顺序一致 == 文件名顺序（${sortedEntries.join(" → ")}）`,
    );

    for (const f of entries) {
      const src = readFileSync(join(partsDir, base, f), "utf8");
      const code = codeOnly(src);
      const fnM = code.match(/export\s+function\s+([A-Za-z0-9_$]+)\s*\(/);
      const exp = imports.find((x) => x.file + ".tsx" === f);
      const keys = lastReturnKeys(src);
      const decl = declaredNames(code);
      const foreign = keys ? keys.filter((k) => !decl.has(k)) : [];
      const mirrors = new Set([...code.matchAll(/\bbag\.([A-Za-z0-9_$]+)\s*=(?!=)/g)].map((m) => m[1]));
      /* ⛔ 这里用**宽松**口径（任何 `bag.X = …` 都算一次「对外发布」），不用「同名镜像」严格口径：
         本仓实测两种口径在 part02 上完全等价（114/93/105/92），但宽松那侧一旦红，
         说明有人往 bag 里写了本文件不 return 的东西 —— 那种情况本来就该人眼看一眼（要么补进 return，
         要么确认它是别的 part 负责发布的字段，再放宽这里）。宁可吵一次，不要静默漏一次。 */
      const lostMirrors = keys ? [...mirrors].filter((m) => !keys.includes(m)) : [...mirrors];
      const bad = !fnM || !keys || !exp || exp.fn !== (fnM && fnM[1]) || foreign.length || lostMirrors.length;
      (bad ? fail : ok)(
        `【92】${base}/${f}：${fnM ? fnM[1] : "<无 export function>"} · return ${keys ? keys.length : "?"} 名 · bag 镜像 ${mirrors.size} 个` +
          (foreign.length ? ` · 外来名 ${foreign.slice(0, 6).join(",")}` : "") +
          (lostMirrors.length ? ` · 镜像未 return ${lostMirrors.slice(0, 8).join(",")}` : "") +
          (exp && fnM && exp.fn !== fnM[1] ? ` · 组合根要的是 ${exp.fn}` : ""),
      );
      for (const k of keys || []) {
        if (seenKey.has(k)) fail(`【92】${k} 被 ${seenKey.get(k)} 与 ${f} 同时 return（组合根展开会静默覆盖）`);
        else seenKey.set(k, f);
      }
    }
  }
}
  }

  /* ══ 【95】原 L8137–L8165 ══ */
  {
{
  console.log(C.bold("\n【95】<userData> 派生子路径的唯一真相源"));
  const UD_SRC = "electron/user-data-paths.ts";
  const walkE = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = join(d, e.name);
    if (e.isDirectory()) return walkE(p);
    return /\.ts$/.test(e.name) ? [p] : [];
  });
  const offenders95 = [];
  for (const p of walkE(join(ROOT, "electron"))) {
    const rel = relative(ROOT, p).replace(/\\/g, "/");
    if (rel === UD_SRC) continue;
    const src = readFileSync(p, "utf8");
    for (const m of src.matchAll(/join\(\s*[A-Za-z_$][\w$.]*\s*,\s*"(images|engine-debug\.log)"/g)) {
      offenders95.push(rel + " → " + m[0].slice(0, 56));
    }
  }
  (offenders95.length === 0 ? ok : fail)(
    `【95】除 ${UD_SRC} 外无人自行拼 <userData>/images 或 engine-debug.log（实际 ${offenders95.length} 处）` +
      (offenders95.length ? "：" + offenders95.slice(0, 6).join(" / ") : ""),
  );
  const self95 = readFileSync(join(ROOT, UD_SRC), "utf8");
  const hits95 = (self95.match(/join\(\s*app\.getPath\("userData"\)\s*,\s*"/g) || []).length;
  (hits95 >= 2 ? ok : fail)(
    `【95】${UD_SRC} 自身有 ${hits95} 处派生（应 ≥ 2：images + engine-debug.log）—— 少于 2 说明收口或本守卫被改坏`,
  );
  const notLazy = /^\s*(?:export\s+)?(?:const|let)\s+[\w$]+\s*=\s*path\.join\(\s*app\.getPath\("userData"\)/m.test(self95);
  (notLazy ? fail : ok)("【95】该模块只在函数内求值（模块顶层不得取 userData，见【91】因同一原因）");
}
  }

  /* ══ 【97】原 L8169–L8224 ══ */
  {
{
  console.log(C.bold("\n【97】记忆碎片池生命周期（过期清理 / pinned 保护 / 容量淘汰）"));
  let pruneMod = null;
  try {
    pruneMod = await import("../../dist-electron/memory-prune.js");
  } catch (error) {
    fail(`【97】记忆生命周期纯逻辑产物读不到（先 npm run build）：${error?.message ?? error}`);
  }
  if (pruneMod) {
    const { MEMORY_MAX_RECORDS, MEMORY_TTL_MS, isExpired, memoryValue, pickPrunable } = pruneMod;
    const DAY = 86_400_000;
    const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
    const ago = (days) => NOW - days * DAY;
    const rec = (id, category, days, extra = {}) => ({ id, category, content: id, confidence: 0.8, updatedAt: ago(days), ...extra });

    // ① 过期判定：只有临时上下文过期，且 pinned 豁免
    (MEMORY_TTL_MS === 14 * DAY ? ok : fail)(`【97】TTL 常量 = 14 天（实际 ${MEMORY_TTL_MS / DAY}）`);
    (isExpired(rec("a", "临时上下文", 15), NOW) ? ok : fail)("【97】临时上下文 15 天未更新 = 过期");
    (isExpired(rec("b", "临时上下文", 13), NOW) ? fail : ok)("【97】临时上下文 13 天 = 未过期（TTL 14 天）");
    (isExpired(rec("c", "项目背景", 400), NOW) ? fail : ok)("【97】项目背景 400 天不过期（长期分类）");
    (isExpired(rec("d", "临时上下文", 400, { pinned: true }), NOW) ? fail : ok)("【97】pinned 的临时上下文不过期（P0 保护）");

    // ② 清理结果：该清的清、该留的留、总数守恒
    const input = [
      rec("keep-pinned", "临时上下文", 400, { pinned: true }),
      rec("drop-temp", "临时上下文", 15),
      rec("keep-temp", "临时上下文", 3),
      rec("keep-project", "项目背景", 400),
      rec("drop-temp-2", "临时上下文", 30),
    ];
    const { keep, dropped } = pickPrunable(input, { now: NOW });
    const keptIds = keep.map((e) => e.id).sort().join(",");
    const droppedIds = dropped.map((e) => e.id).sort().join(",");
    (keptIds === "keep-pinned,keep-project,keep-temp" ? ok : fail)(`【97】保留 pinned / 长期分类 / 未过期临时（实际 ${keptIds}）`);
    (droppedIds === "drop-temp,drop-temp-2" ? ok : fail)(`【97】淘汰两条过期临时（实际 ${droppedIds}）`);
    (keep.length + dropped.length === input.length ? ok : fail)("【97】keep + dropped == 输入总数（不丢记录、不重复）");

    // ③ 容量超限：按价值淘汰尾部，pinned 永不动
    const many = [rec("pin-old", "临时上下文", 30, { pinned: true })];
    for (let k = 0; k < MEMORY_MAX_RECORDS; k++) many.push(rec("n" + k, "临时上下文", k % 10));
    many.push(rec("oldest-unpinned", "临时上下文", 13.9));
    const capped = pickPrunable(many, { now: NOW });
    (capped.keep.length === MEMORY_MAX_RECORDS ? ok : fail)(`【97】容量上限生效：${many.length} 条 → 保留 ${capped.keep.length}`);
    (capped.keep.some((e) => e.id === "pin-old") ? ok : fail)("【97】容量淘汰不动 pinned");
    const excess = many.length - MEMORY_MAX_RECORDS;
    (capped.dropped.length === excess ? ok : fail)(`【97】容量超限只淘汰超出的 ${excess} 条（实际 ${capped.dropped.length}）`);
    (capped.dropped.every((e) => !e.pinned) ? ok : fail)("【97】被淘汰的都不是 pinned");
    (capped.dropped.some((e) => e.id === "oldest-unpinned") ? ok : fail)(`【97】最旧的未置顶条目在被淘汰之列（实际 ${capped.dropped.map((e) => e.id).join(",")}）`);

    // ④ 价值函数与召回打分同口径：分类权重 × 时间衰减（7 天半衰）× 置信度
    const fresh = memoryValue(rec("f", "项目背景", 0), NOW);
    const stale = memoryValue(rec("s", "临时上下文", 7), NOW);
    (fresh > stale ? ok : fail)(`【97】价值：新项目背景 ${fresh.toFixed(2)} > 半衰期临时 ${stale.toFixed(2)}`);
    (Math.abs(memoryValue(rec("h", "项目背景", 7), NOW) - fresh / 2) < 1e-9 ? ok : fail)("【97】时间衰减半衰期 = 7 天");
  }
}
  }

  /* ══ 【98】原 L8229–L8273 ══ */
  {
{
  console.log(C.bold("\n【98】工具调用幂等（同一 item/tool/call 只执行一次）"));
  const reqPath = join(ROOT, "src/features/app-state/parts/part05/event-router/02-request.tsx");
  const reqSrc = readFileSync(reqPath, "utf8");
  (/item\/tool\/call[\s\S]{0,400}?toolCallDedupe\.run\(/.test(reqSrc) ? ok : fail)(
    "【98】item/tool/call 分支经 toolCallDedupe.run 去重（不是裸 void (async () => …)）",
  );
  (/createToolCallDedupe\(\)/.test(reqSrc) ? ok : fail)("【98】渲染层持有去重执行器实例");

  (/toolCallRespond\.resend\(event\.id\)/.test(reqSrc) ? ok : fail)("【98】重复到达必须补发响应（引擎可能没收到第一次的 respond）");
  (/\.then\(\(duplicate\) =>/.test(reqSrc) ? ok : fail)("【98】去重返回值驱动补发（true = 重复到达）");
  (/toolCallRespond\.send\(event\.id/.test(reqSrc) ? ok : fail)("【98】工具回包走带缓存的 toolCallRespond.send（重复到达才有东西可补发）");

  const { createToolCallDedupe } = await import("../../src/lib/tool-call-dedupe.mjs");
  const dedupe = createToolCallDedupe({ ttlMs: 60 });
  let runs = 0;
  const task = async () => { runs += 1; return "r" + runs; };
  const [a, b] = await Promise.all([dedupe.run("id-1", task), dedupe.run("id-1", task)]);
  (runs === 1 ? ok : fail)(`【98】同 id 并发只执行一次（实际 ${runs} 次）`);
  (a === false && b === true ? ok : fail)(`【98】同 id 复用同一份结果（首次 false / 重复 true，副作用只跑 1 次；实际 ${a} / ${b}）`);
  const c = await dedupe.run("id-1", task);
  (runs === 1 && c === true ? ok : fail)("【98】TTL 内重复到达仍复用（不重跑，返回 true）");
  const d = await dedupe.run("id-2", task);
  (runs === 2 && d === false ? ok : fail)("【98】不同 id 各跑各的（返回 false，不误合并用户有意的重复调用）");
  await new Promise((resolve) => setTimeout(resolve, 90));
  await dedupe.run("id-1", task);
  (runs === 3 ? ok : fail)("【98】TTL 过期后可重新执行（不是永久吞掉）");
  let failRuns = 0;
  const boom = async () => { failRuns += 1; throw new Error("boom"); };
  await dedupe.run("id-3", boom).catch(() => undefined);
  await dedupe.run("id-3", boom).catch(() => undefined);
  (failRuns === 2 ? ok : fail)(`【98】失败立刻释放、允许重试（实际 ${failRuns} 次）`);
  let noIdRuns = 0;
  await dedupe.run("", async () => { noIdRuns += 1; });
  await dedupe.run("", async () => { noIdRuns += 1; });
  (noIdRuns === 2 ? ok : fail)("【98】无 id 时不去重（不吞掉没有身份的调用）");
  (dedupe.size() <= 3 ? ok : fail)(`【98】去重表有界（当前 ${dedupe.size()} 条）`);
  // ⛔ 数字 id 0 不得逃逸（`!0 === true` 是经典坑）
  let zeroRuns = 0;
  const dz = createToolCallDedupe({ ttlMs: 60 });
  const zFirst = await dz.run(0, async () => { zeroRuns += 1; });
  const zDup = await dz.run(0, async () => { zeroRuns += 1; });
  (zeroRuns === 1 ? ok : fail)(`【98】数字 id 0 不逃逸去重（实际执行 ${zeroRuns} 次）`);
  (zFirst === false && zDup === true ? ok : fail)(`【98】返回值语义：首次 false / 重复 true（实际 ${zFirst} / ${zDup}）`);
}
  }

  /* ══ 【99】原 L8279–L8300 ══ */
  {
{
  console.log(C.bold("\n【99】记忆捕获链（buffer 兜底 / 出口留痕）"));
  const bootSrc = readFileSync(join(ROOT, "electron/features/boot.ts"), "utf8");
  (/function takeCaptureBuffer/.test(bootSrc) ? ok : fail)("【99】boot.ts 有 takeCaptureBuffer（精确 key 取不到时按 threadId 兜底）");
  (/via: "thread-fallback"/.test(bootSrc) ? ok : fail)("【99】兜底分支存在（thread-fallback）");
  (/peekCaptureBuffer\(String\(p\.threadId\)/.test(bootSrc) ? ok : fail)("【99】delta / item/completed 的累积也走兜底（否则 assistant 永远累积不到）");
  (/debugMemoryCapture\(\{ method: "turn\/completed"/.test(bootSrc) ? ok : fail)("【99】turn/completed 落诊断（via / userLen / assistantLen / cwd / willCapture）");
  (/function turnIdOf\(params: any\): string \{[\s\S]{0,160}params\?\.turn\?\.id \?\? params\?\.turnId \?\? params\?\.id/.test(bootSrc) ? ok : fail)("【99】回合 id 走宽容取法（turn?.id ?? turnId ?? id）—— 不再只认 p.turnId");
  (!/peekCaptureBuffer\(String\(p\.threadId\), p\.turnId\)/.test(bootSrc) ? ok : fail)("【99】捕获链不再用 p.turnId 做 key（写读两端同源）");
  (bootSrc.includes("aborted|failed|interrupted") ? ok : fail)("【99】中断/失败的回合也释放缓冲（防串台与泄漏）");
  (/internalThreads\.has\(String\(p\.threadId\)\)/.test(bootSrc) ? ok : fail)("【99】内部线程不写捕获缓冲（写了没人删）");
  (/captureBuffers\.size > 64/.test(bootSrc) ? ok : fail)("【99】捕获缓冲有上限保护");
  const botSrc99 = readFileSync(join(ROOT, "electron/channel-bot.ts"), "utf8");
  (!/turnMessages\.(set|get|delete)\(params\.turnId\)/.test(botSrc99) ? ok : fail)("【99】channel-bot 不再单独用 params.turnId 做 key（与 finishTurn 同源）");
  const svcSrc = readFileSync(join(ROOT, "electron/memory-store.ts"), "utf8");
  /* 09-22：`too-short` / `greeting` 两个字面量随判定逻辑迁到纯模块 electron/memory-lessons（纠错优先），
     出口留痕的义务没变 ⇒ 两个文件一起扫（断言跟着代码搬）。 */
  const lessonsSrc99 = readFileSync(join(ROOT, "electron/memory-lessons.ts"), "utf8");
  const reasons = ["too-short", "greeting", "no-workspace-or-layers", "empty-summary", "written", "append-failed"];
  const missing = reasons.filter((r) => !svcSrc.includes(`"${r}"`) && !lessonsSrc99.includes(`"${r}"`));
  (missing.length === 0 ? ok : fail)(`【99】localCapture 每个出口都留痕${missing.length ? "，缺：" + missing.join(",") : ""}`);
}
  }

  /* ══ 【100】原 L8306–L8349 ══ */
  {
{
  console.log(C.bold("\n【100】记忆注入块剥离（常驻记忆 / 召回记忆）"));
  const emitterSrc = readFileSync(join(ROOT, "electron/memory-layers.ts"), "utf8");
  const HEAD_ANCHOR = "Harness 常驻记忆";
  const TAIL_ANCHOR = "常驻记忆结束";
  const emitterHasAnchors = emitterSrc.includes(`[${HEAD_ANCHOR}`) && emitterSrc.includes(`[${TAIL_ANCHOR}]`);
  (emitterHasAnchors ? ok : fail)("【100】注入端 memory-layers 仍产出常驻记忆块（头 [Harness 常驻记忆…] / 尾 [常驻记忆结束]）");
  /* 从「剥离语句所在行」取正则字面量并真跑 —— 只在含 .replace( 的行上找锚点，
     否则会抓到注释里的锚点（09-22 首版就栽在这：拿注释行去 new RegExp ⇒ Nothing to repeat）。 */
  const stripReOf = (src, anchor) => {
    for (const line of src.split("\n")) {
      if (!line.includes(anchor)) continue;
      if (!/\.replace\(/.test(line)) continue;
      const m = line.match(/\/((?:[^/\\\n]|\\.)+)\/([gimsuy]*)\s*,\s*""/);
      if (!m) continue;
      try { return new RegExp(m[1], m[2]); } catch { return null; }
    }
    return null;
  };
  /* 样例用注入端的真实措辞（含 ` · ` 与描述串）：剥离正则必须只锚语义锚点、不锚措辞 */
  const SAMPLE = `用户原话\n\n[Harness 常驻记忆 · 以下为已确认的长期上下文，与当前请求冲突时以当前请求为准]\n## 用户档案\n- 昵称：潘潘\n## 近期工作日志\n- x\n[常驻记忆结束]\n`;
  const RECALL_SAMPLE = `用户原话\n\n[Harness 相关记忆，仅供参考]\n- 记一条\n[记忆结束]\n`;
  /* 09-22：渲染层的剥离收口到共享纯函数 src/lib/harness-block-strip.mjs（气泡与标题共用一份，
     且它额外处理**残缺形态**——见【110】）⇒ 这里改为「真跑那个共享模块」，不再要求内联正则。 */
  {
    const refsSrc = readFileSync(join(ROOT, "src/lib/user-refs.ts"), "utf8");
    (refsSrc.includes("harness-block-strip.mjs") ? ok : fail)("【100】src/lib/user-refs.ts 走共享剥离实现（harness-block-strip.mjs）");
    let shared = null;
    try { shared = await import("../../src/lib/harness-block-strip.mjs"); } catch { /* 下面报 */ }
    if (shared) {
      const stripped = shared.stripHarnessBlocks(SAMPLE);
      (!stripped.includes("常驻记忆") ? ok : fail)("【100】src/lib/user-refs.ts 真跑剥离：常驻记忆块被吃掉（气泡/标题/复制/引用）");
      (stripped.includes("用户原话") ? ok : fail)("【100】src/lib/user-refs.ts 剥离不误伤用户正文（气泡/标题/复制/引用）");
      (!shared.stripHarnessBlocks(RECALL_SAMPLE).includes("记忆结束") ? ok : fail)("【100】src/lib/user-refs.ts 真跑剥离：召回块被吃掉");
    } else fail("【100】src/lib/harness-block-strip.mjs 读不到（共享剥离实现缺失）");
  }
  /* 主进程侧两处仍是**内联正则**（主进程不能 import 渲染层 src/lib）⇒ 保持原「正则字面量真跑」口径 */
  const STRIPPERS = [
    ["electron/thread-backup.ts", "导出/备份"],
    ["electron/rollout-worker.cjs", "rollout worker（记忆捕获导出）"],
  ];
  for (const [rel, purpose] of STRIPPERS) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    if (!src.includes(HEAD_ANCHOR)) { fail(`【100】${rel} 缺少常驻记忆剥离（${purpose}）`); continue; }
    const re = stripReOf(src, HEAD_ANCHOR);
    if (!re) { fail(`【100】${rel} 的常驻记忆剥离不是可解析的 replace 正则（${purpose}）`); continue; }
    const stripped = SAMPLE.replace(re, "");
    (!stripped.includes("常驻记忆") ? ok : fail)(`【100】${rel} 真跑剥离：常驻记忆块被吃掉（${purpose}）`);
    (stripped.includes("用户原话") ? ok : fail)(`【100】${rel} 剥离不误伤用户正文（${purpose}）`);
  }
  /* 召回块（L3）同样必须在主进程两处都被剥 —— 历史已有，防回退 */
  for (const [rel] of STRIPPERS) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    const re = stripReOf(src, "Harness 相关记忆");
    if (!re) { fail(`【100】${rel} 缺召回块剥离或不可解析（回退）`); continue; }
    (!RECALL_SAMPLE.replace(re, "").includes("记忆结束") ? ok : fail)(`【100】${rel} 真跑剥离：召回块被吃掉`);
  }
}
  }

  /* ══ 【101】原 L8354–L8389 ══ */
  {
{
  console.log(C.bold("\n【101】设置页注册表（派发 / 覆盖率 / 返回条）"));
  const CONTENT = "src/features/app-view/AppView/08-settings-sheet/01-settings-layout/02-settings-content.tsx";
  const REGISTRY = "src/features/app-view/AppView/08-settings-sheet/01-settings-layout/00-settings-registry.tsx";
  const CATALOG = "src/features/app-view/helpers/catalogs.ts";
  const contentSrc = readFileSync(join(ROOT, CONTENT), "utf8");
  const regSrc = readFileSync(join(ROOT, REGISTRY), "utf8");
  const catSrc = readFileSync(join(ROOT, CATALOG), "utf8");

  /* ① 硬编码渲染分支必须归零（注释里提到不算：只数 `{settingsPage === "x" &&` 形态） */
  const hardcoded = (contentSrc.match(/\{\(?settingsPage === "[\w-]+"\)?\s*&&/g) || []).length;
  (hardcoded === 0 ? ok : fail)(`【101】content 无 settingsPage 硬编码渲染分支（实际 ${hardcoded} 处）`);
  /* ② 派发链路在位 */
  (/import \{ settingsPagesOf \} from "\.\/00-settings-registry"/.test(contentSrc) ? ok : fail)("【101】content 从注册表导入 settingsPagesOf");
  (/settingsPagesOf\(app\)\[settingsPage\]/.test(contentSrc) ? ok : fail)("【101】content 按 settingsPage 派发到注册表");
  (/export function settingsPagesOf\(/.test(regSrc) ? ok : fail)("【101】注册表导出 settingsPagesOf");

  /* ③ id 无重复 + 覆盖 settingsNav 全部 id */
  const regIds = [...regSrc.matchAll(/^\s{4}(?:"([\w-]+)"|([A-Za-z_$][\w$]*)):\s*\{/gm)].map((m) => m[1] || m[2]);
  const dup = regIds.filter((id, i) => regIds.indexOf(id) !== i);
  (dup.length === 0 ? ok : fail)(`【101】注册表 id 无重复${dup.length ? "，重复：" + dup.join(",") : `（共 ${regIds.length} 个）`}`);
  const navIds = [...catSrc.matchAll(/\["([\w-]+)",\s*"/g)].map((m) => m[1]);
  const missing = navIds.filter((id) => !regIds.includes(id));
  (missing.length === 0 ? ok : fail)(`【101】注册表覆盖 settingsNav 全部 ${navIds.length} 个一级页${missing.length ? "，缺：" + missing.join(",") : ""}`);

  /* ④ 二级入口页必须有 back 元数据（返回条从写死三元式收敛而来） */
  const SECONDARY = ["browser", "computer", "rpa", "agents", "teams", "expert-center"];
  const noBack = SECONDARY.filter((id) => {
    const m = regSrc.match(new RegExp("^\\s{4}\"?" + id + "\"?\\s*:\\s*\\{\\s*back:", "m"));
    return !m;
  });
  (noBack.length === 0 ? ok : fail)(`【101】二级入口页都有 back 元数据${noBack.length ? "，缺：" + noBack.join(",") : `（${SECONDARY.length} 个）`}`);
  /* ⑤ 返回条渲染仍在（content 里消费 back，不是写死三元） */
  (/const back = page\.back;/.test(contentSrc) ? ok : fail)("【101】返回条由注册表 back 元数据驱动");
  (!/settingsPage === "agents" \|\| settingsPage === "teams"/.test(contentSrc) ? ok : fail)("【101】content 不再写死「返回智能体团队/返回自动化」三元式");
}

/* ══ 【128】拓展接口目录（设置页 · 拓展接口）09-24 ══
   页面本身只是渲染 —— 真正要守的是「清单数据不会过期、不会写虚路径、五要素齐全、
   统计数字与真相源一致」。⛔ 数字写在别处必然过期（docs 曾长期写 251 个通道）。 */
{
  console.log(C.bold("\n【128】拓展接口目录（完整性 / 数字一致 / 注册在位）"));
  const CATALOG = "src/lib/extensibility-catalog.mjs";
  const PAGE = "src/features/settings-extensibility/ExtensibilitySettingsSection.tsx";
  const REGISTRY_FILE = "src/features/app-view/AppView/08-settings-sheet/01-settings-layout/00-settings-registry.tsx";
  const catalogPath = join(ROOT, CATALOG);
  (existsSync(catalogPath) ? ok : fail)("【128】目录数据文件存在（src/lib/extensibility-catalog.mjs）");
  if (existsSync(catalogPath)) {
    const cat = await import(pathToFileURL(catalogPath).href);
    const entries = cat.EXTENSIBILITY_ENTRIES ?? [];
    const groups = cat.EXTENSIBILITY_GROUPS ?? [];
    (entries.length >= 8 ? ok : fail)(`【128】拓展点条目足够（实得 ${entries.length}，需 ≥8 —— 覆盖接口/界面/能力/质量四类）`);
    const badGroup = entries.filter((e) => !groups.includes(e.group)).map((e) => e.id);
    (badGroup.length === 0 ? ok : fail)(`【128】每条都属于已声明分组${badGroup.length ? "，越界：" + badGroup.join(",") : ""}`);
    const incomplete = entries.filter((e) =>
      !e.id || !e.name || !e.purpose || !e.where?.length || !e.steps?.length || !e.effect || !e.guards || !e.pitfalls?.length
    ).map((e) => e.id || "(无 id)");
    (incomplete.length === 0 ? ok : fail)(`【128】每条五要素齐全（用途/位置/步骤/生效/配套+坑）${incomplete.length ? "，缺：" + incomplete.join(",") : ""}`);
    const dupId = entries.map((e) => e.id).filter((id, i, arr) => arr.indexOf(id) !== i);
    (dupId.length === 0 ? ok : fail)(`【128】id 无重复${dupId.length ? "，重复：" + dupId.join(",") : ""}`);
    /* 真实路径必须存在（占位符/绝对路径/通配跳过）。⛔ where 项允许带中文说明后缀
       （如 `electron/preload.ts（手写区）` —— 页面上对用户更有信息量），校验前剥掉它。 */
    const realPaths = entries.flatMap((e) => e.where)
      .map((p) => String(p).replace(/（[^）]*）/g, "").trim())
      .filter((p) => p && !/[$<>%~*]/.test(p) && !/^[A-Za-z]:/.test(p));
    const missing = [...new Set(realPaths)].filter((p) => !existsSync(join(ROOT, p)));
    (missing.length === 0 ? ok : fail)(`【128】列出的路径都真实存在（检查 ${new Set(realPaths).size} 个）${missing.length ? "，缺：" + missing.join(", ") : ""}`);
    /* 统计数字必须与真相源一致 */
    const manifestNow = JSON.parse(readFileSync(join(ROOT, "electron", "ipc-channels.manifest.json"), "utf8"));
    (cat.IPC_CHANNEL_COUNT === manifestNow.channels.length ? ok : fail)(
      `【128】拓展页显示的通道数 = manifest 实际条数（${cat.IPC_CHANNEL_COUNT} vs ${manifestNow.channels.length}）`
    );
  }
  (existsSync(join(ROOT, PAGE)) ? ok : fail)("【128】页面组件存在（src/features/settings-extensibility/）");
  if (existsSync(join(ROOT, PAGE))) {
    const pageSrc = readFileSync(join(ROOT, PAGE), "utf8");
    (/from "\.\.\/\.\.\/lib\/extensibility-catalog\.mjs"/.test(pageSrc) ? ok : fail)("【128】页面从目录数据文件读清单（不许把清单写进组件）");
    (/EXTENSIBILITY_ENTRIES|EXTENSIBILITY_GROUPS/.test(pageSrc) ? ok : fail)("【128】页面确实消费清单（分组/条目都来自数据文件）");
    (/ext-page/.test(pageSrc) ? ok : fail)("【128】页面使用 ext- 前缀样式（styles/19-misc-hints.css 末节）");
  }
  const regNow = readFileSync(join(ROOT, REGISTRY_FILE), "utf8");
  (/extensibility:\s*\{ render:/.test(regNow) ? ok : fail)("【128】设置注册表已注册 extensibility 页");
  const typeNow = readFileSync(join(ROOT, "src", "features", "app-view", "types.ts"), "utf8");
  (/"extensibility"/.test(typeNow) ? ok : fail)("【128】SettingsPage 联合类型含 extensibility");
}

/* ══ 【129】截图 + 收藏夹（09-24）══
   这一组守的是**「不可再生数据」与「系统级副作用」**两类最容易出人性事故的地方：
     · 收藏是用户手攒的，删了没法从会话复原 ⇒ 删除必须显式 id 列表 + 清空要二次确认；
     · 全局快捷键是系统级抢占，注册失败静默 = 用户以为功能坏了 ⇒ 必须记录并照实回传，
       且**先注册成功才落盘**（反过来会让配置里留下一个注册不上的死键）；
     · 记忆注入是硬预算，收藏可无限追加 ⇒ 写入必须限长，且只能追加（先读后写）。
   还有一条历史事故的复发防线：覆盖层 preload 必须自包含单文件（相对 import ⇒ 沙箱 preload
   整体加载失败 ⇒ 白屏）。 */
{
  console.log(C.bold("\n【129】截图与收藏夹（不可再生数据 / 系统级副作用）"));
  const SHOT = join(ROOT, "electron", "screenshot.ts");
  const FAV = join(ROOT, "electron", "favorites.ts");
  /* ⛔ 10-03 P2 批次 8：截图 / 收藏夹拆成两个独立板块（硬规则「一个文件恒等于一个域前缀」），
     断言**跟着搬**：截图那三条读 SHOT_IPC，记忆那一条读 FAV_IPC（拆开不是取消断言）。 */
  const SHOT_IPC = join(ROOT, "electron", "features", "screenshot-ipc.ts");
  const FAV_IPC = join(ROOT, "electron", "features", "favorites-ipc.ts");
  const OVERLAY = join(ROOT, "electron", "overlay-preload.ts");
  const APP_PART = join(ROOT, "src", "features", "app-state", "parts", "part07", "03-seg.tsx");
  const FAV_PAGE = join(ROOT, "src", "features", "settings-favorites", "FavoritesSettingsSection.tsx");
  const SHOT_PAGE = join(ROOT, "src", "features", "settings-screenshot", "ScreenshotSettingsSection.tsx");
  const REG_FILE = join(ROOT, "src", "features", "app-view", "AppView", "08-settings-sheet", "01-settings-layout", "00-settings-registry.tsx");
  const NAV_FILE = join(ROOT, "src", "features", "app-view", "helpers", "catalogs.ts");
  const TYPES_FILE = join(ROOT, "src", "features", "app-view", "types.ts");
  const HELP_FILE = join(ROOT, "src", "components", "HelpDialog.tsx");

  for (const [file, label] of [[SHOT, "screenshot.ts"], [FAV, "favorites.ts"], [SHOT_IPC, "screenshot-ipc.ts"], [FAV_IPC, "favorites-ipc.ts"], [OVERLAY, "overlay-preload.ts"], [APP_PART, "app-state/part07/03-seg.tsx"], [FAV_PAGE, "settings-favorites"], [SHOT_PAGE, "settings-screenshot"]]) {
    (existsSync(file) ? ok : fail)(`【129】${label} 存在`);
  }

  /* ① 收藏删除只认显式 id 列表；清空必须是独立动作（不提供「不传参就删全部」的隐式入口） */
  if (existsSync(FAV)) {
    const fav = codeOnly(readFileSync(FAV, "utf8"));
    (/export async function deleteFavorites\(\s*userData: string,\s*ids: string\[\],?\s*\)/.test(fav) ? ok : fail)(
      "【129】deleteFavorites 收显式 id 数组（不许出现「不带 id 的批量删」）"
    );
    (/if \(!wanted\.size\) return \{ items: await readFavorites\(userData\), removed: 0 \}/.test(fav) ? ok : fail)(
      "【129】空 id 列表直接返回、不误删（空数组 = 什么都不做）"
    );
    (/FAVORITE_MEMORY_LINE_MAX/.test(fav) && /clipped/.test(fav) ? ok : fail)(
      "【129】加入记忆的行限长（FAVORITE_MEMORY_LINE_MAX）—— 记忆注入是硬预算"
    );
    (/rename\(tmp, target\)/.test(fav) ? ok : fail)("【129】收藏落盘走临时文件 rename（写一半被杀不会留半个 JSON）");
  }

  /* ② 快捷键：先注册成功才落盘 + 失败必须记录并可读回 + 两模式不许同键 */
  if (existsSync(SHOT)) {
    const shot = codeOnly(readFileSync(SHOT, "utf8"));
    (/const ok = globalShortcut\.register\(accelerator, onFire\);/.test(shot) && /if \(!ok\) return \{ ok: false, error:/.test(shot) ? ok : fail)(
      "【129】注册失败回传 error（不静默吞掉）"
    );
    (/if \(registered\[mode\]\) globalShortcut\.unregister\(registered\[mode\]\);/.test(shot) ? ok : fail)(
      "【129】新键注册成功后才注销旧键（先注销会让新键被占用时两头空）"
    );
    (/已被另一种截图模式占用/.test(shot) ? ok : fail)("【129】两条快捷键同键时明确拒绝（否则后者注册必然失败且原因不直观）");
    (/screenCaptureBlockedReason/.test(shot) ? ok : fail)("【129】mac 屏幕录制权限未授权时给出可照做的提示（而不是黑帧）");
    (/finally \{/.test(shot) && /win\.show\(\)/.test(shot) ? ok : fail)("【129】窗口恢复放在 finally（任何失败路径都不能让应用凭空消失）");
    (/pickEdited/.test(shot) && !/resize\(\{ width, height/.test(shot) ? ok : fail)(
      "【129】编辑器底图保持物理分辨率（resize 到逻辑尺寸 = 高分屏截图糊一半）"
    );
    (/createFromDataURL/.test(shot) && /frame\.crop/.test(shot) ? ok : fail)(
      "【129】优先用覆盖层合成的标注图（含编辑内容），缺失时才按选区裁原帧兜底"
    );
    (/hideWindow: false/.test(shot) ? ok : fail)(
      "【129】默认不隐藏应用窗口（用户 09-24：万一要截应用界面呢；要纯桌面去设置页勾选）"
    );
  }

  /* ③ 覆盖层 preload 自包含（历史事故：相对 import ⇒ 沙箱 preload 加载失败 ⇒ 白屏） */
  if (existsSync(OVERLAY)) {
    const overlay = codeOnly(readFileSync(OVERLAY, "utf8"));
    (/(import|require)\s*\(?\s*["']\.\//.test(overlay) ? fail : ok)("【129】覆盖层 preload 无相对 import（沙箱 preload 不许 require 相对模块）");
    (/contextBridge\.exposeInMainWorld/.test(overlay) ? ok : fail)("【129】覆盖层 preload 用 contextBridge 只开两个通道（不挂主桥）");
  }

  /* ④ 截图落点唯一：渲染层只订阅事件，不按 invoke 返回值再插一次 */
  const preloadNow = readFileSync(join(ROOT, "electron", "preload.ts"), "utf8");
  (/onScreenshotCaptured:\s*\(listener/.test(preloadNow) && /__on\("screenshot:captured"/.test(preloadNow) ? ok : fail)(
    "【129】preload 暴露 onScreenshotCaptured（截图落地渲染层唯一入口）"
  );
  if (existsSync(SHOT_IPC)) {
    const ipc = codeOnly(readFileSync(SHOT_IPC, "utf8"));
    (/sendToWindow\("screenshot:captured"/.test(ipc) ? ok : fail)("【129】截图成功才推 screenshot:captured 事件（失败/取消不推）");
    (/copyImageFileToClipboard/.test(ipc) ? ok : fail)(
      "【129】截图确认即复制剪贴板（图要有去处，不能只躺在输入框）"
    );
    (/hotkeys\.apply\(mode, accelerator, \(\) => fire\(mode\)\);\s*\n\s*if \(!applied\.ok\)/.test(ipc) ? ok : fail)(
      "【129】hotkey-set 先注册、失败即返回（不落盘）——顺序不能反"
    );
  }
  if (existsSync(FAV_IPC)) {
    const favIpc = codeOnly(readFileSync(FAV_IPC, "utf8"));
    (/await memoryLayers\.readProject\(workspace\)/.test(favIpc) && /await memoryLayers\.writeProject\(workspace, appendBlock/.test(favIpc) ? ok : fail)(
      "【129】加入记忆先读后写（层文件是整份覆盖语义，不读就写 = 抹掉用户已有记忆）"
    );
  }
  if (existsSync(APP_PART)) {
    const part = codeOnly(readFileSync(APP_PART, "utf8"));
    (/bag\.pendingCommandTextRef\.current = token \|\| item\.content;/.test(part) ? ok : fail)(
      "【129】一键发送走 pendingCommandTextRef 旁路（setPrompt 后立刻 send 会发出上一条草稿）"
    );
    (/onScreenshotCaptured\(\(payload\)/.test(part) ? ok : fail)("【129】渲染层订阅截图事件并把图放进输入框");
  }

  /* ④b 停止链路必须「失败也复位」（09-24 老版本用户反馈：委派场景 interrupt 报 expected active turn，
     catch 只弹错不复位 ⇒ 界面永远「运行中」+ 反复弹窗）。⛔ expected active turn = 回合已不在，
     等价于用户要的「停下」，必须走复位分支；且所有 catch 路径都要 setSending(false)。 */
  const stopPart = join(ROOT, "src", "features", "app-state", "parts", "part08", "03-seg.tsx");
  if (existsSync(stopPart)) {
    const stopSrc = codeOnly(readFileSync(stopPart, "utf8"));
    (/but found \(\[/i.test(stopSrc) && /expected active turn/i.test(stopSrc) && /setSending\(false\)/.test(stopSrc) ? ok : fail)(
      "【131】interrupt 失败：expected active turn 须按引擎报出的真实回合重试（but found (…) 正则捕获）+ 所有失败路径复位运行态"
    );
  }
  /* ⑤d 【146】历史搜索必须排除已删除会话（09-24 用户反馈：搜出来的记录「只能看、点进去报错」）。
     数据源是 rollout 原档，而删除并不立即销毁 rollout ⇒ 已删会话能被搜到、显示出来，
     但引擎与侧栏都没有它 ⇒ openThread 必然失败并把引擎原文弹给用户。
     判据：① 搜索实现引用墓碑集；② 收集文件时用墓碑集过滤；③ 渲染层失败提示不直接抛原文。 */
  {
    const hsFile = join(ROOT, "electron", "features", "history-search-ipc.ts");
    const hs = existsSync(hsFile) ? readFileSync(hsFile, "utf8") : "";
    (/deletedThreadIds/.test(hs) && /loadDeletedThreads/.test(hs) ? ok : fail)(
      "【146】历史搜索引用墓碑集（deletedThreadIds / loadDeletedThreads）"
    );
    (/deletedThreadIds\.has\(/.test(hs) ? ok : fail)(
      "【146】历史搜索在收集文件时用墓碑集过滤（已删除会话不呈现）"
    );
    // 09-24 二次修订：用户要求「只搜当前会话，不要展示其他的」⇒ 面板改为会话内搜索 +
    // 点击跳到那条消息（复用 chatSearchResults，渲染层内存匹配、每条带 turnId/itemId）。
    // ⛔ 这一条同时钉住「不许退回跨会话面板」：渲染层不得再调用跨会话 searchHistory IPC。
    const part09 = join(ROOT, "src", "features", "app-state", "parts", "part09", "02-seg.tsx");
    const p9 = existsSync(part09) ? readFileSync(part09, "utf8") : "";
    (/bag\.chatSearchResults/.test(p9) && /locateMatchEl/.test(p9) ? ok : fail)(
      "【146】搜索面板只搜当前会话（bag.chatSearchResults 内存匹配 + locateMatchEl 跳到命中消息）"
    );
    (!/window\.codex\.searchHistory\(/.test(p9) ? ok : fail)(
      "【146】搜索面板不再走跨会话 searchHistory IPC（用户 09-24：只展示当前会话，不要展示其他的）"
    );
    // ⛔ 用户消息的正文在 `content` 数组里（item.text 是空的）—— 只看 item.text 会让
    //   「用户自己发的消息」一律搜不到（实测：DOM 上明明有那段话，搜它 0 命中，
    //   而助手消息里的字能命中）。必须走 itemText（按 type 取正确字段）。
    const tl = join(ROOT, "src", "features", "app-view", "helpers", "thread-list.ts");
    const tlSrc = existsSync(tl) ? readFileSync(tl, "utf8") : "";
    (/itemText\(item/.test(tlSrc) ? ok : fail)(
      "【146】会话内搜索的取文本必须走 itemText（否则用户消息正文在 content[] 里、搜不到）"
    );
  }
  /* ⑤c 【143】断环（09-24 §2.2 + 同日收尾）：electron/main/** **零**反向 import main.ts；
     叶子模块（runtime-paths / upstream-protocols / bridge-dial）只允许 import electron / node 内置 /
     彼此，否则又会变成「环断路器自己在环里」。
     ⛔ 09-24 收尾：原有一个 LEGACY_MAIN_REF_BUDGET=10 的冻结上限（历史债 10 条）。已全部断干净
        —— 路径 → runtime-paths、单例(server/memoryStore/internalThreads) → runtime-refs、
        bridgeDial/responsesBridge → bridge-dial、同目录符号(decryptSecret/escapeToml/…) → 直连 06/07/08、
        gitBinCache → 归其唯一使用模块 02-git-bin ⇒ 删掉上限，改为硬性 0，**不许再有豁免**。 */
  const mainDir = join(ROOT, "electron", "main");
  if (existsSync(mainDir)) {
    const refs = [];
    for (const f of readdirSync(mainDir)) {
      if (!/\.ts$/.test(f)) continue;
      // ⛔ 用 codeOnly：注释里写「原先 from "../main"」也会被裸正则命中（踩过）
      const code = codeOnly(readFileSync(join(mainDir, f), "utf8"));
      const n = (code.match(/from\s*"(?:\.\.\/)+main"/g) || []).length;
      if (n > 0) refs.push(`${f}(${n})`);
    }
    (refs.length === 0 ? ok : fail)(
      `【143】electron/main/** 零反向依赖 main.ts（断 main→runtime-refs→main/01-model-catalog→main 环）${refs.length ? "：残留 " + refs.join("；") : ""}`
    );
  }
  /* ⛔ 叶子模块允许的「非 electron / node 内置」依赖：只限彼此 + 自包含的 responses-bridge
     （它们都是断环基础设施，互相引用不成环）。任何业务模块出现在这里 = 环又回来了。 */
  const LEAF_ALLOWED_REL = /^\.\/(responses-bridge(\/.*)?|upstream-protocols|runtime-paths)$/;
  for (const leaf of ["runtime-paths.ts", "upstream-protocols.ts", "bridge-dial.ts"]) {
    const leafPath = join(ROOT, "electron", leaf);
    if (!existsSync(leafPath)) { fail(`【143】叶子模块 ${leaf} 缺失（它是断环依赖的叶子）`); continue; }
    const specs = [...readFileSync(leafPath, "utf8").matchAll(/from\s*"([^"]+)"/g)].map((m) => m[1]);
    const bad = specs.filter((s) => !/^(electron|node:)/.test(s) && !LEAF_ALLOWED_REL.test(s));
    (bad.length === 0 ? ok : fail)(`【143】${leaf} 是叶子模块（只依赖 electron / node 内置 / 其它叶子，禁止依赖业务模块）${bad.length ? "：" + bad.join("；") : ""}`);
  }
  /* ⑤e 【147】require 环守卫（09-24 收尾）：断环基础设施（runtime-refs + 三个叶子）不得参与任何 import 环。
     ⛔ 动因：本轮实测抓到一个**真环** —— runtime-refs → main/01-model-catalog → features/window-factory
        → runtime-refs（最后一条是 `01` 里的**死导入**：createWindow 只在注释里出现）。
        这类环 tsc 不报、既有守卫全绿，只在运行时让某些模块拿到**部分初始化**的 exports
        （行为取决于求值时机——今天恰好安全，改一行就未必）。必须机器钉住。
     ⛔ 判据：源码级**剥注释**后建相对 import 图，Tarjan 求 size>1 的 SCC；被保护模块不得出现在任何 SCC 里。
        （不剥注释会假报——本轮注释里写的 from "…" 就让老环"复活"过一次。） */
  {
    const moduleFiles = [];
    const walkTs = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walkTs(p);
        else if (/\.ts$/.test(e.name)) moduleFiles.push(p);
      }
    };
    walkTs(join(ROOT, "electron"));
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    const resolveRel = (from, spec) => {
      const base = resolvePath(dirname(from), spec);
      for (const ext of ["", ".ts", "/index.ts"]) {
        try { if (existsSync(base + ext) && statSync(base + ext).isFile()) return base + ext; } catch { /* 忽略 */ }
      }
      return null;
    };
    const graph = new Map();
    for (const f of moduleFiles) {
      const deps = new Set();
      for (const m of strip(readFileSync(f, "utf8")).matchAll(/from\s*"((?:\.\.?\/)[^"]+)"/g)) {
        const r = resolveRel(f, m[1]);
        if (r) deps.add(r);
      }
      graph.set(f, [...deps]);
    }
    let counter = 0;
    const stack = [], onStack = new Set(), idxOf = new Map(), lowOf = new Map(), cycles = [];
    const strongconnect = (v) => {
      idxOf.set(v, counter); lowOf.set(v, counter); counter += 1;
      stack.push(v); onStack.add(v);
      for (const w of graph.get(v) || []) {
        if (!idxOf.has(w)) { strongconnect(w); lowOf.set(v, Math.min(lowOf.get(v), lowOf.get(w))); }
        else if (onStack.has(w)) lowOf.set(v, Math.min(lowOf.get(v), idxOf.get(w)));
      }
      if (lowOf.get(v) === idxOf.get(v)) {
        const comp = [];
        let w;
        do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
        if (comp.length > 1) cycles.push(comp);
      }
    };
    for (const v of graph.keys()) if (!idxOf.has(v)) strongconnect(v);
    const relOf = (p) => relative(ROOT, p).replace(/\\/g, "/");
    const GUARDED = ["electron/runtime-refs.ts", "electron/runtime-paths.ts", "electron/upstream-protocols.ts", "electron/bridge-dial.ts"];
    const inCycle = cycles.filter((c) => c.some((p) => GUARDED.includes(relOf(p))));
    (!inCycle.length ? ok : fail)(
      `【147】断环基础设施（runtime-refs + 3 叶子）不参与任何 require 环（全图 ${graph.size} 模块 / ${cycles.length} 个环）${inCycle.length ? "：" + inCycle.slice(0, 2).map((c) => c.map(relOf).join("↔")).join("；") : ""}`
    );
  }
  /* ⑤f 【148】「注释吞代码」守卫（09-24 实修事故）。
     ⛔ 动因：P2-9 搬迁时（c04def86）把 closeToTrayEnabled() 搬去 runtime-refs.ts，删掉了它的
        JSDoc 正文与**注释结尾符**，却把开头的块注释开始符留在了原地 ⇒ 该块注释一直吞到下一个
        注释结尾符，正好把紧跟其后的【系统托盘注册】整段 + [ipc-registry] 日志变成死代码。
        表现：用户报「系统托盘图标不见了」，而 **tsc / eslint / 既有全部守卫都是绿的**
        （被吞的是合法注释内容，语法完全正确）。
     ⛔ 判据 = 这条事故的**特征签名**：块注释体里出现「行注释起点（行首两斜杠）」。
        正常 JSDoc / 区块注释不会在体内再嵌行注释；残留的未闭合块注释会把其后的 `// 说明`
        与代码一起吞进来 ⇒ 必然命中。实测：破坏版命中 1、修复版 0（判据非空转、零误伤）。
     ⛔ 实现必须用**解析器**（getLeadingCommentRanges）取注释区间。实测 ts.createScanner
        在本仓某些上下文里会漏判这个块注释（同一文件它一个都没报）——用扫描器 = 假绿。 */
  {
    const req = createRequire(import.meta.url);
    let ts = null;
    try { ts = req(join(ROOT, "node_modules", "typescript")); } catch { /* 未装则跳过 */ }
    if (ts) {
      const files = [];
      const walkE = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, e.name);
          if (e.isDirectory()) walkE(p);
          else if (/\.ts$/.test(e.name)) files.push(p);
        }
      };
      walkE(join(ROOT, "electron"));
      const commentRanges = (src, sf) => {
        const seen = new Set();
        const out = [];
        (function scan(n) {
          for (const r of ts.getLeadingCommentRanges(src, n.getFullStart()) || []) {
            if (seen.has(r.pos)) continue;
            seen.add(r.pos);
            out.push(r);
          }
          ts.forEachChild(n, scan);
        })(sf);
        return out;
      };
      const swallowed = [];
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        const sf = ts.createSourceFile(f, src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
        for (const r of commentRanges(src, sf)) {
          if (r.kind !== ts.SyntaxKind.MultiLineCommentTrivia) continue;
          const bad = src.slice(r.pos, r.end).split("\n").slice(1, -1).filter((l) => /^\s*\/\//.test(l));
          if (bad.length) swallowed.push(`${relative(ROOT, f).replace(/\\/g, "/")}（吞 ${bad.length} 行，例：${bad[0].trim().slice(0, 40)}）`);
        }
      }
      (swallowed.length === 0 ? ok : fail)(
        `【148】electron/** 无「块注释吞代码」（块注释体里不得出现行注释起点）${swallowed.length ? "：" + swallowed.slice(0, 3).join("；") : ""}`
      );
      // 事故专项回归钉：托盘注册必须是**活代码**（曾被上面那个残留开头符吞成死代码）
      const mainFile = join(ROOT, "electron", "main.ts");
      const mainSrc = readFileSync(mainFile, "utf8");
      const mf = ts.createSourceFile(mainFile, mainSrc, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
      const callIdx = mainSrc.indexOf("createAppTray({");
      const inComment = callIdx >= 0 && commentRanges(mainSrc, mf).some((r) => callIdx >= r.pos && callIdx < r.end);
      (callIdx >= 0 && !inComment ? ok : fail)(
        `【148】main.ts 里 createAppTray({ 调用是活代码（托盘注册没被注释吞掉）${inComment ? "：实测它在注释里" : callIdx < 0 ? "：找不到调用" : ""}`
      );
    } else {
      warn("【148】找不到 node_modules/typescript ⇒ 跳过「注释吞代码」检查");
    }
  }
  /* ⑤b P2-9（09-24）：electron/features/** 禁反向依赖 main.ts 的非白名单符号。
     main.ts 是巨石 + 启动链；已下沉 runtime-refs.ts（setter 注入模式）。
     ⛔ 09-24 修正（评估报告 §2.1）：旧正则只匹配 `"../main"`，**看不见子目录里的 `"../../main"`**
        —— engine-ipc / builtin-skills-ipc / connectors-mcp-ipc / model-custom-ipc 共 18 个文件、
        23 条 import 全部漏检；也漏 `import type`，且从不扫 electron/main/**。
        于是「本轮要消除反向依赖」这条规则**唯一的机器校验**，在 18 个文件上是空的
        （守卫静默恒真 —— 项目自己记录过的最危险失败模式）。
        现在按 `(?:\.\.\/)+main` 全量匹配 + 允许 `import type`，且把现状**冻结成棘轮**：
        新增任何白名单外符号、或旧债引用数增长，立即变红。 */
  const eFeatures = join(ROOT, "electron", "features");
  if (existsSync(eFeatures)) {
    /* 甲档（永久）：按 P2-9 结论**只有留在 main 才是对的** —— 依赖 main 本体计数器 / 复杂闭包，
       搬走要么拿不到、要么要改动语义。 */
    const MAIN_PERMANENT = new Set([
      "mutableState", "bridgeDial", "enrichScanCountSnapshot", "filePreviewAllowed",
      "remote", "scheduler", "voiceService", "channelBot", "botPairing",
    ]);
    /* 乙档（历史债）：本应直连其**真正来源模块**（main/01-model-catalog、connectors 域模块）
       或 runtime-refs，目前仍走 main 转发。⛔ 这是待迁移清单，不是"允许"清单：
       棘轮只保证它不再增长；每迁走一个就从上表删一个，并下调 LEGACY_REF_BUDGET。 */
    const MAIN_LEGACY_DEBT = new Set([
      "applyCustomModel", "builtinPluginsFile", "describeNetworkError", "dirEntries", "readBuiltinPlugins",
      "readCustomModel", "refreshSkillDiscipline", "skillsRegistryFile", "userSkillsDir", "BuiltinPluginConfig",
      "connectorEnv", "connectorsFile", "mcpOverrideEnabled", "oauthSessions", "readConnectors",
      "readMcpOverrides", "safeConnectorId", "writeMcpOverrides", "ConnectorConfig", "ConnectorTransport",
      "responsesBridge", "restrictedThreadRole", "StoredChannelBot", "MemoryMode", "StoredMemoryGateway",
      "normalizeProvider", "normalizeUpstreamProtocol", "readCustomModels", "writeCustomModels",
      "SubAgentConfig", "McpOverrides",
    ]);
    /** 乙档引用点的冻结上限：只许降不许升（迁走符号时同轮下调）。 */
    const LEGACY_REF_BUDGET = 201;
    const bad = [];
    let legacyRefs = 0;
    const walkFeat = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) { walkFeat(p); continue; }
        if (!/\.ts$/.test(e.name)) continue;
        const src = readFileSync(p, "utf8");
        for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"(?:\.\.\/)+main";/g)) {
          for (const raw of m[1].split(",")) {
            const sym = raw.trim().split(" as ")[0];
            if (!sym) continue;
            const where = `${sym} @ ${relative(ROOT, p).replace(/\\/g, "/")}`;
            if (MAIN_PERMANENT.has(sym)) continue;
            if (MAIN_LEGACY_DEBT.has(sym)) { legacyRefs += 1; continue; }
            bad.push(where);
          }
        }
      }
    };
    walkFeat(eFeatures);
    (bad.length === 0 ? ok : fail)(
      `【132】electron/features 不新增对 main.ts 的非白名单依赖（甲档 9 个永久 + 乙档 ${MAIN_LEGACY_DEBT.size} 个历史债）${bad.length ? "，新增违规：" + bad.slice(0, 4).join("；") : ""}`,
    );
    (legacyRefs <= LEGACY_REF_BUDGET ? ok : fail)(
      `【132】历史债引用点不增长（实测 ${legacyRefs} ≤ 冻结上限 ${LEGACY_REF_BUDGET}）—— 涨了说明又绕过 runtime-refs 直连 main，符号请进 runtime-refs 或直连来源模块`,
    );
  }

  /* ══ 【135】断言形态：禁止 `cond ? ok : fail("msg")`（缺外层括号 = 静默不执行）══
     09-24：项目自己记录过这起事故（AGENTS.md 探针方法论第 3 条），而 10-memory-audit.mjs
     的三条断言**此刻仍是坏形态**（实测那三条消息完全不出现在预检输出里，条件为真 ⇒ 看起来全绿）。
     判据取「`? ok : fail(` 里 fail 后面**紧跟左括号**」这一形态 —— 正确写法恒为 `? ok : fail)(`，
     所以该正则只命中坏形态，不会误伤 `(a && b ? ok : fail)("x")` 这类合法写法。 */
  {
    const guardDir = join(ROOT, "scripts", "guards");
    /* ⛔ 判据必须同时剥掉**注释**与**字符串/模板字面量内容**，且**保留换行**（行号要能对上原文）。
       前两版实测踩到的坑：
         ① 直接扫原文 ⇒ 命中自己说明文字里的样例（自指假红）；
         ② 用 codeOnly ⇒ 它删字符不保换行（357 行变 201 行，报出的行号全错），
            而且**不剥模板串内容** ⇒ 命中 finish() 里那条报错消息里的字面样例。
       所以这里自带一个状态机：注释/字符串区一律替换成空格，换行原样保留。 */
    const blankNonCode = (src) => {
      const out = src.split("");
      let state = "code";
      for (let i = 0; i < src.length; i++) {
        const c = src[i], n = src[i + 1];
        if (state === "code") {
          if (c === "/" && n === "/") { state = "line"; out[i] = " "; continue; }
          if (c === "/" && n === "*") { state = "block"; out[i] = " "; continue; }
          if (c === '"' || c === "'" || c === "`") { state = c; out[i] = " "; continue; }
        } else if (state === "line") {
          if (c === "\n") { state = "code"; continue; }
          out[i] = " ";
        } else if (state === "block") {
          if (c === "*" && n === "/") { out[i] = " "; out[i + 1] = " "; i++; state = "code"; continue; }
          if (c !== "\n") out[i] = " ";
        } else {
          if (c === "\\") { out[i] = " "; if (src[i + 1] !== "\n") out[i + 1] = " "; i++; continue; }
          if (c === state) { state = "code"; out[i] = " "; continue; }
          if (c !== "\n") out[i] = " ";
        }
      }
      return out.join("");
    };
    const offenders = [];
    for (const name of readdirSync(guardDir)) {
      if (!/\.mjs$/.test(name)) continue;
      const rawText = readFileSync(join(guardDir, name), "utf8");
      const blanked = blankNonCode(rawText).split(/\r?\n/);
      const rawLines = rawText.split(/\r?\n/);
      rawLines.forEach((rawLine, i) => {
        /* 三重保险（前两版都被自指/扫描器带偏坑过）：
           ① 状态机剥注释与字符串；
           ② 按注释行前缀跳过（块注释续行以 * 开头）；
           ③ ⛔ 只认**以 ; 结尾的行** —— 真实断言行必然如此，而说明文字里的样例极少以分号收尾
              （实测：坏形态样例所在的注释行以「——」收尾，第 ③ 条一票否决）。
           已知取舍：跨多行书写的坏形态抓不到（本仓断言均为单行，可接受）。 */
        const t = rawLine.trim();
        if (t.startsWith("*") || t.startsWith("/*") || t.startsWith("//")) return;
        if (!/;\s*$/.test(t)) return;
        if (/\?\s*(?:ok\s*:\s*fail|fail\s*:\s*ok)\s*\(/.test(blanked[i] ?? "")) offenders.push(`${name}:${i + 1}`);
      });
    }
    (offenders.length === 0 ? ok : fail)(
      `【135】守卫断言必须写成 (cond ? ok : fail)("msg") —— 缺外层括号会让 ok 永不被调用、断言静默消失（判据已剥注释与字符串）${offenders.length ? "，坏形态：" + offenders.slice(0, 4).join("；") : ""}`,
    );
  }
  /* ⑤ 页面与导航注册在位（缺一处用户就找不到/进不去）。
     ⛔ 四处用的写法不同：注册表是对象键（`screenshot: { render:`）、导航与总览用中文标签、
     类型用字符串字面量 —— 不能拿同一个模式去套四个文件（曾据此误报过）。 */
  const regSrc = readFileSync(REG_FILE, "utf8");
  (/screenshot:\s*\{\s*render:/.test(regSrc) && /favorites:\s*\{\s*render:/.test(regSrc) ? ok : fail)("【129】截图页与收藏夹页在注册表里都有登记");
  const navSrc = readFileSync(NAV_FILE, "utf8");
  (/\["screenshot",\s*"截图"/.test(navSrc) && /\["favorites",\s*"收藏夹"/.test(navSrc) ? ok : fail)("【129】截图页与收藏夹页在 settingsNav 里都有登记");
  const typesSrc = readFileSync(TYPES_FILE, "utf8");
  (/"screenshot"/.test(typesSrc) && /"favorites"/.test(typesSrc) ? ok : fail)("【129】SettingsPage 联合类型含 screenshot 与 favorites");
  const helpSrc = readFileSync(HELP_FILE, "utf8");
  (/page:\s*"截图"/.test(helpSrc) && /page:\s*"收藏夹"/.test(helpSrc) ? ok : fail)("【129】帮助总览里两页都能被新手找到（【32】按 settingsNav 的中文标签核对）");
  if (existsSync(FAV_PAGE)) {
    const page = readFileSync(FAV_PAGE, "utf8");
    (/确认清空 \{favorites\.length\} 条？/.test(page) ? ok : fail)("【129】清空全部是二次确认（不可再生数据不许一击清空）");
    (/selected\.filter\(\(id\) => alive\.has\(id\)\)/.test(page) ? ok : fail)("【129】选中集合跟着列表收敛（防幽灵 id 命中下一次批量操作）");
  }
}
  }
}

/* ── 分层红线（09-24，评估报告 P0-3）：守卫此前零覆盖 ──
 * 规则①：基座（src/features/shared/**、src/lib/**、src/components/**、src/hooks/**）
 *         不得反向 import 任何域（src/features/<其它目录>/**）——基座只被域消费。
 * 规则②：域 ↔ 域只允许走 barrel（`../<域>` 或 `../<域>/index`），禁止深链对方内部文件。
 * 违例曾是：shared/ItemView ↔ session-queue/SessionQueue 双向环（09-24 已解：
 *         Progressive 随唯一消费者搬进 ItemView，ItemView 迁入 session-queue 域）。
 * ⛔ 新增基座目录 / 新增域时本节自动覆盖（按目录枚举，不是白名单）。 */
{
  const importRe = /(?:^|\n)\s*(?:import[\s\S]*?from\s*|export[\s\S]*?from\s*|import\s*\(\s*)["']([^"']+)["']/g;
  const walkTs = (dir, out = []) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walkTs(p, out);
      else if (/\.(tsx?|mjs)$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const relImportTarget = (fromFile, spec) => {
    if (!spec.startsWith(".")) return null; // 裸包名不管
    const base = join(dirname(fromFile), spec);
    for (const cand of [base, base + ".ts", base + ".tsx", base + ".mjs", join(base, "index.ts"), join(base, "index.tsx")]) {
      if (existsSync(cand) && statSync(cand).isFile()) return cand;
    }
    return base; // 带扩展名的 import 直接返回
  };
  const featuresRoot = join(ROOT, "src", "features");
  const domainOf = (file) => {
    const rel = relative(featuresRoot, file).replace(/\\/g, "/");
    if (rel.startsWith("..") || rel.startsWith("shared/") || rel.startsWith("shared.")) return null;
    return rel.split("/")[0];
  };
  const domainDirs = readdirSync(featuresRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  const baseDirs = [
    { root: join(ROOT, "src", "lib"), label: "src/lib" },
    { root: join(ROOT, "src", "components"), label: "src/components" },
    { root: join(ROOT, "src", "hooks"), label: "src/hooks" },
    { root: join(featuresRoot, "shared"), label: "features/shared" },
  ];
  let bad = [];
  // 规则①：基座 → 域
  for (const { root, label } of baseDirs) {
    if (!existsSync(root)) continue;
    for (const file of walkTs(root)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(importRe)) {
        const target = relImportTarget(file, m[1]);
        if (!target) continue;
        const tRel = relative(ROOT, target).replace(/\\/g, "/");
        // 命中任何域目录即违规；shared 内部互引豁免（shared 同时是域目录枚举成员）
        for (const d of domainDirs) {
          if (d === "shared") continue;
          if (tRel.startsWith(`src/features/${d}/`) || tRel === `src/features/${d}`) { bad.push(`${label} → ${tRel}（${relative(ROOT, file).replace(/\\/g, "/")}）`); break; }
        }
      }
    }
  }
  (bad.length === 0 ? ok : fail)(`【130】基座不反向 import 域（shared/lib/components/hooks → features/*，0 违规）${bad.length ? "：" + bad.slice(0, 4).join("；") : ""}`);
  // 规则②：域 → 域禁深链（barrel = 恰好指到对方目录/index 才合法）
  bad = [];
  for (const d of domainDirs) {
    for (const file of walkTs(join(featuresRoot, d))) {
      const src = readFileSync(file, "utf8");
      // app-view 是组装层：编排各域是其职责（对 app-state/useHarnessApp 的深链全是 import type 拿
      // 组合根类型，12 行重构的既定设计）⇒ 组装层不适用规则②；其余域间仍禁深链
      if (d === "app-view") continue;
      for (const m of src.matchAll(importRe)) {
        const spec = m[1];
        const target = relImportTarget(file, spec);
        if (!target) continue;
        const tRel = relative(featuresRoot, target).replace(/\\/g, "/");
        const tDomain = tRel.split("/")[0];
        if (!domainDirs.includes(tDomain) || tDomain === d) continue;
        if (tDomain === "shared") continue; // 域 → 基座（shared/lib/components）= 正向依赖，合法（含基座转发 barrel）
        if (tDomain === "app-view") continue; // 组装层：其它域消费其 types/barrel 属现行设计（收紧需用户拍板）
        // 指向对方域内部文件（非 index）= 深链
        const rest = tRel.slice(tDomain.length + 1);
        if (rest && rest !== "index.ts" && rest !== "index.tsx") bad.push(`${d} → ${tRel}（${relative(ROOT, file).replace(/\\/g, "/")}）`);
      }
    }
  }
  (bad.length === 0 ? ok : fail)(`【130】域间只经 barrel、禁深链内部文件（0 违规）${bad.length ? "：" + bad.slice(0, 4).join("；") : ""}`);

  /* ══ 【158】项目日志库（`logs/`）：规范 + 索引 + 不丢失保障（用户 09-25 要求）══════
     用户原话：「新增一个专门用于写日志的独立目录，并配套完整的日志规范和使用技能…加入与 WorkBuddy
     一致的索引机制…提供配套的日志管理功能，包括查看、清理和删除，确保项目记录完整留存、不丢失」。
     判据分四类：①规范与工具存在 ②索引可校验（sha256）③**删除必须留墓碑**（用户允许硬删，
     但"存在过"不能消失）④**`logs/` 必须能进 git**（最强度的一道防丢失 —— 被 gitignore 吃掉就全废）。 */
  {
    console.log(C.bold("\n【158】项目日志库：规范 / 索引 / 不丢失"));
    const logsDir = join(ROOT, "logs");
    const mgr = join(ROOT, "scripts", "logs.mjs");
    (existsSync(join(logsDir, "README.md")) ? ok : fail)("【158】日志规范存在（logs/README.md）");
    (existsSync(mgr) ? ok : fail)("【158】日志管理入口存在（scripts/logs.mjs）");
    const mgrSrc = existsSync(mgr) ? readFileSync(mgr, "utf8") : "";
    const mgrCode = codeOnly(mgrSrc);
    /* ⛔ 九个子命令缺一不可：用户点名的「查看/清理/删除」= list|show|stats / archive / delete */
    const required = ["new", "list", "search", "show", "stats", "reindex", "verify", "archive", "delete", "dedupe"];
    const missing = required.filter((c) => !new RegExp(`\\b${c}:\\s*cmd`).test(mgrCode) && !new RegExp(`function cmd${c[0].toUpperCase()}${c.slice(1)}`).test(mgrCode));
    (missing.length === 0 ? ok : fail)(`【158】子命令齐全（查看/检索/统计/重建/校验/归档/删除/查重）${missing.length ? "，缺：" + missing.join(",") : ""}`);

    /* ⛔⛔ 防重复写（用户 2026-09-25：「确保没有重复写日志哈」）—— 两道机制必须都在：
       ① 写入时拦（相似标题 / 相同正文 ⇒ 拒写，除非显式 --allow-similar）
       ② 随时可查（dedupe 全库查重）
       ⛔ 断言打到**代码形态**：只 grep "dedupe" 会被 USAGE 文案满足（今天已踩过同类坑）。 */
    (/function findSimilar\(/.test(mgrCode) && /const similar = findSimilar\(/.test(mgrCode) ? ok : fail)("【158】new 写入时查相似条目（标题 ≥0.75 即拒写）");
    (/--allow-similar/.test(mgrCode) && /flags\["allow-similar"\]/.test(mgrCode) ? ok : fail)("【158】重复拦阻有显式放行闸门（--allow-similar，逼使用者确认不是同一件事）");
    (/bodySha256/.test(mgrCode) && /内容完全相同/.test(mgrCode) ? ok : fail)("【158】正文哈希查重（同一段话换个标题再记一遍也能抓）");
    /* ⛔ 断言要覆盖**注册**，不能只判函数定义存在：改名成 `cmdDedupeGone` 也能通过 `function cmdDedupe`
       （09-25 变异测试实测抓到这个漏洞）。注册在 COMMANDS 表里 = 真的可达。 */
    (/function cmdDedupe/.test(mgrCode) && /dedupe: cmdDedupe/.test(mgrCode) && /problems\.length \? 2 : 0/.test(mgrCode) ? ok : fail)("【158】dedupe 已注册且发现重复时非 0 退出（⛔ 只判函数名会被改名绕过）");

    /* 索引文件存在性 + 边界规则必须写进规范与技能（不然只有工具、没有用法） */
    const readme = existsSync(join(logsDir, "README.md")) ? readFileSync(join(logsDir, "README.md"), "utf8") : "";
    (/不许重复写/.test(readme) && /只留一行/.test(readme) ? ok : fail)("【158】规范写明「不许重复写 + 别处只留指针」的边界");
    /* ⛔ 删除的安全闸门：--confirm（二次确认）+ --reason（进墓碑）。缺一个就等于"可被误删且无据可查"。 */
    /* ⛔ 删除的安全闸门：必须断言**代码形态**，不能只 grep 字样 —— USAGE/注释里也有 `--confirm`/`--reason`，
       只查字样的话把代码删了照样绿（09-25 变异测试实测抓到的空洞断言）。 */
    (/const confirm = flags\.confirm === undefined[\s\S]{0,160}?if \(!confirm\) die\(/.test(mgrCode) ? ok : fail)("【158】delete 的二次确认是**代码**要求（--confirm 缺失即 die）");
    (/const reason = String\(flags\.reason \?\? ""\)\.trim\(\);[\s\S]{0,140}?if \(!reason\) die\(/.test(mgrCode) ? ok : fail)("【158】delete 的 --reason 是**代码**要求（缺失即 die）");
    /* ⛔ 顺序也算判据：**先写墓碑、后删文件**。
       ⛔ 别再加「不得先删后写」的反向断言（我加过、是**误报**）：delete 里有 `if 文件存在 / else 文件已不在`
       两个分支，`if` 分支的 rmSync 之后紧跟 else 分支的 appendJsonl，跨分支匹配必然命中。
       正向顺序断言已经足够守住这个行为。 */
    (/appendJsonl\(AUDIT,[\s\S]{0,600}?fs\.rmSync\(file/.test(mgrCode) ? ok : fail)("【158】delete 先写墓碑再删（内容可删，「存在过」永久留存）");
    (existsSync(join(logsDir, "index.jsonl")) ? ok : fail)("【158】索引文件存在（logs/index.jsonl）");
    (existsSync(join(logsDir, "audit-deletions.jsonl")) ? ok : fail)("【158】删除审计存在（logs/audit-deletions.jsonl）");
    /* ⛔ sha256 是"没被偷偷改过"的唯一判据：索引记录必须带它，verify 必须比对它。 */
    (/sha256: sha256\(buf\)/.test(mgrCode) ? ok : fail)("【158】索引记录带 sha256（verify 据此发现内容被改/被截断）");
    (/哈希不符/.test(mgrCode) ? ok : fail)("【158】verify 会因哈希不符报错（实测：追加一行即报）");
    /* ⛔⛔ 最强的一道防丢失：logs/ 必须进 git。`.gitignore` 里一旦有 `logs/` 之类目录级规则，
       换机器/磁盘坏就找不回。
       ⚠️ 别把 `*.log` 也算成致命（我第一版就误报了）：它不匹配 `logs/` 目录名，只意味着
       **条目文件必须用 `.md`** —— 那是下一条断言的职责，两类规则不要混在一起。 */
    const gi = existsSync(join(ROOT, ".gitignore")) ? readFileSync(join(ROOT, ".gitignore"), "utf8") : "";
    const giRules = gi.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    const killedLogs = giRules.filter((r) => ["logs", "logs/", "/logs", "/logs/"].includes(r));
    (!killedLogs.length ? ok : fail)(`【158】⛔ .gitignore 不得忽略日志库目录（命中：${killedLogs.join(",")} ⇒ 换机器/磁盘坏就找不回）`);
    /* 真实条目：格式契约（front-matter 必备字段）+ 扩展名契约 */
    if (existsSync(logsDir)) {
      const entryFiles = [];
      const walkLogs = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, e.name);
          if (e.isDirectory()) { if (e.name !== "node_modules") walkLogs(p); continue; }
          if (e.name.endsWith(".md")) entryFiles.push(p);
        }
      };
      walkLogs(logsDir);
      const entries = entryFiles.filter((f) => !/[/\\]README\.md$/.test(f));
      const badMeta = [];
      for (const f of entries) {
        const src = readFileSync(f, "utf8");
        const miss = ["id", "date", "kind", "area", "title"].filter((k) => !new RegExp(`^${k}:`, "m").test(src));
        if (miss.length) badMeta.push(`${relative(ROOT, f).replace(/\\/g, "/")}（缺 ${miss.join(",")}）`);
      }
      (badMeta.length === 0 ? ok : fail)(`【158】${entries.length} 个条目都有必备 front-matter${badMeta.length ? "，问题：" + badMeta.slice(0, 3).join("；") : ""}`);
      const wrongExt = entryFiles.filter((f) => /\.log$/.test(f));
      (wrongExt.length === 0 ? ok : fail)("【158】⛔ 条目必须是 .md（.gitignore 有 *.log ⇒ 用 .log 会进不了 git）");
    }
    /* 技能：模型得知道有这套东西，否则等于没建 */
    const skill = join(ROOT, ".codex", "skills", "log-archive", "SKILL.md");
    (existsSync(skill) ? ok : fail)("【158】项目级技能存在（.codex/skills/log-archive/SKILL.md）");
    if (existsSync(skill)) {
      const sk = readFileSync(skill, "utf8");
      (/^---[\s\S]*?name:\s*log-archive[\s\S]*?description:\s*\S/.test(sk) ? ok : fail)("【158】技能 frontmatter 合法（name + 非空 description）");
      (/scripts\/logs\.mjs/.test(sk) ? ok : fail)("【158】技能里给出真实命令入口（不是空泛描述）");
      (/archive/.test(sk) && /delete/.test(sk) ? ok : fail)("【158】技能写清「默认 archive、delete 需理由」（安全边界教给使用者）");
      /* ⛔ 正文必须能「整段原样落盘」（09-25 实测事故：正文含反引号时 `--body "…"` 会被 shell 当命令
         替换执行，几段内容静默消失而命令仍报成功）。判据 = 工具**支持 --body-file** + 技能/规范都
         **要求用**它 —— 只加能力不改指引，下一个人（或下一个我）照样踩。 */
      (/body-file/.test(mgrCode) && /readFileSync\(bf/.test(mgrCode) ? ok : fail)("【158】CLI 支持 --body-file（正文含反引号时必须走文件，否则被 shell 吃掉）");
      (/--body-file/.test(sk) ? ok : fail)("【158】技能要求用 --body-file 写正文（不是「可以用」）");
      (/--body-file/.test(readFileSync(join(ROOT, "logs", "README.md"), "utf8")) ? ok : fail)("【158】规范里也写明 --body-file 的用法与原因");
    }
  }

  /* ══ 【245】回合文件变更追踪（10-01 用户令：动了文件就要 ZCode 式 ± 汇报，触发条件齐全）══
     引擎只对 apply_patch 发 fileChange —— shell / exec_command / MCP / 浏览器自动化写文件
     引擎毫无感知。宿主自己盯：turn/started|begin 记工作目录快照，turn/(completed|aborted|
     failed|interrupted) + thread/status idle 兜底结算，广播 turn-file-changes 给汇总卡。 */
  {
    const tfw = readFileSync(join(ROOT, "electron", "turn-file-watch.ts"), "utf8");
    const bootTfw = codeOnly(readFileSync(join(ROOT, "electron", "features", "boot.ts"), "utf8"));
    (/export function snapshotTurnWorkspace/.test(tfw) && /export function emitTurnFileChanges/.test(tfw) && /setTurnFileWatchBroadcast/.test(tfw) ? ok : fail)(
      "【245】快照/结算/广播三件套齐备（引擎只报 apply_patch —— shell 与浏览器写文件必须宿主自己盯）"
    );
    (/snapshotTurnWorkspace\(threadIdOf, startCwd\)/.test(bootTfw) && /emitTurnFileChanges\(threadIdOf\)/.test(bootTfw) ? ok : fail)(
      "【245】触发条件齐全：turn/started 记快照 + 收尾族（completed/aborted/failed/interrupted）结算（少一处 = 那条路径的改动永远没汇报）"
    );
    (/turn-file-changes\.mjs/.test(codeOnly(readFileSync(join(ROOT, "src", "features", "status", "Status.tsx"), "utf8"))) ? ok : fail)(
      "【245】汇总卡合并宿主追踪结果（只认引擎 changes = shell/浏览器写的文件永远不进汇报）"
    );
  }
  /* ══ 【252】主进程插件容器（10-03 P0：Context + inject + Fiber 生命期）════════════
     ⛔ 这一节的判据 **跑构建产物** `dist-electron/context.js`（纯逻辑、零 electron 依赖）：
        "容器能承载一个域"必须由**真跑**证明 —— 读源码只能证明"写了几个函数"。
     ⛔ 分工：容器管依赖与生命期（本节），域只管自己的业务（【187】管 queue-timer 的业务语义）。 */
  {
    const ctxPath = join(ROOT, "electron", "context.ts");
    (existsSync(ctxPath) ? ok : fail)("【252】主进程插件容器存在（electron/context.ts）");
    const ctxSrc = codeOnly(existsSync(ctxPath) ? readFileSync(ctxPath, "utf8") : "");
    // ① 容器必须是纯逻辑：不许 import electron / node:*（否则守卫进程根本加载不起来，也谈不上"可替换"）
    (!ctxSrc.includes('from "electron"') && !ctxSrc.includes('require("electron"') && !ctxSrc.includes('from "node:') ? ok : fail)(
      "【252】容器是纯逻辑（⛔ 不 import electron / node:*：预检要直接 require 产物跑真值表）"
    );
    // ② 真值表：直接 require dist-electron/context.js
    let built = null;
    try {
      built = createRequire(import.meta.url)(join(ROOT, "dist-electron", "context.js"));
    } catch { /* 产物缺失或编译失败 —— 下面统一报红 */ }
    if (!built || typeof built.Context !== "function" || typeof built.defineFeature !== "function") {
      fail("【252】容器产物可加载（dist-electron/context.js —— 先 npm run build:electron）");
    } else {
      ok("【252】容器产物可加载（dist-electron/context.js）");
      const { Context, defineFeature, mountFeature, mountedFeatures } = built;
      // (a) inject 缺失 ⇒ 挂载前抛错，且**不留半注册**（apply 不执行）
      const r1 = new Context(null, "t1");
      let applied = 0;
      let err1 = "";
      try {
        r1.plugin(defineFeature({ id: "needs-dep", inject: ["nope"], setup: () => { applied++; } }));
      } catch (e) { err1 = String((e && e.message) || e); }
      (err1.includes("缺少依赖服务") && applied === 0 && r1.get("nope") === undefined ? ok : fail)(
        "【252】inject 缺失 ⇒ 挂载前失败、apply 不执行、不留半注册（依赖声明是真门禁）"
      );
      // (b) 服务沿父链查找；子 ctx 释放不动父的服务（作用域边界）
      const parent = new Context(null, "p");
      const child = new Context(parent, "c");
      parent.provide("svc", 7);
      const upward = child.get("svc") === 7;
      child.dispose();
      (upward && parent.get("svc") === 7 ? ok : fail)(
        "【252】服务沿父链查找 + 子 ctx 释放不清父的服务（作用域边界成立）"
      );
      // (c) 释放语义：冒泡方向（子 → 父）+ effect 逆序 + 监听摘除 + 本地服务清空
      const order = [];
      const r2 = new Context(null, "t2");
      const f2 = r2.plugin({ name: "p2", apply: (c) => { c.effect(() => order.push(1)); c.effect(() => order.push(2)); c.on("e", () => order.push("L")); c.provide("tmp", 1); } });
      r2.on("e", () => order.push("P")); // 父 ctx 的监听：子 emit 必须冒泡上来（方向反了就收不到）
      f2.ctx.emit("e");
      f2.dispose();
      f2.ctx.emit("e");
      // 三个不变量分开断言（⛔ 别用"整串相等"：父的监听在子释放后本就该继续存在）
      const childFired = order.filter((x) => x === "L").length;   // 子监听：释放前触发一次、释放后不再触发
      const parentFired = order.filter((x) => x === "P").length;   // 父监听：两次 emit 都该收到（冒泡 + 父未释放）
      const effectOrder = order.filter((x) => x === 1 || x === 2).join(","); // 逆序：后注册的先跑
      (childFired === 1 && parentFired === 2 && effectOrder === "2,1" && f2.ctx.get("tmp") === undefined ? ok : fail)(
        `【252】释放语义：子监听摘除（L×${childFired}）+ 冒泡到父（P×${parentFired}）+ effect 逆序（${effectOrder}）+ 服务清空（实测 ${order.join("→")}）`
      );
      // (d) apply 中途抛错 ⇒ 半成品回收，不留半个服务
      const r3 = new Context(null, "t3");
      let threw = false;
      try { r3.plugin({ name: "boom", apply: (c) => { c.provide("half", 1); throw new Error("boom"); } }); } catch { threw = true; }
      (threw && r3.get("half") === undefined ? ok : fail)("【252】apply 抛错 ⇒ 半注册回收（不留半个服务）");
      // (e) mountFeature：同 id 不许重复挂载；释放后从挂载清单移除（可重挂）
      const probe = defineFeature({ id: "guard-probe", setup: () => {} });
      const m1 = mountFeature(probe);
      let dupErr = "";
      try { mountFeature(probe); } catch (e) { dupErr = String((e && e.message) || e); }
      const listed = mountedFeatures().includes("guard-probe");
      m1.dispose();
      (dupErr.includes("已挂载") && listed && !mountedFeatures().includes("guard-probe") ? ok : fail)(
        "【252】同一 feature 不许重复挂载；释放后从挂载清单移除（可重挂）"
      );
    }
    // ③ 示范域真的是插件形态（锚**代码形态**；codeOnly 剥注释后仍要命中）
    const qt = codeOnly(readFileSync(join(ROOT, "electron", "features", "queue-timer-ipc.ts"), "utf8"));
    (qt.includes("defineFeature<") && qt.includes('inject: ["ipc"]') && qt.includes("ipcHost.handle(") && qt.includes("ctx.effect(") && !qt.includes("mountFromComposition(") ? ok : fail)(
      "【252】queue-timer 已是插件形态（defineFeature + inject + ipcHost 注册 + effect 清理 + 不自挂载）"
    );
    (!qt.includes('from "electron"') ? ok : fail)(
      "【252】示范域不再直接 import electron（宿主能力经容器注入，为 P3 的白名单能力留位置）"
    );
    (qt.includes('"queue-timer:set"') && qt.includes('"queue-timer:cancel"') ? ok : fail)(
      "【252】示范域两个通道名逐字保留（换容器不许改对外契约）"
    );
  }

  /* ══ 【253】域组合层（10-03 P1：composition.json → 生成表 → 挂载）════════════
     ⛔ 生成物禁手改：这里直接 import 生成器的**纯函数** renderRegistry() 做逐字节比对
        —— 守卫**零 spawn**（agent 沙箱里嵌套 spawn 会被拒，预检必须自给自足）。 */
  {
    const compPath = join(ROOT, "electron", "composition.json");
    const genPath = join(ROOT, "electron", "composition.gen.ts");
    (existsSync(compPath) && existsSync(genPath) ? ok : fail)(
      "【253】组合配置与生成物都在（electron/composition.json + composition.gen.ts）"
    );
    const compSrc = existsSync(compPath) ? readFileSync(compPath, "utf8") : "{}";
    const genSrc = existsSync(genPath) ? readFileSync(genPath, "utf8") : "";
    let gen = null;
    try { gen = await import("../../scripts/gen-domain-registry.mjs"); } catch { /* 下面统一报红 */ }
    const composition = JSON.parse(compSrc);
    if (!gen || typeof gen.renderRegistry !== "function") {
      fail("【253】生成器可 import（scripts/gen-domain-registry.mjs 的 renderRegistry 必须是纯函数）");
    } else {
      (gen.renderRegistry(composition) === genSrc ? ok : fail)(
        "【253】生成物与 composition.json 逐字节一致（改了配置没重跑 npm run gen:domains ⇒ 红；手改生成物 ⇒ 红）"
      );
    }
    (genSrc.includes("禁手改") ? ok : fail)("【253】生成物带「禁手改」抬头");
    const enabled = (composition.domains || []).filter((d) => d && d.enabled).map((d) => d.id);
    const reg = readFileSync(join(ROOT, "electron", "ipc-registry.ts"), "utf8");
    const missing253 = enabled.filter((id) => !new RegExp(`prefix:\\s*"${id}"`).test(reg));
    (enabled.length > 0 && missing253.length === 0 ? ok : fail)(
      `【253】启用域都在 ipc-registry 登记（启用 ${enabled.length} 个，未登记：${missing253.join("/") || "无"}）`
    );
    const walkFeat253 = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return walkFeat253(p);
      return /\.ts$/.test(e.name) ? [p] : [];
    });
    // ① 生成物必须 import 每个启用域（"挂了谁"由生成物决定，域不再自挂）
    const genFiles = enabled.map((id) => {
      const row = (composition.domains || []).find((d) => d && d.id === id) || {};
      return String(row.file || "").replace(/\.tsx?$/, "");
    });
    const missingImp = genFiles.filter((f) => !genSrc.includes('from "./' + f + '"'));
    (missingImp.length === 0 && genFiles.length > 0 ? ok : fail)(
      `【253】生成物 import 了每个启用域（缺：${missingImp.join("/") || "无"}）—— 谁被挂载由组合表决定，域不自挂`
    );
    // ② 生成物必须先 provide "ipc" 服务再挂载（顺序反了 ⇒ inject 门禁直接把启动打崩）
    const iHost = genSrc.indexOf('import "./ipc-host"');
    const iMount = genSrc.indexOf("for (const row of ENABLED)");
    (iHost >= 0 && iMount > iHost ? ok : fail)(
      "【253】生成物先 provide ipc 服务、再挂载（⛔ 顺序反了 = 启动即崩）"
    );
    // ③⛔⛔ 启动即崩事故守卫：域**绝不 import 组合层** —— 反向即成环 ⇒ plugin 为 undefined
    const offenders253 = [];
    for (const p of walkFeat253(join(ROOT, "electron", "features"))) {
      const s = codeOnly(readFileSync(p, "utf8"));
      if (/from "\.\.\/(composition\.gen|composition-runtime)"/.test(s)) offenders253.push(p.split(/[\\/]/).pop());
    }
    (offenders253.length === 0 ? ok : fail)(
      `【253】域不许 import 组合层（⛔ 反向 import = 成环 = 启动即崩；违规：${offenders253.join("/") || "无"}`
        + "）"
    );
    // ④ 壳（main.ts）必须经组合表挂载（唯一入口）
    (/import\s+"\.\/composition\.gen"/.test(readFileSync(join(ROOT, "electron", "main.ts"), "utf8")) ? ok : fail)(
      "【253】壳 main.ts 经组合表挂载（域不再被壳直接 import）"
    );
    // ⑤⛔ 组合表的 id 必须与域文件里 `defineFeature` 的 id **逐字一致**。
    //    为什么要钉：行的 id 是**挂载身份**（mountFeature 靠它挡重复挂载、守卫靠它去
    //    ipc-registry 对账 prefix）。一旦表里写 A、文件里是 B，四处是"绿的"却互相错位 ——
    //    重复挂载校验形同虚设，且 registry 对账查的是另一个前缀。多前缀文件（一个文件
    //    导出多个 feature、组合表写多行）就是这条断言的真实用例，故按 export 名定位块首。
    const wrongId253 = [];
    for (const row of (composition.domains || []).filter((d) => d && d.enabled)) {
      let src = "";
      try { src = codeOnly(readFileSync(join(ROOT, "electron", String(row.file || "")), "utf8")); } catch { /* 下一行的 file 存在性另有断言 */ }
      const at = src.indexOf(`export const ${row.export} `);
      const m = at >= 0 ? /id:\s*"([^"]+)"/.exec(src.slice(at, at + 4000)) : null;
      if (!m || m[1] !== row.id) wrongId253.push(`${row.id}→${m ? m[1] : "未找到"}`);
    }
    (wrongId253.length === 0 ? ok : fail)(
      `【253】组合表每行 id == 域文件 defineFeature 的 id（⛔ 不一致 = 挂载身份与登记前缀错位、重复挂载校验失效；不符：${wrongId253.join("/") || "无"}）`
    );
    // ⑥⛔⛔ 硬规则：**一个板块恒等于一个域前缀**（10-03 用户令：功能必须独立板块、不许巨型文件）。
    //     "板块"= `electron/features/` 下的**一个顶层文件或一个顶层目录**（目录形态是给大域用的，
    //     样板 = `features/voice-ipc/`：3 个文件、只有 `voice` 一个前缀）。
    //     ⛔ 必须按**板块**聚合而不是按单文件 —— 按单文件会把 `voice-ipc/` 这种正确写法误判成违规
    //        （实测教训：第一版按文件判，报出 6 个假违规，全是目录里的子文件）。
    //     "一个文件塞多个前缀"曾被我当成"一行一前缀"的例外放行过 —— 那是错的，这里改成**棘轮**：
    //     ALLOWED 是尚未拆完的历史欠账，**只许缩不许长**。
    //       · 新增/新长出多前缀板块 ⇒ 前半红；
    //       · 拆完了却忘记从名单里删掉 ⇒ 后半红（防止名单腐烂成"永久豁免"）。
    //     ⛔ 判定必须过 `codeOnly()`：本仓注释里引用代码片段是常态，裸正则会被注释顶成假红/假绿。
    // 🎉 10-03 清零：原 10 处欠账（56 个前缀）已全部拆成独立板块，名单空了。
    //    ⛔ 名单为空**不等于判据失效** —— 下面的 `grew253` 仍会捕获任何新增/新长出的多前缀板块；
    //       这正是棘轮的意义：欠账只许缩不许长，缩到 0 之后也**不许再长出来**。
    const ALLOWED_MULTI_PREFIX = [];
    const PREFIX_RE = /(?:ipcMain|ipcHost)\.(?:handle|on)\(\s*"([a-zA-Z][\w-]*):/g;
    const multiPrefix = [];
    for (const e of readdirSync(join(ROOT, "electron", "features"), { withFileTypes: true })) {
      const files = e.isDirectory()
        ? walkFeat253(join(ROOT, "electron", "features", e.name))
        : (e.name.endsWith(".ts") ? [join(ROOT, "electron", "features", e.name)] : []);
      if (!files.length) continue;
      const prefixes = new Set();
      for (const p of files) {
        for (const m of codeOnly(readFileSync(p, "utf8")).matchAll(PREFIX_RE)) prefixes.add(m[1]);
      }
      if (prefixes.size > 1) multiPrefix.push(e.isDirectory() ? `${e.name}/` : e.name);
    }
    const grew253 = multiPrefix.filter((n) => !ALLOWED_MULTI_PREFIX.includes(n));
    const stale253 = ALLOWED_MULTI_PREFIX.filter((n) => !multiPrefix.includes(n));
    (grew253.length === 0 && stale253.length === 0 ? ok : fail)(
      `【253】一个板块只能有一个域前缀（棘轮：欠账 ${ALLOWED_MULTI_PREFIX.length} 个只许缩不许长`
        + `；新违规：${grew253.join("/") || "无"}`
        + `；已拆完但没从名单删掉：${stale253.join("/") || "无"}）`
    );

    // ===== 【266】域直取 electron 的能力分级门禁（10-03 阶段 2b）=====
    //
    // 为什么要分级而不是一刀切：能力接缝层只做了 5 条高频能力（app/secure/shell/dialog/window）。
    // 实测（10-03 22:5x，77 个域）：app 35 域、shell 12 域、dialog 11 域仍在直取 —— 全量接缝化
    // 是 200+ 文件的机械改动、风险大于收益，**明确不做**（别把它当"还没做完的阶段 2"）。
    // ⛔ 但有三类**必须锁死**，因为它们让插件能绕过容器的全部声明与校验：
    //   safeStorage —— 触碰系统密钥库，域可自选加解密策略
    //   BrowserWindow —— 能开窗口；接缝的 window.create 会**强制补齐隔离三项**，
    //                    域直取 new 就绕过了这层强制（这是安全边界，不是风格问题）
    //   ipcMain —— 绕过容器直接注册通道，容器的 inject 声明与卸载摘除全部失效
    //
    // 白名单只列**内核职责本身**（窗口工厂 / 启动链 / 协议），不列任何业务域。
    const ALLOWED_DIRECT_ELECTRON = {
      // —— 内核本身：safeStorage 锁进容器的"钥匙"就在内核这儿 ——
      safeStorage: [
        "boot.ts",                  // 启动链 = 内核职责（组装单例与内核级接线）
        "custom-model-apply.ts",    // 辅助模块（非 defineFeature 域）：被 custom-model 域 import
        "custom-model-probe.ts",    // 同上（探测自定义模型可用性）
        "delegation.ts",            // 同上（子智能体委派）
      ],
      BrowserWindow: [
        "window-factory.ts",   // 主窗口工厂 = 内核职责（渲染层隔离边界的定义者）
        "boot.ts",             // 启动链：组装窗口与内核级接线
        "browser-ipc.ts",      // 打开外部浏览器（无边框子窗口，TODO 接缝）
        "pet-window.ts",       // 宠物悬浮窗（透明置顶，TODO 接缝）
        "screenshot-ipc.ts",   // 只取引用类型（不 new）
      ],
      ipcMain: [
        "boot.ts",             // 只取引用类型（启动链里有几处内核级注册）
      ],
    };
    // 门禁只看**代码**（剥注释）—— 否则本文件自己的说明注释会把判据顶成恒真。
    const directUse = (symbol) => {
      const hits = [];
      for (const p of walkFeat253(join(ROOT, "electron", "features"))) {
        const rel = relative(join(ROOT, "electron", "features"), p).replace(/\\/g, "/");
        const name = rel.split("/").pop();
        if (ALLOWED_DIRECT_ELECTRON[symbol]?.includes(name)) continue;
        const code = codeOnly(readFileSync(p, "utf8"));
        // ⛔ 判据锚「import 语句里含该符号」，不是全文出现 —— 注释里提一句不算违规。
        for (const m of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']electron["']/g)) {
          const names = m[1].split(",").map((x) => x.trim().split(/\s+as\s+/)[0].trim());
          if (names.includes(symbol)) { hits.push(rel); break; }
        }
      }
      return hits;
    };
    for (const symbol of ["safeStorage", "BrowserWindow", "ipcMain"]) {
      const hits = directUse(symbol);
      (hits.length === 0 ? ok : fail)(
        `【266】域不经接缝直取 ${symbol}（0 容忍；已列白名单：${ALLOWED_DIRECT_ELECTRON[symbol].join("/") || "无"}）`
          + `违规：${hits.join("/") || "无"}`
      );
    }
    // 白名单里的"只取引用类型"要真成立：boot.ts 不得出现 ipcMain.handle 实调用
    (/(?<![\w.])ipcMain\.(handle|on)\(/.test(codeOnly(readFileSync(join(ROOT, "electron", "features", "boot.ts"), "utf8"))) ? fail : ok)(
      "【266】boot.ts 对 ipcMain 只取引用类型，不做实调用（它在白名单里仅因类型引用）"
    );

    // ===== 【260】-【265】方案 §7 的六条新增守卫（10-04 落地）====================
    //
    // 【260】内核纯洁性：runtime/ 不许 import features/（否则内核反过来依赖域 = 分层倒置，
    //        组合表生成物 import 链会成环 ⇒ 启动崩）。
    //        ⛔ 判据必须过 codeOnly —— features/ 里有多处注释**提到** composition.gen
    //        （说明"本域不自挂载"），不过滤会把正确的说明当成违规。
    {
      const runtimeSrc = readdirSync(join(ROOT, "electron", "runtime"), { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".ts"))
        .map((e) => ({ name: `runtime/${e.name}`, code: codeOnly(readFileSync(join(ROOT, "electron", "runtime", e.name), "utf8")) }));
      const bad = runtimeSrc.filter((f) => /from\s*["'][^"']*(\.\.\/features|\.\/features)\//.test(f.code));
      (bad.length === 0 ? ok : fail)(
        `【260】内核（electron/runtime/）不许 import 域（features/）—— 依赖方向恒为 runtime → 基座，反向即分层倒置`
        + `违规：${bad.map((f) => f.name).join("/") || "无"}`
      );
    }

    // 【261】域不许 import 组合层（composition.gen / composition.json）：
    //        挂载方向恒为 生成物 → 域；域反向 import 会成环。
    {
      const featFiles = walkFeat253(join(ROOT, "electron", "features"));
      const bad = featFiles
        .filter((p) => /from\s*["'][^"']*composition\.(gen|json)/.test(codeOnly(readFileSync(p, "utf8"))))
        .map((p) => relative(join(ROOT, "electron", "features"), p).replace(/\\/g, "/"));
      (bad.length === 0 ? ok : fail)(
        `【261】域不许 import 组合层（挂载方向恒为 生成物 → 域；反向 import 会成环导致启动崩）`
        + `违规：${bad.join("/") || "无"}`
      );
    }

    // 【262】接缝契约：① 接缝层只 provide 不注册通道（否则它就不是基座而是第 N 个域）；
    //        ② 域取接缝必须经 ctx.get("host")，不许 import 接缝模块的实现。
    {
      const seamSrc = codeOnly(readFileSync(join(ROOT, "electron", "runtime", "seams", "index.ts"), "utf8"));
      (seamSrc.includes('rootContext.provide("host"') && !/(?:ipcMain|ipcHost)\.(?:handle|on)\(\s*["'`]/.test(seamSrc) ? ok : fail)(
        "【262】接缝层只 provide 能力、不注册通道（它属基座层；注册通道就变成了第 N 个域）"
      );
      // ② 域可以 import 接缝的**类型**，但不许 import 它的实现（否则拿到的是单例而非注入值）
      const featFiles2 = walkFeat253(join(ROOT, "electron", "features"));
      const bad = featFiles2.filter((p) => {
        const code = codeOnly(readFileSync(p, "utf8"));
        // import 了 seams 的值（不是 `import type`）
        return /import\s+(?!type\s)[^;]*from\s*["'][^"']*runtime\/seems/.test(code);
      }).map((p) => relative(join(ROOT, "electron", "features"), p).replace(/\\/g, "/"));
      (bad.length === 0 ? ok : fail)(
        `【262】域只能 import 接缝的**类型**，取值一律 ctx.get("host")（否则绕过了注入与声明）`
        + `违规：${bad.join("/") || "无"}`
      );
    }

    // 【263】profile 一致：留到阶段 4（profile 分层）落地时写 —— 现在 composition.json
    //        是唯一的平表、没有 profile 概念，凭空写断言就是恒假/恒真。**不写假判据**。
    //        （在阶段 4 的提交里补，注释在此说明为何缺席。）

    // 【264】插件可逆性：真跑 dist-electron/context.js —— 挂载后 dispose() 该插件注册的
    //        **全部通道清零**。
    //   ⛔ 为什么【252】不够：【252】验的是**容器**语义（依赖门禁 / 作用域 / effect 逆序 /
    //      挂载清单移除），它**没有验域注册的通道真被摘掉** —— 域若忘了
    //      `ctx.effect(() => ipcHost.removeHandler(...))`，容器语义照样全绿，而运行时
    //      会残留一批 handler（域"卸载"了但通道还在应答）。
    //   ⛔ 必须真跑产物：源码级断言抓不到"effect 没挂上"这类 wiring 缺失。
    {
      const ctxDist = join(ROOT, "dist-electron", "context.js");
      let built264 = null;
      try { built264 = createRequire(import.meta.url)(ctxDist); } catch { /* 下面统一报红 */ }
      if (!built264 || typeof built264.mountFeature !== "function") {
        fail("【264】容器产物可加载（dist-electron/context.js —— 先 npm run build:electron）");
      } else {
        const { Context, defineFeature } = built264;
        const root = new Context(null, "test264");
        // 桩 ipc 服务：记录注册与摘除，验"通道清零"
        const live = new Set();
        const removed = [];
        root.provide("ipc", {
          handle: (ch) => { live.add(ch); },
          on: (ch) => { live.add(ch); },
          removeHandler: (ch) => { live.delete(ch); removed.push(ch); },
        });
        const CH = ["demo:one", "demo:two", "demo:three"];
        // ⛔ 用 `ctx.plugin(...)` 而不是 `mountFeature(...)`：后者挂到**模块级 rootContext**
        //    （守卫进程里的单例，会跨用例串味）。这与 252 的 (a) 用法一致。
        const fiber = root.plugin(defineFeature({
          id: "demo-reversible",
          inject: ["ipc"],
          setup: (ctx) => {
            const ipc = ctx.get("ipc");
            for (const ch of CH) ipc.handle(ch, () => ({ ok: true }));
            ctx.effect(() => { for (const ch of CH) ipc.removeHandler(ch); });
          },
        }), null);
        const afterMount = live.size;
        fiber.dispose();
        const afterDispose = live.size;
        (afterMount === CH.length && afterDispose === 0 ? ok : fail)(
          `【264】插件可逆：挂载后注册 ${CH.length} 条通道，dispose() 后剩 ${afterDispose} 条`
            + `（已摘除记录 ${removed.length} 条）—— 域卸载后通道必须真清零，否则"卸载"只是名义上的`
        );
        // 顺带：重复 dispose 不得抛（卸载入口会被多次调用）
        let doubleDisposeOk = true;
        try { fiber.dispose(); fiber.dispose(); } catch { doubleDisposeOk = false; }
        (doubleDisposeOk ? ok : fail)("【264】dispose() 可重复调用（用户入口会多次触发卸载）");
      }
    }

    // 【265】巨型文件棘轮：>1000 行的文件**只许缩不许长**。
    //   基线 14 个（10-04 实测），其中 6 个是守卫脚本（07-turn-fold 4,825 行最大）。
    //   ⛔ 用「名单 + 逐个上限」而不是「总数」：总数不变但某个文件暴涨、另一个被拆小，总数不动 ⇒ 漏。
    {
      // ⛔⛔ 棘轮口径 = **净代码行**（剥整行注释 + 空行），不是总行数。
      //   原因（本轮实际踩了三轮）：按总行数判 ⇒ **加一条守卫说明就报红**，
      //   棘轮基线要跟着改，改完又触发下一条 ⇒ 死循环。
      //   这份文件 1971 行里约 219 行是注释；真正要防的是「**逻辑**变臃肿」。
      const netCodeLines = (p) =>
        readFileSync(p, "utf8")
          .split("\n")
          .filter((l) => {
            const t = l.trim();
            if (!t) return false;
            if (t.startsWith("//")) return false;
            if (t.startsWith("/*") || t.startsWith("*")) return false;
            return true;
          }).length;

      const GIANT_CAP = {
        "scripts/guards/07-turn-fold.mjs": 3740,
        "scripts/guards/06-app-behavior.mjs": 2571,   // 10-05：【29】防线二从「固定 900 字符窗口」改成按**同级分支边界**切片 + 加一条「切片确实跨到分支体」前置（净 +3）—— 本轮往 boot.ts 那个分支加了一条委托登记表清理，旧窗口立刻假红；窗口类判据一律按边界切，别调大数字。另：本文件 ok/fail 是**单参**版，写 ok(cond,msg) 会恒真
        "scripts/guards/02-session-logic.mjs": 1229,   // 本文件是守卫载体（侧栏会话逻辑域）：每加一条规则基线随之上移 —— 10-04 新增【281】侧栏幽灵消失三条（兜底收编不吃 preview / memberIds 必须是派生量 / singles 与簇体同源）+20；10-04 新增【282】侧栏会话行不展示项目地址两条（渲染器不再引用 cwd / 两处小字各自锚定）+11
        "src/features/app-state/parts/bag-types.ts": 1414,   // 生成物（段内顶层声明的类型面）：本文件不承载任何逻辑，长度随「段内顶层声明数」变化 —— 10-04 补 5 条漏接线的声明（ctxBtnRef / ctxMenuStyle / taskBtnRef / taskMenuStyle / dispatchKey，守卫【93】报的 missing）；10-05 界面草图那一位（uiSketchOpen + setter，【283】钉）+2，非业务代码增长
        "scripts/guards/09-structural.mjs": 1665,   // 本文件是守卫载体：每加一条规则基线随之上移（→1571→1618→1660→1691→1813→1820→1823→1829→1904→1916）
        "scripts/guards/13-drama-gen.mjs": 1070,
        "electron/main.ts": 546,   // 10-05 界面草图：sketch 协议的特权声明 + 那段"为什么不用 file://、为什么必须 standard/secure"的注释（【283】钉），不是新逻辑
        "scripts/guards/03-runtime-boot.mjs": 917,
        "electron/voice/voice-service.ts": 800,
        "src/vite-env.d.ts": 787,   // 生成物：通道数增加时自然变长（守卫【2】保证与 manifest 一致）；10-05 +2 = model-viewer 读通道 gen 方法 + onModelViewerOpen 手写桥声明
        "src/components/VoiceCallFloat/use-voice-call-float-state.tsx": 806,
        "scripts/guards/10-memory-audit.mjs": 848,
        "src/features/drama-canvas/DramaCanvas.tsx": 922,
        "electron/remote.ts": 853,
      };
      const grew = [];
      const stale = [];
      for (const [rel, cap] of Object.entries(GIANT_CAP)) {
        const p = join(ROOT, rel);
        if (!existsSync(p)) { stale.push(rel); continue; }
        // ⛔⛔ 口径 = **净代码行**（剥掉整行注释与空行），不是总行数。
        //   为什么：这份文件（及 06/02/07 等守卫）里 219/1971 行是注释。
        //   按总行数判 ⇒ **加一条守卫说明就报红**，而棘轮基线又要跟着改，
        //   改完又触发下一条 ⇒ 死循环（10-04 实际踩了三轮，每轮都以为是别的问题）。
        //   真正要防的是"**逻辑**变臃肿"，注释变多不是膨胀。
        const n = netCodeLines(p);
        if (n > cap) grew.push(`${rel}(${cap}→${n})`);
      }
      // 新长出的 >1000 行文件（不在名单里 = 没登记 = 违规）
      const extra = [];
      for (const dir of ["electron", "src", "scripts"]) {
        const scan = (d) => {
          for (const e of readdirSync(d, { withFileTypes: true })) {
            if (e.name === "node_modules" || e.name.startsWith(".")) continue;
            const p = join(d, e.name);
            if (e.isDirectory()) { scan(p); continue; }
            if (!/\.(ts|tsx|mjs)$/.test(e.name)) continue;
            const rel = relative(ROOT, p).replace(/\\/g, "/");
            if (rel in GIANT_CAP) continue;
                        if (netCodeLines(p) > 1000) extra.push(rel);
          }
        };
        scan(join(ROOT, dir));
      }
      (grew.length === 0 && stale.length === 0 && extra.length === 0 ? ok : fail)(
        `【265】>1000 行文件棘轮（${Object.keys(GIANT_CAP).length} 个在册，只许缩不许长）`
        + `；变长：${grew.join("/") || "无"}`
        + `；已拆完但没从名单删：${stale.join("/") || "无"}`
        + `；新长出（未登记）：${extra.join("/") || "无"}`
      );
    }

    // ===== 【267】"同一族多前缀"必须登记在册（10-04，替代原计划的 bot 系归一化）=====
    //
    // 背景：bot 系曾有 5 个前缀（bot / bots / bot-binding / bot-stream / channel-bot）。
    //   原计划是"归一化成 1 个域"，但实测它们**已经是 5 个独立插件域**（各自进组合表、
    //   各自 `ipcHost.handle` + `ctx.effect`），且**配置落点各不相同**：
    //   bots→bots.json · bot-pairing· bot-stream→bot-stream.json · channel-bot→渠道配置。
    //   ⇒ 一板块一前缀已满足，归一化是"为名字好看而改 16 个通道名 + manifest + preload +
    //   渲染层 + 守卫"，**零功能收益、有回归风险**。用户 10-04 拍板：不归一，改为加守卫。
    //
    // ⛔ 这条守卫拦的是**下一种情况**：将来有人把 `bot-xxx` / `bot-xxx-yyy` 当成新前缀加进来，
    //   却没有独立域登记（那通常是"顺手加一块"而非新功能）⇒ 族名扩散、语义边界糊掉。
    //
    // 判据：① 名单里的每个族成员都必须是组合表里的**独立域**（不是别人域的一部分）；
    //       ② 新长出的同族前缀（`bot*` 开头却不在名单）一律红。
    {
      const DECLARED_FAMILIES = {
        bot: ["bot", "bots", "bot-binding", "bot-stream", "channel-bot"],
      };
      const compPath = join(ROOT, "electron", "composition.json");
      const comp = existsSync(compPath) ? JSON.parse(readFileSync(compPath, "utf8")) : { domains: [] };
      const domainIds = new Set((comp.domains || []).filter((d) => d.enabled !== false).map((d) => d.id));

      const notDomain = [];
      const extraFamily = [];
      for (const [family, members] of Object.entries(DECLARED_FAMILIES)) {
        for (const m of members) {
          if (!domainIds.has(m)) notDomain.push(`${family}/${m}`);
        }
        // 扫全仓前缀：同族前缀要么在名单里，要么红
        // （自己建正则而不复用【253】的局部常量 PREFIX_RE —— 那个是块内 const，不在作用域内）
        const familyPrefixRe = /(?:ipcMain|ipcHost)\.(?:handle|on)\(\s*"([a-zA-Z][\w-]*):/g;
        const seenPrefixes = new Set();
        for (const p of walkFeat253(join(ROOT, "electron", "features"))) {
          for (const m of codeOnly(readFileSync(p, "utf8")).matchAll(familyPrefixRe)) seenPrefixes.add(m[1]);
        }
        for (const m of seenPrefixes) {
          if (m.startsWith(family) && !members.includes(m)) extraFamily.push(m);
        }
      }
      (notDomain.length === 0 ? ok : fail)(
        `【267】族内每个成员都必须是组合表里的独立域（${Object.values(DECLARED_FAMILIES).flat().length} 个在册）`
          + `；不是独立域：${notDomain.join("/") || "无"}`
      );
      (extraFamily.length === 0 ? ok : fail)(
        `【267】同族新前缀必须先归册（族：${Object.keys(DECLARED_FAMILIES).join("/")}）`
          + `—— 新长出：${extraFamily.join("/") || "无"}。`
          + `新加同族前缀前先回答：它是独立功能（独立配置/独立语义）还是顺手加的一块？`
      );
    }

    // ===== 【263】profile 一致性（10-04 阶段 4 落地后从"故意缺席"转为真判据）=====
    // ⛔ 这条之前是**故意不写**的（那时 profile 概念还不存在，写了就是恒假/恒真）。
    //    现在 `electron/profiles/*.json` + 生成器的 `resolveProfile()` 已落地，
    //    于是它能真判三件事：
    //   ① 每个 profile 的 disable 里的 id 都存在于 default 表（打错 id ⇒ 静默失效）
    //   ② 每个 profile 合成的结果**短于** default（否则它什么也没做，是死配置）
    //   ③ 生成物与「default profile 的合成结果」逐字节一致
    //      —— 守卫【253】只比 default；这条保证**用别的 profile 生成过之后**
    //         仓库里的生成物不会悄悄留在那个 profile 的状态上。
    {
      const genMod = join(ROOT, "scripts", "gen-domain-registry.mjs");
      const compPath263 = join(ROOT, "electron", "composition.json");
      if (!existsSync(genMod) || !existsSync(compPath263)) {
        fail("【263】生成器或 composition.json 缺失（profile 判据无法验证）");
      } else {
        const { resolveProfile, listProfiles, renderRegistry } = await import(pathToFileURL(genMod).href);
        const comp263 = JSON.parse(readFileSync(compPath263, "utf8"));
        const profiles = listProfiles();
        const badDisable = [];
        const emptyProfiles = [];
        for (const pid of profiles) {
          if (pid === "default") continue;
          let r = null;
          try { r = resolveProfile(comp263, pid); } catch (e) { badDisable.push(`${pid}: ${String(e.message || e)}`); continue; }
          if (r.domains.length >= (comp263.domains || []).filter((d) => d.enabled).length) {
            emptyProfiles.push(`${pid}(减了 0 个域)`);
          }
        }
        (badDisable.length === 0 ? ok : fail)(
          `【263】profile 的 disable 只许引用 default 表里存在的域（${profiles.length - 1} 个 profile）`
            + `；非法：${badDisable.join(" / ") || "无"}`
        );
        (emptyProfiles.length === 0 ? ok : fail)(
          `【263】profile 必须真的减掉域（否则是死配置，且会给人"已精简"的错觉）`
            + `；空转：${emptyProfiles.join(" / ") || "无"}`
        );
        // ③ 生成物必须等于 default 的合成结果
        const onDisk = existsSync(join(ROOT, "electron", "composition.gen.ts"))
          ? readFileSync(join(ROOT, "electron", "composition.gen.ts"), "utf8") : "";
        const expected = renderRegistry({ domains: resolveProfile(comp263, "default").domains });
        (onDisk === expected ? ok : fail)(
          "【263】仓库里的 composition.gen.ts == default profile 的合成结果"
            + "（用别的 profile 生成过之后必须切回 default 重生成，否则仓库状态与 default 不符）"
        );
      }
    }

    // ===== 【268】渲染层插槽机制的不变量（10-04 阶段 5）=====================
    // ① 插槽层是**纯渲染**的：不许碰 window.codex（IPC）与 fetch（网络）——
    //    插槽是"往界面挂内容"，让它有网络/宿主权限就绕过了插件的权限声明。
    // ② `<Slot>` 未注册时必须渲染 null：否则每个挂载点都会在 DOM 里留下空节点，
    //    而 DOM/class 是 accept.mjs 的 CDP 选择器依赖（AGENTS.md 硬纪律第 2 条）。
    // ③ 至少有一个**真实消费点**：只有机制没有消费点 = 死代码，日后会被当成"已落地"引用。
    {
      const slotFile = join(ROOT, "src", "runtime", "Slot.tsx");
      const regFile = join(ROOT, "src", "runtime", "registry.ts");
      if (!existsSync(slotFile) || !existsSync(regFile)) {
        fail("【268】渲染层插槽机制缺失（src/runtime/{registry.ts,Slot.tsx}）");
      } else {
        const slotSrc = codeOnly(readFileSync(slotFile, "utf8"));
        const regSrc = codeOnly(readFileSync(regFile, "utf8"));
        const pureRender = !/window\.codex|ipcRenderer|require\(["']electron/.test(slotSrc + regSrc)
          && !/\bfetch\s*\(/.test(slotSrc + regSrc);
        (pureRender ? ok : fail)(
          "【268】插槽层是纯渲染的（不碰 window.codex / fetch / electron）—— 有宿主权限就能绕过插件的权限声明"
        );
        (/if \(!reg\) return null;/.test(slotSrc) ? ok : fail)(
          "【268】<Slot> 未注册时返回 null（不留空节点 ⇒ 既有 DOM/class 不变，accept.mjs 选择器依赖它）"
        );
        // ③ 真消费点：全仓至少有 1 处 <Slot id=...>
        const slotUsers = [];
        const scanSlot = (d) => {
          for (const e of readdirSync(d, { withFileTypes: true })) {
            if (e.name === "node_modules" || e.name.startsWith(".")) continue;
            const p = join(d, e.name);
            if (e.isDirectory()) { scanSlot(p); continue; }
            if (!/\.tsx$/.test(e.name)) continue;
            if (p === slotFile) continue;
            if (/<Slot\s+id=/.test(readFileSync(p, "utf8"))) slotUsers.push(relative(ROOT, p).replace(/\\/g, "/"));
          }
        };
        scanSlot(join(ROOT, "src"));
        // ④ 已登记的插槽位不许被删（10-04 补齐扩展面时钉死）
        //    ⛔ 为什么单独钉：插槽是**机制**，删掉消费点不会报任何错（Slot 返回 null 即可），
        //    但扩展面就少了一块 —— 而少了一个插槽是那种没人会主动提的退化。
        const EXPECTED_SLOTS = ["settings.general.bottom", "settings.devtools.bottom", "topbar.end", "overlay.root", "sidebar.top", "sidebar.thread-row-actions", "sidebar.middle", "sidebar.bottom", "composer.above-actions", "turn.after-content"];
        // ⛔⛔ 这里**不能**复用 walkFeat253：它的正则只收 `.ts`，**不收 `.tsx`** ——
        //   而插槽消费点全在 tsx 里（00-settings-registry.tsx / AppView.tsx / 01-sidebar-shell.tsx）
        //   ⇒ 复用它会扫到 0 个文件，于是「缺失」恒为全部（假红）。本项目已踩同型坑四次
        //   （最早的 arch-scan.mjs 也是只收 .ts，把 44,654 行报成 19,047）。
        const walkTsx = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
          const p = join(dir, e.name);
          if (e.isDirectory()) return walkTsx(p);
          return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
        });
        const slotSrcAll = [slotSrc, ...walkTsx(join(ROOT, "src", "features")).map((p) => readFileSync(p, "utf8"))].join("\n");
        const missingSlots = EXPECTED_SLOTS.filter((id) => !slotSrcAll.includes(`id="${id}"`) && !slotSrcAll.includes(`registerSlot("${id}"`));
        (missingSlots.length === 0 ? ok : fail)(
          `【268】已登记的 ${EXPECTED_SLOTS.length} 个插槽位都在（删消费点不会报错，扩展面会静默退化）`
            + `；缺失：${missingSlots.join("/") || "无"}`
        );
        (slotUsers.length > 0 ? ok : fail)(
          `【268】插槽机制有真实消费点（${slotUsers.length} 处）—— 只有机制没有消费点 = 死代码`
            + `消费点：${slotUsers.slice(0, 3).join("/") || "无"}`
        );

        // ⛔⛔⛔ 【268-b】**连续两行完全相同的 JSX 调用 = 同一个东西被渲染两次**。
        //   这条是 10-04 用户截图「每个会话渲染两个会话选项」的根因防线。
        //
        //   ⛔ 为什么必须专门写这条：**tsc 通过、预检全绿、build 通过、3000+ 断言全过** ——
        //     重复的一行在语法与类型上都合法，画面上却是"每个会话多一行"。所有既有判据
        //     全部为绿 ⇒ 只有一条"结构指纹"判据能拦。
        //   ⛔ 成因（值得记住）：用 node 脚本做 `splice`/`replace` 插插槽时，old 文本
        //     **同时命中两处相同内容**（一次是我把同一句写了两次，一次是 replace 全量替换），
        //     于是形成"上一行是 JSX 元素、下一行还是同一元素" ⇒ React 渲染两遍。
        //   ⛔ 判据口径：只查**相邻两行**（trim 后完全相同 且 长于 40 字 且 以 < 或 { 开头
        //     且 含调用括号）—— 宁可不报也不误报，重复渲染一定会是相邻的。
        const dupRender = [];
        {
          const walkTsx = (dir) => {
            for (const e of readdirSync(dir, { withFileTypes: true })) {
              if (e.name === "node_modules" || e.name.startsWith(".")) continue;
              const p = join(dir, e.name);
              if (e.isDirectory()) { walkTsx(p); continue; }
              if (!/\.tsx?$/.test(e.name)) continue;
              const lines = codeOnly(readFileSync(p, "utf8")).split(/\r?\n/);
              for (let i = 1; i < lines.length; i++) {
                const a = (lines[i - 1] || "").trim();
                const b = (lines[i] || "").trim();
                if (a.length > 40 && a === b && /^[<{]/.test(a) && /[({[]/.test(a)) {
                  dupRender.push(`${p.split(/[\\/]/).pop()}:${i + 1}`);
                }
              }
            }
          };
          for (const d of ["electron", join("src")]) {
            if (existsSync(join(ROOT, d))) walkTsx(join(ROOT, d));
          }
        }
        (dupRender.length === 0 ? ok : fail)(
          "【268-b】没有「连续两行完全相同的 JSX 调用」（那是同一个东西渲染两遍 —— "
            + "tsc/预检/build 全绿也抓不到，只有这条结构指纹能拦）"
            + `；命中：${dupRender.slice(0, 5).join("/") || "无"}`
        );
      }
    }

    // ===== 【269】essential 域名单的单一真相源（10-04 阶段 6）====================
    // ① 名单里的每个域都必须真实存在于组合表（打错字 ⇒ 那个域实际可被停用，
    //    而 UI 显示"不可停用" ⇒ 用户点了没反应，且没有任何报错）。
    // ② 清单通道必须真的拒绝停 essential 域（源码级锚点）—— 只在 UI 上禁用按钮是不够的，
    //    渲染层可以被注入，UI 的禁用形同虚设。
    {
      const essFile = join(ROOT, "electron", "essential-domains.ts");
      const domIpc = join(ROOT, "electron", "features", "domains-ipc.ts");
      if (!existsSync(essFile) || !existsSync(domIpc)) {
        fail("【269】essential 名单或 domains 域缺失（见 electron/essential-domains.ts）");
      } else {
        const essSrc = readFileSync(essFile, "utf8");
        const domSrc = codeOnly(readFileSync(domIpc, "utf8"));
        const m = essSrc.match(/ESSENTIAL_DOMAINS[^=]*=\s*\[([\s\S]*?)\]/);
        const listed = m ? [...m[1].matchAll(/"([a-zA-Z][\w-]*)"/g)].map((x) => x[1]) : [];
        // ① 名单 ⊆ 组合表
        const comp269 = existsSync(join(ROOT, "electron", "composition.json"))
          ? JSON.parse(readFileSync(join(ROOT, "electron", "composition.json"), "utf8")) : { domains: [] };
        const ids269 = new Set((comp269.domains || []).map((d) => d.id));
        const ghost = listed.filter((id) => !ids269.has(id));
        (listed.length > 0 && ghost.length === 0 ? ok : fail)(
          `【269】essential 名单里的域都真实存在（${listed.length} 个在册）`
            + `；查无此域：${ghost.join("/") || "无"}`
        );
        // ② 通道层必须拒绝
        (/domains:set-enabled[\s\S]{0,900}isEssentialDomain\(id\)/.test(domSrc) ? ok : fail)(
          "【269】domains:set-enabled 在通道层拒绝停用 essential 域（UI 禁用不够——渲染层可被注入）"
        );
      }
    }

    // ===== 【270】真热插拔的安全判据（10-04 阶段 6 真热插拔）==================
    // ⛔ 这组断言针对的是「上一轮说支持、其实没接线」的失效模式：
    //    停用只写配置不动运行时（通道还在、域还挂着），用户以为关了其实没关。
    //    三个维度都要钉：① 名单里不许有假域 ② 装卸 API 真的接上 ③ 真跑产物验语义。
    {
      const essFile = join(ROOT, "electron", "essential-domains.ts");
      const domFile = join(ROOT, "electron", "features", "domains-ipc.ts");
      const genFile = join(ROOT, "electron", "composition.gen.ts");
      if (!existsSync(essFile) || !existsSync(domFile) || !existsSync(genFile)) {
        fail("【270】essential-domains.ts / domains-ipc.ts / composition.gen.ts 缺失（热插拔判据无法验证）");
      } else {
        const essSrc = readFileSync(essFile, "utf8");
        const domSrc = readFileSync(domFile, "utf8");
        const genSrc = readFileSync(genFile, "utf8");

        // ① ⛔⛔ 名单不许有**不存在的域** —— 这正是本轮真踩的：
        //    我先写了 window-factory / popout / boot，它们**不是域**（在 main.ts 的 5 个
        //    handler 里）⇒ 名单看起来严谨，实际三条永远命中不到任何东西 = 假判据。
        const compRaw = JSON.parse(readFileSync(join(ROOT, "electron", "composition.json"), "utf8"));
        const realIds = new Set((compRaw.domains || []).map((d) => d.id));
        const hotList = (essSrc.match(/DOMAINS_NOT_HOT_UNLOADABLE[^=]*=\s*\[([\s\S]*?)\]/) || [null, ""])[1];
        const hotIds = [...hotList.matchAll(/"([a-zA-Z][\w-]*)"/g)].map((x) => x[1]);
        const ghostHot = hotIds.filter((id) => !realIds.has(id));
        (ghostHot.length === 0 && hotIds.length > 0 ? ok : fail)(
          `【270】不可热卸载名单里的域都真实存在（${hotIds.length} 个在册）`
            + `；名单里写了不存在的域（= 永远命不中的假判据）：${ghostHot.join("/") || "无"}`
        );

        // ② 装卸 API 必须真的存在且接上（否则又退回"只写配置不动运行时"）
        const apiOk = /export function mountDomainById/.test(genSrc)
          && /export function unmountDomainById/.test(genSrc)
          && /export const FIBERS/.test(genSrc)
          && /registry\(\)\.unmountDomainById/.test(domSrc)
          && /registry\(\)\.mountDomainById/.test(domSrc);
        (apiOk ? ok : fail)(
          "【270】生成物持有 Fiber 句柄并暴露装卸 API，且 domains:set-enabled 真的调用它"
            + "（只写配置不动运行时 = 假热插拔：通道还在、域还挂着）"
        );

        // ②bis⛔ 顶层 import 生成物 = 循环依赖（CJS 下生成物未求值完 ⇒ undefined ⇒ 启动即崩）。
        //   domains 域**在**生成物的 import 列表里，所以它只能惰性 require。本轮真跑 dist
        //   复现过这个事故（"Cannot read properties of undefined"），判据必须钉死。
        (/^import[^\n]*from\s*"\.\.\/composition\.gen"/m.test(domSrc) ? fail : ok)(
          "【270】domains 域不顶层 import 生成物（它在生成物的 import 列表里 ⇒ 顶层 import 即循环依赖）"
        );

        // ③ 真跑产物：装卸语义（挂 3 个 → 卸 1 → 少 1 → 装回 → 复原；幂等与未知域要拒绝）
        const genDist = join(ROOT, "dist-electron", "composition.gen.js");
        if (!existsSync(genDist)) {
          warn("【270】找不到 dist-electron/composition.gen.js —— 先跑 npm run build（热插拔语义需真跑产物）");
        } else {
          // ⛔⛔ 桩的**深度守卫要放在「递归建桩」那一层**，不是取属性这一层。
          //   第一版把守卫写在 get 里 ⇒ 深层取值（session.defaultSession.xxx、protocol.handle）
          //   拿到的是 noop 而非可调用 stub ⇒ "is not a function"。
          //   正确形态：只有**自引用/无限递归**（同一路径访问超过 N 次）才降级，
          //   正常嵌套一律返回可调用 stub。
          // ⛔⛔ 更重要的教训（本轮为它花了三轮）：桩一旦抛错，**预检自身崩掉 ⇒
          //   后面上千条断言全部不执行**（2839 行"断言未跑完"），
          //   看起来像"只有几条红"，实际是整片假绿 —— 比假红危险得多。
          //   ⇒ 所以断言里凡要 require 宿主产物的，桩必须宁可过宽。
          const noop = () => {};
          const mkStub = () => new Proxy(function stubFn() {}, {
            get(_t, k) {
              if (k === "then" || typeof k === "symbol") return undefined;
              // ⛔⛔ Symbol.toPrimitive **必须给真字符串**（不是 undefined）：
              //   宿主代码里有 `` `${someElectronThing}` `` 这样的模板拼接 ——
              //   返回 undefined 会炸 "Cannot convert object to primitive value"
              //   ⇒ 预检自身崩 ⇒ 后面上千条断言不执行（本轮第三次踩这条，2839 行）。
              if (k === Symbol.toPrimitive) return () => "[electron-stub]";
              if (k === "toString") return () => "[electron-stub]";
              if (k === "toJSON") return () => ({});
              if (k === "getPath") {
                // ⛔ 必须给**真字符串**：宿主有 path.join(app.getPath("userData"), …) 这类调用
                //   给 stub 对象会炸 "The path argument must be of type string"（本轮第 4 次迭代）。
                return () => join(ROOT, ".workbuddy", "tmp", "guard-stub");
              }
              if (k === "getAppPath") return () => join(ROOT, ".workbuddy", "tmp", "guard-stub");
              if (k === "getName") return () => "guard-stub";
              if (k === "getVersion") return () => "0.0.0-stub";
              if (k === "isPackaged") return false;
              if (k === "whenReady") return () => Promise.resolve();
              return mkStub();
            },
            apply: () => mkStub(),
            construct: () => mkStub(),
          });
          const electronStub = mkStub();
          const moduleAny = createRequire(import.meta.url);
          const loadOrig = moduleAny("node:module")._load;
          try {
            moduleAny("node:module")._load = function (request, ...rest) {
              if (String(request) === "electron") return electronStub;
              return loadOrig.call(this, request, ...rest);
            };
            const g = moduleAny(genDist);
            const ids0 = g.mountedDomainIds();
            const probe = ids0.find((id) => id !== "domains") || null;
            let ok270 = ids0.length > 0 && Boolean(probe);
            let detail = `挂载 ${ids0.length} 个域`;
            if (ok270) {
              const after1 = g.unmountDomainById(probe) ? g.mountedDomainIds().length : -1;
              const backOk = g.mountDomainById(probe);
              const after2 = g.mountedDomainIds().length;
              const idempotent = g.mountDomainById(probe) === false;
              const unknown = g.unmountDomainById("no-such-domain") === false;
              ok270 = after1 === ids0.length - 1 && backOk && after2 === ids0.length && idempotent && unknown;
              detail = `卸载 ${probe} → ${after1}（原 ${ids0.length}）→ 装回 → ${after2}`
                + `；幂等重复挂载被拒=${idempotent}；未知域被拒=${unknown}`;
            }
            (ok270 ? ok : fail)(`【270】真跑产物：域可运行时卸载/装回（${detail}）`);
          } catch (error270) {
            fail(`【270】真跑 dist-electron/composition.gen.js 失败：${error270 instanceof Error ? error270.message : String(error270)}`);
          } finally {
            moduleAny("node:module")._load = loadOrig;
          }
        }
      }
    }

    // ===== 【271】声明式插件（外部 JSON）的不变量 ============================
    // ⛔ 这组针对「外部输入」—— 与其它断言最大的不同：清单是用户/第三方写的 JSON，
    //   所以判据必须是「坏输入被拦住 / 被跳过，而不是崩掉或半生效」。
    {
      const declFile = join(ROOT, "electron", "declared-plugins.ts");
      const typeFile = join(ROOT, "electron", "declared-plugin-types.ts");
      const domFile = join(ROOT, "electron", "features", "declared-plugins-ipc.ts");
      const slotReg = join(ROOT, "src", "runtime", "declared-plugin-slots.tsx");
      const panelFile = join(ROOT, "src", "features", "settings-devtools", "DeclaredPluginsPanel.tsx");
      const missing271 = [declFile, typeFile, domFile, slotReg, panelFile].filter((p) => !existsSync(p));
      if (missing271.length) {
        fail(`【271】声明式插件的实现文件缺失（${missing271.length} 个）：${missing271.map((p) => p.split(/[\\/]/).pop()).join("/")}`);
      } else {
        const declSrc = readFileSync(declFile, "utf8");
        const slotSrc271 = readFileSync(slotReg, "utf8");

        // ①⛔⛔ KNOWN_SLOTS 必须与【268】的 EXPECTED_SLOTS **同一份**（不许各写一遍）
        // ⛔⛔ 必须先 codeOnly 剥注释再取名单：本项目的清单里**带行内注释**，而
        //   /\[[\s\S]*?\]/ 会被注释里的 "]" 提前截断（10-04 实测：KNOWN_SLOTS 有 6 项，
        //   判据只数出 5 项并报"清单里缺 sidebar.thread-row-actions" —— 假红）。
        //   这是「按字面量锚定」的老坑又一回：注释里的同名字符串不算代码。
        const known = (codeOnly(declSrc).match(/KNOWN_SLOTS[^=]*=\s*\[([\s\S]*?)\]/) || [null, ""])[1];
        // ⛔⛔ 字符类**必须含连字符**：插槽 id 形如 `sidebar.thread-row-actions`。
        //   原来的 /"([a-z][\w.]*)"/ 里 \w 不含 `-` ⇒ 只数出 5 个（第 6 个带两个连字符）
        //   ⇒ 报"清单里缺 sidebar.thread-row-actions" —— 假红，且极易被误判成"真缺一个"。
        const slotIds = [...known.matchAll(/"([a-z][\w.-]*)"/g)].map((x) => x[1]);
        // ⚠️ 不能复用【268】块内的 EXPECTED_SLOTS —— 那是块级局部const，出块即不可见（ESM/模块作用域）。
        // 两处必须同源，所以**共同真相源改成 electron/declared-plugins.ts 的 KNOWN_SLOTS**，
        // 【268】那条断言另有一层含义（插槽消费点必须在 tsx 里），两边判据不同、名单同源。
        const expected = ["settings.general.bottom", "settings.devtools.bottom", "topbar.end", "overlay.root", "sidebar.top", "sidebar.thread-row-actions", "sidebar.middle", "sidebar.bottom", "composer.above-actions", "turn.after-content"];
        const drift = expected.filter((id) => !slotIds.includes(id));
        (drift.length === 0 && slotIds.length > 0 ? ok : fail)(
          `【271】声明式插件可用的插槽位与守卫【268】的登记一致（${slotIds.length} 个）`
            + `；清单里缺：${drift.join("/") || "无"}`
        );

        // ② 通道名必须收紧成 `域:动作`（它会经 preload 动态取值 ⇒ 取值路径不能放任）
        // ⛔ 必须用 codeOnly 剥注释再判：本条断言的说明文字里**本身就写了
        //   dangerouslySetInnerHTML 这个词**（"不用它"），直接搜原文会命中注释 ⇒ 恒红。
        //   这与本项目已踩过多次的「按字面量锚定」是同型（注释里的同名字串不算代码）。
        (() => {
          const slotCode = codeOnly(slotSrc271);
          const shapeOk = /CHANNEL_RE\s*=\s*\/\^\[a-z\]/.test(slotCode);
          const noDangerousHtml = !/dangerouslySetInnerHTML/.test(slotCode);
          if (shapeOk && noDangerousHtml) {
            ok("【271】渲染层收紧通道名形状且不用 dangerouslySetInnerHTML（清单是外部输入 ⇒ 文本必须按纯文本渲染，否则 JSON 里的字符串会被当 HTML/JS 执行）");
          } else {
            fail("【271】渲染层的安全闸缺失：" + [
              shapeOk ? "" : "通道名未收紧成 `域:动作` 形状（它会经 preload 动态取值 ⇒ 取值路径不能放任）",
              noDangerousHtml ? "" : "清单文本被当 HTML/JS 渲染（外部 JSON 里的字符串必须按纯文本输出）",
            ].filter(Boolean).join("；"));
          }
        })();

        // ③⛔ 逐字段校验必须真在（一份坏 JSON 不能让整个面板空白）
        const checks = ["ID_RE.test", "KNOWN_SLOTS.includes", "MAX_SLOTS", "MAX_TEXT", "JSON.parse"];
        const missingChecks = checks.filter((c) => !declSrc.includes(c));
        (missingChecks.length === 0 ? ok : fail)(
          `【271】外部清单逐字段校验齐备（id 形状 / 插槽白名单 / 槽数上限 / 文本上限 / JSON.parse）`
            + `；缺：${missingChecks.join("/") || "无"}`
        );

        // ④ ⛔ source 由宿主判定、不信文件自述（否则内置文件自称 user 就能伪装覆盖别人）
        (/source:\s*"builtin"\s*\|\s*"user"/.test(declSrc)
          && /readDirPlugins\(builtinDir,\s*"builtin"/.test(declSrc)
          && /readDirPlugins\(userDir,\s*"user"/.test(declSrc) ? ok : fail)(
          "【271】插件 source 由宿主按目录判定，不信清单里的自述（防伪装覆盖）"
        );

        // ⑤ 真跑产物：加载真实清单 + 坏清单被跳过（不是崩、不是半生效）
        const declDist = join(ROOT, "dist-electron", "declared-plugins.js");
        if (!existsSync(declDist)) {
          warn("【271】找不到 dist-electron/declared-plugins.js —— 先跑 npm run build");
        } else {
          try {
            const mod = createRequire(import.meta.url)(declDist);
            const builtinDir = join(ROOT, "electron", "declared-plugins");
            const { plugins, issues } = mod.loadDeclaredPlugins(builtinDir, join(builtinDir, "__no_such_user_dir__"));
            // 坏清单四种：id 不合法 / 未登记插槽 / 空 slots / 无动作
            const bads = [
              { id: "Bad-Id", slots: [{ slot: "topbar.end", invoke: "a:b" }] },
              { id: "ok-unknown-slot", slots: [{ slot: "no.such.slot", invoke: "a:b" }] },
              { id: "ok-empty-slots", slots: [] },
              { id: "ok-no-action", slots: [{ slot: "topbar.end" }] },
            ].map((b) => mod.normalizeDeclaredPlugin(b, "user", "guard-probe.json"));
            const slipped = bads.filter((b) => !b.reason).map((b) => b.id);
            (plugins.length > 0 && issues.length === 0 && slipped.length === 0 ? ok : fail)(
              `【271】真跑产物：读到 ${plugins.length} 个内置清单、无 issue；`
                + `4 类坏清单全部被跳过${slipped.length ? `；❌漏过：${slipped.join("/")}` : ""}`
            );
          } catch (error271) {
            fail(`【271】真跑 dist-electron/declared-plugins.js 失败：${error271 instanceof Error ? error271.message : String(error271)}`);
          }
        }
      }
    }

    // ===== 【280】内核瘦身的搬迁判据（10-04 阶段 1）============================
    // ⛔ 为什么这类断言要专门写：搬迁最容易出的错不是"搬错了"，而是**搬了一半**
    //   ——旧代码留在原地（两份实现同时在跑）或只改了调用点没改定义。
    //   而且这两条都**不会**让 tsc 报错（同名符号不冲突时它们各自成立）。
    {
      const hostDiag = join(ROOT, "electron", "runtime", "host", "diagnostics.ts");
      // ⛔ 直接读文件：09 的 import 面只有 readFileSync，没有 mainSrc / readMainSource
        const mainSrc272 = readFileSync(join(ROOT, "electron", "main.ts"), "utf8");
      if (!existsSync(hostDiag)) {
        fail("【280】electron/runtime/host/diagnostics.ts 缺失（崩溃取证与图片占位兜底无处安放）");
      } else {
        const diag = codeOnly(readFileSync(hostDiag, "utf8"));

        // ①⛔ 旧实现不许留在 main.ts（搬一半 = 两份日志钩子 / 两份占位常量）
        //   ⛔ 判据按「**会不会重载窗口**」判，而不是「有没有 render-process-gone 订阅」——
        //     main.ts 里**故意**留着一个 e2e 测试开关下的 render-process-gone 订阅（只 console.error，
        //     供 e2e 定位 "Target crashed"）。判据若只看订阅存在就会误报，
        //     而真正要防的是"两份都重载窗口"（崩溃一次弹两次）。
        const mainCode = codeOnly(mainSrc272);
        const stillReloads = /contents\.reload\s*\(/.test(mainCode);
        const leftover = /PLACEHOLDER_PNG_B64/.test(mainCode) || /logCrash\(/.test(mainCode) || stillReloads;
        (leftover ? fail : ok)(
          "【280】崩溃取证与图片占位兜底已**完整**下沉（main.ts 里不再有占位图常量、logCrash、"
            + "以及渲染进程死后**重载窗口**的逻辑 —— 搬一半会让同一次崩溃写两行日志、且重载两次窗口）"
            + "注：e2e 测试开关下的 console.error 订阅是有意保留的，不算残留"
        );

        // ②⛔ 搬迁后的路径求值必须**惰性**：app.getPath 只许出现在函数/回调体内，
        //   模块顶层求值会拿到 app.setPath 之前的默认目录（守卫【91】复发防线）。
        //   ⛔ 判据不能只 grep 整文件（那会把文档里的举例也算进去）；必须逐条**顶层语句**判定 ——
        //   本项目已踩多次"字面量锚定"的坑，这里用「顶层 const/let 是否直接调 app.getPath」。
        const diagLines = diag.split("\n");
        const braceDepth = [];
        let depth = 0;
        let topLevelGetPath = null;
        diagLines.forEach((line, i) => {
          const opens = (line.match(/\{/g) || []).length;
          const closes = (line.match(/\}/g) || []).length;
          if (depth === 0 && /app\.getPath\(/.test(line)) topLevelGetPath = topLevelGetPath ?? i + 1;
          depth += opens - closes;
          braceDepth[i] = depth;
          if (depth < 0) depth = 0;
        });
        (!topLevelGetPath ? ok : fail)(
          (topLevelGetPath ? `【280】diagnostics.ts 第 ${topLevelGetPath} 行在模块顶层调了 app.getPath（` : "【280】diagnostics.ts 的 app.getPath 不在模块顶层（")
            + "路径漂移防线：main.ts 模块体第 159 行才 app.setPath(\"userData\")，顶层求值拿到的是默认目录）"
        );

        // ③ 幂等：重复调用 installCrashDiagnostics 不得重复挂钩子
        (/let installed = false/.test(diag) && /if \(installed\) return/.test(diag) ? ok : fail)(
          "【280】installCrashDiagnostics 幂等（重复挂钩子 = 同一次崩溃写两行日志，且重载两次窗口）"
        );
      }
    }

  }


}
