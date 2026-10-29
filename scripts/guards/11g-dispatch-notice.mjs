// 调度许可的**默认值 + 通知映射**判据：真跑 dispatch.ts 的编译产物（不是字符串比对）。
//
// 10-29 用户令：「子智能体调用和专家调度改为默认可直接调用，仅专家团功能需要显式开启」+
//              「不再做数量或使用上的限制，每个会话都可以调度它们」。
// ⇒ 总开关 / 全局独占锁 / 配额全部下线；这里钉住新语义的三条硬边界：
//   ① 默认值：专家 ✓、子智能体 ✓、专家团 ✗（只有它能被"没开"）；
//   ② 通知：一条消息按类分段，差异驱动（新增一段 / 停用一段 / 末尾写当前可调度），
//      新开启的类要附对象名单（中途开团时模型才知道有谁）；
//   ③ 渲染层只有**一个**告知入队点，且核对目标会话 id（10-04 跨会话泄漏事故）。
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const req = createRequire(import.meta.url);
let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log("  " + (c ? "✓" : "✗") + " 【dnotice】" + m); if (!c) fails++; };

const stub = { app: { getPath: () => ROOT, isPackaged: false, getAppPath: () => ROOT, name: "p" } };
const NodeModule = req("node:module");
const origLoad = NodeModule._load;
NodeModule._load = function (request) {
  if (request === "electron") return stub;
  return origLoad.apply(this, arguments);
};
const {
  dispatchSelectionChangeNotice, dispatchKindAllowed, dispatchToolDescription,
  filterTargetsBySwitch, dispatchAllowOf, DISPATCH_DEFAULTS,
} = req(join(ROOT, "dist-electron/dispatch.js"));

const allow = (e, t, s) => ({ expert: e, team: t, subagent: s });

/* ── ① 默认值：这是本轮需求的**唯一**判据面 ─────────────────────────────── */
{
  ok(DISPATCH_DEFAULTS.expert === true && DISPATCH_DEFAULTS.subagent === true,
    "出厂默认：专家与子智能体**可用**（不需要任何开关）");
  ok(DISPATCH_DEFAULTS.team === false, "出厂默认：专家团**关闭**（唯一需要显式开启的一类）");
  ok(!("enabled" in DISPATCH_DEFAULTS), "⛔ 默认值里没有 enabled（调度总开关已删除，不得复活）");
  const d = dispatchAllowOf(null);
  ok(d.expert && d.subagent && !d.team, "无运行时记录（新会话）⇒ 按出厂默认判定");

  ok(dispatchKindAllowed("expert", null).ok === true, "默认可派专家（无需用户动作）");
  ok(dispatchKindAllowed("subagent", null).ok === true, "默认可派子智能体（无需用户动作）");
  const teamDenied = dispatchKindAllowed("team", null);
  ok(teamDenied.ok === false && /显式开启/.test(teamDenied.reason),
    "默认派专家团被拒，且文案指向「需显式开启」（模型据此改派或如实回报）");
  ok(dispatchKindAllowed("member", null).ok === false, "团队成员随专家团（团没开 ⇒ 成员也不能派）");
  ok(dispatchKindAllowed("team", { expert: true, team: true, subagent: true }).ok === true,
    "显式开启专家团后放行");
  const offExpert = dispatchKindAllowed("expert", { expert: false, team: true, subagent: true });
  ok(offExpert.ok === false && /关闭了/.test(offExpert.reason),
    "用户手动关掉专家后执行端拒绝（默认可用 ≠ 不可关）");

  const targets = [
    { kind: "expert", key: "e1", name: "洞明", profession: "", description: "" },
    { kind: "team", key: "t1", name: "施工队", profession: "", description: "" },
    { kind: "member", key: "t1:m1", name: "小工", profession: "", description: "", teamId: "t1", memberId: "m1" },
    { kind: "subagent", key: "s1", name: "评审", profession: "", description: "" },
  ];
  ok(filterTargetsBySwitch(targets, null).map((t) => t.kind).join(",") === "expert,subagent",
    "目录过滤同口径：默认只列专家与子智能体");
  ok(filterTargetsBySwitch(targets, { expert: true, team: true, subagent: true }).length === 4,
    "开启专家团后目录含团与成员（4 条）");
}

/* ── ② 工具描述：为什么"没开团"必须写进模型读得到的文本 ─────────────────── */
{
  const targets = [
    { kind: "expert", key: "e1", name: "洞明", profession: "", description: "" },
    { kind: "team", key: "t1", name: "施工队", profession: "", description: "" },
    { kind: "subagent", key: "s1", name: "评审", profession: "", description: "" },
  ];
  const def = dispatchToolDescription(targets, dispatchAllowOf(null));
  ok(/可调度：专家、子智能体/.test(def), "默认描述首句写明「可调度：专家、子智能体」");
  ok(/未开启（不要派）：专家团/.test(def), "默认描述显式否定专家团（不是隐藏 —— 隐藏会让模型反复试）");
  ok(/默认关闭/.test(def) && /显式开启/.test(def), "专家团那一节写明「默认关闭、需显式开启」");
  const all = dispatchToolDescription(targets, allow(true, true, true));
  ok(!/未开启/.test(all), "三类全开时描述里没有否定段");
  const onlyTeam = dispatchToolDescription(targets, allow(false, true, false));
  ok(/可调度：专家团/.test(onlyTeam) && /未开启（不要派）：专家、子智能体/.test(onlyTeam),
    "只开专家团时，专家 / 子智能体被显式否定（用户关掉的两类不能被当成可用）");
  ok(dispatchToolDescription(targets, null).includes('kind="team"'),
    "allow=null 退化为全列（老调用方 / 描述通道降级时不让描述变空）");
  const x = dispatchToolDescription(targets, null);
  ok(/【专家（单人）】/.test(x) && /【专家团（多人协作）】/.test(x) && /【子智能体（你自定义的角色）】/.test(x),
    "三类各自分节（平铺会让模型靠名字猜、派错类型）");
}

/* ── ③ 通知：一条消息、按类分段、差异驱动 ────────────────────────────────── */
{
  const t = dispatchSelectionChangeNotice(["team"], [], allow(true, true, true));
  ok(t.includes("新开启") && t.includes("【专家团】一个团队按 SOP"), "开启专家团：该类有独立段落");
  ok(t.includes("当前仍可调度：专家、专家团、子智能体"), "开启专家团：末尾状态正确");
  ok(!t.includes("已在本会话停用"), "开启专家团：没有停用段（不误报）");

  for (const [kind, label, rest] of [
    ["expert", "专家", "专家团、子智能体"],
    ["subagent", "子智能体", "专家、专家团"],
    ["team", "专家团", "专家、子智能体"],
  ]) {
    const off = allow(kind !== "expert", kind !== "team", kind !== "subagent");
    const s = dispatchSelectionChangeNotice([], [kind], off);
    ok(s.includes(`【${label}】已在本会话停用`), `关闭${label}：有停用段`);
    ok(s.includes(`当前仍可调度：${rest}`), `关闭${label}：其余仍写明`);
  }

  {
    const s = dispatchSelectionChangeNotice(["team"], ["expert"], allow(false, true, true));
    ok(s.includes("【专家】已在本会话停用") && s.includes("【专家团】一个团队按 SOP"), "一开一关：两段都有");
    ok(s.includes("当前仍可调度：专家团、子智能体"), "一开一关：状态正确");
  }

  {
    const s = dispatchSelectionChangeNotice([], ["expert", "team", "subagent"], allow(false, false, false));
    ok(s.includes("当前仍可调度：（无）") && s.includes("不要尝试调度"), "三类全关：明确告知无可调度对象");
  }

  {
    const s = dispatchSelectionChangeNotice(["expert"], [], allow(true, false, true));
    ok(s.includes("⛔ 未开启（默认关闭 / 用户没开，不要派）：专家团"), "未开启的专家团即使本轮没动也被显式否定");
  }

  {
    const targets = [
      { kind: "team", key: "t1", name: "施工队", profession: "", description: "" },
      { kind: "team", key: "t2", name: "审校组", profession: "", description: "" },
    ];
    const s = dispatchSelectionChangeNotice(["team"], [], allow(true, true, true), targets);
    ok(s.includes("可派对象：施工队、审校组"), "开启专家团时附上该类对象名单");
    const empty = dispatchSelectionChangeNotice(["team"], [], allow(true, true, true), []);
    ok(!empty.includes("可派对象"), "没传目录时不硬编「可派对象」（不撒谎）");
  }

  {
    const same = dispatchSelectionChangeNotice([], [], allow(true, false, true));
    ok(same.includes("（本次没有实际变化。）"), "差集为空：给中性说明（渲染层本不该发）");
  }
}

/* ── ④ 静态：告知必须带会话作用域闸、且只有一条入队点 ─────────────────────── */
{
  const activity = readFileSync(join(ROOT, "src/features/app-state/parts/part06/02-seg/01-turn-runtime-activity.tsx"), "utf8");
  const queues = activity.split("\n").filter((l) => l.includes("queueInlineNotice(id, text)"));
  ok(queues.length === 1, "调度告知恰好 1 个入队点（开启 / 关闭 / 变化收敛成一条路径）");
  ok(queues.every((l) => l.includes("threadRef.current?.id === id")), "入队前核对目标会话 id（防跨会话泄漏）");
  ok(!/dispatchEnabledNotice|dispatchOffNotice/.test(activity), "⛔ 渲染层不再调用已删除的两条旧通知通道");
  ok(!/pendingCommandTextRef\.current = text/.test(activity),
    "⛔ 不再用「塞旁路文本 + send()」单独发一轮（会凭空多一条用户气泡）");
  const sendSrc = readFileSync(join(ROOT, "src/features/app-state/parts/part08/02-seg/send.tsx"), "utf8");
  ok(/takeInlineNotices\(String\(bag\.thread\?\.id/.test(sendSrc) && (sendSrc.match(/\$\{inlineNotices\}/g) ?? []).length === 2,
    "发送管线两条路径（排队 / 正常）都把待注入告知拼进正文最前");
  ok(readFileSync(join(ROOT, "src/lib/harness-block-strip.mjs"), "utf8").includes("harness-notice"),
    "告知块在显示层被整段剥掉（模型看得到、气泡里看不到）");
}

/* ── ⑤ 静态：独占锁必须真的下线（否则"每个会话都能调度"是假的） ───────────── */
{
  const store = readFileSync(join(ROOT, "electron/thread-runtime-store.ts"), "utf8");
  ok(!/dispatchOwnerFromMap|releaseDispatch\(/.test(store), "⛔ store 里没有独占锁（dispatchOwner / releaseDispatch 已删）");
  const ipc = readFileSync(join(ROOT, "electron/features/thread-runtime-ipc.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok(!/dispatch-owner|release-dispatch/.test(ipc), "⛔ 两条锁通道已从 IPC 域删除（不留死通道）");
  const preload = readFileSync(join(ROOT, "electron/preload.ts"), "utf8");
  ok(!/dispatchOwner|releaseDispatch/.test(preload), "⛔ preload 不再暴露锁方法");
  const types = readFileSync(join(ROOT, "src/vite-env.d.ts"), "utf8");
  ok(!/dispatchOwner|releaseDispatch/.test(types), "⛔ d.ts 不再声明锁方法（签名漂移 ⇒ 运行时丢参）");
  const menu = readFileSync(join(ROOT, "src/features/dispatch/DispatchMenu.tsx"), "utf8");
  ok(!/lockedBy|onReleaseHolder|dispatch-master/.test(menu),
    "⛔ 面板不再有总开关 / 占用者 / 一键释放（三类平行开关）");
}

console.log("\n【dnotice】" + (checks - fails) + "/" + checks + " 通过" + (fails ? " —— " + fails + " 条红" : ""));
process.exit(fails ? 1 : 0);
