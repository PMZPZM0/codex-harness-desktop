/** 07-turn-fold 第 2/6 段：原 07-turn-fold.mjs L1052–L1794（逐字搬运 + 各自成块）。
 *  ⛔ 每个顶层语句外面套一层块：拆段后同一文件里不再共享作用域，const 重名不会撞（也正好还原原文件的分块隔离）。 */
/**
 * 预检守卫组：07-turn-fold
 * 分节：【43】（原 L4094–L7963）
 *
 * 09-22 从 scripts/check-preflight.mjs（8,997 行单文件）按域拆出，正文逐字未改；
 * 共享面由 ./_ctx.mjs 注入（同名导入）。动机：多路并行写者往同一文件加守卫会互相覆盖（已发生）。
 */
import {
  AUTO_CONTINUE_MAX_ATTEMPTS, C, MOOD_HEADING, ROOT, TRUNCATE_OUTPUT_MAX_CHARS, TRUNCATE_REASONING_MIN_CHARS, applyMoodSignal, codeOnly, composeMoodInstructions, createHash, createRequire, decayMood, emptyMood, existsSync, fail, homedir, isTruncatedEmptyTurn, join, mainSrc, moodBlock, moodSignature, moodTone, normalizeMood, ok, pathToFileURL, preloadSrc, readAppUi, readBuiltinSkillsSource, readFileSync, readMainSource, readResponsesBridgeSource, readStyles, readVoiceSettingsSrc, readdirSync, relative, spawnSync, statSync, turnOutputStats, walk, warn,
} from "../_ctx.mjs";
import { isQueueAlreadyStartedError } from "../../../src/lib/queue-errors.mjs";
import { splitMarkdown, trimInvisibleSpace } from "../../../src/lib/markdown-blocks.mjs";



export async function run() {
{
{
    console.log(C.bold("\n【43】永久删除的磁盘收尾（删了就不能重启复活）"));
    const req = createRequire(import.meta.url);
    const st = req(join(ROOT, "dist-electron", "tools", "session-tools.js"));
    const pool = req(join(ROOT, "dist-electron", "rollout-pool.js"));
    const mainTs = readMainSource();
    const workerSrc = readFileSync(join(ROOT, "electron", "rollout-worker.cjs"), "utf8");
    const workerGen = readFileSync(join(ROOT, "electron", "rollout-worker-source.ts"), "utf8");

    // ① 行为：墓碑（小写 id）必须把索引侧与兜底侧的同名会话都排掉
    const indexed = [{ id: "KEEP-1", name: "留着", updatedAt: 2 }, { id: "GONE-1", name: "删掉了", updatedAt: 3 }];
    const fallback = [{ id: "GONE-1", name: "删掉了（磁盘独有）", updatedAt: 4 }, { id: "GHOST-2", name: "兜底留着", updatedAt: 1 }];
    const withTomb = st.mergeThreadList(indexed, fallback, false, 100, new Set(["gone-1"]));
    (!withTomb.some((entry) => String(entry.id).toLowerCase() === "gone-1") ? ok : fail)("【43】mergeThreadList：墓碑把已删会话从合并结果里排掉（索引与兜底两侧同 id）");
    (withTomb.length === 2 ? ok : fail)(`【43】mergeThreadList：其它会话不受影响（期望 2 条，实得 ${withTomb.length}）`);
    const withoutTomb = st.mergeThreadList(indexed, fallback, false, 100);
    (withoutTomb.length === 3 ? ok : fail)(`【43】mergeThreadList：不传墓碑时一条都不排（防实现退化成「无条件过滤」的假绿，期望 3 条，实得 ${withoutTomb.length}）`);
    const caseFold = st.mergeThreadList([{ id: "AbC-9", updatedAt: 1 }], [], false, 100, new Set(["abc-9"]));
    (caseFold.length === 0 ? ok : fail)("【43】mergeThreadList：墓碑匹配大小写不敏感（引擎 id 大小写未必与墓碑一致）");

    // ② 接线：删除路径（请求 + 引擎事件）、列表合并、启动载入，缺一不可
    (mainTs.includes('const purgeTarget = method === "thread/delete"') ? ok : fail)("【43】thread/delete 请求路径取出待清理的线程 id");
    (mainTs.includes("if (purgeTarget) await purgeDeletedThread(purgeTarget);") ? ok : fail)("【43】thread/delete 请求路径真的清了磁盘 rollout 并记墓碑");
    (mainTs.includes('if (event.method === "thread/deleted") void purgeDeletedThread(goneId)') ? ok : fail)("【43】引擎侧 thread/deleted 事件路径也走清理（不经渲染层的删除）");
    (mainTs.includes("mergeThreadList(indexed, fallback, archiveFilter, Number((params as any)?.limit ?? 100), deletedThreadIds)") ? ok : fail)("【43】thread/list 合并时传入墓碑集合（否则兜底扫描依旧把删掉的会话捞回来）");
    (mainTs.includes("await loadDeletedThreads();") ? ok : fail)("【43】启动时先载入墓碑（靠懒加载会让首屏出现幽灵会话）");
    (mainTs.includes("deletedThreadIds.has(String(entry.id") ? ok : fail)("【43】手机端会话列表同样按墓碑过滤（那条链路直接打引擎、不过合并逻辑）");

    // ③ 打包：worker 的清理能力必须进内联产物（生成物落后 = 打包后清理是空操作）
    (workerSrc.includes('msg.op === "purge"') && workerSrc.includes("function purgeRolloutFiles(") ? ok : fail)("【43】worker 源码有 purge op 及其实现");
    (workerGen.includes('msg.op === "purge"') && workerGen.includes("purgeRolloutFiles") ? ok : fail)("【43】内联产物 rollout-worker-source.ts 含 purge（落后于 .cjs 就重新生成）");
    (typeof pool.purgeRolloutFilesAsync === "function" ? ok : fail)("【43】rollout-pool 暴露 purgeRolloutFilesAsync");

    // ④ 语义：引擎对「索引里已无这条线程」的删除会报错（failed to read session metadata…），
    //    而这类会话正是用户二次删除的幽灵 —— 本地残留已清、墓碑已记，必须按成功返回，
    //    否则渲染层会弹「删除任务失败」，用户以为没删掉又会反复点。
    //    断言钉住「条件 + 匹配串」两部分，只查标识符会被 `if (false)` 架空。
    (/if \(purgeTarget && \/failed to delete thread\|failed to read session metadata\|no rollout found/.test(mainTs) ? ok : fail)("【43】幽灵会话的删除报错按成功处理（不然用户二次删除会看到「删除失败」）");
    (mainTs.includes("localCleanupOnly") ? ok : fail)("【43】成功返回带上 localCleanupOnly 标记（便于将来排查「日志说成功、引擎侧没删」）");
    // ④② 僵尸会话根治（10-04）：引擎的 thread/delete 只认 archived_sessions/ 里的 rollout，
    //     活会话（rollout 还在 sessions/）删一次报一次 "must be in archived sessions directory"。
    //     断言钉住「归档兜底 + 重试 + 仍失败按本地清理」三段接线，只查标识符会被架空。
    (mainTs.includes("/must be in archived sessions directory/i") ? ok : fail)("【43】引擎拒删活会话（rollout 在 sessions/）的错误有识别分支");
    (mainTs.includes('await server.request("thread/archive", { threadId: purgeTarget })') ? ok : fail)("【43】拒删时先 thread/archive 把 rollout 挪进归档目录再重试 delete");
    (/归档后重试删除仍失败，按本地清理处理/.test(mainTs) ? ok : fail)("【43】归档后重试仍失败按本地清理成功处理（不反复弹错让用户反复点）");

    // ⑤ 墓碑不能是**单向死锁**（code review 抓到的真缺口）：导入会话备份时
    //    `applySessionsBackup` 原样复用备份里的 thread id，不清墓碑的话
    //    「删除 → 再从备份导入」之后这条会话永远不显示，用户也查不出原因。
    (/async function forgetDeletedThreads\(ids: string\[\]\)/.test(mainTs) && mainTs.includes("deletedThreadIds.delete(id)") ? ok : fail)("【43】墓碑可被摘除（forgetDeletedThreads 实现存在）");
    (mainTs.includes("await forgetDeletedThreads(summary.threads.filter((entry: { status: string }) => entry.status === \"ok\")") ? ok : fail)("【43】导入备份写入成功即摘墓碑（只清 status===\"ok\"，duplicate/conflict 保留墓碑）");
  }
}

{
{
    console.log(C.bold("\n【44】回合结束原因（为什么停 / 能不能接着跑）"));
    const { describeTurnStop, turnHeadline, isAwaitingTurnClose } = await import("../../../src/lib/turn-stop-reason.mjs");
    const appSrc = readAppUi();
    const cssSrc = readStyles();
    const libSrc = readFileSync(join(ROOT, "src", "lib", "turn-stop-reason.mjs"), "utf8");

    // ① 行为：被中断（真机实测形态）必须看得出来
    const interrupted = describeTurnStop({ status: "interrupted", error: null, durationMs: 3001 });
    (interrupted.label === "已停止" ? ok : fail)(`【44】status=interrupted 且 error=null → 「已停止」（旧实现落进「耗时 Xs」分支；实得「${interrupted.label}」）`);
    (interrupted.detail.includes("接着发一条消息") ? ok : fail)("【44】被中断时给出「怎么继续」的说明");
    // ② 行为：错误分类要落到中文标签，且保留引擎原文
    const ctx = describeTurnStop({ status: "failed", error: { message: "context window exceeded", codexErrorInfo: "contextWindowExceeded" } });
    (ctx.label === "上下文超限" ? ok : fail)(`【44】codexErrorInfo=contextWindowExceeded → 「上下文超限」（实得「${ctx.label}」）`);
    (ctx.detail.includes("context window exceeded") && ctx.detail.includes("新会话") ? ok : fail)("【44】上下文超限：既带引擎原文也带处置建议");
    (describeTurnStop({ status: "completed", error: { message: "m", codexErrorInfo: "sandboxError" } }).label === "沙箱拒绝" ? ok : fail)("【44】sandboxError → 「沙箱拒绝」（命令被策略拒的场景）");
    (describeTurnStop({ status: "completed", error: { message: "m", codexErrorInfo: "rateLimitExceeded" } }).label === "被限流" ? ok : fail)("【44】rateLimitExceeded → 「被限流」");
    (describeTurnStop({ status: "completed", error: { message: "上游炸了", codexErrorInfo: "someFutureCode" } }).label === "处理出错" ? ok : fail)("【44】未知分类回落「处理出错」（引擎新增分类不能变成空白）");
    // ③ 行为：正常完成 / 运行中**不得**出现提示（防误报）
    (describeTurnStop({ status: "completed", durationMs: 1200 }).label === "" ? ok : fail)("【44】正常完成的回合不出提示条（否则每条消息下面都挂一块）");
    (describeTurnStop({ status: "inProgress" }).kind === "running" ? ok : fail)("【44】运行中的回合按 running 处理（不显示结束原因）");
    // ④ 行为：引擎给的「继续指令」要取出来（misalignment.steer.message）
    const steer = describeTurnStop({ status: "failed", error: { message: "x", codexErrorInfo: "misalignmentPolicyViolation", misalignment: { steer: { message: "继续执行剩余步骤" } } } });
    (steer.continueText === "继续执行剩余步骤" ? ok : fail)("【44】misalignment.steer.message 被提取（引擎说「确认继续就把这条作为下一回合输入」）");
    // ⑤ 标题合成：分类 + 耗时
    (turnHeadline({ status: "interrupted", error: null }, "3s") === "已停止 · 耗时 3s" ? ok : fail)("【44】标题合成「已停止 · 耗时 3s」");
    (turnHeadline({ status: "completed" }, "") === "已处理" ? ok : fail)("【44】正常完成回落「已处理」");
    // ⑥ 接线 + 旧写法必须消失（这是"修好了"的关键锚，别只查新符号存在）
    (appSrc.includes("describeTurnStop(turn)") ? ok : fail)("【44】界面调用 describeTurnStop");
    (appSrc.includes("turn-stop-notice") && appSrc.includes("stopReason.label &&") ? ok : fail)("【44】非正常结束渲染提示条（含原因与建议）");
    (!/turn\.error \? "处理出错"/.test(appSrc) ? ok : fail)("【44】旧的「有 error 就写处理出错」写法已消失（否则被中断的回合还是看不出原因）");
    (!/turn\.error \? "出错"/.test(appSrc) ? ok : fail)("【44】回合状态词不再只写「出错」");
    (cssSrc.includes(".turn-stop-notice") && cssSrc.includes(".turn-stop-notice.stop-interrupted") ? ok : fail)("【44】提示条样式存在（被中断用中性色，不冒充错误）");
    (libSrc.length > 800 ? ok : fail)("【44】原因表在纯函数模块里（可直跑断言，不是散在 JSX 里的字面量）");

    // ⑦ 「正文已完整，等待模型收尾」（09-18 用户实测「怎么回复完了还没结束」：gpt-5.6-sol
    //    正文落盘后 28 秒零事件才 task_complete —— 引擎干等上游的流结束信号，不是 bug，
    //    但界面还说「正在生成回复」就是误导）。
    (isAwaitingTurnClose({ status: "inProgress", items: [{ type: "agentMessage", status: "completed", text: "答案" }] }) ? ok : fail)("【44】正文完成且无在跑 item → 收尾等待状态");
    (!isAwaitingTurnClose({ status: "inProgress", items: [{ type: "agentMessage", status: "inProgress", text: "" }] }) ? ok : fail)("【44】正文还在流式输出 → 不算收尾等待（防误报）");
    (isAwaitingTurnClose({ status: "inProgress", items: [{ type: "commandExecution", status: "completed" }, { type: "agentMessage", status: "completed", text: "答案" }] }) ? ok : fail)("【44】前面有已完成工具不影响判定（只看最后的有正文消息）");
    (!isAwaitingTurnClose({ status: "inProgress", items: [{ type: "agentMessage", status: "completed", text: "答案" }, { type: "commandExecution", status: "inProgress" }] }) ? ok : fail)("【44】还有在跑的 item → 不算收尾等待");
    (!isAwaitingTurnClose({ status: "completed", items: [{ type: "agentMessage", status: "completed", text: "答案" }] }) ? ok : fail)("【44】回合已结束 → 不算收尾等待");
    // 09-18 收严：在跑的 item 要**扫全量**，不能只看到正文为止 —— 否则「正文已完成 +
    // 后面还有一条在跑的命令」会同时显示「正在执行命令」和「正文已完整，等待模型收尾」。
    (!isAwaitingTurnClose({ status: "inProgress", items: [{ type: "commandExecution", status: "inProgress" }, { type: "agentMessage", status: "completed", text: "答案" }] }) ? ok : fail)("【44】在跑的 item 哪怕排在正文之前也不算收尾等待（防状态行自相矛盾）");
    // 界面接线：① 收尾提示**只在一处**说（09-18 用户实测「这段文字会出现在『正在处理』后面，
    //    跟消息下面重复了」—— 两边同时报同一句就是同屏重复）② 状态行兜底**复用同一判据**
    //    （不许在组件里再抄一份，两份会漂移）。锚用**结构正则**不锁整行字面量
    //    （09-18 教训：给组件加 prop 就会让整行锚假红）。
    const timerIdx = appSrc.indexOf("function RunningProcessTime");
    const timerFn = timerIdx >= 0 ? appSrc.slice(timerIdx, appSrc.indexOf("\n}", timerIdx) + 2) : "";
    (timerFn && !/等待模型收尾/.test(timerFn) ? ok : fail)("【44】收尾提示只在底部状态行说一次（计时条不再重复同一句）");
    (/const turnFinalizing = Boolean\([^)]*isAwaitingTurnClose\(/.test(appSrc) ? ok : fail)("【44】收敛为一个布尔判据（状态行与短语共用，不各写一份）");
    (/turnFinalizing \? "等待模型收尾"/.test(appSrc) ? ok : fail)("【44】状态行在收尾等待时如实说（不再写「正在生成回复」）");
    // ⛔ 反向守卫：判据**不许**写成 `runActivity === "某中文文案"` —— 文案一改就静默失效，
    //   界面会悄悄退回「正在生成回复」，而预检照样全绿（09-18 审查抓出的隐患）。
    //   ⛔ 必须先去掉注释再判：注释里解释这条隐患时也会出现同样的写法，直接正则会假红（本轮踩到）。
    const appNoCmt = appSrc.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    (!/runActivity\s*===\s*"/.test(appNoCmt) ? ok : fail)("【44】不用展示文案做状态判据（否则改文案 = 判据静默失效）");
    // 收尾态的底部短语只能用**专属池**：过通用池会抽到「正在把改动收拢干净」这类干活句。
    const exactIdx = appSrc.indexOf("function pickRunPhraseExact");
    const exactWin = exactIdx >= 0 ? appSrc.slice(exactIdx, exactIdx + 260) : "";
    (exactWin && /RUN_PHRASES_BY_ACTIVITY\[activity\]/.test(exactWin) && !/\.\.\.RUN_PHRASES\b/.test(exactWin) ? ok : fail)("【44】收尾态专属句不过通用池（pickRunPhraseExact 只取专属池）");
    (/setRunPhrase\(turnFinalizing \? pickRunPhraseExact\(/.test(appSrc) ? ok : fail)("【44】收尾状态跨进/跨出各换一次句（只在跨界时换，不在「思考→命令」之间乱换）");
  }
}

{
{
    console.log(C.bold("\n【45】语法高亮结果缓存（切会话不重复高亮）"));
    const { highlightCacheKey, createHighlightCache } = await import("../../../src/lib/code-highlight-cache.mjs");
    const appSrc45 = readAppUi();

    // ① 键必须覆盖所有影响高亮产物的输入 —— 漏一个字段就会串键（不同代码命中同一份元素树 = 高亮错乱）
    const base = { language: "ts", code: "const a = 1;", theme: "one-dark", lineNumbers: true, wrapLongLines: false };
    const k0 = highlightCacheKey(base);
    (k0 === highlightCacheKey({ ...base }) ? ok : fail)("【45】同样的输入 → 同样的键（缓存才能命中）");
    (k0 !== highlightCacheKey({ ...base, code: "const a = 2;" }) ? ok : fail)("【45】代码不同 → 键不同（否则会用错元素树）");
    (k0 !== highlightCacheKey({ ...base, language: "python" }) ? ok : fail)("【45】语言不同 → 键不同");
    (k0 !== highlightCacheKey({ ...base, theme: "dracula" }) ? ok : fail)("【45】主题不同 → 键不同（否则切主题后颜色不跟着变）");
    (k0 !== highlightCacheKey({ ...base, lineNumbers: false }) ? ok : fail)("【45】行号开关不同 → 键不同");
    (k0 !== highlightCacheKey({ ...base, wrapLongLines: true }) ? ok : fail)("【45】换行开关不同 → 键不同");
    // 串键防护：分隔符必须不可出现在正常输入里（用 \u0000 而不是空格/竖线）
    (highlightCacheKey({ language: "a", code: "b" }) !== highlightCacheKey({ language: "a b", code: "" }) ? ok : fail)("【45】拼接不产生歧义（分隔符不可被输入伪造出同键）");

    // ② LRU 行为：容量上限、淘汰最旧、get 提升热度、命中/未命中计数
    const c = createHighlightCache({ maxEntries: 3, minCodeChars: 10, maxCodeChars: 100 });
    c.set("a", 1); c.set("b", 2); c.set("c", 3);
    (c.size === 3 ? ok : fail)("【45】容量上限生效（3 条）");
    (c.get("a") === 1 ? ok : fail)("【45】能取回已缓存内容");
    c.set("d", 4); // 超容量：最旧的应是 b（a 刚被 get 提到最新）
    (c.get("b") === undefined && c.get("a") === 1 ? ok : fail)("【45】淘汰的是最久未用的那条（get 过的不会被先淘汰）");
    (c.size === 3 ? ok : fail)("【45】淘汰后仍不超容量");
    const st = c.stats();
    (st.hits >= 2 && st.misses >= 1 ? ok : fail)(`【45】命中/未命中计数可用（实得 hits=${st.hits} misses=${st.misses}）`);
    // 字符总量上限（防"很多大块"把内存吃满）；淘汰时总量必须同步扣减，否则会提前把缓存清空
    const c2 = createHighlightCache({ maxEntries: 99, maxTotalChars: 30, minCodeChars: 1, maxCodeChars: 999 });
    c2.set("x".repeat(20), 1); c2.set("y".repeat(20), 2);
    (c2.size === 1 && c2.stats().totalChars === 20 ? ok : fail)(`【45】总字符上限生效且总量同步扣减（实得 size=${c2.size} totalChars=${c2.stats().totalChars}）`);
    // 覆盖校验：把同一个 key 再 set 一次不得重复计账（否则总量虚高、缓存被提前清空）
    c2.set("y".repeat(20), 3);
    (c2.stats().totalChars === 20 ? ok : fail)("【45】重复 set 同一键不重复计账");
    // 长度窗口：太短不缓存（本来不贵）、超单块上限不缓存
    (!c.shouldCache("x".repeat(5)) ? ok : fail)("【45】过短的代码块不缓存（收益低、只增开销）");
    (c.shouldCache("x".repeat(50)) ? ok : fail)("【45】正常长度的代码块缓存");
    (!c.shouldCache("x".repeat(500)) ? ok : fail)("【45】超单块上限的代码块不缓存");
    // ⛔ 默认上限必须覆盖真机出现过的大块（13346 元素的那个会话里最长块 66838 字）——
    //    第一版把单块上限设成 60000，恰好吃不到缓存，那个会话每次切换照样高亮 ~1.4 秒。
    {
      const d = createHighlightCache();
      (d.shouldCache("x".repeat(66838)) ? ok : fail)(`【45】默认单块上限覆盖真机出现过的 66838 字大块（当前 maxCodeChars=${d.stats().maxCodeChars}）`);
      (d.stats().maxTotalChars >= 600000 ? ok : fail)("【45】默认总量上限不缩水（防很多大块把内存吃满，同时别把预算设到吃不到缓存）");
    }

    // ③ 接线：三处 SyntaxHighlighter 必须都能接 renderer；流式追字期间不许接
    const rendererUses = (appSrc45.match(/renderer=\{/g) ?? []).length;
    (rendererUses >= 3 ? ok : fail)(`【45】三处高亮都接上了缓存 renderer（实得 ${rendererUses} 处）`);
    (/function makeCachedHighlightRenderer\(cacheKey: string\)/.test(appSrc45) && /createHighlightElement\(\{ node, stylesheet, useInlineStyles/.test(appSrc45)
      ? ok : fail)("【45】缓存 renderer 复用库自身的 createElement（不是自己重写高亮逻辑）");
    // ⛔ 流式追字时 text 每帧都变，key 每帧 miss —— 必须返回 undefined 走默认实现
    (/if \(revealing \|\| virtualizable \|\| !HIGHLIGHT_CACHE\.shouldCache\(text\)\) return undefined;/.test(appSrc45)
      ? ok : fail)("【45】逐字追字期间不接缓存（否则每帧 miss，白付哈希/淘汰开销）");
    // ⛔ MdCode 的提前 return（!className / mermaid）之后**不得再出现任何 hook 调用**，
    //    否则 hooks 顺序错乱（React 会直接报错）。
    //    ⚠️ 判据必须是「return 之后那段里没有 hook」，不能写成「存在某个 hook 在 return 之前」——
    //    后者因为 useCodeSettings() 一直在函数开头而**恒真**（本条守卫第一版就是这样，
    //    反证时把 hooks 挪到 return 之后它照样绿，等于没有守卫）。
    const mdIdx = appSrc45.indexOf("const MdCode = memo(function MdCode");
    const mdBody = mdIdx >= 0 ? appSrc45.slice(mdIdx, appSrc45.indexOf("\n});", mdIdx)) : "";
    const retIdx = mdBody.search(/if \(!className\) return/);
    const afterReturn = retIdx > 0 ? mdBody.slice(retIdx) : "";
    (/useMemo\(|useState\(|useRef\(|useEffect\(|useCallback\(|useCodeSettings\(/.test(afterReturn) ? fail : ok)("【45】MdCode 的提前 return 之后没有 hook 调用（hooks 顺序不能变）");
    // ⛔ 流式追字期间不许写缓存：流式每帧一个 never-again 的新 key，照单写入会把其它会话
    //    攒下的条目按 LRU 挤掉（那些会话切回来又变慢）。判据 =「在上次文本上追加」。
    (/const appended = prevCodeRef\.current\.length > 0 && code\.length > prevCodeRef\.current\.length && code\.startsWith\(prevCodeRef\.current\);/.test(appSrc45)
      && /useMemo\(\(\) => \(!appended && HIGHLIGHT_CACHE\.shouldCache\(code\)/.test(appSrc45)
      ? ok : fail)("【45】流式追字期间不写缓存（防中间态挤掉其它会话的缓存条目）");
  }
}

{
{
    console.log(C.bold("\n【46】懒高亮 / 图片项折叠 / 附件行位置"));
    const appSrc46 = readAppUi();
    const foldSrc = readFileSync(join(ROOT, "src", "lib", "turn-fold.ts"), "utf8");
    const { deservesLazyHighlight, plainCodeStyles, LAZY_HIGHLIGHT_MIN_CHARS } = await import("../../../src/lib/lazy-highlight.mjs");
    const { attachChipName } = await import("../../../src/lib/attach-chip-name.mjs");

    // ① 懒高亮阈值（纯函数直跑）
    (LAZY_HIGHLIGHT_MIN_CHARS >= 1000 ? ok : fail)(`【46】懒加载只针对"大块"（阈值 ${LAZY_HIGHLIGHT_MIN_CHARS} 字符）`);
    (deservesLazyHighlight("x".repeat(LAZY_HIGHLIGHT_MIN_CHARS)) && !deservesLazyHighlight("x".repeat(LAZY_HIGHLIGHT_MIN_CHARS - 1)) ? ok : fail)("【46】阈值边界正确（等于阈值懒加载、差一个字符不懒加载）");
    (!deservesLazyHighlight(undefined) && !deservesLazyHighlight(null) ? ok : fail)("【46】空值不崩（undefined/null 当小块）");
    // ② 兜底样式必须取自与高亮一致的键（否则未高亮时背景/文字色不同 = 白底闪一下）
    {
      const theme = { 'pre[class*="language-"]': { background: "bg" }, 'code[class*="language-"]': { color: "fg" } };
      const s = plainCodeStyles(theme);
      (s.pre.background === "bg" && s.code.color === "fg" ? ok : fail)("【46】未高亮兜底用主题的 pre/code 基样式（背景与文字色和高亮后一致，不闪白）");
      (JSON.stringify(plainCodeStyles(null)) === JSON.stringify({ pre: {}, code: {} }) ? ok : fail)("【46】主题缺失时兜底为空对象（不崩）");
    }
    // ③ 接线：三处代码块都要接 + 共享单个 observer + 不支持时降级
    const lazySites = (appSrc46.match(/useNearViewport\(/g) ?? []).length;
    (lazySites >= 4 ? ok : fail)(`【46】三处代码块都接上懒高亮（useNearViewport 出现 ${lazySites} 次 = 定义 1 + 接线 3）`);
    (/let sharedHighlightObserver/.test(appSrc46) && /new IntersectionObserver\(/.test(appSrc46) && /rootMargin: "1200px 0px"/.test(appSrc46)
      ? ok : fail)("【46】共享单个 IntersectionObserver 且带预载 rootMargin（几百个代码块不各建一个）");
    (/typeof IntersectionObserver !== "function"\) return null/.test(appSrc46) ? ok : fail)("【46】环境不支持 IntersectionObserver 时降级直接高亮（不空白）");
    // ④ 图片项：查看 → foldable，生成 → 仍常驻
    (/if \(item\.type === "plan" \|\| item\.type === "imageGeneration"\) return "keepVisible";/.test(foldSrc) ? ok : fail)("【46】plan 与生成图仍常驻外露");
    (!/item\.type === "plan" \|\| item\.type === "imageView"/.test(foldSrc) ? ok : fail)("【46】imageView（查看图片）不再 keepVisible（不再一张一个大图铺满消息区）");
    (/case "imageView": return \{ key: "image-view", label: "查看图片" \};/.test(foldSrc) ? ok : fail)("【46】imageView 有独立分组标签");
    (/case "imageView":[\s\S]{0,140}group: "read"/.test(foldSrc) ? ok : fail)("【46】imageView 摘要归 read 组（显示「查看 xxx」而非「处理多个步骤」）");
    // ⑤ 用户附件：**内联在正文文字流里**，形态与输入框逐字一致（用户三次纠正后的定稿）
    {
      // ⛔ 定稿契约（09-18 用户：「谁让你单独一行靠右了，我要的是像输入框那样，内联在里面」）：
      //    附件 chip 必须与输入框共用 `.composer-image-chip-inline`，且**不许**再有"气泡下方独立附件行"。
      //    曾有两版被否决的实现（单独一行右对齐 / 方形缩略图），守卫要防它们复活。
      const css46 = readStyles();
      (appSrc46.includes("const inlineAttachItems") ? ok : fail)("【46】附件以 inlineAttachItems 组装（供内联渲染）");
      (!/\{attachRow\}/.test(appSrc46) && !/const attachRow =/.test(appSrc46)
        ? ok : fail)("【46】已删除气泡下方的独立附件行（附件不再另起一行）");
      (!/\.msg-refs\.user-attach-row \{/.test(css46) && !/\.msg-refs \.user-attach-chip \{/.test(css46)
        ? ok : fail)("【46】被否决的两版附件行样式已清除（不留复活入口）");
      (!/refImageFiles|refPlainFiles/.test(appSrc46) ? ok : fail)("【46】附件不做图片/文件左右分区（用户要的是统一内联）");
      // 内联 chip 必须在正文 <p class="user-message-text"> 之内（不是它的兄弟节点）
      const bodyIdx = appSrc46.indexOf("const inlineAttachItems");
      const listIdx = bodyIdx > 0 ? appSrc46.indexOf("{inlineAttachItems.map(", bodyIdx) : -1;
      const pOpen = listIdx > 0 ? appSrc46.lastIndexOf('<p className="user-message-text">', listIdx) : -1;
      const pClose = listIdx > 0 ? appSrc46.indexOf("</p>", listIdx) : -1;
      (listIdx > 0 && pOpen > 0 && pClose > listIdx && pClose - listIdx < 2000
        ? ok : fail)("【46】附件 chip 内联在正文段落内（文字 + chip 同一文字流）");
      // 与输入框**字面同一个类名** —— 这是"发送前看到的样子 == 发送后显示的样子"的保证
      // （09-18 起抽成模块级组件 `MessageAttachChip`，所以判据落在**组件定义**上）
      const chipDef = (() => {
        const i = appSrc46.indexOf("function MessageAttachChip(");
        if (i < 0) return "";
        // ⛔ 终点不能写死 "\n}\n"：CRLF 文件里 `}` 前是 \r ⇒ 永远匹配不到 ⇒ 切片一路吞到
        //    聚合串尾，把**后续文件**里的 user-attach-chip/ref-image-card 误收进来（09-24 实测：
        //    主仓库 readdir 顺序把 CRLF 文件排前 ⇒ 假红；副本靠顺序运气绿）。终点改 CRLF 兼容。
        const m = /\r?\n\}\r?\n/.exec(appSrc46.slice(i));
        return m ? appSrc46.slice(i, i + m.index + m[0].length) : "";
      })();
      (chipDef.includes('className={`composer-image-chip-inline message-attach-chip') && !/user-attach-chip|ref-image-card/.test(chipDef)
        ? ok : fail)("【46】内联附件复用输入框的 composer-image-chip-inline（不自造 chip 样式）");
      // 文件与图片都要能内联（文件用 FileText 图标 + 文件名）
      (chipDef.includes("FileText") && chipDef.includes("composer-image-chip-name")
        ? ok : fail)("【46】文件与图片都内联（文件用 FileText 图标 + 文件名）");
      // 去重：已在文本占位符里渲染过的图片不重复出现（否则同一张图显示两份）
      (chipDef.length > 0 && /inlineImageSet\.has\(path\)/.test(appSrc46)
        ? ok : fail)("【46】内联附件对占位符已渲染的图片去重（不出现两份）");
      // ⛔ 去重集合的收集器必须与渲染拆分器**同一个**（splitAttachmentSegments，图片+文件都认）：
      //    曾经用 splitPromptSegments（只认图片 token）收 annotatedPaths ⇒ 文件 chip
      //    「按原位置内联一次 + refs.files 末尾追加一次」，同一文件两颗 chip（09-27 用户截图）。
      (appSrc46.includes("for (const seg of splitAttachmentSegments(annotatedText))")
        && !/for \(const seg of splitPromptSegments\(\s*annotatedText/.test(appSrc46)
        ? ok : fail)("【46】annotatedPaths 与渲染用同一个拆分器（只认图片的收集器会让文件 chip 出现两次）");
      // ⛔ 上面那条**锚代码形态**（for 循环 + 哪个拆分器），⛔ 别用「annotatedPaths 后 N 字符内
      //    禁止出现 splitPromptSegments」这种禁词式正则 —— 注释里的解释文字就含这个词，
      //    会把正确的代码误判红（09-27 实测：修复注释自己触发了自己）。
      // md 文档视图（09-27，用户：「他都这种可视化 MD，跟 WorkBuddy 差远了」）：
      // .md/.markdown 在文件预览里默认按**排版渲染**（复用聊天的 .markdown 体系），
      // ⛔ 不许退回"所有文本一律 FilePreviewCode"（暗底行号 = 把文档当代码读）；
      // 源码必须是显式开关（path 记忆，切 tab 复位），超大截断文件仍走源码。
      (appSrc46.includes("file-preview-markdown markdown")
        && /isMarkdownDoc && !sourceOn && !fileTruncated/.test(appSrc46)
        && /mdSourceView\b/.test(appSrc46) ? ok : fail)(
        "【46】md 文件默认排版视图 + 源码开关（一律代码视图 = 把文档当代码读）"
      );
      // ⛔ 附件名必须是"像文件名"的字符串：data URL 直接取 basename 会得到 base64 尾巴
      //    （实测 `basename("data:image/png;base64,iVBOR…")` → `q842iQAAAABJRU5ErkJggg==`）。
      //    09-18 代码审查抓到的真缺陷，用纯函数钉死。
      {
        const DATA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
        const dataName = attachChipName({ type: "image", image_url: DATA }, DATA);
        (/^(data:|=|.*base64)/.test(dataName) || dataName.length > 12
          ? fail : ok)(`【46】data URL 图片的名字不是 base64 尾巴（实得「${dataName}」）`);
        (attachChipName({ type: "localImage", path: "C:\\a\\b\\真图.png" }, "C:\\a\\b\\真图.png") === "真图.png"
          ? ok : fail)("【46】有本地路径时用其文件名");
        (attachChipName({ type: "localImage", path: "/tmp/x/y.jpg" }, "/tmp/x/y.jpg") === "y.jpg"
          ? ok : fail)("【46】posix 路径同样取末段");
        (attachChipName({ type: "image", image_url: "https://cdn.example.com/a/pic.png?v=2#x" }, "https://cdn.example.com/a/pic.png?v=2#x") === "pic.png"
          ? ok : fail)("【46】http 图片名剥掉 query/hash");
        (attachChipName({}, "") === "图片" && attachChipName(null, null) === "图片"
          ? ok : fail)("【46】无来源时兜底为「图片」（不崩、不空）");
        // ⛔ part.path 本身就是 data URL 的分支（真机验收抓到的 bug：lastSegment 先剥了前缀，
        //    之后的 startsWith("data:") 永远为假 → 名字显示成 base64 尾巴）
        (attachChipName({ type: "image", path: DATA }, DATA) === "粘贴的图片"
          ? ok : fail)("【46】part.path 是 data URL 时也识别成「粘贴的图片」（先拦 data: 再取末段）");
        // 结构守卫：extraImages 的命名必须走纯函数，不许回退成裸 basename
        (!/const name = basename\(String\(part\?\.path \?\? src\)\)/.test(appSrc46) && /attachChipName\(part, src\)/.test(appSrc46)
          ? ok : fail)("【46】粘贴图片的名字经 attachChipName 归一（不许直接 basename(src)）");
        // 文本占位符那支也必须走同一个纯函数：local path 结果相同，但 data URL 占位符
        // 若走裸 basename 又会露出 base64 尾巴 —— 两处口径必须一致（09-18 守卫抓出的不一致）
        (/name=\{attachChipName\(\{ path: seg\.path \}, seg\.path\)\}/.test(appSrc46) && !/name=\{basename\(seg\.path\) \|\| seg\.path\}/.test(appSrc46)
          ? ok : fail)("【46】文本占位符图片的名字也走 attachChipName（两支口径一致）");
      }
    }

    console.log(C.bold("\n【47】内联图片：点击大预览 + 悬停自适应小预览"));
    const { imageDisplaySrc, localImageUrl, LOCAL_IMAGE_SCHEME } = await import("../../../src/lib/image-src.mjs");
    {
      // ① 纯函数：src 归一化必须**认得出 data URL**，否则会被拼成本地协议 URL（灯箱/preview 全打不开）
      const DATA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
      (imageDisplaySrc(DATA) === DATA ? ok : fail)(`【47】data URL 原样透传（实得 ${String(imageDisplaySrc(DATA)).slice(0, 42)}…）`);
      (imageDisplaySrc("https://x.com/a.png") === "https://x.com/a.png" ? ok : fail)("【47】http(s) 原样透传");
      (imageDisplaySrc("blob:http://x/1") === "blob:http://x/1" ? ok : fail)("【47】blob 原样透传");
      (imageDisplaySrc("harness-image://local?path=x") === "harness-image://local?path=x" ? ok : fail)("【47】已是协议 URL 的不重复包装");
      (imageDisplaySrc("") === "" && imageDisplaySrc(null) === "" ? ok : fail)("【47】空值返回空串（不崩）");
      // 本地路径 → 协议 URL，且**必须双重编码**（单编码会让反斜杠在协议层丢失 → 透明占位图）
      const win = "C:\\dir\\a b.png";
      const want = LOCAL_IMAGE_SCHEME + encodeURIComponent(encodeURIComponent(win));
      (localImageUrl(win) === want ? ok : fail)("【47】本地路径双重编码（改单编码会让图片变透明占位）");
      (/%25/.test(localImageUrl(win)) ? ok : fail)("【47】确实编了两层（URL 里出现 %25）");
      (imageDisplaySrc(win).startsWith(LOCAL_IMAGE_SCHEME) ? ok : fail)("【47】本地路径走自定义协议");
      // ⛔ 灯箱的「在文件夹中显示」必须靠 resolveImagePath 的真返回值决定：它对 data URL / http
      //    返回 null（那两个来源没有本机文件可定位）。断言这段结构，防"给 data URL 也挂一个
      //    指向假路径的按钮"。曾写过一个 isLocalImageSource 纯函数，但它没有任何调用点
      //    （resolveImagePath 已天然处理）→ 属死代码，已删（不再为无人使用的函数写断言）。
      (/const local = resolveImagePath\(path\);/.test(appSrc46) && /return local\s*\r?\n?\s*\? <button title="在文件夹中显示"/.test(appSrc46)
        ? ok : fail)("【47】灯箱「在文件夹中显示」以 resolveImagePath 的真返回值为准（data/http 不挂）");
      // ② 结构守卫：三个显示位点都必须用 imageDisplaySrc，且**不许**再出现旧的 http-only 三元
      // ⛔ 用 codeOnly 剥掉注释：注释里解释这个隐患时会写出同款字符串（本仓库就这么写的），
      //    按原文匹配会把它算成一处残留 → 假红（09-18 实测，见 codeOnly 的说明）。
      const badTernary = codeOnly(appSrc46).split(/\r?\n/).filter((l) => /startsWith\("http"\) \? [^\n]*: imageUrl\(/.test(l)).length;
      (badTernary === 0 ? ok : fail)(`【47】没有残留「只看 http、其余当本地路径」的旧写法（实得 ${badTernary} 处，已排除注释）`);
      const displaySites = (appSrc46.match(/imageDisplaySrc\(/g) || []).length;
      (displaySites >= 3 ? ok : fail)(`【47】消息图片 / 灯箱 / 悬停预览都走 imageDisplaySrc（${displaySites} 处，含定义 1）`);
      (/function imageUrl\(path: string\) \{\s*\r?\n\s*\/\/[^\n]*\r?\n\s*return localImageUrl\(path\);/.test(appSrc46)
        ? ok : fail)("【47】imageUrl 转发到纯函数（行为不变、可离线断言）");
      // ③ 组件必须是模块级的（内联箭头函数会每次 render 换身份 → 图片子树重挂、预览闪烁）
      (/^function MessageAttachChip\(/m.test(appSrc46) ? ok : fail)("【47】内联附件 chip 是模块级组件（不在 render 里现造）");
      (/<MessageAttachChip/.test(appSrc46) ? ok : fail)("【47】正文占位符图片与附件列表都复用它");
      (/className="message-attach-preview"/.test(appSrc46) ? ok : fail)("【47】图片 chip 里带悬停预览浮层");
      // ④ CSS：默认隐藏 + hover/focus 显示 + 两方向都限上限（自适应宽高比）+ 不挡自己的 hover
      const css47 = readStyles();
      (/\.message-attach-preview \{[\s\S]{0,420}?opacity: 0;[\s\S]{0,200}?visibility: hidden;/.test(css47)
        ? ok : fail)("【47】预览默认隐藏（不占位、不挡视线）");
      (/\.message-attach-chip:hover \.message-attach-preview,[\s\S]{0,120}?\.message-attach-chip:focus-visible \.message-attach-preview \{/.test(css47)
        ? ok : fail)("【47】hover 与键盘 focus 都能唤出预览");
      (/\.message-attach-preview img \{[\s\S]{0,300}?max-width:[^;]+;[\s\S]{0,160}?max-height: 240px;/.test(css47)
        ? ok : fail)("【47】预览只给上限（宽高 auto ⇒ 自适应原始宽高比，不用按比例写分支）");
      (/\.message-attach-preview \{[\s\S]{0,520}?pointer-events: none;/.test(css47)
        ? ok : fail)("【47】预览不接收鼠标（否则会挡掉 chip 自身的 hover/click）");
      (/\.message-attach-chip \{\s*\r?\n\s*position: relative;/.test(css47) ? ok : fail)("【47】chip 是定位上下文（浮层锚在它上方）");
      (/\.message-attach-chip\.is-image \{\s*\r?\n\s*cursor: zoom-in;/.test(css47) ? ok : fail)("【47】图片 chip 用 zoom-in 光标提示可点开大图");
      // ⑤ 浮层不能被祖先裁掉：气泡链路上不许有 overflow 裁剪
      const clipAncestors = [".message-body", ".user-message .message-body", ".user-message-text"]
        .filter((sel) => {
          const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{[^}]*overflow: (hidden|clip)", "");
          return re.test(css47);
        });
      (clipAncestors.length === 0 ? ok : fail)(`【47】气泡链路没有 overflow 裁剪（否则预览会被切掉）：${clipAncestors.join(", ") || "无"}`);
      // ⑥ 上方空间不足要能翻到下方 —— 聊天区滚动容器有 overflow 裁剪，靠近顶部的消息
      //    若硬往上弹会被切掉上半截（真机实测预览 top=-101，等于看不见）
      (/setPreviewBelow\(/.test(appSrc46) && /preview-below/.test(appSrc46)
        ? ok : fail)("【47】预览带方向判定（空间不足翻到下方）");
      (/onMouseEnter=\{\(event\) => decideDirection\(event\.currentTarget\)\}/.test(appSrc46)
        ? ok : fail)("【47】悬停时按实际几何决定方向（不是写死一个方向）");
      (/\.message-attach-chip\.preview-below \.message-attach-preview \{[\s\S]{0,200}?top: calc\(100% \+ 8px\);[\s\S]{0,80}?bottom: auto;/.test(css47)
        ? ok : fail)("【47】CSS 有「翻到下方」的对应变体（top 定位、bottom 复位）");
      // ⑦ 决定方向要取"最近裁剪容器"的上沿，不能拿视口/0 当界。
      // ⛔ 必须锚**那一行的实际表达式**：先前写成「文件里存在 getBoundingClientRect().top」
      //    是假绿（同函数里 `el.getBoundingClientRect().top` 就满足它，反证 ⑬ 因此没变红）。
      (/const limitTop = \(box \?\? document\.documentElement\)\.getBoundingClientRect\(\)\.top;/.test(appSrc46)
        ? ok : fail)("【47】方向判定以最近裁剪容器为界（不是 window 顶部 / 写死 0）");
      // ⑧ 指针点击后必须释放焦点：否则「点开大图 → Esc 关闭」后小预览会自己再冒出来
      //    （:focus-visible 命中；Esc 属键盘操作会把 Chromium 切到键盘焦点渲染模式）。
      //    判据要锚住 `detail > 0` 的条件与 blur() 调用，键盘激活（detail===0）必须保留焦点。
      (/if \(event\.detail > 0\) event\.currentTarget\.blur\(\);/.test(appSrc46)
        ? ok : fail)("【47】指针点击后释放焦点（Esc 关大图后小预览不会再冒出来）");
      (!/onClick=\{\(\) => \(image \? onOpenImage/.test(appSrc46)
        ? ok : fail)("【47】onClick 不再是一句话箭头函数（要拿 event 判断是否指针触发）");
    }

    console.log(C.bold("\n【48】输入框附件统一内联 chip + 粘贴长文本转 .txt + 文本编辑窗口"));
    {
      const att = await import("../../../src/lib/composer-attachments.mjs");
      const {
        attachmentToken, imageToken, fileToken, splitAttachmentSegments,
        promptImagePaths, promptFilePaths, stripAttachmentTokens,
        PASTED_TEXT_TO_FILE_THRESHOLD, shouldSavePastedTextAsFile,
      } = att;
      const css48 = readStyles();
      const mainSrc = readMainSource();
      const preloadSrc = readFileSync(join(ROOT, "electron", "preload.ts"), "utf8");
      const dtsSrc = readFileSync(join(ROOT, "src", "vite-env.d.ts"), "utf8");
      const IMGP = "C:\\a\\b\\图.png";
      const TXTP = "D:\\work\\笔记 v2.txt";

      // ── ① token 格式：图片那份**必须与历史逐字节一致**（老消息里存着它）
      (imageToken(IMGP) === `[图片:${encodeURIComponent(IMGP)}]` ? ok : fail)("【48】图片 token 格式与历史一致（老消息仍能解析出图）");
      (fileToken(TXTP) === `[文件:${encodeURIComponent(TXTP)}]` ? ok : fail)("【48】文件 token 形如 [文件:path]");
      (attachmentToken("file", TXTP) === fileToken(TXTP) && attachmentToken("image", IMGP) === imageToken(IMGP) ? ok : fail)("【48】两种类型走同一个 attachmentToken");
      let threw = false;
      try { attachmentToken("video", "x"); } catch { threw = true; }
      (threw ? ok : fail)("【48】未知类型直接抛错（不静默产出坏 token）");

      // ── ② 消息渲染层只认图片：`[文件:…]` 必须**原样算文本**，不能被吞掉
      //    （吞掉 = 用户正文里凭空少一段，且没人报错）
      const mixed = `开头 ${imageToken(IMGP)} 中间 ${fileToken(TXTP)} 结尾`;
      const imgOnly = splitAttachmentSegments(mixed, { kinds: ["image"] });
      (imgOnly.some((s) => s.kind === "image") ? ok : fail)("【48】只认图片时仍能解析出图片段");
      (imgOnly.every((s) => s.kind !== "file") && imgOnly.map((s) => (s.kind === "text" ? s.text : "IMG")).join("").includes(fileToken(TXTP))
        ? ok : fail)("【48】`[文件:…]` 对消息渲染层原样保留为文本（不被吞掉）");
      const both = splitAttachmentSegments(mixed);
      (both.filter((s) => s.kind !== "text").map((s) => s.kind).join(",") === "image,file" ? ok : fail)("【48】两种都认时按出现顺序解析（image,file）");

      // ── ③ 路径提取与去重
      (promptFilePaths(`${fileToken(TXTP)} 和 ${fileToken(TXTP)}`).join("|") === TXTP ? ok : fail)("【48】文件路径去重且保序");
      (promptImagePaths(mixed).join("|") === IMGP ? ok : fail)("【48】图片路径提取与历史行为一致");

      // ── ④ 剥离：只剥文件时图片 token 必须留着（图片要靠它在正文里定位渲染）
      const stripped = stripAttachmentTokens(mixed, ["file"]);
      (stripped.includes(imageToken(IMGP)) && !stripped.includes(fileToken(TXTP)) ? ok : fail)("【48】只剥文件 token，图片 token 原样保留");
      (!stripAttachmentTokens(mixed, ["image"]).includes(imageToken(IMGP)) ? ok : fail)("【48】可只剥图片 token（历史行为）");
      (stripAttachmentTokens(`${fileToken(TXTP)}\n\n\n\n尾`, ["file"]) === "尾" ? ok : fail)("【48】剥完清理多余空行（不留一串空行）");

      // ── ⑤ 长文本转文件：阈值与判据
      (PASTED_TEXT_TO_FILE_THRESHOLD === 200 ? ok : fail)(`【48】阈值是 200 字（实得 ${PASTED_TEXT_TO_FILE_THRESHOLD}）`);
      (shouldSavePastedTextAsFile("x".repeat(201)) && !shouldSavePastedTextAsFile("x".repeat(200)) ? ok : fail)("【48】正好 200 字不转、201 字转（边界）");
      (!shouldSavePastedTextAsFile("   \n\t  ") && !shouldSavePastedTextAsFile("") && !shouldSavePastedTextAsFile(null) ? ok : fail)("【48】空白/空值不转文件（不生成空文件）");
      // ⛔ 必须带"**超过阈值的**空白串"这一例：只测短空白串时，按原文长度判定也能通过
      //    （7 个字本来就不到 200）——那样的断言区分不出 trim 有没有生效（09-18 反证 ④ 实测）。
      (!shouldSavePastedTextAsFile(" ".repeat(PASTED_TEXT_TO_FILE_THRESHOLD + 50)) ? ok : fail)("【48】超阈值的纯空白也不转文件（复制一大段空行不该生成文件）");
      (shouldSavePastedTextAsFile(`${"x".repeat(201)}   \n\n`) ? ok : fail)("【48】按 trim 后长度判定（尾随空白不改变结论）");

      // ── ⑥ 输入框：删掉上方 strip、文件状态改为"从文本派生"
      // ⛔ 匹配前必须剥注释：我在 App.tsx 里留了「原先那条 .attachment-strip 已删除」的说明，
      //    按原文匹配会把这行注释算成"strip 还在"（同一个坑第三次踩到，见 codeOnly 注释）。
      const appCode48 = codeOnly(appSrc46);
      (!/attachment-strip/.test(appCode48) ? ok : fail)("【48】输入框上方那条附件 strip 已删除（用户要求文件也进输入框）");
      (!/setFiles\(/.test(appCode48) ? ok : fail)("【48】composer 的 files 状态已移除（文件只以 [文件:path] 存在于文本）");
      (/const attachedFiles = useMemo\(\(\) => promptFilePaths\(prompt\), \[prompt\]\)/.test(appSrc46) ? ok : fail)("【48】文件列表由 prompt 文本派生（不会与文本不同步）");
      (!/\.attachment-strip|\.file-attachment/.test(css48) ? ok : fail)("【48】strip 的 CSS 已清除（不留复活入口）");
      (/if \(seg\.kind !== "text"\) \{ root\.appendChild\(makeChip\(seg\.kind, seg\.path\)\); continue; \}/.test(appSrc46)
        ? ok : fail)("【48】编辑器重建 DOM 时图片/文件都生成 chip");
      (/const kind = el\.getAttribute\("data-attach-kind"\);/.test(appSrc46) && /el\.getAttribute\("data-attach-path"\)/.test(appSrc46)
        ? ok : fail)("【48】序列化靠统一的 data-attach-kind/path 还原占位符（不再用 data-image-path）");
      (!/getAttribute\("data-image-path"\)/.test(appSrc46) ? ok : fail)("【48】旧的 data-image-path 引用已清干净（不留两套属性各认一半）");
      // 插入/删除 token 只允许一条路径：composer 走 insertComposerAttachments（插 chip），
      // 旧的「直接往文本框拼 token」两个函数已无调用点，09-18 已删 —— 别让它们回来。
      (!/export function insertImageToken|export function removeImageToken/.test(readFileSync(join(ROOT, "src", "lib", "prompt-images.ts"), "utf8"))
        ? ok : fail)("【48】已删除两个历史死代码（insertImageToken / removeImageToken 无调用点）");
      // 删 chip 要只吃掉"插入时补的那一个空格"：把两侧全吃或全不吃都会让正文少/多一个空格
      {
        const { removeAttachmentToken: rm } = await import("../../../src/lib/composer-attachments.mjs");
        (rm(`看 readme ${fileToken(TXTP)} 很好`, "file", TXTP) === "看 readme 很好" ? ok : fail)("【48】删 chip 保留分词空格（不把两侧空格一起吃掉）");
        (rm(`前${fileToken(TXTP)}后`, "file", TXTP) === "前 后" ? ok : fail)("【48】删 chip 若两侧无空格则补一个（不把两个词粘成一个）");
      }

      // ── ⑦ 发送管线：文件 token → 既有 [附件文件] 段（模型侧协议不变），且从正文剥离
      (/const inlineFilePaths = promptFilePaths\(messageText\);/.test(appSrc46) ? ok : fail)("【48】发送前提取文件 token");
      (/if \(inlineFilePaths\.length\) messageText = stripAttachmentTokens\(messageText, \["file"\]\);/.test(appSrc46)
        ? ok : fail)("【48】文件 token 从正文剥离（不把 [文件:path] 当正文发给模型）");
      (appSrc46.includes("[附件文件]") && /inlineFilePaths\.map\(\(path\) => `- \$\{path\}`\)/.test(appSrc46)
        ? ok : fail)("【48】仍拼成 [附件文件] 段（引擎与渲染层解析的协议没变）");

      // ── ⑧ 粘贴长文本 → txt：三件套齐全 + 安全校验
      for (const [label, ch] of [["save", "pasted-text:save"], ["read", "pasted-text:read"], ["update", "pasted-text:update"]]) {
        (mainSrc.includes(`"${ch}"`) && preloadSrc.includes(`"${ch}"`) ? ok : fail)(`【48】${label} 通道 main + preload 都有（${ch}）`);
      }
      (/savePastedText\(text: string\): Promise<string \| null>;/.test(dtsSrc) && /readPastedText\(path: string\)/.test(dtsSrc) && /updatePastedText\(path: string, content: string\)/.test(dtsSrc)
        ? ok : fail)("【48】三个通道的类型声明齐全（渲染层才拿得到类型）");
      (/function isInsidePastedTextDir\(target: string\)/.test(mainSrc) && /只允许编辑应用自己保存的粘贴文本/.test(mainSrc)
        ? ok : fail)("【48】读/写做了目录内校验（否则等于给渲染层任意文件读写）");
      (/crypto\.createHash\("sha1"\)\.update\(content, "utf8"\)\.digest\("hex"\)\.slice\(0, 8\)/.test(mainSrc)
        ? ok : fail)("【48】文件名按内容哈希（同一段文本粘两次得到同一个文件）");
      (!/codex-harness-\$\{Date\.now\(\)\}\.txt/.test(mainSrc) ? ok : fail)("【48】不用时间戳命名（否则同一内容会堆出无限副本）");
      (/shouldSavePastedTextAsFile\(plain\)\) \{ onPasteLongText\(plain\); return; \}/.test(appSrc46)
        ? ok : fail)("【48】编辑器在「插入纯文本」之前先判长文本（否则超长文本照旧内联铺满输入框）");

      // ── ⑨ 文本编辑窗口：先问主进程再决定，且关窗即存
      (/const info = await window\.codex\.readPastedText\(target\);/.test(appSrc46) && /if \(info\?\.editable\) \{ setPastedText\(\{ path: target, name: basename\(target\) \}\); return; \}/.test(appSrc46)
        ? ok : fail)("【48】chip 点击先问主进程「是否可编辑」，再回退普通文件预览（不靠路径猜）");
      (!/pasted-text(?:\\\\|\/)/.test(appSrc46.replace(/pastedTextDir/g, "")) ? ok : fail)("【48】渲染层不靠路径前缀识别粘贴文本");
      // ⛔ 允许 `export ` 前缀：搬进 src/features/** 后声明行会变成 `export function …`，
      //    锚死 `^function` 会在搬家时假红（判据要盯"是不是模块级组件"，不盯有没有 export）。
      (/^(?:export\s+)?function PastedTextEditor\(/m.test(appSrc46) ? ok : fail)("【48】编辑器是模块级组件（内联箭头函数会每次 render 重挂）");
      (/if \(state\.editable && dirty\) \{ await save\(contentNow, \{ silent: true \}\); showToastEverywhere/.test(appSrc46)
        ? ok : fail)("【48】关窗自动保存（编辑的是应用自己的临时文本，丢改动比多存一次更糟；表格视图下取回写后的全文 contentNow）");
      (/\.pasted-text-body \{[\s\S]{0,420}?min-height: 0;/.test(css48)
        ? ok : fail)("【48】编辑区 min-height:0（flex 子项不收缩的话 textarea 会顶破面板）");
      (/\.pasted-text-modal \{[\s\S]{0,320}?z-index: 91;/.test(css48) ? ok : fail)("【48】文本窗口层级高于图片灯箱（不会被盖住）");

      // ── ⑩ 输入框自适应高度：有下限（够写）+ 有上限（不顶掉正文）+ 到顶内部滚动
      const editorCss = (css48.match(/\.composer-editor \{[\s\S]*?\n\}/) || [""])[0];
      (/min-height: \d+px/.test(editorCss) ? ok : fail)("【48】输入框有最小高度");
      /* 10-06 夜三轮：上限改为 var(--composer-editor-max, min(42vh, 360px)) —— 拖动把手的
         拖动上限在 JS 里钳（48 ~ min(55vh,560)，守卫【composer-resize】钉常量），这里的
         「有上限」判据两种形态都接受（裸 min(...) 或带 fallback 的 var）。 */
      (/max-height: (?:min\([^)]+\)|var\(--composer-editor-max)/.test(editorCss) ? ok : fail)("【48】输入框有高度上限");
      (/overflow-y: auto/.test(editorCss) ? ok : fail)("【48】到达上限后内部滚动（不会把上方正文顶出视野）");
    }
  }
}

{
{
  const { createRunClock } = await import("../../../src/lib/run-clock.mjs");
  const T0 = 1_700_000_000_000;
  const clock = createRunClock({ maxEntries: 3 });

  // ① 行为断言：起点幂等 + 跨挂载接着走（重挂载 = 拿同一个起点再问一次）
  clock.elapsedSeconds("turn-a", T0);
  (clock.elapsedSeconds("turn-a", T0 + 8000) === 8 ? ok : fail)("【49】同一回合的计时接着走（8 秒后就是 8 秒，不从 0 重数）");
  (clock.elapsedSeconds("turn-a", T0 + 125000) === 125 ? ok : fail)("【49】跨分钟后仍接着走（125 秒，不回到个位数）");
  // 不同回合必须各自独立（否则两个会话的计时会互相串）
  (clock.elapsedSeconds("turn-b", T0 + 3000) === 0 ? ok : fail)("【49】不同回合各自独立计时（不共用起点）");
  // 时钟回拨/负值：不得显示成「正在处理 -5 秒」
  (clock.elapsedSeconds("turn-a", T0 - 5000) === 0 ? ok : fail)("【49】时钟回拨时夹到 0（不出现负数计时）");
  // 回合结束后清理：下一轮同 id（理论上不复用，但语义要自洽）从 0 开始
  clock.forget("turn-a");
  (clock.elapsedSeconds("turn-a", T0 + 999000) === 0 ? ok : fail)("【49】回合结束清理起点（下一轮不再复用老起点）");
  // 容量上限：溢出淘汰最久未用，防止「只跑不停的会话」把表撑大
  const cap = createRunClock({ maxEntries: 2 });
  cap.elapsedSeconds("a", T0); cap.elapsedSeconds("b", T0); cap.elapsedSeconds("c", T0);
  (cap.size === 2 && !cap.has("a") && cap.has("b") && cap.has("c") ? ok : fail)("【49】起点表有容量上限（超出淘汰最久未用，不无限增长）");
  // ⛔ 上一条**区分不出「有没有 LRU 提热度」**（插入顺序就是 a,b,c 时，淘汰 a 是无提热度也成立的结果）。
  //    真机意义很大：长期在跑的回合每秒都在取起点，若命中不提升热度，它会被后续新回合挤出表 →
  //    切回来又归零（本 bug 原地复活）。这条专测它。
  const lru = createRunClock({ maxEntries: 2 });
  lru.elapsedSeconds("x", T0); lru.elapsedSeconds("y", T0);
  lru.elapsedSeconds("x", T0 + 1000);   // 命中 x → 提到最新
  lru.elapsedSeconds("z", T0 + 2000);   // 超容量 → 该淘汰 y（不是 x）
  (lru.has("x") && !lru.has("y") && lru.has("z") ? ok : fail)("【49】正在跑的回合不会被新回合挤掉（取起点会提升热度）");
  // 没有 id 也不能崩（退化成「不记忆」，只保证当次正确）
  (typeof createRunClock().elapsedSeconds(null, T0) === "number" ? ok : fail)("【49】缺少回合 id 时不崩（退化为不记忆）");

  // ② 结构守卫：起点必须来自 RUN_CLOCK，不许退回组件内部状态（那正是本 bug 的成因）
  const appCode49 = codeOnly(readAppUi());
  (!/const startedRef = useRef\(Date\.now\(\)\)/.test(appCode49) ? ok : fail)("【49】计时起点不再存在组件内部（useRef(Date.now()) 已清除）");
  (/RUN_CLOCK\.elapsedSeconds\(turnId, now\)/.test(appCode49) ? ok : fail)("【49】计时条从按回合记忆的起点表取值");
  (/<RunningProcessTime turnId=\{turn\.id\} \/>/.test(appCode49) ? ok : fail)("【49】计时条拿到回合 id（否则记忆表无从索引）");
  (/if \(!running\) RUN_CLOCK\.forget\(turn\.id\);/.test(appCode49) ? ok : fail)("【49】回合结束时清掉起点（表不随历史回合堆积）");
  // 必须盯住"不是在 effect 的 cleanup 里清"：卸载时清理 = 切会话就把记忆丢了 = 本 bug 原地复活
  (!/return \(\) => \{[^}]*RUN_CLOCK\.forget/.test(appCode49) ? ok : fail)("【49】不是「卸载时清理」（切会话正要靠这条记忆跨过卸载）");
}
}

{
{
  // user-refs.ts 是 TS，预检（纯 node ESM）不能直接 import ⇒ **从源码里取出真实正则**再跑。
  // 这样测的是仓库里那个正则本身，而不是抄一份到断言里（抄一份就会漂移，且抄错也照样绿）。
  const refsSrc = readFileSync(join(ROOT, "src", "lib", "user-refs.ts"), "utf8");
  const grabRe = (name) => {
    const m = refsSrc.match(new RegExp(`const ${name} = clean\\.match\\((/.*?/)\\);`));
    if (!m) return null;
    const body = m[1];
    const lastSlash = body.lastIndexOf("/");
    try {
      return new RegExp(body.slice(1, lastSlash), body.slice(lastSlash + 1));
    } catch {
      return null;
    }
  };
  const fileSeg = grabRe("fileMatch");
  const skillSeg = grabRe("skillMatch");
  const ctxSeg = grabRe("ctxMatch");
  (fileSeg && skillSeg && ctxSeg ? ok : fail)("【50】能从 user-refs.ts 取出三处段解析正则（取不到说明写法变了，下面的断言会失效）");

  if (fileSeg) {
    const parseAttach = (text) => {
      const files = [];
      const m = text.match(fileSeg);
      let clean = text;
      if (m) {
        for (const line of m[1].split(/\r?\n/)) {
          const mm = line.match(/^-\s+(.+)$/);
          if (mm) files.push(mm[1].trim());
        }
        clean = text.replace(m[0], "");
      }
      return { files, clean: clean.replace(/\n{3,}/g, "\n\n").trim() };
    };
    const leak = (raw) => {
      const r = parseAttach(raw);
      return { leaked: /\[附件结束\]|\[附件文件\]/.test(r.clean), ...r };
    };

    // ⛔ 用户截图的原始场景：文件名含方括号 → 旧正则在行中间就把段截断，
    //    残留 ".png" 与 "[附件结束]" 被当成用户正文显示。
    const b = leak("看下图片\n\n[附件文件]\n- D:\\素材\\_a_曦_2026年9月6日_初评图片_1.jpg\n- D:\\素材\\22 钛光金 [最终版].png\n[附件结束]\n");
    (b.leaked ? fail : ok)("【50】文件名含方括号不再泄漏协议标记（用户截图场景）");
    (b.files.length === 2 && b.files[1] === "D:\\素材\\22 钛光金 [最终版].png" ? ok : fail)(`【50】含方括号的文件名完整解析（实得 ${b.files.length} 个：${b.files.join(" | ")}）`);

    const c = leak("看下图片\n\n[附件文件]\n- D:\\素材\\图[1].jpg\n- D:\\素材\\b.png\n[附件结束]\n");
    (c.leaked || c.files.length !== 2 ? fail : ok)("【50】路径里的方括号目录（素材[1]）同样不破坏解析");

    // ⛔ CRLF 回归防线：本轮把结束标记改成「整行」后，\n 写死会让 CRLF 消息里最后一行的 \r
    //    留在行尾 → 行正则失配 → **文件数变 0**（我第一版就是这样，靠这条断言才没漏出去）。
    const d = leak("看下图片\r\n\r\n[附件文件]\r\n- D:\\素材\\22 钛光金 [最终版].png\r\n[附件结束]\r\n");
    (!d.leaked && d.files.length === 1 ? ok : fail)(`【50】CRLF 行尾的消息也能解析出文件（实得 ${d.files.length} 个）`);

    const e = leak("看下图片\n\n[附件文件]\n- D:\\素材\\a.png\n");
    (!e.leaked && e.files.length === 1 ? ok : fail)("【50】没有结束标记的残缺段仍能解析出已列出的文件");

    const f = leak("看下图片\n\n[附件文件]\n- D:\\素材\\b [2].png\n[附件结束]\n\n后面这句是我的正文");
    (!f.leaked && f.clean.includes("后面这句是我的正文") ? ok : fail)("【50】段后的用户正文完整保留（不误吞）");
  }

  // 结构守卫：三处都必须要求「整行」结束标记（`\r?\n\[`），不许再有裸 `\[[^\]]+\]` 分支
  // ⛔ 取「整行」时记得带上行尾的 `;`：写成 `.*$\)` 会因为末尾还剩一个 `;` 而匹配失败
  //    （`.*` 回溯到 `)` 后 `$` 不是行尾）→ 列表恒空 → 后两条断言假红（本轮实测）。
  const segRegExes = (refsSrc.match(/^.*const (?:fileMatch|skillMatch|ctxMatch) = clean\.match\(\/.*$/gm) || []);
  (segRegExes.length === 3 ? ok : fail)(`【50】三处段解析正则都在（实得 ${segRegExes.length} 处）`);
  const looseEnd = segRegExes.filter((l) => /\(\?:\\\[\[\^\\\]\]\+\\\]\|\$\)/.test(l)).length;
  (looseEnd === 0 ? ok : fail)(`【50】三处段解析都不再用「行中任意方括号」当结束标记（实得 ${looseEnd} 处旧写法）`);
  const lineAnchored = segRegExes.filter((l) => /\(\?:\\r\?\\n\\\[/.test(l)).length;
  (lineAnchored === 3 ? ok : fail)(`【50】三处结束标记都要求整行 + 兼容 CRLF（实得 ${lineAnchored}/3）`);

  // ── 停止后：过程保持展开 + 标记落在最新内容之后 ──
  const appSrc50 = readAppUi();
  const appCode50 = codeOnly(appSrc50);
  const css50 = readStyles();
  (/\{userStopped && \(/.test(appCode50) ? ok : fail)("【50】有「用户已停止」标记");
  // 判据：interruptedAt 只由本机 interrupt() 写入，用它区分"用户点的停止"
  (/const userStopped = Boolean\(interruptedAt\)/.test(appCode50) ? ok : fail)("【50】用 interruptedAt 区分「用户点的停止」（语音/手机端/引擎中止不算）");
  (/!running && !stoppedWithoutReply && !userStopped && stopReason\.label/.test(appCode50) ? ok : fail)("【50】用户点的停止不再同时弹顶部通用中断提示（避免同屏两处说停止）");
  (/keepProcessOpen=\{userStopped\}/.test(appCode50) ? ok : fail)("【50】停止的回合把过程组摊开（keepProcessOpen 接上了）");
  // ⛔ 必须数「≥2 处」：TurnFoldStream 有两条完成态渲染分支（planCompletedFold 分段 / 通用 segments），
  //    只改一处的话另一条路径照样折着 —— 而"只查存在一处"的写法对这种情况恒绿（反证时实测到）。
  {
    const n = (appCode50.match(/defaultOpen=\{keepProcessOpen\}/g) || []).length;
    (n >= 2 ? ok : fail)(`【50】两条完成态渲染分支都用了 defaultOpen（实得 ${n} 处，需 ≥2）`);
  }
  (/\{stoppedWithoutReply &&/.test(appCode50) ? ok : fail)("【50】「未开始回复就停止」的既有提示保留（零产出场景仍要说清）");
  // ⛔ 防重复文案：标记里不许再报耗时（过程组标题已经写了「已停止 · 耗时 X」）
  {
    const at = appCode50.indexOf("{userStopped && (");
    const marker = at >= 0 ? appCode50.slice(at, appCode50.indexOf("{turnFinished && finalAgent", at)) : "";
    (!/elapsedSeconds|已处理\s*\$\{|耗时/.test(marker) ? ok : fail)("【50】停止标记不重复耗时（耗时由过程组标题负责，同一屏只说一次）");
    // 顺序：内容 → 标记 → 操作栏
    const foldIdx = appCode50.indexOf("<TurnFoldStream items={foldItems}");
    const noticeIdx = appCode50.indexOf("{userStopped && (");
    const footerIdx = appCode50.indexOf("{turnFinished && finalAgent");
    (foldIdx > 0 && noticeIdx > foldIdx && footerIdx > noticeIdx ? ok : fail)("【50】标记落在「最新内容之后、操作栏之前」（用户明确要求的位置）");
  }
  (/\.turn-user-stopped \{[\s\S]{0,400}?display: flex;/.test(css50) ? ok : fail)("【50】停止标记有样式（不是裸文本）");
}
}

{
{
  const appSrc51 = readAppUi();
  const appCode51 = codeOnly(appSrc51);

  // ① 「thread?.id 一变就清留白」的 passive effect 必须不存在 ——
  //    它与 useLayoutEffect 里的 pinSentMessage 抢同一份留白（layout 先跑、passive 后跑），
  //    结果「刚撑起来就被清成 0」→ 锚点滚不到落点 → 切回来钉顶掉下来。
  (!/useEffect\(\(\) => \{\r?\n\s*clearAnchorPad\(\);\r?\n\s*\}, \[thread\?\.id, clearAnchorPad\]\)/.test(appCode51)
    ? ok : fail)("【51】没有「thread.id 一变就清留白」的 passive effect（它会覆盖 layout effect 刚撑好的留白）");

  // ② 归属变化必须被当作 first（切回来要重算留白 + 立即落位）
  (/const ownerChanged = Boolean\(owner\) && pinThreadIdRef\.current !== owner;/.test(appCode51)
    ? ok : fail)("【51】归属变化被当作 first 处理（切回来会重算留白并立即落位）");
  (/const first = pinnedAnchorKeyRef\.current !== key \|\| returned \|\| ownerChanged;/.test(appCode51)
    ? ok : fail)("【51】first 判据包含归属变化");

  // ③ 归属只能被真实 id 写入（空值不许覆盖）——
  //    乐观阶段传进来的 thread?.id 还是 null，旧写法会把归属写成 null → 跟随的入口条件
  //    `pinThreadIdRef.current === myThreadId` 恒不成立 → 钉顶期间一次都不跟随。
  (/const owner = threadId \|\| pinThreadIdRef\.current \|\| null;/.test(appCode51)
    ? ok : fail)("【51】归属不被空 threadId 覆盖（否则长消息发送后自动跟随失效）");
  (!/pinThreadIdRef\.current = threadId \?\? null;/.test(appCode51)
    ? ok : fail)("【51】没有残留「归属 = threadId ?? null」的旧写法");

  // ④ ⛔ 09-20 用户定稿「运行中的话就钉顶，运行完成就不要钉」：**回合结束即脱钉** ——
  //    解除锚定（anchorTopRef=false）+ 留白归零 + 贴底回到内容末尾（下方不留空白）。
  //    旧口径（09-18「钉顶仍生效就保留」）的代价是完成后下方残留一大片空白（09-20 中午截图），
  //    已按用户新口径废弃 —— 留白量 N 与「滚到底时内容底部到视口底部的距离」严格 1:1，
  //    留着 N 就有 N 的空白，用户选了「不要空白」。
  (/if \(params\.threadId === threadRef\.current\?\.id\) \{[\s\S]{0,200}?anchorTopRef\.current = false;/.test(appCode51)
    ? ok : fail)("【51】回合结束即脱钉（09-20 用户定稿：运行中钉顶、运行完成不钉）");
  (!/&& !anchorTopRef\.current\) clearAnchorPad\(\);/.test(appCode51)
    ? ok : fail)("【51】没有残留「只在钉顶已失效时清留白」的旧口径（那会在完成后留下大片空白）");

  // ⑤ 自动跟随三要素（09-20 用户回头确认「最新消息自动跟随还在不，这个没丢吧」）——
  //    跟随只在**运行中（钉顶期）**生效，回合结束脱钉后自然停止，所以它必须与钉顶口径同存亡。
  (/const FOLLOW_STEP_PX = 48;/.test(appCode51) ? ok : fail)(
    "【51】自动跟随步长常量在（48px：攒约两行再整体跟一次，逐帧跟会与换行重排抢）"
  );
  (/const pinMine = anchorTopRef\.current && \(pinThreadIdRef\.current === null \|\| pinThreadIdRef\.current === myThreadId\);/.test(appCode51)
    ? ok : fail)("【51】跟随入口接受「归属未知 = 自己」（否则刚发送那一小段完全不跟随）");
  (/if \(followDist > -FOLLOW_STEP_PX\) \{/.test(appCode51) ? ok : fail)(
    "【51】跟随入口 = followDist > -48（交棒前 bodyDist / 交棒后全量 dist，短回复不被推）");
  (/scrollToOffsetInstant\(scroller, scroller\.scrollTop \+ followDist\);/.test(appCode51) ? ok : fail)(
    "【51】跟随补滚动量 = followDist（把内容底补到视口底，不整体推）");

  // ⑧ 钉顶交棒只看**正文**（09-26 用户定稿：思考板块撑满一屏不许取消钉顶）——
  //    旧判据用全量内容底，思考卡一流式就把 overflow 撑正 → 提前交棒（钉顶没了）；
  //    思考折叠后 pin-fix 又把消息拉回落点（又钉上去）= 用户看到的来回翻。
  //    判据锚**接线**：helper 存在 + 两个消费方（交棒 / 跟随）都改用它，缺一边 = 半死状态。
  (/const bodyBottomOf = useCallback\(\(el: HTMLElement\) => \{/.test(appCode51) ? ok : fail)(
    "【51】bodyBottomOf（正文底 = 内容底 − 展开中的思考卡高）在 pin-scroll-anchor 定义"
  );
  (/const overflow = bodyBottomOf\(el\) - el\.scrollTop - el\.clientHeight;/.test(appCode51) ? ok : fail)(
    "【51】pinSentMessage 交棒判据用正文底（思考板块不取消钉顶，09-26）"
  );
  (/const bodyDist = bodyBottomOf\(scroller\) - scroller\.scrollTop - scroller\.clientHeight;/.test(appCode51) ? ok : fail)(
    "【51】钉顶跟随分支的判据与交棒同源（都走 bodyBottomOf，缺一边 = 半死状态）"
  );
  (!/const overflow = contentBottomOf\(el\) - el\.scrollTop - el\.clientHeight;/.test(appCode51) ? ok : fail)(
    "【51】交棒判据不许退回全量内容底（那就是「思考一输出钉顶就没」本身）"
  );
  (/setAwayFromBottom\(!anchorTopRef\.current && dist >/.test(appCode51) ? ok : fail)(
    "【51】钉顶期间「回到底部」按钮不得出现（它的 onClick 会解除钉顶 = 思考从侧门取消钉顶）"
  );

  // ⑤ 侧栏会话行带 data-thread-id：验收脚本按 id 切换才可靠
  //    （按标题找会因列表重排/标题变化而"找不到会话行" → 观测无效，本轮就是这么白跑一轮的）
  (/data-thread-id=\{entry\.id\}/.test(appCode51) ? ok : fail)("【51】会话行带 data-thread-id（验收按 id 切换，不靠标题）");

  // ⑥ 「归属未知」不得被当成「属于别的会话」——这是「长内容发送后不自动跟随」的**真根因**：
  //    乐观阶段归属还是 null，旧判据 `pinThreadIdRef.current !== thread?.id` 把它当外人 ⇒
  //    跳过 pinSentMessage ⇒ 归属永远补不上 ⇒ 跟随入口恒不成立（真机实测 top 恒为 0、
  //    内容底部停在视口外 34px 且一动不动）。
  (/const pinOwnerUnknown = anchorTopRef\.current && pinThreadIdRef\.current === null;/.test(appCode51)
    ? ok : fail)("【51】归属未知不算休眠（否则钉顶归属永远补不上、跟随永不启动）");
  (/const pinDormant = anchorTopRef\.current && !pinOwnerUnknown && pinThreadIdRef\.current !== thread\?\.id;/.test(appCode51)
    ? ok : fail)("【51】pinDormant 判据排除「归属未知」");
  // ⑦ 跟随入口同样把 null 当自己（多一层保险）
  (/const pinMine = anchorTopRef\.current && \(pinThreadIdRef\.current === null \|\| pinThreadIdRef\.current === myThreadId\);/.test(appCode51)
    ? ok : fail)("【51】跟随入口接受「归属未知 = 自己」（anchorTopRef 只在本会话发送时置真）");
}
}
}
