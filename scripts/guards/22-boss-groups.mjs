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
  ok(channels.length === 14, `manifest 有 14 个 boss-groups 通道（实测 ${channels.length}）`);
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
  ok(/\{ prefix: "boss-groups", count: 14, status: "in-features", file: "features\/boss-groups-ipc\.ts"/.test(registry),
    "ipc-registry.ts 账本已登记（count=12）");

  const preload = read("electron/preload.ts");
  for (const method of ["listBossGroups", "bossGroupStatus", "createBossGroup", "assignBossTask", "reviewBossTask", "escalateBossTask", "bossBrowserStatus", "bossGroupMember", "bossGroupPin", "bossGroupSay", "bossGroupPool"]) {
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
  ok(/setBossDirDialog\(true\)/.test(sidebar) && /startNewThread\(\)/.test(sidebar) && !/app\.openThread\(home\)/.test(sidebar),
    "点 BOSS 会话 = 弹项目地址对话框 + **新建一个全新会话**（⛔ 不复用上一次的；⛔ 也不再「有群就跳旧群」）");
  const bossStore = read("src/features/boss-group-view/boss-threads-store.mjs");
  ok(/boss-home-thread/.test(bossStore) && /setBossHomeThreadId/.test(bossStore),
    "没群时的 BOSS 会话有固定锚点（localStorage boss-home-thread）");
  /* ⛔⛔ 10-25 用户令（三条，截图实证）：
     ① 「这个子成员都触发一次评审？评审机制有问题…评审上下文子智能体不要默认，删了，让 codex 自己创建」
     ② 「记忆蒸馏器又是什么玩意…删了，让 codex 自己蒸馏记忆」+「到阈值了，会话自己蒸馏就行了」
     ③ 「这个重试又是什么东西…重试删掉」 */
  const runnerSrc = read("electron/boss-groups/runner.ts");
  /* ⛔⛔ 10-25 用户实测：「成员会话的汇总消息没有发送到主对话…这叫什么群聊」「右侧群成员头像也没有」
     「成员也没有更新，完全看不懂」（同一 BOSS 会话建过两个群，弹窗停在旧的） */
  ok(/交活：「\$\{task\.title\}」/.test(runnerSrc) && /postToBoss\(group, `\[群事件\] \$\{deliverer\.name\} 交活/.test(runnerSrc),
    "成员交活的成品要**汇总到主对话**（否则就是各说各话，不是群聊）");
  ok(/boss-avatar/.test(read("src/features/boss-group-view/BossGroupPanel.tsx")) && /boss-member-strip/.test(read("src/features/boss-group-view/BossGroupPanel.tsx")),
    "群面板要有成员头像（顶栏头像条 + 成员气泡头像）");
  /* ⛔ 10-25 用户令：「我每次新建，就是全新的，跟旧的不要有任何关系」「BOSS 会话不要归档功能，
     有删除会话功能就行了」 */
  /* ⛔⛔ 10-25 用户实测三处：
     ① 「BOSS 他根本不知道他这个会话是干嘛的」—— 之前靠 boss-home/AGENTS.md 注入，
        cwd 改成用户项目后引擎读不到 ⇒ 改成**会话级注入**（每轮正文前挂一段，显示层剥掉）。
     ② 「BOSS 会话跟普通会话串了」—— 自愈重建时无条件登记身份 ⇒ 普通会话被当成 BOSS。
     ③ 「我要经常删了BOSS会话，重新建」—— 删了要从身份登记里摘掉，重建要搬迁而不是叠加。 */
  const sendSrc = read("src/features/app-state/parts/part08/02-seg/send.tsx");
  ok(/BOSS_ROLE_PROMPT/.test(sendSrc) && /bossRolePrefix/.test(sendSrc),
    "BOSS 会话每轮都注入角色说明（⛔ 不再依赖 cwd 的 AGENTS.md）");
  ok(/<!--boss-role-->/.test(read("src/lib/user-refs.ts")),
    "角色说明在气泡里**不可见**（userDisplayText 剥掉带标记的段）");
  ok(/wasBoss/.test(sendSrc) && /if \(wasBoss\) renameBossSessionId/.test(sendSrc),
    "⛔ 身份搬迁只对**本来就是 BOSS 会话**的会话做（否则普通会话被串成 BOSS）");
  ok(/removeBossSessionId\(id\)/.test(read("src/features/app-state/parts/part08/01-seg.tsx")),
    "删除 BOSS 会话 ⇒ 从身份登记摘掉（删了重建不会被当成旧的）");
  ok(/BossProjectDirDialog/.test(read("src/features/app-view/AppView/01-sidebar-shell.tsx"))
    && /createBossProjectDir/.test(read("src/features/app-view/AppView/01-sidebar-shell.tsx")),
    "新建 BOSS 会话走**应用内对话框**（选目录 / 在软件所在盘自动新建），⛔ 不用系统弹窗或内联 toast");
  /* ⛔⛔ 10-25 用户令：「记忆板块里面加一个BOSS会话记忆板块，跟普通会话完全拆开」
     +「删除了BOSS会话，这里就同步更新，新建了就是新的」。

     ① **名单必须在主进程**：记忆层的捕获写入（boot.ts 的 captureTurn）在主进程跑，
        它得知道这个 thread 是 BOSS 会话才能把记忆写进它自己的目录 ⇒ 渲染层
        localStorage 那份不够用（主进程读不到）⇒ 登记表落 <userData>/boss-sessions.json。
     ② **读写都要路由**：捕获写入（boot.ts）与渲染层注入（send.tsx）都用专属目录；
        只改一边会出现「写进项目、读自己」或反之。
     ③ **删除同步**：删 BOSS 会话 ⇒ 名单摘掉 + 记忆目录清掉；新建 ⇒ 全新目录、空记忆。
     ④ **删除类操作要有路径安全闸**（只许删 boss-home/memories 下的目录）。 */
  const bossRegistry = read("electron/boss-groups/session-registry.ts");
  ok(/boss-sessions\.json/.test(bossRegistry) && /export function bossMemoryWorkspace/.test(bossRegistry),
    "BOSS 会话身份登记表落主进程（<userData>/boss-sessions.json）+ 专属记忆目录");
  ok(/isBossSession/.test(read("electron/features/boot.ts")) && /bossMemoryWorkspace/.test(read("electron/features/boot.ts")),
    "⛔ 捕获写入按名单路由到 BOSS 专属目录（不写进用户选的项目）");
  const sendMem = read("src/features/app-state/parts/part08/02-seg/send.tsx");
  ok(/ensureBossMemoryWorkspace/.test(sendMem) && /memWorkspace/.test(sendMem),
    "⛔ 渲染层注入的常驻记忆/召回按 BOSS 专属目录取（与项目记忆分开）");
  const reqMem = read("src/features/app-state/parts/part05/event-router/02-request.tsx");
  ok(/ensureBossMemoryWorkspace/.test(reqMem),
    "⛔ memory_write 写进 BOSS 专属目录（不污染项目记忆）");
  ok(/action: "remove"/.test(read("src/features/boss-group-view/boss-threads-store.mjs"))
    && /action: "rename"/.test(read("src/features/boss-group-view/boss-threads-store.mjs")),
    "删除/重建 BOSS 会话时同步主进程名单（⇒ 记忆目录跟着清掉/搬过去）");
  ok(/拒绝清理该路径/.test(bossRegistry) && /boss-home", "memories"/.test(bossRegistry),
    "⛔ 清空记忆有路径安全闸（只许删 BOSS 记忆目录内的路径）");
  /* ⛔⛔ 10-25 用户实测两处（截图实证）：
     ① 「旧的还是删不掉」—— 面板上「清空这份记忆」点了报「清空失败」。
        根因：UI 调的方法名与 preload 不一致（写成 deleteBossMemory，preload 里是
        clearBossMemory）⇒ optional call 静默返回 undefined ⇒ 必然失败。
        ⇒ 断言 UI 里调的方法名**必须出现在 preload 里**（这类"名字对不上"编译器查不出）。
     ② 列表里出现**两个同名**「BOSS 会话 01a171d5」——
        真因：codex thread id 是 **uuid v7**，前 8 位是时间戳 ⇒ 同一分钟建的会话前缀一样；
        而且同一个 bossThreadId 出现在**两个群里**时，补登会把它加两次 ⇒ 名单重复。
        ⇒ 断言：registry 读/写/补登三处都去重；显示名不能只取 id 前 8 位。 */
  const bossMemPanel = read("src/features/settings-memory/BossMemoryPanel.tsx");
  const clearCall = /codex\?\.(\w+)\?\.\(\{ memoryDir/.exec(bossMemPanel);
  ok(Boolean(clearCall) && read("electron/preload.ts").includes(clearCall[1] + ":"),
    `面板调的记忆清理方法名必须在 preload 里存在（实测 ${clearCall ? clearCall[1] : "没匹配到"}）`);
  ok(/seen\.has\(s\.id\)/.test(bossRegistry) && /new Set\(bossThreadIds/.test(bossRegistry),
    "BOSS 会话名单**读/补登**都去重（同一个 bossThreadId 出现在两个群里也不会登记两次）");
  ok(/merged\.set\(s\.id, s\)/.test(bossRegistry) && /merged\.set\(entry\.id, entry\)/.test(bossRegistry),
    "BOSS 会话名单**写入**去重（并发 add 不会写两条）");
  ok(!/slice\(0, 8\)/.test(bossMemPanel),
    "⛔ 显示名不能只取 id 前 8 位（uuid v7 的时间戳前缀会撞）");
  /* ⛔⛔ 10-25 用户实测三处（截图实证）：
     ① 「这个弹窗真小气，而且…那个按键真丑」—— 之前复用了 `.close-confirm-*`
        （那是给「确认/取消」两按钮设计的紧凑卡片）⇒ 卡片挤、两个选项被压成两行字、按钮换行。
        ⇒ 现在用**自己的宽体样式** `.boss-dir-*`（≥480px 宽 + 两个大选项卡）。
        ⛔ 断言不复用 close-confirm 样式（这类"视觉退化"编译器查不出，只能钉死）。
     ② 「注释太业余」—— 侧栏那段注释被两处改写**嵌套**了 ⇒ 注释没闭合。
        ⇒ 断言那段没有嵌套块注释。
     ③ 「为啥我进主仓没这个弹窗，PPCODE弹了」—— 原来「有群 ⇒ 直接跳旧群的 boss 线程」
        ⇒ **行为随有没有群而变**（新装用户看得到弹窗、老用户被跳走）。
        ⇒ 断言：不再有「有群就跳走」那条分支；点按钮只弹对话框、不新建会话
        （原来建一次、选完地址又建一次 ⇒ 两个空会话，点「取消」也留一个未命名任务）。 */
  const bossDirDlg = read("src/features/boss-group-view/BossProjectDirDialog.tsx");
  ok(!/close-confirm-card/.test(bossDirDlg) && /boss-dir-card/.test(bossDirDlg),
    "⛔ 项目地址对话框用**自己的宽体样式**（不复用 close-confirm 的紧凑卡片）");
  const bossDirCss = read("src/styles/47-boss-group-view.css");
  ok(/\.boss-dir-card\s*\{[^}]*width:\s*min\(5\d\dpx/.test(bossDirCss),
    "对话框卡片宽度 ≥500px（⛔ 旧版约 400 ⇒ 用户骂「真小气」）");
  ok(/\.boss-dir-option\s*\{/.test(bossDirCss) && /\.boss-dir-option-body/.test(bossDirCss),
    "两个选项是**大选项卡**（图标 + 标题 + 说明），不是并排小按钮");
  const bossSideSrc = read("src/features/app-view/AppView/01-sidebar-shell.tsx");
  const bossBlock = bossSideSrc.slice(Math.max(0, bossSideSrc.indexOf("sidebar-quick-boss") - 2600), bossSideSrc.indexOf("sidebar-quick-boss") + 400);
  /* ⛔ 注释嵌套检测：**正则里不能出现块注释起始符**（那会把本守卫自己的注释提前闭合，
     表现为 SyntaxError: Unexpected identifier）⇒ 用字符类拼出来。 */
  const blockStart = new RegExp("\\/" + "\\*", "g");
  const nestedComment = new RegExp("\\/" + "\\*[^\\n]*\\/" + "\\*[^\\n]*\\*" + "\\/", "g");
  ok(!(blockStart.test(bossBlock) && nestedComment.test(bossBlock)),
    "⛔ 侧栏 BOSS 那段注释没有嵌套坏掉（之前两段块注释套在一起）");
  ok(!/openThread\(groupBoss\)/.test(bossSideSrc),
    "⛔ 点「BOSS 会话」不再「有群就跳旧群」⇒ 行为不随有没有群而变（用户实测：主仓不弹、PPcode 弹）");
  ok(!/setBossDirDialog\(true\);\s*startNewThread\(\)/.test(bossSideSrc),
    "⛔ 点按钮只弹对话框、**不新建会话**（原来建两次 ⇒ 两个空会话，点取消也留一个）");
  ok(/BossMemoryPanel/.test(read("src/features/settings-memory/MemoryCenterSection.tsx"))
    && existsSync(join(ROOT, "src/features/settings-memory/BossMemoryPanel.tsx")),
    "记忆设置页有独立的「BOSS 会话记忆」板块（与项目共享记忆库分开）");
  ok(/sessionIds/.test(read("src/features/boss-group-view/boss-threads-store.d.mts")),
    "BOSS 会话有独立身份标记 sessionIds（⛔ homeId 不再用于复用会话）");
  const sideSrc = read("src/features/app-view/AppView/01-sidebar-shell.tsx");
  ok(!/app\.openThread\(home\)/.test(sideSrc),
    "⛔ 点「BOSS 会话」不再回到上一次的会话（每次都是全新会话）");
  ok(/isBossOwnThread \? null : \([\s\S]{0,120}thread-archive-button/.test(read("src/features/app-state/parts/part02/02-goal-browser-notice/01-goal-review-file-browser/02-thread-attention-rows.tsx")),
    "BOSS 会话不挂归档按钮（只保留删除）");
  ok(/lastActivityAt/.test(read("electron/features/boss-groups-ipc.ts")),
    "群列表按最近活动排序（同一会话建过多个群时，弹窗要落在**现在这个**群上）");
  ok(!/REVIEW_PROMPT/.test(runnerSrc) && !/SYSTEM TASK · 独立评审/.test(runnerSrc),
    "⛔ 不再有「独立评审」提示词/会话（评审由会话自己用技能做）");
  ok(/已交活，请\*\*用你自己的评审技能\*\*判一下/.test(runnerSrc),
    "⛔ 交活后回投给 BOSS（成品 + 验收标准），由它自己用技能判，不再另开评审会话");
  ok(!/memoryLayers\.autoDistill/.test(read("electron/features/boot.ts")),
    "⛔ 应用不再自动蒸馏记忆（不派内部会话；到 90% 蒸馏线由会话自己按技能蒸）");
  ok(!/boss-groups:recheck/.test(read("electron/features/boss-groups-ipc.ts")) && !/recheckBossTask/.test(read("src/features/settings-boss-groups/BossGroupsSection.tsx")),
    "⛔ 评审的「重跑/retry」通道与按钮已删");
  ok(/memberThreadIds/.test(bossStore),
    "共享 store 汇总群成员会话 id（侧栏据此打「BOSS 调度」标签）");
  ok(/chooseDirectory/.test(sidebar),
    "新建 BOSS 会话要**重新选**项目地址（⛔ 不沿用上一次的，也不跟其他会话同步）");
  ok(/workspaceRef\.current = dir/.test(sidebar) && /createBossProjectDir/.test(sidebar),
    "BOSS 会话跑在**自己选的项目目录**（同步 workspaceRef；不写全局 workspace ⇒ 别的会话不受影响）");
  ok(/isBossThread \? null : \(/.test(read("src/features/app-state/parts/part09/02-seg.tsx")),
    "BOSS 会话隐藏顶栏「允许本会话调度」开关（群编排自带独立调度）");
  const timeline = read("src/features/app-view/AppView/02-main-stage/01-timeline.tsx");
  /* ⛔⛔ 10-25 用户实测两处：
     ① 「移除的群成员没有真实生效，Codex 不知道我移除了」—— group_status 原来把整份 snapshot
        的 JSON 直接丢给模型，members 里带 status=removed 的那位，模型就照着数成"3 位成员"。
     ② 「拉了群里，弹窗没有实时更新」—— 弹窗按 threadId 选群，看不到别的群的人数。 */
  const requestFile = read("src/features/app-state/parts/part05/event-router/02-request.tsx");
  ok(/activeMembers/.test(requestFile) && /removedMembers/.test(requestFile)
    && /当前成员 \$\{activeMembers\.length\} 位/.test(requestFile),
    "group_status 给模型明确口径：当前成员 N 位 + 已移出名单（⛔ 不能把 removed 也算进成员数）");
  const runnerFile = read("electron/boss-groups/runner.ts");
  ok(/成员已被用户移出群/.test(runnerFile) && /新成员进群/.test(runnerFile),
    "成员增删都回投给 BOSS 会话（模型要实时知道，不该只能靠它自己查）");
  ok(/memberCount: group\.members\.filter\(\(m: any\) => String\(m\?\.status \?\? ""\) !== "removed"\)\.length/.test(read("electron/features/boss-groups-ipc.ts")),
    "群列表的成员数不含被移出的（弹窗下拉按群显示人数）");
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
  ok(/thread && historyPlan\.hiddenCount > 0/.test(read("src/features/app-view/AppView/02-main-stage/01-timeline.tsx")),
    "空会话不显示「加载更早的消息」（空会话 hiddenCount=0）");
  ok(existsSync(join(ROOT, "src/features/boss-group-view/BossGroupHelpButton.tsx")),
    "BOSS 会话独有的「?」说明组件在位");
  /* ⛔ 10-25 实测：只认 bossIds 会让「还没建群时的 home 会话」顶栏缺成员图标与「?」——
     主窗口与独立弹窗用的是同一个 topbarActionsNode，所以两处一起缺。 */
  ok(/bossThreads\.bossIds\.includes\(String\(bag\.thread\?\.id\)\) \|\| \(bossThreads\.sessionIds \?\? \[\]\)\.includes\(String\(bag\.thread\?\.id\)\)/.test(read("src/features/app-state/parts/part09/02-seg.tsx")),
    "顶栏成员图标 /「?」都渲染（群 boss 线程 + 已登记的 BOSS 会话）");
  /* ⛔⛔ 10-25 实测「独立弹窗没有成员图标和问号」：DOM 在、断言全绿，但 CSS 媒体查询把
     `display` 设成了 none（当时断点是 1180，而默认窗口 1080 就命中）。
     ⇒ 隐藏断点必须 ≤640，且断言只认 DOM 存在的写法不可再用于这两个图标。
     ⛔ 上一行那条正则的**末尾是右括号紧跟斜杠** ⇒ 会被解析成注释闭合符、提前闭合本注释 ⇒ 整文件 SyntaxError。
     ⇒ 结尾补一个空格再接斜杠。 */
  const bossViewCss = read("src/styles/47-boss-group-view.css");
  /* 只允许 ≤640 的断点隐藏这两个图标：出现更大的断点（如 1180）就是回归。 */
  const hideRules = bossViewCss.split("\n").filter((line) => /@media/.test(line) && /boss-(members-wrap|help-btn)/.test(line));
  ok(hideRules.every((line) => {
    const m = line.match(/max-width:\s*(\d+)px/);
    return !m || Number(m[1]) <= 640;
  }), `成员/「?」图标的隐藏断点必须 ≤640（实测过 1180 在默认 1080 窗口里命中 ⇒ 图标不显示）：${JSON.stringify(hideRules)}`);
  const bossIpc = read("electron/features/boss-groups-ipc.ts");
  ok(/BOSS_HOME_AGENTS_VERSION/.test(bossIpc) && /不亲自执行任何任务/.test(bossIpc),
    "BOSS 角色提示词写明「不亲自执行」且版本化（内容升级会覆盖旧文件）");
  const bossTools = read("src/features/app-view/constants/05-boss-group-tools.tsx");
  ok(/from=\\"expert/.test(bossTools) && /from=\\"cli/.test(bossTools) && /cliName/.test(bossTools) && /cliCommand/.test(bossTools),
    "拉人来源覆盖专家/专家团 + 本机 CLI（group_add_member 的 from 两个分支）");
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
