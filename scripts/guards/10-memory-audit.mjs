/**
 * 预检守卫组：10-memory-audit
 * 分节：【102】【103】【104】【105】【106】【107】（原 L8396–L8988）+【113】【114】（09-23 加：技能内置与安装门禁）
 *       +【119】【120】【121】（09-23 加：剥离抗自指污染 / 失败词误报回归 / 纪律行写入即拦）
 *       +【125】（09-23 加：被委派会话的记忆注入 —— 子智能体 / 专家 / 专家团 / 成员）
 *
 * 09-22 从 scripts/check-preflight.mjs（8,997 行单文件）按域拆出，正文逐字未改；
 * 共享面由 ./_ctx.mjs 注入（同名导入）。动机：多路并行写者往同一文件加守卫会互相覆盖（已发生）。
 */
import {
  C, ROOT, existsSync, fail, join, mkdirSync, mkdtempSync, ok, preloadSrc, readFileSync, readdirSync, rmSync, tmpdir, writeFileSync,
} from "./_ctx.mjs";

export async function run() {

  /* ══ 【102】原 L8396–L8465 ══ */
  {
{
  console.log(C.bold("\n【102】踩坑留痕（纠错优先 / LESSONS 注入最前 / 去重）"));
  let lessonMod = null;
  let layersMod = null;
  try { lessonMod = await import("../../dist-electron/memory-lessons.js"); }
  catch (error) { fail(`【102】坑判定纯逻辑产物读不到（先 npm run build）：${error?.message ?? error}`); }
  try { layersMod = await import("../../dist-electron/memory-layers.js"); }
  catch (error) { fail(`【102】记忆分层产物读不到（先 npm run build）：${error?.message ?? error}`); }

  if (lessonMod) {
    const { detectCorrection, buildLessonLine, buildLogEntry, buildUserProfileLine, extractConclusion, shouldCapture, stripInjectedBlocks } = lessonMod;
    /* ① 纠错识别 */
    (detectCorrection("不对，我说的是 B 不是 A").hit ? ok : fail)("【102】识别用户纠错（「不对，我说的是…」）");
    (detectCorrection("帮我加一个功能").hit ? fail : ok)("【102】普通需求不误判成纠错");
    /* ② 纠错优先：短消息/寒暄过滤不得吞掉纠错 */
    const forced = shouldCapture("不对", "嗯");
    (forced.record && forced.forced ? ok : fail)(`【102】纠错**强制记录**（不被 too-short/greeting 吞掉，实际 ${forced.reason}）`);
    const chit = shouldCapture("你好", "在的");
    (chit.record ? fail : ok)(`【102】寒暄仍然不记（实际 ${chit.reason}）`);
    /* ⛔ 09-23：常驻记忆块的标题里就含「别再犯」⇒ 不剥注入块会让**每一轮**都 forced=true（实证：带块回合 correction-forced(别再)、不带块回合 ok） */
    const injPlain = shouldCapture("[Harness 常驻记忆 · 上下文]\n- 旧纪律行\n[常驻记忆结束]\n帮我加个按钮", "好的。");
    (!injPlain.forced && injPlain.reason === "ok" ? ok : fail)(`【102】注入块里的「别再犯」不得把普通需求判成纠错（实际 ${injPlain.reason}）`);
    const injReal = shouldCapture("[Harness 常驻记忆 · 上下文]\n- 旧纪律行\n[常驻记忆结束]\n不对，你改错了", "抱歉。");
    (injReal.forced ? ok : fail)("【102】剥块后真实的纠错仍强制记录");
    /* ③ 结论取末尾而非开头寒暄 */
    const concl = extractConclusion("好的，我先看看代码。\n\n结论：根因是 turnId 是 null，已修，验证通过。");
    (/根因|已修/.test(concl) && !/我先看看/.test(concl) ? ok : fail)(`【102】结论段取末尾（实际「${String(concl).slice(0, 40)}」）`);
    /* ④ 坑行格式：单行 + 带日期与「坑」+ 有去重键 */
    const lesson = buildLessonLine({ userContent: "不对，我说的是 B", assistantContent: "根因是 X，已修。", date: "2026-09-22" });
    (lesson && /(坑|纠错)/.test(lesson.line) && !/\n/.test(lesson.line) && lesson.dedupeKey.length > 0 ? ok : fail)("【102】纪律行格式（单行 / 含「坑」或「纠错」标记 / 有现象去重键）");
    /* ⛔ 去重键不能太窄：用户只回「不对」时，两条**不同**纠错必须产生不同键（否则第二条被当重复丢掉） */
    const shortA = buildLessonLine({ userContent: "不对", assistantContent: "结论：根因是 A，已修。", date: "2026-09-22" });
    const shortB = buildLessonLine({ userContent: "不对", assistantContent: "结论：根因是 B，已修。", date: "2026-09-22" });
    (shortA && shortB && shortA.dedupeKey !== shortB.dedupeKey ? ok : fail)("【102】极短纠错（只说「不对」）的两条不同坑不撞键");
    (buildLessonLine({ userContent: "帮我加功能", assistantContent: "已加。", date: "2026-09-22" }) === null ? ok : fail)("【102】无纠错无失败时不产坑行（防噪音）");
/* 09-22 修（用户实测：L2 里躺着一条垃圾纪律行「⚠️ 坑：看下你的记忆板块 [Harness 相关记忆…] → A/B/C 选项」，
   零复用价值却永不淘汰、每轮注入）。两个根因、两条防线：
   ① 捕获链拿到的是**原始 userContent**，里面带着注入块 ⇒ 必须先剥；
   ② FAILURE_SIGNALS 收了 `failed` 与 `根因` 这类**引用/分析**词 ⇒ 讨论 bug 被误判成"踩了坑"。 */
const injected102 = "[Harness 常驻记忆 · 上下文]\n- 旧纪律行\n[常驻记忆结束]\n\n[Harness 相关记忆，仅供参考]\n[任务经验] 旧的\n[记忆结束]\n\n看下你的记忆板块";
(stripInjectedBlocks(injected102) === "看下你的记忆板块" ? ok : fail)("【102】剥注入块：常驻记忆 / 相关记忆两段都剥干净");
(!buildLogEntry(injected102, "结论：已通。").includes("Harness") ? ok : fail)("【102】当天日志的「需求」字段不再带注入块");
(buildLessonLine({ userContent: "空是因为这个是新会话", assistantContent: '日志里有 "reason":"append-failed"，根因是 key 两端不同源。', date: "2026-09-22" }) === null ? ok : fail)("【102】引用 failed / 分析「根因」不再误判成踩坑");
(buildLessonLine({ userContent: "帮我加个导出按钮", assistantContent: "结论：已修复，验证通过。", date: "2026-09-22" }) ? ok : fail)("【102】真踩坑（有修复动作）仍照记");
(buildUserProfileLine({ userContent: "我更喜欢直接反馈，别绕弯", date: "2026-09-22" })?.line === "- 2026-09-22 画像：我更喜欢直接反馈，别绕弯" ? ok : fail)("【102】L0 画像候选行（跨项目偏好 → USER.md）");
(buildUserProfileLine({ userContent: "帮我加个按钮", date: "2026-09-22" }) === null ? ok : fail)("【102】普通任务句不产画像行");
/* appendUserProfile 曾经只有实现 + 【108】真跑，**生产代码零调用点** ⇒ L0 永远空、跨项目画像无从积累 */
(/appendUserProfile\(/.test(readFileSync(join(ROOT, "electron/memory-store.ts"), "utf8")) ? ok : fail)("【102】L0 画像已接线（捕获链真的会调 appendUserProfile）");
    /* ⑤ 日志条目形态：需求 + 结论 */
    const entry = buildLogEntry("改一下发送逻辑", "结论：已改好，验证通过。");
    (/- 需求：/.test(entry) && /- 结论：/.test(entry) ? ok : fail)("【102】日志条目 = 需求 + 结论（不再是「结果」取开头）");
  }

  if (layersMod) {
    const { MemoryLayers } = layersMod;
    const tmp = mkdtempSync(join(tmpdir(), "harness-102-"));
    const ws = join(tmp, "ws");
    mkdirSync(ws, { recursive: true });
    const ml = new MemoryLayers(tmp);
    await ml.writeProject(ws, "项目：把记忆做成三层");
    const first = await ml.appendLesson(ws, "- 2026-09-22 ⚠️ 坑：捕获链静默断掉 → turnId 是 null → 两端 key 同源", "捕获链静默断掉");
    const dup = await ml.appendLesson(ws, "- 2026-09-22 ⚠️ 坑：捕获链静默断掉了（又说一遍）", "捕获链静默断掉");
    (first === true && dup === false ? ok : fail)(`【102】同一现象不重复写（首写 ${first} / 重复 ${dup}）`);
    const ctx = await ml.context(ws);
    const iLessons = ctx.text.indexOf("踩坑与纪律");
    const iProject = ctx.text.indexOf("项目记忆");
    (iLessons >= 0 ? ok : fail)("【102】坑清单进了常驻记忆注入块");
    (iLessons >= 0 && iProject >= 0 && iLessons < iProject ? ok : fail)(`【102】坑排在项目记忆**之前**（lessons@${iLessons} < project@${iProject}）`);
    const snap = await ml.snapshot(ws);
    (typeof snap.lessons === "string" && snap.lessons.includes("坑") && typeof snap.paths.lessons === "string" && snap.budget.lessons === snap.lessons.length
      ? ok : fail)("【102】快照带 lessons 字段与预算（设置页可见）");
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* 清理失败不影响判定 */ }
  }

  /* ⑥ 文本面：三件套 scope / 引擎指令 / 蒸馏提示 */
  const rpaIpc = readFileSync(join(ROOT, "electron/features/memory-rpa-ipc.ts"), "utf8");
  /* preload 是自包含单文件（09-23 深夜改内联） */
  const preloadSrc = readFileSync(join(ROOT, "electron/preload.ts"), "utf8");
  const envSrc = readFileSync(join(ROOT, "src/vite-env.d.ts"), "utf8");
  (/"user" \| "background" \| "project" \| "lessons"/.test(rpaIpc) ? ok : fail)("【102】IPC 写入口支持 scope=lessons");
  (/scope: "user" \| "background" \| "project" \| "lessons"/.test(preloadSrc) ? ok : fail)("【102】preload 桥接同步 lessons scope");
  (/scope: "user" \| "background" \| "project" \| "lessons"/.test(envSrc) ? ok : fail)("【102】vite-env 声明同步 lessons scope");
  const instr = readFileSync(join(ROOT, "electron/developer-instructions.ts"), "utf8");
  (/LESSONS\.md/.test(instr) && /坑/.test(instr) ? ok : fail)("【102】引擎指令要求「踩坑留痕」（LESSONS.md + 格式）");
  const layersSrc = readFileSync(join(ROOT, "electron/memory-layers.ts"), "utf8");
  (/现有踩坑与纪律/.test(layersSrc) ? ok : fail)("【102】蒸馏输入带上坑清单（否则蒸馏会把坑丢掉）");
  const svcSrc = readFileSync(join(ROOT, "electron/memory-store.ts"), "utf8");
  (/shouldCapture\(/.test(svcSrc) && /appendLesson/.test(svcSrc) ? ok : fail)("【102】捕获链改用纠错优先判定 + 追加坑");
}
  }

  /* ══ 【103】原 L8475–L8559 ══ */
  {
{
  console.log(C.bold("\n【103】经验包：技能沉淀（解析 / 落点 / 元技能 / 与指令同源）"));
  let pack = null;
  try { pack = await import("../../dist-electron/skill-pack.js"); }
  catch (error) { fail(`【103】技能包产物读不到（先 npm run build）：${error?.message ?? error}`); }

  if (pack) {
    const { parseSkillMdSource, scanSkillRoot, globalSkillsDir, projectSkillsDir, GLOBAL_SKILLS_SUBDIR, PROJECT_SKILLS_SUBDIR, SKILL_AUTHORING_NAME } = pack;

    /* ① 解析器真跑 */
    const good = parseSkillMdSource("---\nname: demo-skill\ndescription: 演示技能\n---\n\n正文\n", "fallback");
    (good && good.name === "demo-skill" && good.desc === "演示技能" ? ok : fail)("【103】解析合法 frontmatter（name / description）");
    (parseSkillMdSource("\uFEFF---\nname: bom\ndescription: 带 BOM\n---\n", "x") ? ok : fail)("【103】容忍 BOM（启动自愈剥 BOM 后仍要能解析）");
    ((parseSkillMdSource("---\ndescription: 只有描述\n---\n", "dir-name") || {}).name === "dir-name" ? ok : fail)("【103】缺 name 用目录名兜底");
    (parseSkillMdSource("---\nname: only-name\n---\n", "dir") === null ? ok : fail)("【103】缺 description = 无效（不进能力清单，等于没写）");
    (parseSkillMdSource("# 没有 frontmatter\n", "dir") === null ? ok : fail)("【103】无 frontmatter = 无效");

    /* ② 扫描器真跑（临时目录：2 启用 + 1 坏 + 1 停用） */
    const tmp = mkdtempSync(join(ROOT, "node_modules", ".p103-"));
    mkdirSync(join(tmp, "alpha"), { recursive: true });
    writeFileSync(join(tmp, "alpha", "SKILL.md"), "---\nname: alpha\ndescription: 甲\n---\n", "utf8");
    mkdirSync(join(tmp, "beta"), { recursive: true });
    writeFileSync(join(tmp, "beta", "SKILL.md"), "---\nname: beta\ndescription: 乙\n---\n", "utf8");
    mkdirSync(join(tmp, "broken"), { recursive: true });
    writeFileSync(join(tmp, "broken", "SKILL.md"), "---\nname: broken\n---\n", "utf8");
    mkdirSync(join(tmp, "off"), { recursive: true });
    writeFileSync(join(tmp, "off", "SKILL.md.disabled"), "---\nname: off\ndescription: 停用的\n---\n", "utf8");
    const active = await scanSkillRoot(tmp, "user");
    (active.length === 2 ? ok : fail)(`【103】能力清单只列启用中的技能（实际 ${active.length}，期望 2：坏的 / 停用的都不算）`);
    (active.every((s) => s.enabled === true) ? ok : fail)("【103】清单里的技能都带 enabled=true");
    const all = await scanSkillRoot(tmp, "user", { includeDisabled: true });
    (all.length === 3 ? ok : fail)(`【103】管理视图才含停用项（实际 ${all.length}，期望 3）`);
    (all.some((s) => s.name === "off" && s.enabled === false) ? ok : fail)("【103】停用技能带 enabled=false（界面据此显示「已停用」，模型也不会去调它）");

    /* ③ 落点契约（引擎实测：$CODEX_HOME/skills 与 <cwd>/.codex/skills 都被原生发现，后者 scope=repo） */
    (GLOBAL_SKILLS_SUBDIR === "skills" ? ok : fail)("【103】全局技能目录 = $CODEX_HOME/skills");
    (PROJECT_SKILLS_SUBDIR === ".codex/skills" ? ok : fail)(`【103】项目级技能落点 = .codex/skills（实际 ${PROJECT_SKILLS_SUBDIR}）`);
    (projectSkillsDir("C:/proj") === join("C:/proj", ".codex", "skills") ? ok : fail)("【103】projectSkillsDir 拼装正确");
    (globalSkillsDir("C:/home") === join("C:/home", "skills") ? ok : fail)("【103】globalSkillsDir 拼装正确");
    (/codex-harness/.test(PROJECT_SKILLS_SUBDIR) ? fail : ok)("【103】项目级技能**不落** .codex-harness（引擎实测不认该目录）");

    /* ④ 元技能真落盘 + 清单可见（ensureBuiltinSkills 跑进临时目录） */
    let listed = [];
    try {
      const builtin = await import("../../dist-electron/builtin-skills.js");
      await builtin.ensureBuiltinSkills(tmp);
      listed = await scanSkillRoot(tmp, "user");
    } catch (error) { fail(`【103】内置技能落盘失败：${error?.message ?? error}`); }
    const names = listed.map((s) => s.name);
    (names.includes(SKILL_AUTHORING_NAME) ? ok : fail)(`【103】元技能 ${SKILL_AUTHORING_NAME} 真落盘且进了能力清单（引擎才知道自己会造技能）`);
    (names.length === new Set(names).size ? ok : fail)("【103】技能名不重复（同名两条 = 列表里看起来像假的）");
    (listed.length > 0 && listed.every((s) => s.desc.length > 0) ? ok : fail)("【103】每个内置技能都有 description（缺了就不进清单）");
    rmSync(tmp, { recursive: true, force: true });

    /* ⑤ 元技能正文契约（必须是源文件里的**字面量**：预检【86】按源文件文本做安全扫描，
       运行时拼装会让它看不见内容 ⇒「内置技能零 critical/high」变恒真，记过的假绿形态） */
    const meta = readFileSync(join(ROOT, "electron", "builtin-skills", "07-skill-authoring.ts"), "utf8");
    const metaSections = ["## 何时沉淀", "## 步骤", "## 坑", "## 判据"];
    const missingSec = metaSections.filter((h) => !meta.includes(h));
    (missingSec.length === 0 ? ok : fail)(`【103】元技能含格式四段${missingSec.length ? "，缺：" + missingSec.join(" / ") : ""}`);
    (meta.includes(".codex/skills") && /\$CODEX_HOME\/skills/.test(meta) ? ok : fail)("【103】元技能写明两个落点");
    (/LESSONS/.test(meta) && /升级/.test(meta) ? ok : fail)("【103】元技能含「坑 → 技能」的升级通道");
    (/frontmatter/.test(meta) && /description/.test(meta) ? ok : fail)("【103】元技能写明 frontmatter 契约");

    /* ⑥ 与引擎指令 / AGENTS.md 守则同源 */
    try {
      const { buildDevInstructions } = await import("../../dist-electron/developer-instructions.js");
      const instr = buildDevInstructions({});
      (instr.includes(SKILL_AUTHORING_NAME) ? ok : fail)("【103】引擎指令点名元技能（沉淀前先读它）");
      (instr.includes(`<workspace>/${PROJECT_SKILLS_SUBDIR}/`) ? ok : fail)("【103】引擎指令给的项目级落点来自 skill-pack 常量");
      /* ⛔ 断言的是「不许把 .codex-harness/skills 写成落点」，不是「不许出现这个词」——
         指令里那句是**禁止语境**（NEVER `<workspace>/.codex-harness/skills/` —— 引擎不读该目录），
         它出现在指令里恰恰是我们要的（提前堵掉这个误解）。 */
      (/NEVER `<workspace>\/\.codex-harness\/skills\//.test(instr) ? ok : fail)("【103】引擎指令把 .codex-harness/skills 标为**禁止**落点（引擎实测不认该目录）");
      (/已沉淀技能/.test(instr) && /LESSONS\.md/.test(instr) ? ok : fail)("【103】指令含沉淀回报行与「坑升级为技能」");
    } catch (error) { fail(`【103】引擎指令产物读不到：${error?.message ?? error}`); }
    try {
      const { buildDisciplineSection } = await import("../../dist-electron/skill-discipline.js");
      const disc = buildDisciplineSection({ skills: [], mcp: [] });
      (disc.includes(PROJECT_SKILLS_SUBDIR) && disc.includes(SKILL_AUTHORING_NAME) ? ok : fail)("【103】AGENTS.md 守则同步项目级落点与元技能名");
      (/\.codex-harness\/memory/.test(disc) ? ok : fail)("【103】守则写明记忆（是什么）与技能（怎么做）的目录分工");
      (/scope=repo/.test(disc) ? ok : fail)("【103】守则说明项目级技能由引擎原生发现（不重复枚举）");
    } catch (error) { fail(`【103】守则产物读不到：${error?.message ?? error}`); }
  }
}
  }

  /* ══ 【104】原 L8569–L8640 ══ */
  {
{
  console.log(C.bold("\n【104】记忆金字塔：八层 / 90% 漏斗 / 自助蒸馏真跑"));
  let mem = null;
  try { mem = await import("../../dist-electron/memory-layers.js"); }
  catch (error) { fail(`【104】记忆分层产物读不到（先 npm run build）：${error?.message ?? error}`); }

  if (mem) {
    const { MEMORY_PYRAMID, MEMORY_DISTILL_THRESHOLD, layerWatermarks, splitDistill, MemoryLayers, MEMORY_DISTILL_SKILL } = mem;

    /* ① 层表 */
    (MEMORY_PYRAMID.length === 8 ? ok : fail)(`【104】金字塔八层齐全（实际 ${MEMORY_PYRAMID.length}）`);
    const ids = MEMORY_PYRAMID.map((l) => l.id).join(",");
    (ids === "L0,L1,L2,L3,L4,L5,L6,L7" ? ok : fail)(`【104】层 id 顺序为 L0..L7（实际 ${ids}）`);
    (MEMORY_PYRAMID.every((l) => l.budget >= 0 && l.sink && l.writer && l.where) ? ok : fail)("【104】每层都有 落点 / 预算 / 谁写 / 蒸馏去向");
    (MEMORY_DISTILL_THRESHOLD === 0.9 ? ok : fail)(`【104】蒸馏线 = 90%（实际 ${MEMORY_DISTILL_THRESHOLD}）`);

    /* ② 水位纯函数（边界 + 外部层 + 一致性） */
    const budgets = Object.fromEntries(MEMORY_PYRAMID.map((l) => [l.id, l.budget]));
    const wm = layerWatermarks({ L1: budgets.L1 * 0.89, L4: budgets.L4 * 0.9 });
    (wm.find((s) => s.id === "L1").needDistill === false ? ok : fail)("【104】89% 不触发蒸馏");
    (wm.find((s) => s.id === "L4").needDistill === true ? ok : fail)("【104】正好 90% 触发蒸馏（边界含等于）");
    (wm.find((s) => s.id === "L6").ratio === null && wm.find((s) => s.id === "L6").needDistill === false ? ok : fail)("【104】冷存档（budget 0）不参与触发");
    (wm.length === 8 && wm.every((s) => s.needDistill === (s.ratio !== null && s.ratio >= MEMORY_DISTILL_THRESHOLD)) ? ok : fail)("【104】needDistill 与 ratio 严格一致（不是恒真假绿）");

    /* ③ 两段切分（含"模型漏标题"的退回路径） */
    const two = splitDistill("## 核心\n- 约定 A\n\n## 纪要\n- 今天干了 B\n");
    (two.core.includes("约定 A") && two.digest.includes("今天干了 B") ? ok : fail)("【104】两段切分：核心→L1 / 纪要→L5");
    const one = splitDistill("- 没有标题的一条结论\n");
    (one.core.includes("没有标题") && one.digest === "" ? ok : fail)("【104】模型漏标题 ⇒ 退回单段（整段进 L1，内容不丢）");
    (splitDistill("").core === "" && splitDistill("").digest === "" ? ok : fail)("【104】空输出不炸");

    /* ④ 真跑：临时 workspace 上走完整漏斗 */
    const ws = mkdtempSync(join(ROOT, "node_modules", ".p104-"));
    const memDir = join(ws, ".codex-harness", "memory");
    mkdirSync(memDir, { recursive: true });
    const inst = new MemoryLayers(join(ws, ".codex-harness", "userdata"));
    const day = (n) => `2026-09-${String(10 + n).padStart(2, "0")}`;
    /* 6 天日志（v2 布局：logs/），合计 6×8000=48000 字 > L4 预算 40000（logPerDay 8000×logDays 5，重度口径）的 90%（36000）⇒ 必然触发水位 */
    mkdirSync(join(memDir, "logs"), { recursive: true });
    for (let i = 0; i < 6; i += 1) writeFileSync(join(memDir, "logs", `${day(i)}.md`), `## ${day(i)}\n${"日志内容".repeat(2000)}\n`, "utf8");
    const hint = await inst.watermarkHint(ws);
    (/L4/.test(hint) && /90%/.test(hint) ? ok : fail)(`【104】超水位时给出提示行（${hint.split("\n")[1] ? hint.split("\n")[1].slice(0, 60) : "空"}）`);
    ((await inst.context(ws)).text.includes("记忆水位") ? ok : fail)("【104】水位提示进了常驻记忆块（引擎每轮都看得见，无需额外工具）");
    const pick = await inst.pickDistill(ws);
    (pick && pick.trigger === "watermark" && pick.dates.length === 3 ? ok : fail)(`【104】水位触发取最老一半（实际 ${pick?.trigger} / ${pick?.dates?.length} 天）`);
    const res = await inst.distill(ws, async () => "## 核心\n- 结论：约定 A\n\n## 纪要\n- 阶段纪要：做了 B\n", true);
    (res.ok ? ok : fail)(`【104】蒸馏真跑成功（${res.reason ?? "ok"}）`);
    (res.rollup === "rollups/2026-09.md" && existsSync(join(memDir, "rollups", "2026-09.md")) ? ok : fail)(`【104】L5 月度卷宗真落盘（${res.rollup}）`);
    (readFileSync(join(memDir, "project", "MEMORY.md"), "utf8").includes("约定 A") ? ok : fail)("【104】L1 项目宪法写入蒸馏「核心」段（project/MEMORY.md）");
    (pick && existsSync(join(memDir, "archive", `${pick.dates[0]}.md`)) ? ok : fail)("【104】L6 冷存档拿到原文（移动而非删除）");
    (pick && !existsSync(join(memDir, "logs", `${pick.dates[0]}.md`)) ? ok : fail)("【104】被蒸日志已从 L4（logs/）移走（否则水位永远降不下来）");
    const after = await inst.watermarkHint(ws);
    (!/L4/.test(after) ? ok : fail)("【104】蒸完 L4 水位回落、提示消失（闭环）");
    const snap = await inst.snapshot(ws);
    (Array.isArray(snap.layers) && snap.layers.length === 8 ? ok : fail)("【104】快照带八层水位（设置页可见漏斗）");
    rmSync(ws, { recursive: true, force: true });

    /* ⑤ 与指令 / 技能同源 */
    const skillSrc = readFileSync(join(ROOT, "electron", "builtin-skills", "08-skill-memory-distill.ts"), "utf8");
    const missingIds = MEMORY_PYRAMID.map((l) => l.id).filter((id) => !skillSrc.includes(`**${id}**`));
    (missingIds.length === 0 ? ok : fail)(`【104】技能正文含全部八层${missingIds.length ? "，缺：" + missingIds.join(",") : ""}`);
    (/rollups/.test(skillSrc) && /archive/.test(skillSrc) ? ok : fail)("【104】技能写明 L5 月卷 / L6 冷存档落点");
    (readFileSync(join(ROOT, "electron", "builtin-skills.ts"), "utf8").includes('["memory-distill"') ? ok : fail)("【104】memory-distill 进了 entries（只写常量不注册 = 永不落盘）");
    try {
      const { buildDevInstructions } = await import("../../dist-electron/developer-instructions.js");
      const instr = buildDevInstructions({});
      (instr.includes(MEMORY_DISTILL_SKILL) ? ok : fail)("【104】引擎指令点名技能 memory-distill（步骤在技能里，不在每轮指令里）");
      (instr.includes("记忆水位") ? ok : fail)("【104】引擎指令写明触发 = 水位提示行（跟提示行文案同源）");
      (instr.includes(`at ${Math.round(MEMORY_DISTILL_THRESHOLD * 100)}% of a layer`) ? ok : fail)("【104】指令里的阈值由常量拼装（改阈值不会漏改指令）");
    } catch (error) { fail(`【104】引擎指令产物读不到：${error?.message ?? error}`); }
  }
}
  }

  /* ══ 【105】原 L8649–L8741 ══ */
  {
{
  console.log(C.bold("\n【105】记忆分类：纠错单独一类（分类 / 分节 / 注入顺序 / 永不淘汰）"));
  let lessonsMod = null;
  let layersMod2 = null;
  let pruneMod = null;
  try { lessonsMod = await import("../../dist-electron/memory-lessons.js"); }
  catch (error) { fail(`【105】分类纯逻辑产物读不到（先 npm run build）：${error?.message ?? error}`); }
  try { layersMod2 = await import("../../dist-electron/memory-layers.js"); }
  catch (error) { fail(`【105】记忆分层产物读不到：${error?.message ?? error}`); }
  try { pruneMod = await import("../../dist-electron/memory-prune.js"); }
  catch (error) { fail(`【105】淘汰策略产物读不到：${error?.message ?? error}`); }

  if (lessonsMod) {
    const { CORRECTION_CATEGORY, PITFALL_CATEGORY, SOP_CATEGORY, PREFERENCE_CATEGORY, MEMORY_CATEGORY_ORDER, classifyMemory, buildLessonLine, splitLessonSections, groupLessonSections, sortLessonSections, appendLessonLine } = lessonsMod;

    /* ① 分类判据与优先级 */
    (classifyMemory("不对，我说的是 B 不是 A", "好的") === CORRECTION_CATEGORY ? ok : fail)("【105】用户纠错 → 「用户纠错」（单独一类）");
    (classifyMemory("帮我加个导出按钮", "已修复渲染报错（根因：空数组）") === PITFALL_CATEGORY ? ok : fail)("【105】自踩的坑/回归 → 「任务经验」");
    (classifyMemory("我更喜欢深色一点的主题", "好的") === PREFERENCE_CATEGORY ? ok : fail)("【105】口味/习惯 → 「用户偏好」");
    (classifyMemory("以后统一用 pnpm", "记下了，约定：统一 pnpm") === SOP_CATEGORY ? ok : fail)("【105】定下来的做法 → 「工作流/SOP」");
    /* 优先级：一句话同时像"纠错"和"坑"时，必须先算纠错（纪律优先于经验） */
    (classifyMemory("不对，这个又报错了", "已修") === CORRECTION_CATEGORY ? ok : fail)("【105】纠错优先级高于坑（不被埋进坑堆）");
    (MEMORY_CATEGORY_ORDER[0] === CORRECTION_CATEGORY ? ok : fail)("【105】注入顺序里纠错排第一");

    /* ② 分节读写 */
    const started = appendLessonLine("", PITFALL_CATEGORY, "- 2026-09-22 ⚠️ 坑：x → y");
    (/## 任务经验/.test(started) ? ok : fail)("【105】空文件首写会建出分类节");
    const two = appendLessonLine(started, CORRECTION_CATEGORY, "- 2026-09-22 ⚠️ 纠错：a → b");
    (/## 用户纠错/.test(two) && /## 任务经验/.test(two) ? ok : fail)("【105】新分类自动建节，已有节不受影响");
    const again = appendLessonLine(two, PITFALL_CATEGORY, "- 2026-09-23 ⚠️ 坑：z → w");
    const pitfallSection = splitLessonSections(again).find((s) => s.category === PITFALL_CATEGORY);
    (pitfallSection && pitfallSection.lines.filter((l) => /^\s*-/.test(l)).length === 2 ? ok : fail)("【105】同分类再写追加到该节（不新建第二个同名列）");
    (splitLessonSections(again).find((s) => s.category === CORRECTION_CATEGORY).lines.filter((l) => /^\s*-/.test(l)).length === 1 ? ok : fail)("【105】追加不污染其它分类节");
    const sorted = sortLessonSections(again);
    (sorted.indexOf("## 用户纠错") < sorted.indexOf("## 任务经验") ? ok : fail)("【105】注入前重排：纠错节排在任务经验之前（磁盘顺序不动）");
    const groups = groupLessonSections(again);
    (groups.find((g) => g.category === CORRECTION_CATEGORY).count === 1 && groups.find((g) => g.category === PITFALL_CATEGORY).count === 2 ? ok : fail)("【105】分类计数正确（设置页显示 N 条）");

    /* ③ 行前缀带分类标记 */
    const line = buildLessonLine({ userContent: "不对，你把 A 改成了 B", assistantContent: "已改回 A。根因：判断顺序写反。", date: "2026-09-22" });
    (line && line.category === CORRECTION_CATEGORY && /纠错/.test(line.line) ? ok : fail)("【105】纠错行前缀 = ⚠️ 纠错（不再一律叫「坑」）");
  }

  if (lessonsMod && layersMod2) {
    /* ④ 真跑 MemoryLayers：写入 → 注入顺序 + 快照分类计数 */
    const ws = mkdtempSync(join(ROOT, "node_modules", ".p105-"));
    const memDir = join(ws, ".codex-harness", "memory");
    mkdirSync(memDir, { recursive: true });
    const inst = new layersMod2.MemoryLayers(join(ws, ".codex-harness", "userdata"));
    await inst.appendLesson(ws, "- 2026-09-22 ⚠️ 坑：先写了测试 → 后补实现", "key-pitfall-1", lessonsMod.PITFALL_CATEGORY);
    await inst.appendLesson(ws, "- 2026-09-22 ⚠️ 纠错：别再用 git add . → 只 add 自己的文件", "key-correction-1", lessonsMod.CORRECTION_CATEGORY);
    const corrFile = readFileSync(join(memDir, "lessons", "corrections.md"), "utf8");
    const pitFile = readFileSync(join(memDir, "lessons", "pitfalls.md"), "utf8");
    (corrFile.includes("别再用 git add .") && !corrFile.includes("先写了测试") ? ok : fail)("【105】纠错写进 lessons/corrections.md 且未串到坑文件");
    (pitFile.includes("先写了测试") && !pitFile.includes("别再用 git add .") ? ok : fail)("【105】坑写进 lessons/pitfalls.md（一个分类一个文件）");
    const ctx = (await inst.context(ws)).text;
    const iCorr = ctx.indexOf("用户纠错");
    const iPit = ctx.indexOf("任务经验");
    (iCorr >= 0 && iPit >= 0 && iCorr < iPit ? ok : fail)(`【105】注入块里纠错在坑之前（corr@${iCorr} < pit@${iPit}）`);
    const snap = await inst.snapshot(ws);
    (Array.isArray(snap.lessonGroups) && snap.lessonGroups.length === 2 ? ok : fail)("【105】快照带分类计数（设置页可见「纠错 N 条」）");
    /* 去重仍然生效（分类不破坏原有去重）：⛔ 键必须是**从现象里归一化出来的**（真实链路的做法），
       自己编一个 "key-xxx" 放进断言会恒为"没重复"——那是假绿。 */
    const normKey = (s) => s.replace(/[\s，。！？、,.!?:：；;""''（）()【】\[\]]/g, "").slice(0, 32);
    const corrLine = "- 2026-09-22 ⚠️ 纠错：别再用 git add . → 只 add 自己的文件";
    (await inst.appendLesson(ws, corrLine, normKey(corrLine), lessonsMod.CORRECTION_CATEGORY) === false ? ok : fail)("【105】同现象重复写仍被去重拦下");
    rmSync(ws, { recursive: true, force: true });
  }

  if (pruneMod) {
    const { MEMORY_CATEGORY_WEIGHT, pickPrunable } = pruneMod;
    (typeof MEMORY_CATEGORY_WEIGHT["用户纠错"] === "number" && MEMORY_CATEGORY_WEIGHT["用户纠错"] >= Math.max(...Object.values(MEMORY_CATEGORY_WEIGHT)) ? ok : fail)("【105】「用户纠错」权重最高（高于项目背景）");
    const now = Date.now();
    const recs = [];
    for (let i = 0; i < 3; i += 1) recs.push({ id: "c" + i, category: "用户纠错", content: "纠错" + i, updatedAt: now - 90 * 86400000 });
    for (let i = 0; i < 6; i += 1) recs.push({ id: "t" + i, category: "临时上下文", content: "临时" + i, updatedAt: now - 90 * 86400000 });
    const { keep, dropped } = pickPrunable(recs, { now, maxRecords: 2 });
    (keep.filter((r) => r.category === "用户纠错").length === 3 ? ok : fail)("【105】容量淘汰绝不丢「用户纠错」（丢掉就等着再犯）");
    (dropped.every((r) => r.category !== "用户纠错") ? ok : fail)("【105】被淘汰的都没有纠错项");
  }

  /* ⑤ 渲染层分类清单 + 引擎指令的分类规则 */
  const constSrc = readFileSync(join(ROOT, "src", "features", "app-view", "constants", "02-identity-onboarding.tsx"), "utf8");
  (/name: "用户纠错"/.test(constSrc) ? ok : fail)("【105】渲染层分类清单含「用户纠错」（复用同一套分类，不另起一套）");
  try {
    const { buildDevInstructions } = await import("../../dist-electron/developer-instructions.js");
    const instr = buildDevInstructions({});
    /* 分类在**指令里**表现为"一个分类一个文件"（v2 布局）；断言跟着实现走，别再盯分节标题 */
    const need = ["用户纠错", "corrections.md", "preferences.md", "sop.md", "pitfalls.md", "⚠️ 纠错："];
    const miss = need.filter((n) => !instr.includes(n));
    (miss.length === 0 ? ok : fail)(`【105】引擎指令写明四个分类文件与纠错标记${miss.length ? "，缺：" + miss.join(" / ") : ""}`);
  } catch (error) { fail(`【105】引擎指令产物读不到：${error?.message ?? error}`); }
}
  }

  /* ══ 【106】原 L8748–L8807 ══ */
  {
{
  console.log(C.bold("\n【106】记忆目录布局：分类子文件夹 / v1→v2 迁移 / 不覆盖"));
  let memMod = null;
  try { memMod = await import("../../dist-electron/memory-layers.js"); }
  catch (error) { fail(`【106】记忆分层产物读不到：${error?.message ?? error}`); }

  if (memMod) {
    const { MemoryLayers } = memMod;

    /* ① v1 现场 → 迁移 */
    const ws = mkdtempSync(join(ROOT, "node_modules", ".p106-"));
    const memDir = join(ws, ".codex-harness", "memory");
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, "MEMORY.md"), "# 项目记忆\n\n- 旧约定 A\n", "utf8");
    writeFileSync(join(memDir, "BACKGROUND.md"), "# 背景\n\n- 老背景\n", "utf8");
    writeFileSync(join(memDir, "2026-09-01.md"), "# 2026-09-01\n\n- 需求：旧日志\n", "utf8");
    writeFileSync(join(memDir, "LESSONS.md"), "# 纪律与记忆\n\n## 用户纠错\n- 2026-09-01 ⚠️ 纠错：别用 add .\n\n## 任务经验\n- 2026-09-01 ⚠️ 坑：端口写错\n", "utf8");
    const inst = new MemoryLayers(join(ws, ".codex-harness", "userdata"));
    const project = await inst.readProject(ws); // 这一读触发迁移
    (String(project).includes("旧约定 A") ? ok : fail)("【106】迁移后仍读得到项目宪法（内容不丢）");
    (existsSync(join(memDir, "project", "MEMORY.md")) ? ok : fail)("【106】MEMORY.md 搬进 project/ 子目录");
    (existsSync(join(memDir, "project", "BACKGROUND.md")) ? ok : fail)("【106】BACKGROUND.md 搬进 project/");
    (existsSync(join(memDir, "logs", "2026-09-01.md")) ? ok : fail)("【106】日志搬进 logs/");
    (!existsSync(join(memDir, "MEMORY.md")) && !existsSync(join(memDir, "LESSONS.md")) ? ok : fail)("【106】旧位置的散文件已搬空（移动而非复制 ⇒ 不留两份真相）");
    (existsSync(join(memDir, "archive", "legacy-LESSONS.md")) ? ok : fail)("【106】旧 LESSONS.md 归档到 archive/（原文可回溯）");
    const corr = readFileSync(join(memDir, "lessons", "corrections.md"), "utf8");
    const pit = readFileSync(join(memDir, "lessons", "pitfalls.md"), "utf8");
    (corr.includes("别用 add .") && !corr.includes("端口写错") ? ok : fail)("【106】旧「用户纠错」进 corrections.md 且没串到别类");
    (pit.includes("端口写错") && !pit.includes("别用 add .") ? ok : fail)("【106】旧「任务经验」进 pitfalls.md");
    const merged = await inst.readLessons(ws);
    (/## 用户纠错/.test(merged) && /## 任务经验/.test(merged) ? ok : fail)("【106】读回仍是「## 分类」文本（注入/快照/蒸馏复用同一解析）");
    const snapBefore = readFileSync(join(memDir, "lessons", "corrections.md"), "utf8");
    await inst.readProject(ws);
    await inst.readLessons(ws);
    (readFileSync(join(memDir, "lessons", "corrections.md"), "utf8") === snapBefore ? ok : fail)("【106】迁移幂等（重复触发不改内容）");

    /* ② 新写入落点 */
    await inst.appendLesson(ws, "- 2026-09-22 ⚠️ 纠错：新纠错 → 落 corrections", "k-p106-new", "用户纠错");
    (readFileSync(join(memDir, "lessons", "corrections.md"), "utf8").includes("落 corrections") ? ok : fail)("【106】新追加写进 lessons/corrections.md（不是旧的散文件）");
    await inst.appendLog(ws, "- 需求：x\n- 结论：y");
    (readdirSync(join(memDir, "logs")).filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n)).length >= 2 ? ok : fail)("【106】日志写进 logs/");
    const snap = await inst.snapshot(ws);
    (snap.paths.project.endsWith(join("project", "MEMORY.md")) && snap.paths.lessons.endsWith("lessons") && snap.paths.logDir.endsWith("logs") ? ok : fail)("【106】快照路径指向新布局（设置页显示的路径不骗人）");

    /* ③ 不覆盖：新位置有内容时，旧文件只归档、不合并 */
    const ws2 = mkdtempSync(join(ROOT, "node_modules", ".p106b-"));
    const memDir2 = join(ws2, ".codex-harness", "memory");
    mkdirSync(join(memDir2, "lessons"), { recursive: true });
    writeFileSync(join(memDir2, "lessons", "corrections.md"), "## 用户纠错\n- 新内容（新布局已写）\n", "utf8");
    writeFileSync(join(memDir2, "LESSONS.md"), "# 纪律与记忆\n\n## 用户纠错\n- 旧内容（应只留在 archive）\n", "utf8");
    const inst2 = new MemoryLayers(join(ws2, ".codex-harness", "userdata"));
    await inst2.readLessons(ws2);
    const kept = readFileSync(join(memDir2, "lessons", "corrections.md"), "utf8");
    (kept.includes("新内容") && !kept.includes("旧内容") ? ok : fail)("【106】新位置已有内容 ⇒ 不追加不覆盖（新旧不混成一锅）");
    (existsSync(join(memDir2, "archive", "legacy-LESSONS.md")) ? ok : fail)("【106】被跳过的旧内容仍归档保存（没丢）");

    rmSync(ws, { recursive: true, force: true });
    rmSync(ws2, { recursive: true, force: true });
  }
}
  }

  /* ══ 【107】原 L8816–L8988 ══ */
  {
{
  console.log(C.bold("\n【107】记忆整洁与清理规则（规则表 / 待办 / 动作真跑 / 二次确认护栏）"));
  let hyg = null;
  let memMod3 = null;
  try { hyg = await import("../../dist-electron/memory-hygiene.js"); }
  catch (error) { fail(`【107】整洁规则产物读不到（先 npm run build）：${error?.message ?? error}`); }
  try { memMod3 = await import("../../dist-electron/memory-layers.js"); }
  catch (error) { fail(`【107】记忆分层产物读不到：${error?.message ?? error}`); }

  if (hyg) {
    const { CLEANUP_RULES, HYGIENE_ACTIONS, HYGIENE_ACTION_LABEL, isHygieneAction, lintLessonLines, planHygiene, suggestedActions } = hyg;

    /* ① 规则表 */
    (CLEANUP_RULES.length === 8 ? ok : fail)(`【107】清理规则八层齐全（实际 ${CLEANUP_RULES.length}）`);
    (CLEANUP_RULES.map((r) => r.layer).join(",") === "L0,L1,L2,L3,L4,L5,L6,L7" ? ok : fail)("【107】规则层 id 与金字塔一致（L0..L7）");
    (CLEANUP_RULES.every((r) => r.when && r.action && r.protect && r.trace) ? ok : fail)("【107】每层都写明「何时清 / 动作 / 保护项 / 留痕」");
    const l0 = CLEANUP_RULES.find((r) => r.layer === "L0");
    (/禁止/.test(l0.action) ? ok : fail)("【107】L0 用户档案：规则写明禁止自动压缩/删除");
    const l2 = CLEANUP_RULES.find((r) => r.layer === "L2");
    (/用户纠错/.test(l2.protect) ? ok : fail)("【107】L2 保护项点名「用户纠错」（只许压缩措辞、不许删条）");
    const l6 = CLEANUP_RULES.find((r) => r.layer === "L6");
    (/二次确认/.test(l6.action) ? ok : fail)("【107】L6 冷存档：清空需二次确认且告知不可回溯");
    (HYGIENE_ACTIONS.length === 3 ? ok : fail)("【107】清理动作白名单 = 3 个（purge-archive / prune-pool / tidy-lessons）");
    (isHygieneAction("purge-archive") && isHygieneAction("prune-pool") && isHygieneAction("tidy-lessons") ? ok : fail)("【107】白名单内的动作被接受");
    (!isHygieneAction("rm-rf") && !isHygieneAction("") && !isHygieneAction(null) && !isHygieneAction({}) ? ok : fail)("【107】未知 / 空 / 非字符串动作一律拒绝（白名单不是「有就行」）");
    (HYGIENE_ACTIONS.every((a) => HYGIENE_ACTION_LABEL[a]?.title && HYGIENE_ACTION_LABEL[a]?.danger) ? ok : fail)("【107】每个动作都有标题 + 后果说明（UI 二次确认要显示危险）");

    /* ② 纯函数 */
    const dirty = "- 2026-09-22 ⚠️ 纠错：没日期标记的条目\n- 修好了东西\n- 2026-09-22 约定：x\n";
    const lintCodes = lintLessonLines(dirty).map((i) => i.code);
    (lintCodes.includes("lesson-no-mark") && lintCodes.includes("lesson-no-date") ? ok : fail)(`【107】lint 抓到缺日期/缺分类标记（${lintCodes.join(",")}）`);
    (lintLessonLines("- 2026-09-22 ⚠️ 纠错：规范条目 → 结论\n").length === 0 ? ok : fail)("【107】规范条目零告警（不误报）");
    const issues = planHygiene({
      layers: [{ id: "L4", name: "每日日志", where: "logs/", budget: 40000, used: 38000, ratio: 0.95, needDistill: true, writer: "自动", sink: "沉 L5" }],
      lessonText: "- 2026-09-22 ⚠️ 纠错：ok → fine\n",
      archive: { files: 400, bytes: 3 * 1024 * 1024 },
      fragments: { total: 12, expiring: 2, expired: 3 },
      hasWorkspace: false,
    });
    const codes2 = issues.map((i) => i.code);
    (/layer-over|fragments-expired|archive-large|no-workspace/.test(codes2.join(" ")) ? ok : fail)(`【107】plan 汇总四类待办（${codes2.join(",")}）`);
    (suggestedActions([{ severity: "warn", layer: "L7", code: "fragments-expired", message: "" }, { severity: "warn", layer: "L2", code: "lesson-no-mark", message: "" }, { severity: "info", layer: "L6", code: "archive-large", message: "" }]).join(",") === "prune-pool,tidy-lessons,purge-archive" ? ok : fail)("【107】待办→动作映射正确（顺序稳定）");
    (planHygiene({ layers: [], lessonText: "", archive: { files: 1, bytes: 10 }, fragments: { total: 0, expiring: 0, expired: 0 }, hasWorkspace: true }).length === 0 ? ok : fail)("【107】干净状态零待办");

    /* ③ 真跑动作 */
    if (memMod3) {
      const ws = mkdtempSync(join(ROOT, "node_modules", ".p107-"));
      const memDir = join(ws, ".codex-harness", "memory");
      mkdirSync(join(memDir, "lessons"), { recursive: true });
      mkdirSync(join(memDir, "archive"), { recursive: true });
      const inst = new memMod3.MemoryLayers(join(ws, ".codex-harness", "userdata"));
      /* 脏格式：行尾空格 + 连续空行；内容与条目数必须原样保留 */
      writeFileSync(join(memDir, "lessons", "corrections.md"), "## 用户纠错   \n- 2026-09-22 ⚠️ 纠错：别用 add .   \n\n\n\n- 2026-09-22 ⚠️ 纠错：第二条   \n", "utf8");
      writeFileSync(join(memDir, "archive", "2026-09-01.md"), "# 旧日志\n内容\n", "utf8");
      writeFileSync(join(memDir, "archive", "2026-09-02.md"), "# 旧日志2\n内容\n", "utf8");
      const stats = await inst.archiveStats(ws);
      (stats.files === 2 ? ok : fail)(`【107】archiveStats 真跑（${stats.files} 个文件）`);
      const tidy = await inst.tidyLessons(ws);
      const tidied = readFileSync(join(memDir, "lessons", "corrections.md"), "utf8");
      (tidy.changed === 1 ? ok : fail)(`【107】tidy-lessons 真跑（改了 ${tidy.changed} 个文件）`);
      (!/[ \t]+\n/.test(tidied) && !/\n{3,}/.test(tidied) ? ok : fail)("【107】整理后无行尾空格、无连续空行");
      (tidied.split("\n").filter((l) => /^\s*-\s+/.test(l)).length === 2 && tidied.includes("第二条") ? ok : fail)("【107】整理是**无损**的（条目数与内容不变）");
      const purged = await inst.purgeArchive(ws);
      (purged.removed === 2 ? ok : fail)(`【107】purge-archive 真跑（删了 ${purged.removed} 个文件）`);
      /* ⛔ 清空是**整目录移除** ⇒ 目录可能已不存在；断言"没有残留文件"而不是"目录为空"（否则自己崩在 scandir） */
      (!existsSync(join(memDir, "archive")) || readdirSync(join(memDir, "archive")).length === 0 ? ok : fail)("【107】冷存档已清空（目录已移除或为空）");
      (existsSync(join(memDir, "lessons", "corrections.md")) ? ok : fail)("【107】清存档**不碰**其它层（纪律文件还在）");
      const trace = readFileSync(join(memDir, "pruned.jsonl"), "utf8");
      (/purge-archive/.test(trace) && /\d/.test(trace) ? ok : fail)("【107】清理留痕写进 pruned.jsonl（可追溯）");
      rmSync(ws, { recursive: true, force: true });
    }

    /* ④ 护栏（文本断言：改动这几处等于拆掉安全网） */
    const ipcSrc = readFileSync(join(ROOT, "electron", "features", "memory-rpa-ipc.ts"), "utf8");
    (/confirm !== true/.test(ipcSrc) ? ok : fail)("【107】IPC 层强制 confirm 检查（渲染层 bug 也删不掉冷存档）");
    (/isHygieneAction\(/.test(ipcSrc) ? ok : fail)("【107】IPC 层走动作白名单校验");
    (/memory:hygiene:plan/.test(ipcSrc) && /memory:hygiene:apply/.test(ipcSrc) ? ok : fail)("【107】两个通道都已注册（plan 只读 / apply 动作）");
    const regSrc = readFileSync(join(ROOT, "electron", "ipc-registry.ts"), "utf8");
    (/memory:hygiene:apply/.test(regSrc) && /prefix: "memory", count: 21/.test(regSrc) ? ok : fail)("【107】IPC 账本同步（memory 域 21 通道：09-25 加 backend:read/set）");
    /* preload 面 = 手写 + 生成（09-23 gen-ipc-bridge）：applyMemoryHygiene 的桥接已迁到生成文件 */
    const preloadSrc = readFileSync(join(ROOT, "electron", "preload.ts"), "utf8");
    (/applyMemoryHygiene/.test(preloadSrc) && /confirm: true/.test(preloadSrc) ? ok : fail)("【107】preload 桥接同步（apply 的类型要求 confirm: true）");
    const envSrc2 = readFileSync(join(ROOT, "src", "vite-env.d.ts"), "utf8");
    (/planMemoryHygiene/.test(envSrc2) && /applyMemoryHygiene/.test(envSrc2) ? ok : fail)("【107】渲染层类型声明同步（三件套同轮）");
    const panelsSrc = readFileSync(join(ROOT, "src", "features", "memory", "MemoryPanels.tsx"), "utf8");
    (/export function MemoryHygienePanel/.test(panelsSrc) ? ok : fail)("【107】整洁面板组件存在");
    (/pending === action/.test(panelsSrc) && /确认执行/.test(panelsSrc) ? ok : fail)("【107】UI 危险动作走二次确认（点一次只展开确认条）");
    const panelUse = readFileSync(join(ROOT, "src", "features", "app-view", "AppView", "07-memory-panel.tsx"), "utf8");
    (/<MemoryHygienePanel/.test(panelUse) ? ok : fail)("【107】整洁面板挂进了记忆中心（否则用户看不见）");
  }

  {
    /* ── 【108】记忆可信度四件套：截断可见化 / L5→L1 下沉 / L0 画像自维护 / scratch 隔离（09-22 实测教训）── */
    console.log(C.bold("\n【108】记忆可信度：截断可见化 / L5 下沉 / L0 画像 / scratch 隔离 / 指令四条"));
    let mem = null;
    try { mem = await import("../../dist-electron/memory-layers.js"); }
    catch (error) { fail(`【108】记忆分层产物读不到（先 npm run build）：${error?.message ?? error}`); }

    if (mem) {
      const { MemoryLayers, isScratchWorkspace } = mem;
      const ws = mkdtempSync(join(ROOT, "node_modules", ".p108-"));
      const memDir = join(ws, ".codex-harness", "memory");
      const inst = new MemoryLayers(join(ws, ".codex-harness", "userdata"));

      /* ④ 截断可见化：L1 超预算 → 注入块里必须有「被截断」标记，引擎不得在盲区里干活 */
      mkdirSync(join(memDir, "project"), { recursive: true });
      writeFileSync(join(memDir, "project", "MEMORY.md"), `# 项目记忆\n\n${"宪法条目。".repeat(2600)}`, "utf8"); // 13000 字 > 12000
      const ctx = (await inst.context(ws)).text;
      (/被截断 \d+ 字/.test(ctx) && /盲区/.test(ctx) ? ok : fail)("【108】L1 超预算注入时带截断标记（不再静默丢内容）");

      /* ② L5→L1 下沉：月卷超 90% 线 → distillRollup 把最老月卷提炼进 L1，月卷原文保留 */
      mkdirSync(join(memDir, "rollups"), { recursive: true });
      writeFileSync(join(memDir, "rollups", "2026-08.md"), `# 2026-08 月度卷宗\n${"八月事项。".repeat(2400)}`, "utf8"); // 12000 字 ≥ 90%×12000
      const rp = await inst.distillRollup(ws, async () => "## 核心\n- 八月结论：口径 X\n\n## 纪要\n- 八月阶段：做了 Y\n");
      (rp.ok && rp.dates[0] === "2026-08" ? ok : fail)(`【108】L5→L1 下沉真跑（${rp.ok ? "ok" : rp.reason}）`);
      (rp.ok && readFileSync(join(memDir, "project", "MEMORY.md"), "utf8").includes("八月结论") ? ok : fail)("【108】月卷提炼进了 L1 项目宪法");
      (rp.ok && existsSync(join(memDir, "rollups", "2026-08.md")) ? ok : fail)("【108】月卷原文保留（下沉 ≠ 删除）");
      const rp2 = await inst.distillRollup(ws, async () => "x");
      (!rp2.ok && /不足 6 小时/.test(rp2.reason ?? "") ? ok : fail)(`【108】下沉受 6 小时节流约束（实际：${rp2.reason}）`);

      /* ① L0 画像自维护：追加去重 + 只追加不覆盖
         ⛔ 09-24 修复：下面三条原先写成 `cond ? ok : fail("…")`（**缺外层括号**）——
            条件为真时 `ok` 根本不被调用 ⇒ 断言一行都不打印、静默漏检（正是 AGENTS.md 探针方法论记的事故）。
            实测这三条消息曾完全不出现在输出里。新形态由【135】静态钉死，防止再写回。 */
      ((await inst.appendUserProfile("- 2026-09-22 画像：重度开发者，偏好直接反馈")) === true ? ok : fail)("【108】USER.md 画像追加成功");
      ((await inst.appendUserProfile("- 2026-09-22 画像：重度开发者，偏好直接反馈")) === false ? ok : fail)("【108】同文画像被去重拦下");
      ((await inst.appendUserProfile("- 2026-09-22 画像：主力栈 TypeScript")) === true ? ok : fail)("【108】不同画像可继续追加");
      const userTxt = readFileSync(inst.userFile, "utf8");
      ((userTxt.match(/画像：/g) || []).length === 2 && userTxt.includes("主力栈") ? ok : fail)("【108】USER.md 两条画像并存（只追加不覆盖）");

      /* scratch 隔离：识别真跑 + projectDir 拦截（appendLog 到 scratch 路径不落盘） */
      (isScratchWorkspace(join(ws, "dist", "scratch", "chat-20260922-mucemlrp")) && !isScratchWorkspace(join(ws, "my-project")) ? ok : fail)("【108】isScratchWorkspace 识别准确（scratch/chat-… 命中、普通项目不误伤）");
      await inst.appendLog(join(ws, "scratch", "chat-20260922-abc12345"), "- 需求：测试\n- 结果：x");
      (!existsSync(join(ws, "scratch", "chat-20260922-abc12345", ".codex-harness")) ? ok : fail)("【108】scratch 会话不落任何项目记忆（否则构建即清 = 假记忆）");

      /* B 组：指令四条（历史检索 / 技能用前查+用后养 / 收尾清单）+ L0 授权 */
      const instrSrc = readFileSync(join(ROOT, "electron", "developer-instructions.ts"), "utf8");
      const need = ["HISTORICAL RECALL", "USE-BEFORE-WRITE", "MAINTAIN:", "WRAP-UP CHECKLIST", "co-maintain"];
      const miss = need.filter((n) => !instrSrc.includes(n));
      (miss.length === 0 ? ok : fail)(`【108】引擎指令含新四条 + L0 授权${miss.length ? "，缺：" + miss.join(" / ") : ""}`);
    }
  }

  {
    /* ── 【109】思考卡碎片防御（09-22 用户群反馈：中转网关逐 delta 递增 summaryIndex ⇒
         思考内容碎成 2~4 字短行，停止重发又恢复）。纯函数真跑 + stream.ts 接线断言。── */
    console.log(C.bold("\n【109】思考卡碎片防御：summary 短段并入真跑"));
    let mrg = null;
    try { mrg = await import("../../src/lib/reasoning-part-merge.mjs"); }
    catch (error) { fail(`【109】reasoning-part-merge.mjs 读不到：${error?.message ?? error}`); }
    if (mrg) {
      const { mergeReasoningPartIndex } = mrg;
      const MIN = 30;
      /* ① 碎片场景（网关逐条递增 index）：连续 6 条 2 字 delta 各自递增 index ⇒ 全并进同一段 */
      let parts = [];
      let idx = 0;
      for (const d of ["好。", "执行", "好。", "OK", "好。", "继续"]) { idx = mergeReasoningPartIndex(parts, idx, "summary", d, MIN); parts[idx] = (parts[idx] ?? "") + d; idx += 1; }
      (parts.filter(Boolean).length === 1 && parts[0] === "好。执行好。OK好。继续" ? ok : fail)(`【109】逐条递增 index 的碎片滚成一段（实际 ${JSON.stringify(parts)}）`);
      /* ② 正常分段不受影响：part0 长段，part1 首片照常开新段 */
      const long = "用户要求修复登录页的样式回归，我先看 CSS 分节文件再决定动哪一层。"; // 31 字
      parts = [long];
      (mergeReasoningPartIndex(parts, 1, "summary", "先看布局", MIN) === 1 ? ok : fail)("【109】正常分段（前段够长）不并入，新段照常");
      /* ③ 长短交替：短碎后接长段，长段之后的新段不受前面碎片影响 */
      parts = ["好。", long];
      (mergeReasoningPartIndex(parts, 2, "summary", "新的思考", MIN) === 2 ? ok : fail)("【109】最近非空段是长段时不并入（碎片防御不吞正常分段）");
      /* ④ 边界：index 0 / 空白 delta / content 字段 / 落点已有内容（续写）一律原位 */
      (mergeReasoningPartIndex([], 0, "summary", "好。", MIN) === 0 ? ok : fail)("【109】index 0 恒原位");
      (mergeReasoningPartIndex(["好。"], 1, "summary", "  ", MIN) === 1 ? ok : fail)("【109】空白增量不触发合并");
      (mergeReasoningPartIndex(["好。"], 1, "content", "x", MIN) === 1 ? ok : fail)("【109】content 字段不参与防御（命令输出/思考原文不受影响）");
      (mergeReasoningPartIndex(["长段长段长段"], 0, "summary", "续写", MIN) === 0 ? ok : fail)("【109】落点已有内容 = 续写既有段");
    }
    /* stream.ts 接线：合并函数被调用 + 阈值常量 + 只对 summary 的字段约束在 .mjs 里 */
    const streamSrc = readFileSync(join(ROOT, "src", "features", "app-view", "helpers", "stream.ts"), "utf8");
    (/mergeReasoningPartIndex\(parts, index, field, delta, REASONING_MIN_PART_CHARS\)/.test(streamSrc) && /REASONING_MIN_PART_CHARS = 30/.test(streamSrc)
      ? ok : fail)("【109】stream.ts 已接线（appendIndexedDelta 调合并函数，阈值 30）");
  }

  /* ── 【110】注入块**残缺形态**不得泄漏进气泡/标题（09-22 用户截图：常驻记忆首次触发即铺满气泡与左栏标题）──
     实测 rollout 原文（取证于 D:/codexFBces/.../rollout-…21-57-25.jsonl 第 219 行）：
       `空是因为这个是新会话…\n\n[Harness 常驻记忆 · …]\n## 踩坑与纪律…\n- ⚠️ 坑：…` + 召回块
     头标签在、闭合标签 `[常驻记忆结束]` 丢了 ⇒ 成对正则不命中，整段铺进 UI。 */
  {
    let strip = null;
    try { strip = await import("../../src/lib/harness-block-strip.mjs"); }
    catch (error) { fail(`【110】harness-block-strip.mjs 读不到：${error?.message ?? error}`); }
    if (strip) {
      const { stripHarnessBlocks } = strip;
      /* ① 真实残缺形态（用户原话 + 缺尾常驻块 + 召回块）⇒ 只剩用户原话 */
      const real = "空是因为这个是新会话，用户画像没有是因为我没填\n\n" +
        "[Harness 常驻记忆 · 以下为已确认的长期上下文，与当前请求冲突时以当前请求为准]\n" +
        "## 踩坑与纪律（必须遵守，别再犯）\n# 纪律与记忆\n\n> 按分类分节：用户纠错（注入最前、永不淘汰）/ 任务经验 / 工作流-SOP / 用户偏好。\n\n" +
        "## 任务经验\n- 2026-09-22 ⚠️ 坑：看下你的记忆板块功能，自检一下 \n\n" +
        "[Harness 相关记忆，仅供参考]\n[任务经验] 旧的一条\n[记忆结束]\n";
      const out1 = stripHarnessBlocks(real);
      (out1.trim() === "空是因为这个是新会话，用户画像没有是因为我没填" ? ok : fail)(`【110】残缺常驻块被剥净（实际剩：${JSON.stringify(out1.trim().slice(0, 60))}）`);
      /* ② 完整形态（成对闭合）仍然剥净 */
      const full = "帮我改下样式\n\n[Harness 常驻记忆 · 上下文]\n## 项目记忆\n- 约定\n[常驻记忆结束]\n\n[Harness 相关记忆，仅供参考]\n- 记一条\n[记忆结束]\n";
      (stripHarnessBlocks(full).trim() === "帮我改下样式" ? ok : fail)("【110】完整形态（成对闭合）仍剥净");
      /* ③ ⛔ 不误伤：用户在正文里**讨论**这些标签（头标签后不是注入块特征）⇒ 原样保留 */
      const discussing = "你看这里 [Harness 常驻记忆] 这个标签为什么漏出来了？";
      (stripHarnessBlocks(discussing) === discussing ? ok : fail)("【110】用户正文里提到标签不误伤（不吞用户原话）");
      /* ④ 空/非字符串不炸 */
      (stripHarnessBlocks("") === "" ? ok : fail)("【110】空串返回空串");
    }
    /* ⑤ 两侧都接了同一实现（气泡 = parseUserRefs，标题 = cleanThreadDisplayTitle） */
    const refsSrc = readFileSync(join(ROOT, "src", "lib", "user-refs.ts"), "utf8");
    ((refsSrc.match(/stripHarnessBlocks\(/g) || []).length >= 2 && /from "\.\/harness-block-strip\.mjs"/.test(refsSrc)
      ? ok : fail)("【110】气泡（parseUserRefs）与标题（cleanThreadDisplayTitle）都走同一剥离实现");
    /* ⑥ 注入端契约：context() 真实输出必须**同时**含头与尾（防"缺尾"再出现） */
    let mem = null;
    try { mem = await import("../../dist-electron/memory-layers.js"); } catch { /* 下面报 */ }
    if (mem) {
      const ws = mkdtempSync(join(ROOT, "node_modules", ".p110-"));
      const memDir = join(ws, ".codex-harness", "memory");
      mkdirSync(join(memDir, "lessons"), { recursive: true });
      writeFileSync(join(memDir, "lessons", "pitfalls.md"), "# 纪律与记忆\n\n> 按分类分节\n\n## 任务经验\n- 2026-09-22 ⚠️ 坑：测试\n", "utf8");
      const ctx = new mem.MemoryLayers(join(ws, ".codex-harness", "ud"));
      const text = (await ctx.context(ws)).text;
      (/\[Harness 常驻记忆/.test(text) && /\[常驻记忆结束\]/.test(text) ? ok : fail)("【110】注入端 context() 头尾成对（闭合标签不得丢）");
      rmSync(ws, { recursive: true, force: true });
    }
  }

  /* ── 【111】未知回合的 userMessage 不得被静默丢弃 ──
     （09-23 用户实测：「排队消息自动发出时对话框里不出现那条消息，agent 只短暂显示正在回复然后就结束」）
     实证（真实 app-server + mock 上游，09-23）：`turn/started` 的回合快照 items=[]、
     `turn/completed` 的快照 items=[agentMessage] —— 引擎从不在这两处带用户消息，它只走
     item/started / item/completed；而排队消息由**引擎自己**启动成新回合（队列随即清空，应用侧
     thread/queue/list 拿到空数组）⇒ 应用不建回合。一旦 userMessage 事件比 turn/started 早到，
     旧实现当场丢弃且再无补救（turn/completed 不含它）⇒ 只剩「没有用户消息的回复」。
     本守卫把「未知回合的 userMessage 必须建出回合容器」钉成不变量。 */
  {
    let adopt = null;
    try { adopt = await import("../../src/lib/turn-item-merge.mjs"); }
    catch (error) { fail(`【111】turn-item-merge.mjs 读不到：${error?.message ?? error}`); }
    if (adopt) {
      const { adoptUnknownTurn } = adopt;
      const msg = { id: "u2", type: "userMessage", content: [{ type: "text", text: "排队哨兵" }] };
      /* ① 未知回合 + userMessage ⇒ 必须建出回合（否则那条用户消息永久消失） */
      const made = adoptUnknownTurn([{ id: "t1" }], "t2", msg);
      (made && made.id === "t2" && made.items.length === 1 && made.items[0] === msg
        ? ok : fail)(`【111】未知回合的 userMessage 建出回合容器（实际 ${JSON.stringify(made)}）`);
      /* ② 建出来的回合是「运行中」：渲染端才按流式态渲染，不会收成历史折叠组 */
      (made && made.status === "inProgress" ? ok : fail)("【111】承接回合状态为 inProgress");
      /* ③ 回合已存在 ⇒ 不建（交给正常合并，避免重复回合） */
      (adoptUnknownTurn([{ id: "t1" }, { id: "t2" }], "t2", msg) === null ? ok : fail)("【111】回合已存在时不重复建（走正常合并）");
      /* ④ 非 userMessage 的产出条目 ⇒ 不建（防「没有用户消息的孤儿回复」，09-19 修过的 bug） */
      (adoptUnknownTurn([{ id: "t1" }], "t2", { id: "a2", type: "agentMessage", text: "OK" }) === null
        ? ok : fail)("【111】未知回合的产出条目不建回合（不造孤儿回复）");
      /* ⑤ 边界：无回合 id / 空 item / turns 非数组一律 null（不造匿名回合、不炸） */
      (adoptUnknownTurn([], "", msg) === null ? ok : fail)("【111】无回合 id 不建");
      (adoptUnknownTurn([], "t2", null) === null ? ok : fail)("【111】空 item 不建");
      (adoptUnknownTurn(null, "t2", msg) === null ? ok : fail)("【111】turns 非数组不炸");
    }
    /* stream.ts 接线：mergeItem 里必须**先判定、后合并**（顺序反了等于没接） */
    const streamSrc = readFileSync(join(ROOT, "src", "features", "app-view", "helpers", "stream.ts"), "utf8");
    const fnIdx = streamSrc.indexOf("export function mergeItem");
    const callIdx = streamSrc.indexOf("adoptUnknownTurn(thread.turns, turnId, item)");
    const mapIdx = streamSrc.indexOf("turns: thread.turns.map((turn) =>");
    (/from "\.\.\/\.\.\/\.\.\/lib\/turn-item-merge\.mjs"/.test(streamSrc) && fnIdx >= 0 && callIdx > fnIdx && mapIdx > callIdx
      ? ok : fail)(`【111】stream.ts 接线（导入 + mergeItem 内先判定后合并；fn=${fnIdx} call=${callIdx} map=${mapIdx}）`);
  }

  /* ══ 【113】【114】技能内置与安装门禁（09-23 加）══ */
  {
    // 【113】四个新内置技能**真跑落盘**（不是 grep 常量）：ensureBuiltinSkills 写到临时目录，
    //        再逐个断言 SKILL.md 存在且含必需结构（frontmatter name/description + 关键判据行）。
    //        ⛔ 只查常量字符串会漏掉「注册了但写不进磁盘」与「正文缺段」两种真故障。
    let skillsMod = null;
    try { skillsMod = await import("../../dist-electron/builtin-skills.js"); }
    catch (error) { fail(`【113】无法加载 builtin-skills 产物：${error.message}`); }
    if (skillsMod) {
      const ws = mkdtempSync(join(tmpdir(), "skills-audit-"));
      try {
        await skillsMod.ensureBuiltinSkills(ws);
        const expect = [
          ["self-review", ["name: self-review", "description:", "升级规则", "判据"]],
          ["memory-hygiene", ["name: memory-hygiene", "description:", "永不自动清", "二次确认"]],
          ["memory-classify", ["name: memory-classify", "description:", "用户纠错", "去重"]],
          ["skill-audit", ["name: skill-audit", "description:", "提示注入", "不得安装"]],
        ];
        for (const [name, needles] of expect) {
          const file = join(ws, name, "SKILL.md");
          if (!existsSync(file)) { fail(`【113】内置技能 ${name} 未落盘（ensureBuiltinSkills 漏注册？）`); continue; }
          const text = readFileSync(file, "utf8");
          const missing = needles.filter((n) => !text.includes(n));
          (missing.length === 0 ? ok : fail)(`【113】内置技能 ${name} 已落盘且结构完整（${text.length} 字）${missing.length ? "｜缺：" + missing.join(" / ") : ""}`);
        }
      } finally { rmSync(ws, { recursive: true, force: true }); }
    }

    // 【114】安装门禁**三处同源**：① skill-pack 常量；② AGENTS.md 守则；③ 每轮指令；④ 导入通道。
    //   ⛔ 第四处是本轮修的真缺口：此前只有市场安装走 auditSkill，本地导入 `skills:import` 完全没审
    //      ⇒ 用户随手挑一个来源不明的 SKILL.md 就能绕过审查，把任意指令送进执行链。
    const packSrc = readFileSync(join(ROOT, "electron", "skill-pack.ts"), "utf8");
    (/export const SELF_REVIEW_SKILL/.test(packSrc) && /export const MEMORY_HYGIENE_SKILL/.test(packSrc)
      && /export const MEMORY_CLASSIFY_SKILL/.test(packSrc) && /export const SKILL_AUDIT_SKILL/.test(packSrc)
      ? ok : fail)("【114】skill-pack 里四个技能名常量齐全（self-review / memory-hygiene / memory-classify / skill-audit）");

    let disc = "";
    try {
      const mod = await import("../../dist-electron/skill-discipline.js");
      disc = mod.buildDisciplineSection({ skills: [], mcp: [] });
    } catch (error) { fail(`【114】无法加载 skill-discipline 产物：${error.message}`); }
    if (disc) {
      (disc.includes("skill-audit") && /审查/.test(disc) && /不得安装/.test(disc)
        ? ok : fail)("【114】AGENTS.md 守则：装技能前必须先过 skill-audit 审查，未通过不得安装");
      (disc.includes("self-review") && disc.includes("memory-classify") && disc.includes("memory-hygiene")
        ? ok : fail)("【114】AGENTS.md 守则含收尾复盘 / 记忆分类 / 记忆整洁三条");
    }

    let dev = "";
    try {
      const mod = await import("../../dist-electron/developer-instructions.js");
      dev = mod.buildDevInstructions({});
    } catch (error) { fail(`【114】无法加载 developer-instructions 产物：${error.message}`); }
    if (dev) {
      (dev.includes("MANDATORY skill-install gate") && dev.includes("skill-audit")
        ? ok : fail)("【114】每轮指令含强制安装门禁（与守则引用同一个技能名）");
      (dev.includes("END-OF-TASK REVIEW") && dev.includes("self-review")
        ? ok : fail)("【114】每轮指令含收尾复盘触发（并指向 self-review 技能）");
      (dev.includes("memory-classify") && dev.includes("memory-hygiene")
        ? ok : fail)("【114】每轮指令含记忆分类与整洁规则（指向对应技能）");
    }

    const importSrc = readFileSync(join(ROOT, "electron", "features", "builtin-skills-ipc", "02-skills-registry.ts"), "utf8");
    const at = importSrc.indexOf('ipcMain.handle("skills:import"');
    const nextAt = at >= 0 ? importSrc.indexOf("ipcMain.handle(", at + 10) : -1;
    const body = at >= 0 ? importSrc.slice(at, nextAt > 0 ? nextAt : importSrc.length) : "";
    const audited = at >= 0 && /auditSkill\(/.test(body) && /安全检查未通过/.test(body) && /throw new Error/.test(body);
    (audited ? ok : fail)("【114】skills:import 导入口也过安全审查（否则本地导入是绕开审查的后门）");
  }

  /* ══ 【119】09-23 加：剥离必须抗「自指污染」══════════════════════════
     L2 纪律行会在正文里**字面写出**闭合标签（它在描述"要剥掉哪些标签"）。若剥离用非贪婪成对正则，
     就会在纪律行内部**提前闭合** ⇒ 只剥前半段、后半段铺进 L4「需求」/L2「现象」，并继续喂出新的垃圾行。
     判据：① 行为（真跑两个同源函数）；② 结构（四处同源正则都带「独立成行」约束）。 */
  /* 【119】-【121】自带产物引用：【102】块里的 lessonMod 是块级 let，出块即不可见（09-23 踩过） */
  const memLessons = await import("../../dist-electron/memory-lessons.js").catch((error) => {
    /* ⛔ 不能静默吞：产物读不到时下面的断言会一行都不打印、check 依旧绿（09-23 评审抓到的假绿面） */
    fail(`【119】【120】坑判定产物读不到（先 npm run build）：${error?.message ?? error}`);
    return null;
  });

  {
    const clean = "哈喽";
    const selfRef = [
      "[Harness 常驻记忆 · 上下文]",
      "## 任务经验",
      "- 旧纪律行：生成候选前先剥掉 `[Harness …]…[常驻记忆结束]` 与 `[Harness 相关记忆…][记忆结束]` 两段。",
      "## 用户偏好",
      "- 偏好：喜欢简短",
      "[常驻记忆结束]",
    ].join("\n");
    const injected = clean + "\n\n" + selfRef;
    if (memLessons) {
      const out = memLessons.stripInjectedBlocks(injected);
      (out === clean ? ok : fail)(`【119】自指污染：块内字面闭合标签不得提前闭合剥离（实际残留 ${JSON.stringify(out.slice(0, 60))}）`);
    }
    try {
      const { stripHarnessBlocks } = await import("../../src/lib/harness-block-strip.mjs");
      const out2 = stripHarnessBlocks(injected).trim();
      (out2 === clean ? ok : fail)(`【119】渲染侧同源函数同样抗自指污染（实际 ${JSON.stringify(out2.slice(0, 60))}）`);
    } catch (error) { fail(`【119】harness-block-strip 读不到：${error?.message ?? error}`); }

    /* 四处同源正则：改一处漏一处 = 静默半剥。⛔ 第四处查的是**源** rollout-worker.cjs ——
       rollout-worker-source.ts 是 gen-rollout-worker.mjs 的生成物（build:electron 里无条件重写、且 gitignore），
       改生成物 = 白改（09-23 实证：patch 后跑一次 build 就没了）。 */
    for (const rel of ["electron/memory-lessons.ts", "src/lib/harness-block-strip.mjs", "electron/thread-backup.ts", "electron/rollout-worker.cjs"]) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      const hits = (src.match(/\^\\{0,2}\[(?:常驻记忆结束|记忆结束)\\{0,2}\]/g) ?? []).length;
      (hits >= 2 ? ok : fail)(`【119】${rel} 闭合标签独立成行约束 ≥2 处（实际 ${hits}）`);
    }
  }


  /* ══ 【119b】09-23 评审补：头标签行首锚 / 落盘侧剥集 / CRLF 分支 ══════════
     ① 头标签也必须**独立成行**：否则用户正文里先出现字面头标签时，会从那里一路吞到真闭合标签（吞掉用户正文）；
     ② 落盘侧（memory-lessons）必须剥**四类**机器块 —— 漏一类就是每轮把机器块写进 L4「需求」/L2「现象」；
     ③ 新增的 \r?\n? 分支必须有断言覆盖（只喂 LF 样本等于没测）。 */
  {
    const four = ["electron/memory-lessons.ts", "src/lib/harness-block-strip.mjs", "electron/thread-backup.ts", "electron/rollout-worker.cjs"];
    for (const rel of four) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      const head = (src.match(/\.replace\(\/\^\\{0,2}\[(?:Harness 常驻记忆|Harness 相关记忆|当前时间|本轮已引用技能)/g) ?? []).length;
      (head >= 2 ? ok : fail)(`【119】${rel} 头标签行首锚 ≥2 处（实际 ${head}）`);
    }
    {
      const src = readFileSync(join(ROOT, "electron", "memory-lessons.ts"), "utf8");
      const at = src.indexOf("export function stripInjectedBlocks");
      const body = at >= 0 ? src.slice(at, at + 1600) : "";
      for (const tag of ["Harness 常驻记忆", "Harness 相关记忆", "本轮已引用技能", "当前时间"]) {
        (body.includes(tag) ? ok : fail)(`【119】落盘侧剥集含「${tag}」（漏一类 = 每轮把机器块写进记忆）`);
      }
    }
    if (memLessons) {
      const crlf = "哈喽\r\n\r\n[Harness 常驻记忆 · 上下文]\r\n- x\r\n[常驻记忆结束]\r\n尾随正文";
      const out3 = memLessons.stripInjectedBlocks(crlf);
      (/^哈喽\r\n\r\n尾随正文$/.test(out3) ? ok : fail)(`【119】CRLF 注入块同样剥净（实际 ${JSON.stringify(out3)}）`);
    }
  }

  /* ══ 【120】09-23 加：失败信号词不得命中常见中文 ══════════════════════
     /回归/ 命中「所有努力终将回归本心」⇒ 纯测试轮被判成踩坑、白产 L2 垃圾行（09-23 实证 7 条）。 */
  if (memLessons) {
    const noisy = memLessons.buildLessonLine({
      userContent: "请从 1 数到 30，每个数字单独一行，每行加一句说明。",
      assistantContent: "9 — 九九归一，所有努力终将回归本心。",
      date: "2026-09-23",
    });
    (noisy === null ? ok : fail)(`【120】正常中文里的「回归」不产坑行（实际 ${JSON.stringify(noisy?.line?.slice(0, 60))}）`);
    const real = memLessons.buildLessonLine({
      userContent: "这个页面打不开了",
      assistantContent: "结论：根因是路由写错，已修复并验证通过。",
      date: "2026-09-23",
    });
    (real ? ok : fail)("【120】真踩坑（报错 + 已修复）仍照记");
  }

  /* ══ 【121】09-23 加：含字面块标签的纪律行必须在**写入那一刻**被拦 ══════ */
  {
    const src = readFileSync(join(ROOT, "electron", "memory-layers.ts"), "utf8");
    const at = src.indexOf("async appendLesson(");
    const body = at >= 0 ? src.slice(at, at + 1600) : "";
    (/\.test\(text\)\)\s*return false/.test(body) ? ok : fail)("【121】appendLesson 拒绝含字面块标签的纪律行（写入即拦，防自指污染）");
    const guardRe = /\[Harness\s*(?:常驻记忆|相关记忆)|\[(?:常驻记忆结束|记忆结束)\]/;
    (guardRe.test("- ⚠️ 坑：含 `[常驻记忆结束]` 的旧行") && !guardRe.test("- ⚠️ 坑：机械删 main.ts 顶层定义，聚合导出被一起切掉")
      ? ok : fail)("【121】判据本身：命中含字面标签的行、放过正常纪律行");
    /* 源里用的必须**就是这个**正则（不是"某段像正则的文本"）—— 09-23 评审：把源里的正则换成 /never-matches/ 时，
       原来两条断言都仍绿（片段匹配 + 自证副本）。这里钉完整字面量。 */
    const fullRe = "/\\[Harness\\s*(?:常驻记忆|相关记忆)|\\[(?:常驻记忆结束|记忆结束)\\]/";
    (body.includes(fullRe) ? ok : fail)("【121】源里出现**完整**拦截正则字面量（不是片段）");
  }

  /* ══ 【125】09-23 加：被委派会话（子智能体 / 专家 / 专家团主理人 / 成员）也必须拿到记忆 ══
     用户原话：「子智能体跟专家团都有没有记忆板块跟功能，没有就完善好」。
     缺口：主会话的记忆是**渲染层发送路径**拼的（send.tsx），而被委派回合由主进程直接 turn/start
     ⇒ 子智能体/成员此前读不到任何记忆。修法 = electron/delegate-memory.ts + 三处接线。
     ⛔ 这几条的判据都是"能被违反"的：删掉任一接线、换掉标记、或让工作区退到 process.cwd() 都会红。 */
  {
    console.log(C.bold("\n【125】被委派会话的记忆注入（子智能体 / 专家 / 专家团 / 成员）"));
    const dmPath = join(ROOT, "electron", "delegate-memory.ts");
    (existsSync(dmPath) ? ok : fail)("【125】存在 electron/delegate-memory.ts（委派会话的记忆拼装模块）");
    if (existsSync(dmPath)) {
      const dm = readFileSync(dmPath, "utf8").replace(/\r/g, "");
      /* 门禁必须沿用既有真相源（工作区记忆开关），不许自造开关 */
      (/workspaceMemoryEnabled\(/.test(dm) ? ok : fail)("【125】门禁沿用 workspaceMemoryEnabled（不新增开关）");
      /* ⛔ 约束③：工作区不许退到 process.cwd()（那是应用安装目录 ⇒ 静默读到不存在的工作区）
         ⛔⛔ 必须先**剥注释**再匹配：这个模块的说明注释里就写着 `process.cwd()`（解释为什么不用它），
            直接 match 会命中注释 ⇒ 自造假红（09-23 实测，与【112】踩的是同一个坑）。 */
      const dmCode = dm.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      (!/process\.cwd\(\)/.test(dmCode) ? ok : fail)(
        "【125】代码里不得退到 process.cwd()（会是应用安装目录 —— 静默错误；注释不算）"
      );
      /* ⛔ 约束②：失败必须降级（记忆读不到不能把整个调度炸掉） */
      const catches = (dm.match(/catch\s*[({]/g) || []).length;
      (catches >= 2 ? ok : fail)(`【125】记忆读取失败全部降级（实得 ${catches} 处 catch，需 ≥2）`);
      /* ⛔ 约束①：标记必须与主会话逐字一致 —— 显示侧按这些标记整段剥离（【100】【119】） */
      (dm.includes("[Harness 相关记忆，仅供参考]") && dm.includes("[记忆结束]") ? ok : fail)(
        "【125】召回段用主会话同款标记（否则机器块会漏进用户气泡/标题/导出）"
      );
      (/memoryLayers\.context\(/.test(dm) ? ok : fail)("【125】常驻层走 memoryLayers.context()（自带 [Harness 常驻记忆] 标记）");
      (/memoryStore\.recall\(/.test(dm) ? ok : fail)("【125】按需召回走 memoryStore.recall()（L3 碎片池）");
    }

    /* 三处主进程发送路径都必须接上（少一处 = 那条路径的会话仍然失忆） */
    const deleg = readFileSync(join(ROOT, "electron", "features", "delegation.ts"), "utf8").replace(/\r/g, "");
    const nDeleg = (deleg.match(/buildDelegateMemory\(/g) || []).length;
    (nDeleg >= 1 ? ok : fail)(`【125】runDelegatedTask 接线（实得 ${nDeleg} 处，需 ≥1 —— 引擎调度的全部角色走它）`);
    (deleg.includes("delegateMemory.text") ? ok : fail)("【125】runDelegatedTask 的记忆段确实追到了出站文本上");

    const teams = readFileSync(join(ROOT, "electron", "features", "teams-agents-ipc.ts"), "utf8").replace(/\r/g, "");
    const nTeams = (teams.match(/buildDelegateMemory\(/g) || []).length;
    (nTeams >= 2 ? ok : fail)(
      `【125】成员会话两条入口都接线（实得 ${nTeams} 处，需 ≥2 —— teams:member-session + teams:invoke-member）`
    );
    (teams.includes("${memberMemory.text}") ? ok : fail)("【125】teams:member-session 的记忆段追到出站文本上");
    (teams.includes("${invokedMemory.text}") ? ok : fail)("【125】teams:invoke-member（主理人→成员）同理");

    /* 反向绊线：主会话那条注入路径不许被这次改动顺手改掉（标记/口径是两边共同契约） */
    const sendSrc = readFileSync(join(ROOT, "src", "features", "app-state", "parts", "part08", "02-seg", "send.tsx"), "utf8").replace(/\r/g, "");
    (sendSrc.includes("[Harness 相关记忆，仅供参考]") ? ok : fail)(
      "【125】主会话召回段标记未被改动（委派侧必须与它逐字同源）"
    );
  }
}

  /* ══ 【150】记忆后端二选一（09-25 加）══
     用户原话：「启用 MCP 记忆就优先用 MCP，不要 MCP 写了记忆又用金字塔记忆，这样重复了」。
     三条不变量：① 后端判定必须是叶子模块（放进 runtime-refs 会与 memory-layers 成环）；
     ② 内置记忆的写入入口必须让位（否则同一条记忆存两份）；③ 两个记忆技能互斥（否则模型
     同时收到「写 lessons/」与「调 MCP 工具」两套矛盾指引）。 */
  {
    const bePath = join(ROOT, "electron", "memory-backend.ts");
    (existsSync(bePath) ? ok : fail)("【150】记忆后端判定在独立叶子模块 electron/memory-backend.ts（⛔ 不许放进 runtime-refs：它已 import memory-layers，反向引用会成 require 环）");
    const beSrc = existsSync(bePath) ? readFileSync(bePath, "utf8") : "";
    (beSrc && !/from "\.\/(?!app-settings")/.test(beSrc) ? ok : fail)("【150】memory-backend.ts 只依赖 app-settings（叶子，不许依赖其它业务模块）");

    const layersSrc = readFileSync(join(ROOT, "electron", "memory-layers.ts"), "utf8");
    (/appendLesson\([\s\S]{0,900}?effectiveMemoryBackend\(\) === "mcp"\) return false/.test(layersSrc) ? ok : fail)("【150】内置记忆写入入口 appendLesson 有 MCP 后端让位（否则同一条记忆在两处各存一份）");
    (beSrc.includes("export function effectiveMemoryBackend") && /localMemoryMcpInstalled\(\)/.test(beSrc) ? ok : fail)("【150】后端判定必须是 effectiveMemoryBackend（带「装了才让位」回退）：⛔ 选了 MCP 但服务装不上时若也让位 ⇒ 记忆一处都不写 = 彻底丢记忆");
    (!/appendLesson[\s\S]{0,900}?[^e]memoryBackend\(\) === "mcp"\) return false/.test(layersSrc) ? ok : fail)("【150】捕获链不得用裸 memoryBackend() 做让位（必须用带回退的 effective 版）");
    (!/from "\.\/runtime-refs"/.test(layersSrc) ? ok : fail)("【150】memory-layers 不得 import runtime-refs（会与它成环，与守卫【147】同族）");

    const skillsSrc = readFileSync(join(ROOT, "electron", "builtin-skills.ts"), "utf8");
    (/setEnabled\("memory-mcp-backend", backend === "mcp"\)/.test(skillsSrc) && /setEnabled\("memory-classify", backend === "builtin"\)/.test(skillsSrc) ? ok : fail)("【150】两个记忆技能按后端互斥启用（同时生效会让模型收到两套写法）");
    (skillsSrc.includes("MEMORY_MCP_SKILL") && existsSync(join(ROOT, "electron", "builtin-skills", "13-skill-memory-mcp.ts")) ? ok : fail)("【150】MCP 记忆后端技能存在且已注册到内置技能清单");

    const instPath = join(ROOT, "scripts", "install-memory-mcp.cjs");
    const instSrc = existsSync(instPath) ? readFileSync(instPath, "utf8") : "";
    (instSrc.includes("--check") && instSrc.includes("--uninstall") ? ok : fail)("【150】MCP 记忆服务是**可选安装**（scripts/install-memory-mcp.cjs 支持 --check/--uninstall，不进项目依赖）");
    /* ⛔ --verify：这个包依赖原生模块 + 带 postinstall 的依赖，会**装得上但起不来**
       （禁 npm scripts / 无构建工具链 / 取不到预编译二进制）。只判文件存在 = 把坏安装报成就绪。 */
    (instSrc.includes("--verify") && /"result"/.test(instSrc) ? ok : fail)("【150】安装器提供 --verify（真起一次服务做 MCP 握手），不许只凭文件存在判定「可用」");
    (instSrc.includes("--ignore-scripts") ? ok : fail)("【150】安装器保留 --ignore-scripts 逃生口（受限环境唯一装法），并在文档里写明它会缺原生产物");

    /* 连接器同步（09-25）：后端=mcp ⇒ 启用 local-memory 连接器（引擎可见 MCP 工具、写入走 MCP）；
       builtin ⇒ 停用。⛔ 两边必须同源，否则「内置在写 + 工具也可见」= 双写。 */
    const connPath = join(ROOT, "electron", "memory-mcp-connector.ts");
    const connSrc = existsSync(connPath) ? readFileSync(connPath, "utf8") : "";
    (/effectiveMemoryBackend\(\)/.test(connSrc) ? ok : fail)("【150】连接器同步必须用 effectiveMemoryBackend（与捕获链同源，否则会出现双写窗口）");
    const bootSrc = readFileSync(join(ROOT, "electron", "features", "boot.ts"), "utf8");
    (/try \{\s*\n\s*const action = await syncLocalMemoryConnector\(\)|await syncLocalMemoryConnector\(\)/.test(bootSrc) ? ok : fail)("【150】启动链会同步本地 MCP 连接器（挂进 boot.ts，包 try/catch 不掐启动）");

    /* 设置页入口（09-25 补）：只有后端逻辑、没有入口 = 用户根本开不了
       （本轮用户原话就是「MCP 那个记忆，在哪里开启啊」—— 当时三处后端逻辑齐全但无处可点）。
       三处必须同轮齐全：manifest 两条通道 + IPC 账本 + 设置页「记忆」里的区块。 */
    const manifestSrc = readFileSync(join(ROOT, "electron", "ipc-channels.manifest.json"), "utf8");
    (manifestSrc.includes("memory:backend:read") && manifestSrc.includes("memory:backend:set") ? ok : fail)("【150】记忆后端两条通道在 manifest 里（read/set）");
    const regSrc150 = readFileSync(join(ROOT, "electron", "ipc-registry.ts"), "utf8");
    (/prefix: "memory", count: 21/.test(regSrc150) ? ok : fail)("【150】记忆域 IPC 账本同步（21 通道）");
    const centerSrc = readFileSync(join(ROOT, "src", "features", "settings-memory", "MemoryCenterSection.tsx"), "utf8");
    (centerSrc.includes("MemoryBackendSection") && centerSrc.includes("readMemoryBackend") && centerSrc.includes("setMemoryBackend") ? ok : fail)("【150】设置页「记忆」有后端入口（MemoryBackendSection：能读、能切；否则用户无处开启）");
    (!/spawn\(|execFile\(|child_process/.test(centerSrc) ? ok : fail)("【150】渲染层不自己跑安装器（按用户要求走「命令安装」，不在渲染层 spawn）");
  }
  }
}
