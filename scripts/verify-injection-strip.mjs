/**
 * 注入段剥离回归（10-26 全量审查）。
 *
 * 背景：中枢角色说明曾被当**用户消息**显示在气泡里（用户截图）。根因是"注入段只剥了一部分"。
 * 同类风险还有一堆：团队/成员/群成员/调度会话的 SYSTEM TASK 壳、壳前的团队系统提示词、
 * 记忆块、时间块、技能/上下文/附件段、导入记录、boss-role 老壳…
 *
 * ⛔ 为什么必须真跑：这些都是**字符串正则**契约，靠读代码判断"应该剥了"正是上次翻车的原因
 *    （userDisplayText 剥了、气泡正文走的是 cleanText，等于没剥）。这里把真实编译出来的
 *    parseUserRefs 跑一遍全部真实格式，任何一条漏剥直接退出码 1。
 *
 * 用法（守卫 22 会调用它；也可单独跑）：
 *   node scripts/verify-injection-strip.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const TMP = join(ROOT, ".workbuddy", "tmp", "injection-strip");
const require = createRequire(import.meta.url);

function bundleUserRefs() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  const entry = join(TMP, "entry.ts");
  writeFileSync(entry, 'export { parseUserRefs, userDisplayText } from "../../../src/lib/user-refs";\n', "utf8");
  const cli = join(ROOT, "node_modules", "rolldown", "bin", "cli.mjs");
  if (!existsSync(cli)) throw new Error(`找不到打包器 ${cli}`);
  execFileSync(process.execPath, [cli, entry, "--format", "cjs", "--platform", "node", "-d", TMP], { cwd: ROOT, stdio: "pipe" });
  const out = join(TMP, "entry.js");
  if (!existsSync(out)) throw new Error("打包产物缺失（entry.js）");
  return require(out);
}

const NOW = "\n\n[当前时间]\n2026-10-26 00:40（周一）\n（涉及\"现在/今天/昨天/最近\"的判断以这里为准，不要凭训练数据猜日期）\n[时间结束]\n";
const MEMORY = "\n\n[Harness 常驻记忆 · 项目 / 团内 / 私有]\n## 踩坑与纪律\n- 2026-10-25 坑：xxx\n[常驻记忆结束]\n";
const TEAM_PROMPT = "【专家团「落地页小组」系统提示】你是主理人，负责编排团队、按阶段推进、最后汇总。\n\n";

const CASES = [
  {
    name: "普通消息（不能误伤）",
    text: "帮我做个落地页",
    expect: "帮我做个落地页",
    forbid: ["[SYSTEM TASK", "=== END ===", "boss-role"],
  },
  {
    name: "时间块",
    text: `帮我做个落地页${NOW}`,
    expect: "帮我做个落地页",
    forbid: ["[当前时间]", "[时间结束]"],
  },
  {
    name: "常驻记忆块",
    text: `帮我做个落地页${MEMORY}`,
    expect: "帮我做个落地页",
    forbid: ["[Harness 常驻记忆", "[常驻记忆结束]", "踩坑与纪律"],
  },
  {
    name: "上下文段",
    text: "接着上面那个改\n\n[用户指定的对话上下文]\n(1) 用户：之前说过要蓝色\n[上下文结束]\n",
    expect: "接着上面那个改",
    forbid: ["[用户指定的对话上下文]", "[上下文结束]", "之前说过要蓝色"],
  },
  {
    name: "技能段",
    text: "按技能来一遍\n\n[本轮已引用技能]\n- 评审：逐条对照验收标准\n[请按上述技能工作流执行]\n",
    expect: "按技能来一遍",
    forbid: ["[本轮已引用技能]", "逐条对照验收标准"],
  },
  {
    name: "附件段",
    text: "看这张图\n\n[附件文件]\n- D:\\测试\\a.png\n[附件结束]\n",
    expect: "看这张图",
    forbid: ["[附件文件]", "a.png"],
  },
  {
    name: "团队会话（壳**前**还有系统提示词）",
    text: `${TEAM_PROMPT}[SYSTEM TASK · 团队会话]\n=== 用户需求 ===\n做个落地页，要设计+前端+测试\n=== END ===\n\n请按 SOP 编排团队完成任务，过程中用 team_member_invoke 调度成员。`,
    expect: "做个落地页，要设计+前端+测试",
    forbid: ["[SYSTEM TASK", "系统提示词", "编排团队", "team_member_invoke", "=== END ==="],
  },
  {
    name: "成员会话（壳后有角色提示与记忆）",
    text: `[SYSTEM TASK · 成员会话]\n=== 用户需求 ===\n主理人分配的子任务：写首页\n=== END ===\n\n[专家团「落地页小组」成员 前端小张（前端）]\n你是资深前端，注重可访问性。${MEMORY}`,
    expect: "写首页",
    forbid: ["[SYSTEM TASK", "资深前端", "[专家团「", "主理人分配的子任务", "可访问性"],
  },
  {
    name: "群成员会话（本次任务格式）",
    text: "[SYSTEM TASK · 群成员会话]\n你是「落地页」群里的 **前端小张**（前端）。\n擅长 React。\n=== 本次任务（第 2 次尝试）===\n标题：首页\n说明：做首屏\n验收标准：移动端不塌\n=== END ===\n\n请**直接交成品**（产物或结论 + 依据），不要复述流程。",
    expect: "验收标准：移动端不塌",
    forbid: ["[SYSTEM TASK", "前端小张", "擅长 React", "直接交成品", "=== END ===", "标题："],
  },
  {
    name: "调度会话（壳后带 [角色：…] 段）",
    text: "[SYSTEM TASK · 调度会话]\n=== 用户需求 ===\n发起方交给你的任务：审一下这个方案\n=== END ===\n\n[角色：子智能体 评审]\n你是独立评审员，只判交给你的材料。\n\n直接执行上面的任务并给出最终产出。",
    expect: "审一下这个方案",
    forbid: ["[SYSTEM TASK", "[角色：", "独立评审员", "发起方交给你的任务", "最终产出"],
  },
  {
    name: "导入的会话记录",
    text: "[导入的会话记录]\n来源：ChatGPT 导出\n=== 记录内容 ===\n很久以前的对话全文\n=== 记录结束 ===\n\n接着聊",
    expect: "接着聊",
    forbid: ["[导入的会话记录]", "很久以前的对话全文"],
  },
  {
    name: "引用的会话记录",
    text: "[引用的会话记录]\n会话 ID：abc-123\n别的会话\n=== 记录内容 ===\n那边的正文\n=== 记录结束 ===\n\n对比一下",
    expect: "对比一下",
    forbid: ["[引用的会话记录]", "那边的正文"],
  },
  {
    name: "boss-role 老壳（历史消息）",
    text: "<!--boss-role-->\n【指挥中枢 · 角色说明（自动注入）】\n你现在是 **中枢（主控）**…\n<!--/boss-role-->\n\n哈喽",
    expect: "哈喽",
    forbid: ["boss-role", "指挥中枢", "主控"],
  },
  {
    name: "旧格式（无壳）专家团成员首条",
    text: "[专家团「落地页小组」成员 前端小张（前端）]\n你是资深前端。\n\n主理人分配的子任务：\n写首页",
    expect: "写首页",
    forbid: ["[专家团「", "资深前端"],
  },
  {
    name: "会话告知块（调度已开启 · 随下一条消息注入）",
    text: "\n\n<!--harness-notice-->\n【调度已开启】本会话已启用「调度」能力。开启的对象类别：【专家】【专家团】\n<!--/harness-notice-->\n\n把首页派给前端小张",
    expect: "把首页派给前端小张",
    forbid: ["harness-notice", "【调度已开启】", "对象类别"],
  },
  {
    name: "旧中枢会话补种（角色说明挂在下一条消息前）",
    text: "<!--boss-role-->\n【指挥中枢 · 角色说明（自动注入）】\n你现在是中枢（主控）…你是谁、要干什么…\n<!--/boss-role-->\n\n把首页派给前端小张",
    expect: "把首页派给前端小张",
    forbid: ["boss-role", "指挥中枢", "主控"],
  },
  {
    name: "旧团队会话补种（团队纪律补充 · 告知块包裹）",
    text: "\n<!--harness-notice-->\n【团队工作纪律 · 补发】\n0. ⛔ 你不亲自干活：只做拆解、派活、验收、汇总。\n1. ⛔ 先派活，再说话。\n<!--/harness-notice-->\n\n继续上一版，把测试补上",
    expect: "继续上一版，把测试补上",
    forbid: ["harness-notice", "团队工作纪律", "补发"],
  },
  {
    name: "最坏组合（壳 + 记忆 + 时间 + 附件）",
    text: `${TEAM_PROMPT}[SYSTEM TASK · 团队会话]\n=== 用户需求 ===\n做个落地页\n=== END ===\n\nSOP 指令段。${MEMORY}${NOW}`,
    expect: "做个落地页",
    forbid: ["[SYSTEM TASK", "SOP 指令段", "[Harness", "[当前时间]", "编排团队"],
  },
];

/* ── 群广播（10-26「只广播」方案）──────────────────────────────────────────
   `[群事件]` 是宿主投进中枢会话的群消息。这里用**runner 里真实的四段文案**验证解析，
   一旦生产者改文案而解析没跟（或反之），这条回归立刻红 —— 否则界面又退回"一坨机器文本"。 */
const GROUP_CASES = [
  {
    name: "群广播 · 单人交活",
    text: "[群事件] 前端小张 交活：「首页」\n第一屏做完了，移动端断点已补。\n自查：无横向滚动条。",
    blocks: [{ type: "deliverable", who: "前端小张", title: "首页" }],
    plain: "第一屏做完了",
  },
  {
    name: "群广播 · 合并投递（2 条）",
    text: "[群事件] 本轮 2 条交活（成品全文在群内消息流里，需要细节用 group_status 读）：\n- 「首页」（前端小张）：首屏完成…\n- 「配色」（设计小李）：主色定 #2b6cb0…",
    blocks: [{ type: "batch", count: 2 }],
    plain: "「首页」（前端小张）",
  },
  {
    name: "群广播 · 单人待审请求（正文含验收标准与成品）",
    text: "[群事件] 任务「首页」已交活，请**用你自己的评审技能**判一下。\n\n=== 验收标准（criteria）===\n移动端不塌\n\n=== 成品 ===\n<交付正文 16000 字>",
    blocks: [{ type: "review", count: 1 }],
    plain: "「首页」待评审",
  },
  {
    name: "群广播 · 多条待审",
    text: "[群事件] 有 2 条任务已交活待你判：\n· taskId=t_1「首页」\n· taskId=t_2「配色」\n\n⛔ 用你自己的**评审技能**逐条对照各任务的验收标准判。",
    blocks: [{ type: "review", count: 2 }],
    plain: "「首页」待评审",
  },
  {
    name: "群广播 · 预算系统行",
    text: "[群事件] 群「落地页」预算已用 80%（40/50 分钟）。",
    blocks: [{ type: "notice" }],
    plain: "预算已用 80%",
  },
  {
    name: "群广播 · 交活 + 待审合并成一条",
    text: "[群事件] 前端小张 交活：「首页」\n做完了。\n\n[群事件] 任务「首页」已交活，请**用你自己的评审技能**判一下。\n\n=== 验收标准（criteria）===\nc\n\n=== 成品 ===\nbody",
    blocks: [{ type: "deliverable", who: "前端小张" }, { type: "review", count: 1 }],
    plain: "做完了",
  },
];

/** 生产者（runner.ts）里的文案锚点 —— 与上面的样本必须同时成立，防止单边漂移。 */
const PRODUCER_ANCHORS = [
  " 交活：「${",
  "本轮 ${deliverables.length} 条交活",
  "有 ${reviews.length} 条任务已交活待你判",
  "任务「${task.title}」已交活",
];

async function main() {
  const mod = bundleUserRefs();
  const { parseGroupEvents, groupEventPlainText } = await import(new URL("../src/lib/group-event-text.mjs", import.meta.url));
  const cases = [...CASES.map((c) => ({ ...c, kind: "refs" }))];
  let bad = 0;
  let total = 0;

  for (const item of cases) {
    total += 1;
    const res = mod.parseUserRefs(item.text);
    const shown = mod.userDisplayText(item.text);
    const missing = !res.cleanText.includes(item.expect) && !(res.teamTask?.requirement ?? "").includes(item.expect);
    const leaked = item.forbid.filter((token) => res.cleanText.includes(token) || (res.teamTask?.requirement ?? "").includes(token));
    const shownLeaked = item.forbid.filter((token) => shown.includes(token));
    if (missing || leaked.length || shownLeaked.length) {
      bad += 1;
      console.log(`✗ ${item.name}`);
      if (missing) console.log(`    期望正文缺失：「${item.expect}」 实际 cleanText=${JSON.stringify(res.cleanText.slice(0, 160))}`);
      if (leaked.length) console.log(`    注入段残留：${leaked.join(" / ")}`);
      if (shownLeaked.length) console.log(`    userDisplayText 残留：${shownLeaked.join(" / ")}`);
    } else {
      console.log(`✓ ${item.name}`);
    }
  }

  for (const item of GROUP_CASES) {
    total += 1;
    const blocks = parseGroupEvents(item.text) ?? [];
    const plain = groupEventPlainText(blocks);
    const wrong = item.blocks.filter((want, index) => {
      const got = blocks[index];
      if (!got) return true;
      return got.type !== want.type || (want.who != null && got.who !== want.who) || (want.title != null && got.title !== want.title) || (want.count != null && got.count !== want.count);
    });
    const okPlain = plain.includes(item.plain);
    const leftover = plain.includes("[群事件]");
    if (wrong.length || !okPlain || leftover) {
      bad += 1;
      console.log(`✗ ${item.name}`);
      if (wrong.length) console.log(`    分块不符：期望 ${JSON.stringify(item.blocks)} 实际 ${JSON.stringify(blocks.map((b) => ({ type: b.type, who: b.who, title: b.title, count: b.count })))}`);
      if (!okPlain) console.log(`    纯文本缺「${item.plain}」：${JSON.stringify(plain.slice(0, 160))}`);
      if (leftover) console.log("    纯文本里残留 [群事件] 标签");
    } else {
      console.log(`✓ ${item.name}`);
    }
    /* 同一段文本走 parseUserRefs 时也必须结构化（否则界面上仍是用户气泡） */
    total += 1;
    const refs = mod.parseUserRefs(item.text);
    if (refs.groupEvents?.length === blocks.length && !refs.cleanText.includes("[群事件]")) {
      console.log(`✓ ${item.name} · parseUserRefs 结构化`);
    } else {
      bad += 1;
      console.log(`✗ ${item.name} · parseUserRefs 没结构化（groupEvents=${refs.groupEvents?.length ?? 0}）`);
    }
  }

  /* ── 待注入告知队列（调度开关变化走它）────────────────────────────────── */
  {
    const store = await import(new URL("../src/lib/inline-notices.mjs", import.meta.url));
    store._resetInlineNotices();
    total += 3;
    store.queueInlineNotice("t1", "【调度已开启】A");
    store.queueInlineNotice("t1", "【调度范围已更新】B");
    store.queueInlineNotice("t2", "【调度已关闭】C");
    const t1 = store.takeInlineNotices("t1");
    const t2 = store.takeInlineNotices("t2");
    const again = store.takeInlineNotices("t1");
    if (t1.length === 2 && t2.length === 1 && t2[0].includes("已关闭")) console.log("✓ 告知队列按会话分桶（A 的两条不会串进 B）");
    else { bad += 1; console.log(`✗ 告知队列按会话分桶失败：t1=${JSON.stringify(t1)} t2=${JSON.stringify(t2)}`); }
    if (again.length === 0) console.log("✓ 告知取出即清空（同一段只喂模型一次，不重复烧上下文）");
    else { bad += 1; console.log("✗ 告知取走后仍在队列里（会每轮重复注入）"); }
    const block = store.formatInlineNotice("【调度已开启】X");
    if (block.includes(store.INLINE_NOTICE_MARK) && block.includes(store.INLINE_NOTICE_END)) console.log("✓ 告知块带标记（显示层据此整段剥离）");
    else { bad += 1; console.log("✗ 告知块缺标记 ⇒ 会直接显示在气泡里"); }
    store._resetInlineNotices();
  }

  /* ── 旧会话补种记账（prompt-seeds.mjs）────────────────────────────────────
     ⛔ 关键：补种只能补**一次**。漏了 ⇒ 旧会话永远不知道自己是谁；重复 ⇒ 每轮多烧几百字。 */
  {
    const seeds = await import(new URL("../src/lib/prompt-seeds.mjs", import.meta.url));
    seeds._resetPromptSeeds();
    total += 4;
    const V = seeds.BOSS_SEED_VERSION;
    if (seeds.needsSeed("old-1", "boss", V)) console.log("✓ 旧会话第一次发送判定为「需要补种」");
    else { bad += 1; console.log("✗ 旧会话没被判定为需要补种 ⇒ 永远拿不到角色说明"); }
    seeds.markSeeded("old-1", "boss", V);
    if (!seeds.needsSeed("old-1", "boss", V)) console.log("✓ 补过之后不再重复补（同一条会话只喂一次）");
    else { bad += 1; console.log("✗ 补过了还在补 ⇒ 每轮多烧一段上下文"); }
    if (seeds.needsSeed("old-2", "team", seeds.TEAM_SEED_VERSION)) console.log("✓ 记账按 kind 分桶（中枢补过不影响团队会话）");
    else { bad += 1; console.log("✗ 记账串了 kind ⇒ 团队会话会被漏掉"); }
    if (seeds.needsSeed("old-1", "boss", V + 1)) console.log("✓ 文案改版（版本 +1）会重新补一次");
    else { bad += 1; console.log("✗ 版本 +1 后不再补 ⇒ 改了文案旧会话收不到"); }
    /* ⛔ 认人必须跨重启：只靠内存 ref 的话，旧团队会话永远补不上（正是要修的场景） */
    total += 2;
    seeds.setTeamLeadThreads(["lead-1"]);
    if (seeds.isTeamLeadThread("lead-1") && !seeds.isTeamLeadThread("member-1")) console.log("✓ 主理人名单认得准（成员会话不会被补发纪律）");
    else { bad += 1; console.log("✗ 主理人名单判据错 ⇒ 会把「别自己干」发给成员会话"); }
    seeds.setTeamLeadThreads([]);
    if (!seeds.isTeamLeadThread("lead-1")) console.log("✓ 名单更新后旧条目清掉（不会残留）");
    else { bad += 1; console.log("✗ 名单更新后旧条目还在"); }
    seeds._resetPromptSeeds();
  }

  /* ── 补种文案与新建会话的系统提示词必须同义（否则新旧会话行为不一致）── */
  total += 1;
  {
    const seeds = await import(new URL("../src/lib/prompt-seeds.mjs", import.meta.url));
    const teamTools = readFileSync(join(ROOT, "electron", "expert-teams", "06-team-tools.ts"), "utf8");
    const missing = ["你不亲自干活", "先派活，再说话"].filter((a) => !teamTools.includes(a) || !seeds.TEAM_DISPATCH_SUPPLEMENT.includes(a));
    if (missing.length) {
      bad += 1;
      console.log(`✗ 团队纪律两处文案不同源：${missing.join("、")}（06-team-tools.ts 与 prompt-seeds.mjs 必须同义）`);
    } else {
      console.log("✓ 补发文案与新建会话的系统提示词同源（2 个锚点两处都在）");
    }
  }

  total += 1;
  const runner = readFileSync(join(ROOT, "electron", "boss-groups", "runner.ts"), "utf8");
  const missingAnchors = PRODUCER_ANCHORS.filter((anchor) => !runner.includes(anchor));
  if (missingAnchors.length) {
    bad += 1;
    console.log(`✗ 群事件文案漂移：runner.ts 里找不到 ${missingAnchors.map((a) => `「${a}」`).join("、")}（改了文案就要同步改 group-event-text.mjs + 本脚本）`);
  } else {
    console.log("✓ 群事件文案与 runner 同源（4 个锚点全在）");
  }

  rmSync(TMP, { recursive: true, force: true });
  if (bad) {
    console.log(`\n【注入段剥离】${bad}/${total} 项失败`);
    process.exit(1);
  }
  console.log(`\n【注入段剥离】${total}/${total} 通过（气泡里只剩用户原文；群广播按块渲染）`);
}

main();
