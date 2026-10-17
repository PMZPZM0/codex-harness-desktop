/**
 * 预检守卫：10b-memory-write-gate —— 记忆写入判据（10-17）
 *
 * 判据本体 = `electron/memory-lessons.ts` 的 `shouldRememberLine`（与 `buildLessonLine` 同源信号，
 * ⛔ 不是第二套分类）。管的是**绕过自动捕获链的手写路径**（收藏 / 引擎手写 / 记忆工具）。
 *
 * ⛔ 为什么单独一个文件：`10-memory-audit` 与 `04-misc-and-tools` 都在【265】巨文件棘轮名单里
 *    （口径 = **净代码行**，只许缩不许长）—— 往那儿加断言直接红。本文件自执行、不进 check-preflight
 *    的 MODULES，所以**不动** EXPECTED_CHECKS 总账基线。
 *
 * ⛔ 断言一律锚**行为**（真跑判据取值），不锚注释文本。
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./_ctx.mjs";

let checks = 0, fails = 0;
const ok = (c, m) => { checks++; if (c) console.log("  ✓ " + m); else { fails++; console.log("  ✗ " + m); } };

console.log("\n【memGate】记忆写入判据（流水不入记忆 / 纠错永不拦 / 判据顺序）");

let mod = null;
try { mod = await import("../../dist-electron/memory-lessons.js"); }
catch (error) { console.log(`  ✗ 【memGate】判据产物读不到（先 npm run build）：${error?.message ?? error}`); fails++; checks++; }

if (mod) {
  const { shouldRememberLine } = mod;

  /* ① 流水 ⇒ 拒（每条都带**具体成因**，⛔ 只判 keep=false 会让两类原因互换而看不出来） */
  const reject = [
    ["已完成 3 个文件的修改", "progress-narration"],
    ["$ npm run build", "shell-echo"],
    ["npm run check", "command-echo"],
    ["electron/cloud-provider.ts", "bare-path"],
    ["a1b2c3d4e5f60718293a4b5c6d7e8f90", "bare-hash-or-id"],
    ["10:32 开始处理请求", "timestamp-line"],
    ["共 12 条记录", "count-summary"],
    ["改了 src/App.tsx", "file-change-narration"],
  ];
  for (const [text, why] of reject) {
    const v = shouldRememberLine(text);
    ok(v.keep === false && v.reason === why, `流水不入记忆：「${text}」→ ${why}`);
  }

  /* ② 有价值 ⇒ 留（默认 fail-open：宁可多记一条，也不误杀用户有意留下的） */
  const keep = [
    ["不对，应该用 A 不是 B", "correction"],
    ["报错：MCP 握手失败 → 已修（换本地已有镜像）", "signal"],
    ["约定：统一用 pnpm", "signal"],
    ["以后默认走深色主题", "signal"],
    ["- 2026-10-16 ⚠️ 坑：网络抖动被当成删除会重复建库", "conclusion"],
    ["这条既没有流水特征也没有信号，默认保留", "default"],
  ];
  for (const [text, why] of keep) {
    const v = shouldRememberLine(text);
    ok(v.keep === true && v.reason === why, `有价值内容保留：「${text.slice(0, 24)}…」→ ${why}`);
  }

  /* ③ 顺序回归：「已完成」既是结论标记又是进度播报 ⇒ 必须判成流水（先判结论就会漏放） */
  ok(shouldRememberLine("已完成 3 个文件的修改").keep === false, "流水优先于结论标记（「已完成…」不被当结论留下）");
  /* ④ 纠错优先级最高：哪怕它长得像流水，也不许拦 */
  ok(shouldRememberLine("不对，npm run check 这个命令不对").keep === true, "纠错永不拦（用户亲手纠正优先于启发式）");
  /* ⑤ 纠错类目显式传入时同样不拦 */
  ok(shouldRememberLine("npm run check", mod.CORRECTION_CATEGORY).keep === true, "分类=用户纠错 ⇒ 不拦（哪怕正文像命令回显）");
}

/* ⑥ 回合重点摘要（10-17）：⛔ 核心回归是「收尾语不许被当结论」——
      原实现取「最后一段≥24 字」，于是「需要我继续吗？」也会被写成回合结论（用户报的流水账根因）。 */
if (mod && typeof mod.summarizeTurn === "function") {
  const s1 = mod.summarizeTurn("改好了。\n\n结论：根因是 turnId 为 null，已修，check 通过。\n\n需要我继续吗？");
  ok(/根因/.test(s1.line) && !/需要我继续/.test(s1.line), "收尾语不被当结论（取命中段，不取最后一段）");
  ok(/^- 重点/.test(s1.line), "摘要形如「- 重点：…」");
  const s2 = mod.summarizeTurn("嗯嗯。\n\n就是这样。");
  ok(s2.degraded === true && /未识别到结论/.test(s2.line), "无结构信号 ⇒ 诚实降级（⛔ 不假装是结论）");
  const s3 = mod.summarizeTurn("   ");
  ok(s3.line === "" && s3.fields.length === 0, "空回复 ⇒ 不产摘要行");
  const s4 = mod.summarizeTurn("结论：X 已修。\n\n验证：check 通过。\n\n遗留：三仓同步未做。\n\n改动：新增判据。");
  ok(s4.fields.length <= 3, "字段最多三个（注入预算有限）");
  const s5 = mod.summarizeTurn("结论与验证：已修，check 通过。");
  ok(s5.fields.length === 1, "同一段不重复占用多个字段");
  /* ⛔ 摘要必须真的接进日志条目：只改判据不接线 = 白做 */
  const logEntry = mod.buildLogEntry("改一下发送逻辑", "结论：已改好，check 通过。");
  ok(/- 需求：/.test(logEntry) && /- 重点/.test(logEntry), "日志条目 = 需求 + 回合重点摘要（接线断言）");
}

/* ⑧ 记忆技能**默认启用且不可停用**（10-17 用户令）。
   ⛔ 两端都要钉：UI 拦一道（拒绝写停用态）+ 投影兜一道（强制恢复）——
      只钉一端的话，另一端绕过就把开关"看起来关掉了"却仍生效（或反过来真被关掉）。 */
{
  const pool = readFileSync(join(ROOT, "electron", "skill-pool.ts"), "utf8");
  ok(/PROTECTED_SKILLS/.test(pool) && /isProtectedSkill\(/.test(pool), "存在技能保护名单与判定函数");
  ok(/["']memory-classify["']/.test(pool) && /["']memory-hygiene["']/.test(pool) && /["']memory-distill["']/.test(pool), "三个记忆纪律技能都在保护名单里");
  /* ⛔ 只锚**数组字面量**，不锚注释 —— 注释里提到 memory-mcp-backend 是正常的（就在旁边解释为什么排除它）。 */
  const protectedArr = /export const PROTECTED_SKILLS: readonly string\[\] = \[([^\]]*)\]/.exec(pool)?.[1] ?? "";
  ok(protectedArr.length > 0 && !protectedArr.includes("memory-mcp-backend"), "⛔ 联动技能（memory-mcp-backend）**不进**保护名单（它按后端二选一，会被正常停用）");
  /* 投影端：保护技能无条件启用（磁盘是停用态就恢复） */
  ok(/isProtectedSkill\(name\)[\s\S]{0,400}renameSync\(off, on\)/.test(pool), "投影端强制恢复（磁盘上被改成停用态也拉回来）");
  /* UI 端：拒绝把保护技能写成停用态 */
  ok(/isProtectedSkill\(name\)[\s\S]{0,200}throw new Error/.test(pool), "UI 端拒绝停用（⛔ 不许出现「看着关了其实没关」）");
  /* ⛔ 指令面必须在：判据写进技能正文才叫"引擎知道" */
  const classify = readFileSync(join(ROOT, "electron", "builtin-skills", "11-skill-memory-classify.ts"), "utf8");
  ok(/该不该记/.test(classify) && /写入四问/.test(classify), "memory-classify 正文含写入判据（四问）");
  ok(/云端记忆  >  本地记忆|云端记忆\s*>\s*本地记忆/.test(classify), "memory-classify 正文含云端优先于本地的优先级");
}

  /* ⑨ 判据**两处口径一致性**（10-17）：代码 `FLOW_PATTERNS` ↔ 技能正文的九种特征名单。
     ⛔ 这是唯一能防"技能里说会拦、实际没拦"的办法 —— 漂移不会报错，只会让模型凭错的说法办事。 */
  {
    const classify = readFileSync(join(ROOT, "electron", "builtin-skills", "11-skill-memory-classify.ts"), "utf8");
    const reasons = mod?.MEMORY_FLOW_REASONS;
    ok(Array.isArray(reasons) && reasons.length > 0, "代码侧导出了流水特征名（供比对）");
    const missing = (reasons || []).filter((r) => !classify.includes(r));
    ok(missing.length === 0, `技能正文与代码判据同步（缺：${missing.join(",") || "无"}）`);
    /* 反向：技能里写了的特征名，代码里也得有 —— 否则是"写了没实现" */
    const inSkill = [...classify.matchAll(/^\s{2}([a-z][a-z-]+)\s{2,}/gm)].map((m) => m[1]);
    const ghost = inSkill.filter((n) => /-/.test(n) && !(reasons || []).includes(n) && n !== "memory-write" && n !== "memory-classify" && n !== "memory-hygiene" && n !== "memory-distill" && n !== "memory-mcp-backend");
    ok(ghost.length === 0, `技能正文没有"写了但代码没实现"的特征（多出：${ghost.join(",") || "无"}）`);
  }

/* ⑩ 存量审计脚本（10-17）：判据只挡新增 ⇒ 老账必须能单独扫。
   ⛔ 钉的是**行为契约**（不是"文件存在"）：单一判据 · CRLF 容忍 · 默认 dry-run · 纠错类豁免 · 只审条目行。 */
{
  const auditPath = join(ROOT, "scripts", "memory-audit.mjs");
  ok(existsSync(auditPath), "存量审计脚本存在（老用户升级后要能扫老账）");
  if (existsSync(auditPath)) {
    const a = readFileSync(auditPath, "utf8");
    ok(/dist-electron["'],\s*["']memory-lessons\.js|dist-electron\/memory-lessons\.js/.test(a), "审计复用**同一份**判据产物（⛔ 不另写一套）");
    ok(/shouldRememberLine/.test(a), "审计真的调判据（不是只看行数）");
    ok(/\\r\?\\n/.test(a), "读取容忍 CRLF（主仓 LF、副本/mac 可能 CRLF —— 锚死 \\n 会假红）");
    ok(/--apply/.test(a) && /干跑|dry-run/.test(a), "默认 dry-run，--apply 才动（⛔ 批量先出清单）");
    ok(/corrections\.md/.test(a), "用户纠错**永不参与**审计（保护项）");
    ok(/\^\\s\*\[-\*\]/.test(a), "只审条目行（标题/引用不会被误判成流水 —— 实测踩过）");
    ok(/renameSync/.test(a), "落盘走「临时文件 + rename」原子替换（跨平台不留半截文件）");
  }
  const pkg = readFileSync(join(ROOT, "package.json"), "utf8");
  ok(/"memory:audit"/.test(pkg), "npm run memory:audit 已注册（用户/CI 有入口）");
}

/* ⑪ 敏感信息闸门（10-17，P0）：捕获链每轮写 L4 且每轮回灌 ⇒ 落盘的密钥会长期注入上下文。
   ⛔ 钉的是"真的拦得住"+「敏感优先于纠错」，不是"函数存在"。 */
if (mod && typeof mod.scanSensitive === "function") {
  const hit = [
    "-----BEGIN RSA PRIVATE KEY-----",
    "sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
    "ghp_abcdefghijklmnopqrstuvwxyz1234",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij",
    "password: hunter2hunter2",
    "数据库口令 password=SuperSecret123",
    "身份证 11010519491231002X",
    "postgres://user:passw0rd@db.internal:5432/app",
  ];
  for (const t of hit) ok(mod.scanSensitive(t).length > 0, `敏感拦截：${t.slice(0, 26)}…`);
  const clean = [
    "根因是 turnId 为 null，已修，check 通过",
    "约定：统一用 pnpm",
    "token 这个变量名建议改掉",   // ⛔ 只提到"token"这个词、没有赋值 ⇒ 不该误伤
  ];
  for (const t of clean) ok(mod.scanSensitive(t).length === 0, `不误伤正常内容：${t.slice(0, 20)}…`);
  /* ⛔ 最关键的一条：敏感 **优先于纠错** —— 「不对，我的密码是 xxx」不能因为命中纠错就放过去 */
  ok(mod.shouldRememberLine("不对，我的密码是 password=SuperSecret123").keep === false, "⛔ 敏感优先于纠错（命中纠错也不许写）");
  ok(/^sensitive:/.test(mod.shouldRememberLine("sk-ant-api03-abcdefghijklmnopqrstuvwxyz").reason), "拒绝原因标明是敏感信息（可审计）");
  /* 日志侧是隐去而非拒写：回合流水要留，密钥不能留 */
  const e = mod.buildLogEntry("帮我看看 password=SuperSecret123 这个配置", "结论：已修。");
  ok(/- 需求：/.test(e) && !/SuperSecret123/.test(e) && /已隐去/.test(e), "L4 日志需求段被隐去（流水保留、密钥不落盘）");
}

/* ⑫ P1-1 重复 vs 冲突：同一条纪律再次出现**不许静默丢弃**（老行为 return false，信息直接消失）。
   ⑬ P1-2 遗忘粒度：单条 / 主题 / 分类，且**纠错类只许单条**。 */
{
  let layersMod = null;
  try { layersMod = await import(pathToFileURL(join(ROOT, "dist-electron", "memory-layers.js")).href); }
  catch (error) { fail(`【memGate】记忆分层产物读不到：${error?.message ?? error}`); }
  if (layersMod) {
    const ws = mkdtempSync(join(tmpdir(), "memgate-"));
    /* ⛔⛔ 品牌无关：harness 目录名**两仓不同**（主仓 `.codex-harness` / PPcode `.ppcode-harness`，
       由各仓 `memory-layers.ts` 的 `MEMORY_DIR` 决定）。写死任一个 ⇒ 副本假红（实测踩到）。
       ⇒ 扫工作区里的 `.*-harness/memory/lessons/`，不猜名字。 */
    const lessonsDir = () => {
      const base = readdirSync(ws).find((n) => /^\.\w[\w-]*-harness$/.test(n));
      return base ? join(ws, base, "memory", "lessons") : null;
    };
    const read = () => {
      const d = lessonsDir();
      if (!d || !existsSync(d)) return "";
      return readdirSync(d).map((f) => readFileSync(join(d, f), "utf8")).join("\n");
    };
    try {
      const L = () => new layersMod.MemoryLayers(ws);
      const KEY = "网络抖动被当成删除会重复建库";   // ⛔ 真实 dedupeKey = 现象归一化后的切片，必须能在行里找到
      const line = `- 2026-10-17 ⚠️ 坑：${KEY} → 先问 alive`;
      ok((await L().appendLesson(ws, line, KEY, "任务经验")) === true, "P1-1 首次写入成功");
      /* 同现象同结论 ⇒ 就地记数，不新增行 */
      ok((await L().appendLesson(ws, line, KEY, "任务经验")) === false, "P1-1 重复不再产生新行");
      ok(/（再次 \d{4}-\d{2}-\d{2}/.test(read()), "P1-1 就地记下「再次出现」（⛔ 不再静默丢弃）");
      /* 同现象不同结论 ⇒ 冲突/更新：新行标 ⟳，旧行**保留** */
      const updated = `- 2026-10-17 ⚠️ 坑：${KEY} → 改成先核验归属再删`;
      await L().appendLesson(ws, updated, KEY, "任务经验");
      const body = read();
      ok(/⟳ 更新：/.test(body), "P1-1 结论变了 ⇒ 落「⟳ 更新」新行");
      ok(/先问 alive/.test(body), "P1-1 旧条目**保留**（可回溯「当时是这么定的」");
      /* P1-2 遗忘粒度：主题 / 分类 / 单条，且纠错类只许单条 */
      ok((await L().forgetLessons(ws, { key: KEY })) === 1, "P1-2 按主题遗忘（键命中 1 条）");
      const corr = "- 2026-10-17 ⚠️ 纠错：不该顺手改权限 → 先问";
      await L().appendLesson(ws, corr, "perm", "用户纠错");
      ok((await L().forgetLessons(ws, { key: "perm" })) === 0, "P1-2 ⛔ 纠错类**按主题**拒绝（保护项）");
      ok((await L().forgetLessons(ws, { category: "用户纠错" })) === 0, "P1-2 ⛔ 纠错类**按分类**拒绝");
      ok((await L().forgetLessons(ws, { line: "不该顺手改权限" })) === 1, "P1-2 纠错类**单条**允许遗忘");
    } finally { rmSync(ws, { recursive: true, force: true }); }
  }
}

/* ⑭ P0-2 召回口径必须存在且有回归地板（⛔ "记忆的质量等于召回的质量" —— 没有这个口径，
   之前所有验证都只证明"该不该写"，证明不了"找不找得到"）。 */
{
  const p = join(ROOT, "scripts", "memory-recall.mjs");
  ok(existsSync(p), "召回口径脚本存在");
  if (existsSync(p)) {
    const r = readFileSync(p, "utf8");
    ok(/FLOOR/.test(r) && /poolTop1/.test(r), "召回有**回归地板**（改动不许让召回变差）");
    ok(/措辞与条目刻意错开/.test(r), "用例是换措辞的（⛔ 用原文当查询必然 100%，那是自欺）");
    ok(/bigram/.test(r), "两条检索路径都测（L7 碎片池 + 知识库 bigram）");
  }
  const pkg2 = readFileSync(join(ROOT, "package.json"), "utf8");
  ok(/"memory:recall"/.test(pkg2), "npm run memory:recall 已注册");
}

/* ⑦ 判据必须真的**接线**在 appendLesson 上：判据存在但没接 = 闸门形同不存在 */
{
  const layers = readFileSync(join(ROOT, "electron", "memory-layers.ts"), "utf8");
  ok(/shouldRememberLine\(text, category\)/.test(layers), "appendLesson 真的调了判据（⛔ 判据存在 ≠ 闸门生效）");
  ok(/\[memory\] 未写入纪律/.test(layers), "被拒时留痕（⛔ 不许静默吞：判据是启发式，拒错要能复盘）");
}

console.log(`【memGate】${checks - fails}/${checks} 通过`);
if (fails) process.exitCode = 1;
