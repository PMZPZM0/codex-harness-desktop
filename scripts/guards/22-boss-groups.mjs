/**
 * 预检守卫：创世 boss 群编排（10-24 立）
 *
 * ⛔ 这一组**真跑**状态机（`dist-electron/boss-groups/state.js`），不是 grep 字符串：
 *    这套功能的价值全在"打回真的会换人、超限真的会停"，而那两条**只能靠行为断言证明**。
 *    事故形态（不夸张）：作者锁写漏一个判断 ⇒ 同一个成员改自己被打回的稿子 ⇒ 用户看到的是
 *    "改了两轮还是错的"，而所有静态检查全绿。
 *
 * ⛔ 跑在 check 链上（不进 check-preflight 的 MODULES ⇒ 不占 EXPECTED_CHECKS 总账，同 11r/12w 的口径）。
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const require = createRequire(import.meta.url);

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【boss-groups】${message}`);
  if (!condition) fails++;
};
const throws = (fn) => { try { fn(); return null; } catch (error) { return String(error?.message ?? error); } };

/* ── 0. 产物必须存在（预检会先 build，缺产物说明 build 挂了，别静默当 0 条通过） ── */
let state = null;
try {
  state = require(join(ROOT, "dist-electron", "boss-groups", "state.js"));
} catch (error) {
  ok(false, `dist-electron/boss-groups/state.js 加载失败（先跑 npm run build:electron）：${String(error?.message ?? error).slice(0, 120)}`);
}
if (state) {
  const { emptyState, createGroup, addMember, addTask, assignTask, markRunning, submitTask, recordReview, pickReassignee, resolveEscalation, checkBudget, parseVerdict, removeMember, setPinned, pushEvent } = state;
  const { MAX_MEMBERS, DEFAULT_POLICY } = require(join(ROOT, "dist-electron", "boss-groups", "types.js"));

  const mkGroup = (stateObj, members, policy) => createGroup(stateObj, {
    name: "回归群", workspace: "D:/tmp", bossThreadId: "thread-boss",
    members, policy,
  });

  /* ── 1. 建群：成员数边界 ── */
  {
    const s = emptyState();
    ok(Boolean(throws(() => createGroup(s, { name: "空群", workspace: "", bossThreadId: "t", members: [] }))),
      "成员 0 个 ⇒ 建群被拒");
    const seven = Array.from({ length: 7 }, (_, i) => ({ name: `m${i}`, role: "角色" }));
    ok(Boolean(throws(() => createGroup(s, { name: "太挤", workspace: "", bossThreadId: "t", members: seven }))),
      `成员超过上限（${MAX_MEMBERS}）⇒ 建群被拒`);
    ok(String(throws(() => createGroup(s, { name: "无 boss", workspace: "", bossThreadId: "", members: [{ name: "a", role: "r" }] })))?.includes("boss"),
      "缺 bossThreadId ⇒ 建群被拒（群必须挂在一条会话上）");
  }

  /* ── 2. policy 缺省值（undefined 覆盖默认值那个坑的回归） ── */
  {
    const s = emptyState();
    const g = mkGroup(s, [{ name: "甲", role: "写" }], { maxRejects: undefined, budgetMinutes: undefined });
    ok(g.policy.maxRejects === DEFAULT_POLICY.maxRejects && g.policy.budgetMinutes === DEFAULT_POLICY.budgetMinutes,
      `policy 传 undefined 时保留默认（maxRejects=${g.policy.maxRejects} / ${g.policy.budgetMinutes} 分钟，不是 NaN）`);
    ok(Number.isFinite(g.policy.stallMs) && g.policy.stallMs > 0, "stallMs 有有效默认值");
  }

  /* ── 3. 加任务：验收标准是硬门槛 ── */
  {
    const s = emptyState();
    const g = mkGroup(s, [{ name: "甲", role: "写" }, { name: "乙", role: "写" }]);
    ok(String(throws(() => addTask(s, { groupId: g.id, title: "无标准", brief: "", criteria: "  " })))?.includes("验收标准"),
      "没有验收标准（criteria）⇒ 加任务被拒（没有标准就没法审）");
    ok(String(throws(() => addTask(s, { groupId: g.id, title: "  ", brief: "", criteria: "能跑" })))?.includes("标题"),
      "空标题被拒");
  }

  /* ── 4. 正常闭环：派活 → 交活 → 通过 ── */
  {
    const s = emptyState();
    const g = mkGroup(s, [{ name: "甲", role: "写" }, { name: "乙", role: "写" }]);
    const t = addTask(s, { groupId: g.id, title: "首页文案", brief: "三屏", criteria: "有主标题 + CTA" });
    assignTask(s, t.id, g.members[0].id);
    ok(t.status === "assigned" && t.attempts.length === 1, "派活 ⇒ assigned 且记一次 attempt");
    markRunning(s, t.id, { threadId: "th-1", turnId: "turn-1" });
    ok(t.status === "running" && g.members[0].status === "busy", "开跑 ⇒ running 且成员 busy");
    submitTask(s, t.id, "成品正文");
    ok(t.status === "reviewing" && g.members[0].status === "reviewing", "交活 ⇒ reviewing");
    recordReview(s, t.id, { by: "fresh", verdict: "approved", reasons: [] });
    ok(t.status === "done" && g.members[0].status === "idle" && t.rejects === 0, "审查通过 ⇒ done，成员回到 idle");
  }

  /* ── 5. 打回：必须给理由 ── */
  {
    const s = emptyState();
    const g = mkGroup(s, [{ name: "甲", role: "写" }, { name: "乙", role: "写" }]);
    const t = addTask(s, { groupId: g.id, title: "T", brief: "", criteria: "有 CTA" });
    assignTask(s, t.id, g.members[0].id);
    markRunning(s, t.id, { threadId: "th-1" });
    submitTask(s, t.id, "没有 CTA 的稿子");
    ok(String(throws(() => recordReview(s, t.id, { by: "fresh", verdict: "rejected", reasons: [] })))?.includes("理由"),
      "空理由打回被拒（防「我不满意」式空转）");
    const t2 = recordReview(s, t.id, { by: "fresh", verdict: "rejected", reasons: ["缺 CTA"] });
    ok(t2.rejects === 1 && t2.lockedAuthors.includes(g.members[0].id), "打回 ⇒ rejects=1 且作者进锁名单");
    ok(g.members[0].status === "locked" && g.members[0].lockedTaskIds.includes(t.id), "打回 ⇒ 成员状态 locked 且锁住的是**这条任务**");
    ok(t2.status === "rejected", "还有可用成员 ⇒ 停在 rejected（等换人）");
    ok(String(throws(() => assignTask(s, t.id, g.members[0].id)))?.includes("锁"), "⛔ 再派给被锁作者 ⇒ 被拒（作者锁真的生效）");
    ok(pickReassignee(s, t2)?.id === g.members[1].id, "pickReassignee 跳过被锁作者，选第二人");
    assignTask(s, t.id, g.members[1].id);
    markRunning(s, t.id, { threadId: "th-2" });
    submitTask(s, t.id, "第二版");
    const t3 = recordReview(s, t.id, { by: "fresh", verdict: "rejected", reasons: ["还是没 CTA"] });
    ok(t3.rejects === 2 && t3.status === "escalated", "第二次打回（上限 2）⇒ escalated，不再自动重派");
    ok(Boolean(t3.escalation?.options?.length === 3), "escalated 带三个可选项（换模型/放宽/接手）");
    ok(g.members.every((m) => m.status === "locked" || m.lockedTaskIds.includes(t.id)), "两人都被锁在任务上");
  }

  /* ── 6. 全员被锁：不许放行被锁作者 ── */
  {
    const s = emptyState();
    const g = mkGroup(s, [{ name: "甲", role: "写" }], { maxRejects: 5 });
    const t = addTask(s, { groupId: g.id, title: "独角戏", brief: "", criteria: "能用" });
    assignTask(s, t.id, g.members[0].id);
    markRunning(s, t.id, { threadId: "x" });
    submitTask(s, t.id, "v1");
    const t2 = recordReview(s, t.id, { by: "fresh", verdict: "rejected", reasons: ["不合格"] });
    ok(t2.status === "escalated" && pickReassignee(s, t2) === null,
      "只有一个人且被打回 ⇒ 直接 escalated（不会把被锁的人放回来）");
    ok(Boolean(throws(() => assignTask(s, t.id, g.members[0].id))), "escalated 状态下再派活一律被拒（状态闸先于作者锁）");
  }

  /* ── 7. 升级三选一 ── */
  {
    const s = emptyState();
    const g = mkGroup(s, [{ name: "甲", role: "写" }, { name: "乙", role: "写" }], { maxRejects: 1 });
    const t = addTask(s, { groupId: g.id, title: "升级", brief: "", criteria: "老标准" });
    assignTask(s, t.id, g.members[0].id);
    markRunning(s, t.id, { threadId: "x" });
    submitTask(s, t.id, "v1");
    recordReview(s, t.id, { by: "fresh", verdict: "rejected", reasons: ["不达标"] });
    ok(t.status === "escalated", "打回 1 次到上限 ⇒ escalated");
    ok(String(throws(() => resolveEscalation(s, t.id, "relax-criteria", "")))?.includes("验收标准"),
      "放宽标准必须给新标准（否则下一轮还按老标准打回）");
    resolveEscalation(s, t.id, "relax-criteria", "能跑起来就算过");
    ok(t.status === "queued" && t.criteria === "能跑起来就算过", "放宽 ⇒ 回 queued 且 criteria 真的被改");
    ok(t.lockedAuthors.length === 0 && g.members.every((m) => m.lockedTaskIds.length === 0), "用户介入后清锁（锁的目的已达成）");
    ok(String(throws(() => resolveEscalation(s, t.id, "user-takeover")))?.includes("升级状态"), "非 escalated 状态不能再走升级流程");
  }

  /* ── 8. 预算闸 ── */
  {
    const s = emptyState();
    const g = mkGroup(s, [{ name: "甲", role: "写" }], { budgetMinutes: 1 });
    g.createdAt = Date.now() - 61_000;     // 假装已经用了 61 秒 / 预算 1 分钟
    const res = checkBudget(s, g.id);
    ok(res.warn === "100" && g.paused === true, "预算用尽 ⇒ paused + 告警 100");
    const t = addTask(s, { groupId: g.id, title: "暂停后", brief: "", criteria: "x" });
    ok(String(throws(() => assignTask(s, t.id, g.members[0].id)))?.includes("暂停"), "暂停后派活被拒（不会偷偷继续烧）");
  }

  /* ── 8b. 动态成员：拉人 / 移人（10-24 用户令） ── */
  {
    const s = emptyState();
    const g = mkGroup(s, [{ name: "甲", role: "写" }]);
    const m2 = addMember(s, g.id, { name: "乙", role: "写" });
    ok(g.members.length === 2 && m2.status === "idle", "拉人 ⇒ 建档（不建会话，idle）");
    ok(addMember(s, g.id, { name: "丙", role: "" }).role === "成员", "空岗位回落「成员」（不拒，别让 boss 卡在措辞上）");
    let capError = "";
    for (let i = 0; i < 6 && !capError; i++) {
      capError = throws(() => addMember(s, g.id, { name: `乙${i}`, role: "写" })) ?? "";
    }
    ok(capError.includes("最多"), "在群成员超过上限 ⇒ 被拒");
    const t = addTask(s, { groupId: g.id, title: "T", brief: "", criteria: "能用" });
    assignTask(s, t.id, m2.id);
    markRunning(s, t.id, { threadId: "x" });
    removeMember(s, g.id, m2.id);
    ok(m2.status === "removed" && pickReassignee(s, t)?.id !== m2.id, "移出 ⇒ removed 且不再被挑中");
    // ⛔ 双闸都在：running 状态闸先拒；就算任务回到可派状态，成员状态闸也拒（“已移出群”）
    ok(Boolean(throws(() => assignTask(s, t.id, m2.id))), "派活给已移出成员 ⇒ 被拒");
    {
      const t2 = addTask(s, { groupId: g.id, title: "T2", brief: "", criteria: "能用" });
      ok(String(throws(() => assignTask(s, t2.id, m2.id)))?.includes("移出"), "queued 任务派给已移出成员 ⇒ 成员状态闸拒绝");
    }
    ok(t.status === "running", "移人不打断在跑任务（等它交活，默认口径）");
    // 置顶：事件由 addMember/removeMember 产生，取一条真实事件
    const ev = s.events[s.events.length - 1];
    setPinned(s, g.id, ev.id, true);
    ok(g.pinnedEventIds.includes(ev.id), "置顶 ⇒ 进 pinnedEventIds");
    setPinned(s, g.id, ev.id, false);
    ok(!g.pinnedEventIds.includes(ev.id), "取消置顶 ⇒ 移出");
  }

  /* ── 8c. 群聊正文（10-24 用户令：回复要在群里，不在外面）── */
  {
    const s = emptyState();
    const g = mkGroup(s, [{ name: "甲", role: "写" }]);
    for (const kind of ["chat-user", "chat-boss", "chat-member"]) {
      const ev = pushEvent(s, { groupId: g.id, kind, text: "hi" });
      ok(ev.kind === kind && s.events.includes(ev), `群聊事件 kind=${kind} 可落账本`);
    }
    ok(s.events.filter((e) => e.kind === "chat-user").length === 1, "重复触发不会互相顶掉（各自独立入账）");
  }

  /* ── 8d. CLI 成员（本机外部 agent，10-25 群聊重构）── */
  {
    const s = emptyState();
    const g = mkGroup(s, [{ name: "甲", role: "写" }]);
    ok(String(throws(() => addMember(s, g.id, { name: "zcode", role: "CLI", source: "cli" })))?.includes("命令模板"), "⛔ CLI 成员没有命令模板 ⇒ 被拒");
    const cli = addMember(s, g.id, { name: "zcode", role: "CLI", source: "cli", cliCommand: 'zcode -p "{prompt}"' });
    ok(cli.source === "cli" && cli.cliCommand?.includes("{prompt}"), "CLI 成员建档（source=cli + 模板）");
    const t = addTask(s, { groupId: g.id, title: "T", brief: "", criteria: "能用" });
    assignTask(s, t.id, cli.id);
    ok(t.status === "assigned" && t.assignee === cli.id, "CLI 成员可以被派活（派遣走子进程，状态机同款）");
    const eng = addMember(s, g.id, { name: "乙", role: "写" });
    ok(eng.source === "engine" && !eng.cliCommand, "默认来源 = engine（不带 cliCommand）");
  }

  /* ── 9. 评审输出解析：绝不默认通过 ── */
  {
    ok(parseVerdict('{"pass": true, "reasons": []}').verdict === "approved", "pass:true ⇒ approved");
    const bad = parseVerdict('{"pass": false, "reasons": []}');
    ok(bad.verdict === "rejected" && bad.reasons.length === 1, "pass:false 且无理由 ⇒ rejected 且补一条兜底理由");
    const fenced = "```json\n" + JSON.stringify({ pass: false, reasons: ["第2条没做"] }) + "\n```";
    ok(parseVerdict(fenced).reasons[0] === "第2条没做", "包在代码块里的 JSON 也能解析");
  }
}

/* ── 10. 结构面：域注册三件套齐全（漏一处 = 通道静默全废） ── */
{
  const manifest = JSON.parse(read("electron/ipc-channels.manifest.json"));
  const channels = (manifest.channels ?? []).filter((c) => String(c.channel).startsWith("boss-groups:"));
  ok(channels.length === 12, `manifest 有 12 个 boss-groups 通道（实测 ${channels.length}）`);
  ok(manifest.count === manifest.channels.length, `manifest.count 与通道数一致（${manifest.count} / ${manifest.channels.length}）`);
  ok(channels.every((c) => typeof c.invokeArgs === "string" && Boolean(c.returns)
    && (!String(c.paramsImpl ?? "").trim() || String(c.invokeArgs ?? "").trim())),
  "每个通道都有 returns，且带参通道的 invokeArgs 不为空（漏 invokeArgs = preload 静默丢参）");

  const composition = JSON.parse(read("electron/composition.json"));
  const row = (composition.domains ?? []).find((d) => d.id === "boss-groups");
  ok(Boolean(row?.enabled) && row?.file === "features/boss-groups-ipc.ts" && row?.export === "bossGroupsFeature",
    "composition.json 已启用该域且 file/export 对得上");
  ok(read("electron/composition.gen.ts").includes("boss-groups-ipc"), "composition.gen.ts 已重生成（跑过 npm run gen:domains）");

  const registry = read("electron/ipc-registry.ts");
  ok(/\{ prefix: "boss-groups", count: 12, status: "in-features", file: "features\/boss-groups-ipc\.ts"/.test(registry),
    "ipc-registry.ts 账本已登记（count=12）");

  const preload = read("electron/preload.ts");
  for (const method of ["listBossGroups", "bossGroupStatus", "createBossGroup", "assignBossTask", "reviewBossTask", "escalateBossTask", "bossBrowserStatus", "recheckBossTask", "bossGroupMember", "bossGroupPin", "bossGroupSay", "bossGroupPool"]) {
    ok(preload.includes(method), `preload 已生成 ${method}`);
  }

  /* ── 11. 异步派活的结构证据：不许 await 等回合（否则 boss 串行卡死） ── */
  const runner = read("electron/boss-groups/runner.ts");
  ok(/void waitForTurnCompletion\(threadId, turnId\)\.then/.test(runner), "派活是 fire-and-forget（`void waitForTurnCompletion(...).then`）");
  ok(/thread\/queue\/add/.test(runner) && /thread\/queue\/start/.test(runner), "群事件用 queue/add + queue/start 回投（不打断 boss 在跑的回合）");
  ok(/codex-/.test(runner) && /ego-browser/.test(runner), "成员提示词写明浏览器走 ego-browser 且每会话独立 TaskSpace");
  ok(/TURN_WAIT_TIMEOUT_CODE/.test(runner) && /不判失败|转后台/.test(runner), "等待到点按「转后台」处理，不误判失败");

  /* ── 12. BOSS 会话 = **普通会话**（10-25 用户令，推翻此前的群聊覆盖层）──
     用户原话：「一个正常对话框不会做嘛，新建一个会话，常驻成 BOSS 会话，不就好了嘛」。
     ⛔ 四条负向契约，任何一条被"顺手加回来"都会退回覆盖层形态：
       ① 不许再有 BossGroupStage 组件/文件
       ② 主舞台不许再对 .workspace 做 visibility 隐藏（父级 hidden 会被子元素继承 ⇒ 全白）
       ③ store 不许再有 stage 布尔（它和真实会话状态对不上：切走了按钮还亮）
       ④ CSS 不许再有 .boss-stage 根规则 */
  ok(!existsSync(join(ROOT, "src/features/boss-group-view/BossGroupStage.tsx")),
    "BOSS 群聊覆盖层组件已删除（BOSS 会话走普通对话框）");
  const mainStage = read("src/features/app-view/AppView/02-main-stage.tsx");
  ok(!/BossGroupStage|bossStage|visibility:\s*"hidden"/.test(mainStage),
    "主舞台不再渲染覆盖层、不再隐藏 .workspace");
  const panelStore = read("src/features/boss-group-view/panel-store.mjs");
  ok(!/stage:/.test(panelStore) && !/openBossStage|closeBossStage/.test(panelStore),
    "panel-store 不再有 stage 布尔与开合动作（只留群选择 + 面板开关）");
  ok(!/^\.boss-stage[\s-]/m.test(read("src/styles/47-boss-group-view.css")),
    "47-boss-group-view.css 不再有 .boss-stage* 规则");

  /* ── 13. 侧栏入口：点它 = 打开 boss 会话线程，选中态是**派生量** ──
     ⛔ 选中态必须由「当前会话 id 命中某群 bossThreadId」算出来，不许再用一个独立布尔
        （上一版就是布尔与真实会话脱钩：切到别的会话后按钮还亮着）。
     ⛔ 还没建群时要有 home 锚点（localStorage），否则每点一次就多一个「未命名任务」。 */
  const sidebar = read("src/features/app-view/AppView/01-sidebar-shell.tsx");
  ok(/bossThreads\.bossIds\.includes\(currentThreadId\)/.test(sidebar),
    "侧栏选中态派生自「当前会话 = 某群 boss 线程」");
  ok(/app\.openThread\(groupBoss\)/.test(sidebar) && /app\.openThread\(home\)/.test(sidebar) && /startNewThread\(\)/.test(sidebar),
    "点 BOSS 会话 = 打开群 boss 线程 / home 锚点；两者都没有才新建会话");
  const bossStore = read("src/features/boss-group-view/boss-threads-store.mjs");
  ok(/boss-home-thread/.test(bossStore) && /setBossHomeThreadId/.test(bossStore),
    "没群时的 BOSS 会话有固定锚点（localStorage boss-home-thread）");
  ok(/memberThreadIds/.test(bossStore),
    "共享 store 汇总群成员会话 id（侧栏据此打「BOSS 调度」标签）");
  ok(/boss-workspace/.test(sidebar) && /chooseDirectory/.test(sidebar) && /workspaceRef\.current = dir/.test(sidebar),
    "BOSS 会话有独立项目目录：首次进入要选、选过记住、并同步 workspaceRef（否则首条消息用旧目录）");
  ok(/isBossThread \? null : \(/.test(read("src/features/app-state/parts/part09/02-seg.tsx")),
    "BOSS 会话隐藏顶栏「允许本会话调度」开关（群编排自带独立调度）");
  const timeline = read("src/features/app-view/AppView/02-main-stage/01-timeline.tsx");
  ok(/BossThreadIntro/.test(timeline) && /isEmpty && !isBossEmpty/.test(timeline),
    "BOSS 会话空态走自己的组件（BossThreadIntro），普通欢迎页只给非 BOSS 会话");
  ok(!/boss-welcome/.test(read("src/styles/47-boss-group-view.css")) && /boss-intro-card/.test(read("src/styles/47-boss-group-view.css")),
    "BOSS 空态样式是独立的卡片（⛔ 不复用 .welcome-state 那套）");
  /* ⛔⛔ 10-25 实测：用 isEmpty 判 BOSS 空态会漏 —— 它要求 thread 为 null，而「会话已建出来但
     一条消息都没有」时 thread 存在 ⇒ isEmpty 恒 false ⇒ 卡片不渲染 ⇒ 整片空白（用户截图）。 */
  ok(/const noTurns = \(thread\?\.turns \?\? \[\]\)\.length === 0/.test(timeline)
    && /isBossHome = Boolean\(thread\?\.id\)/.test(timeline)
    && /isBossEmpty = \(bossThreads\.pending \|\| isBossThreadNow \|\| isBossHome\) && noTurns/.test(timeline),
    "BOSS 空态按「0 回合」判定，且三种入口都算（pending / 群 boss 线程 / home 锚点会话）");
  ok(/\{isBossEmpty \? <BossThreadIntro/.test(timeline),
    "BOSS 引导卡只在 isBossEmpty 时挂载（普通欢迎页条件保持 isEmpty && !isBossEmpty）");
  ok(/isEmpty && !\(bossThreads\.pending/.test(read("src/features/app-view/AppView/02-main-stage/03-composer.tsx")),
    "BOSS 会话不渲染「周报总结」那排新会话快捷任务");
  ok(/!isEmpty && \(historyPlan\.hiddenCount/.test(read("src/features/app-view/AppView/02-main-stage/01-timeline.tsx")),
    "空会话不显示「加载更早的消息」");
  ok(existsSync(join(ROOT, "src/features/boss-group-view/BossGroupHelpButton.tsx")),
    "BOSS 会话独有的「?」说明组件在位");
  ok(/isBossMemberThread[\s\S]{0,260}?"BOSS 调度"/.test(read("src/features/app-state/parts/part02/02-goal-browser-notice/01-goal-review-file-browser/02-thread-attention-rows.tsx")),
    "侧栏给群成员会话打「BOSS 调度」标签（与普通「调度」区分）");
  /* ── 14. rollout 丢失的会话要能自愈（10-25 用户实测：红条 + 消息发不出去 + 输入框被塞记忆）── */
  const sendFile = read("src/features/app-state/parts/part08/02-seg/send.tsx");
  ok(/unavailable = \/not found\|no such thread\|unloaded\|no rollout found\//.test(sendFile),
    "turn/start 的「会话不可用」判定包含 no rollout found（否则直接 throw ⇒ 红条 + 发不出去）");
  ok(/const failedText = userDisplayText\(/.test(sendFile),
    "发送失败回填只还用户原文（⛔ 不能把记忆段 / SYSTEM TASK 塞回输入框）");
}

console.log(`\n【boss-groups】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
