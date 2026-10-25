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
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
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
    name: "最坏组合（壳 + 记忆 + 时间 + 附件）",
    text: `${TEAM_PROMPT}[SYSTEM TASK · 团队会话]\n=== 用户需求 ===\n做个落地页\n=== END ===\n\nSOP 指令段。${MEMORY}${NOW}`,
    expect: "做个落地页",
    forbid: ["[SYSTEM TASK", "SOP 指令段", "[Harness", "[当前时间]", "编排团队"],
  },
];

function main() {
  const mod = bundleUserRefs();
  let bad = 0;
  for (const item of CASES) {
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
  rmSync(TMP, { recursive: true, force: true });
  if (bad) {
    console.log(`\n【注入段剥离】${bad}/${CASES.length} 项失败`);
    process.exit(1);
  }
  console.log(`\n【注入段剥离】${CASES.length}/${CASES.length} 通过（气泡里只剩用户原文）`);
}

main();
