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
  const IPC_FILE = join(ROOT, "electron", "features", "screenshot-favorites-ipc.ts");
  const OVERLAY = join(ROOT, "electron", "overlay-preload.ts");
  const APP_PART = join(ROOT, "src", "features", "app-state", "parts", "part07", "03-seg.tsx");
  const FAV_PAGE = join(ROOT, "src", "features", "settings-favorites", "FavoritesSettingsSection.tsx");
  const SHOT_PAGE = join(ROOT, "src", "features", "settings-screenshot", "ScreenshotSettingsSection.tsx");
  const REG_FILE = join(ROOT, "src", "features", "app-view", "AppView", "08-settings-sheet", "01-settings-layout", "00-settings-registry.tsx");
  const NAV_FILE = join(ROOT, "src", "features", "app-view", "helpers", "catalogs.ts");
  const TYPES_FILE = join(ROOT, "src", "features", "app-view", "types.ts");
  const HELP_FILE = join(ROOT, "src", "components", "HelpDialog.tsx");

  for (const [file, label] of [[SHOT, "screenshot.ts"], [FAV, "favorites.ts"], [IPC_FILE, "screenshot-favorites-ipc.ts"], [OVERLAY, "overlay-preload.ts"], [APP_PART, "app-state/part07/03-seg.tsx"], [FAV_PAGE, "settings-favorites"], [SHOT_PAGE, "settings-screenshot"]]) {
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
  if (existsSync(IPC_FILE)) {
    const ipc = codeOnly(readFileSync(IPC_FILE, "utf8"));
    (/sendToWindow\("screenshot:captured"/.test(ipc) ? ok : fail)("【129】截图成功才推 screenshot:captured 事件（失败/取消不推）");
    (/copyImageFileToClipboard/.test(ipc) ? ok : fail)(
      "【129】截图确认即复制剪贴板（图要有去处，不能只躺在输入框）"
    );
    (/hotkeys\.apply\(mode, accelerator, \(\) => fire\(mode\)\);\s*\n\s*if \(!applied\.ok\)/.test(ipc) ? ok : fail)(
      "【129】hotkey-set 先注册、失败即返回（不落盘）——顺序不能反"
    );
    (/await memoryLayers\.readProject\(workspace\)/.test(ipc) && /await memoryLayers\.writeProject\(workspace, appendBlock/.test(ipc) ? ok : fail)(
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
}
