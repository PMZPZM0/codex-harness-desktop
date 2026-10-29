// 调度许可的**默认值 + 注入提示词**判据：真跑 dispatch.ts 的编译产物（不是字符串比对）。
//
// 10-29 两轮用户令：
//   ①「子智能体调用和专家调度改为默认可直接调用，仅专家团功能需要显式开启」+
//     「不再做数量或使用上的限制，每个会话都可以调度它们」；
//   ②「这里就可以只剩一个专家团就行，展示优化一下」+「配套的注入提示词，要优化一下」。
// ⇒ 总开关 / 独占锁 / 三类并排开关全部下线；面板只剩专家团，注入提示词也必须只说这件事。
//   这里钉住四条硬边界：
//     a) 默认值：专家 ✓、子智能体 ✓、专家团 ✗（只有它能被"没开"，且**旧记录里的 false 也读成 true**）；
//     b) 工具描述：明确"专家/子智能体随时可派、别让用户去开开关"，且专家团未开启时显式否定；
//     c) 告知：只有两态（开了团 / 关了团），且都写明"专家与子智能体不受影响"；
//     d) 渲染层只有**一个**告知入队点，且核对目标会话 id（10-04 跨会话泄漏事故）。
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
const targets = [
  { kind: "expert", key: "e1", name: "洞明", profession: "", description: "" },
  { kind: "team", key: "t1", name: "施工队", profession: "", description: "" },
  { kind: "member", key: "t1:m1", name: "小工", profession: "", description: "", teamId: "t1", memberId: "m1" },
  { kind: "subagent", key: "s1", name: "评审", profession: "", description: "" },
];

/* ── ① 默认值：专家/子智能体恒可用，专家团是唯一开关 ─────────────────────── */
{
  ok(DISPATCH_DEFAULTS.expert === true && DISPATCH_DEFAULTS.subagent === true,
    "出厂默认：专家与子智能体**可用**（不需要任何开关）");
  ok(DISPATCH_DEFAULTS.team === false, "出厂默认：专家团**关闭**（唯一需要显式开启的一类）");
  ok(!("enabled" in DISPATCH_DEFAULTS), "⛔ 默认值里没有 enabled（调度总开关已删除，不得复活）");
  const d = dispatchAllowOf(null);
  ok(d.expert && d.subagent && !d.team, "无运行时记录（新会话）⇒ 按出厂默认判定");
  /* ⛔ 旧记录里 expert/subagent 的 false（当年逐类勾选关过）必须读成 true：
     界面上已没有关闭它们的入口，留着 false 会让模型让用户去点一个不存在的开关。 */
  const legacy = dispatchAllowOf({ expert: false, team: false, subagent: false, enabled: true });
  ok(legacy.expert === true && legacy.subagent === true, "⛔ 旧记录里被关掉的专家 / 子智能体读成 true（界面已无关闭入口）");

  ok(dispatchKindAllowed("expert", null).ok === true, "默认可派专家（无需用户动作）");
  ok(dispatchKindAllowed("subagent", null).ok === true, "默认可派子智能体（无需用户动作）");
  const teamDenied = dispatchKindAllowed("team", null);
  ok(teamDenied.ok === false && /不要重复调用/.test(teamDenied.reason) && /专家或子智能体/.test(teamDenied.reason),
    "默认派专家团被拒：文案给出「别再试 + 可改用专家/子智能体」（模型据此收敛）");
  ok(dispatchKindAllowed("member", null).ok === false, "团队成员随专家团（团没开 ⇒ 成员也不能派）");
  ok(dispatchKindAllowed("team", { expert: true, team: true, subagent: true }).ok === true, "显式开启专家团后放行");

  ok(filterTargetsBySwitch(targets, null).map((t) => t.kind).join(",") === "expert,subagent",
    "目录过滤同口径：默认只列专家与子智能体");
  ok(filterTargetsBySwitch(targets, { expert: true, team: true, subagent: true }).length === 4,
    "开启专家团后目录含团与成员（4 条）");
}

/* ── ② 工具描述：必须消掉"让用户去开开关"这个错觉 ───────────────────────── */
{
  const def = dispatchToolDescription(targets, dispatchAllowOf(null));
  ok(/专家、子智能体可直接派（不需要任何开关）/.test(def), "默认描述首句：专家/子智能体可直接派、无需开关");
  ok(/专家团未开启/.test(def) && /别硬试/.test(def), "默认描述点明专家团未开启、别硬试");
  ok(/不要把「先去调度面板开启」当成前置条件/.test(def), "⛔ 明确禁止把「去开开关」当前置条件（10-29 实测错觉）");
  ok(/【专家团】本会话\*\*未开启\*\*/.test(def), "专家团那一节显式否定（不是隐藏 —— 隐藏会让模型反复试）");
  ok(!/【专家】本会话\*\*未开启\*\*/.test(def) && !/【子智能体】本会话\*\*未开启\*\*/.test(def),
    "专家 / 子智能体**永远不被写成未开启**（它们恒可用）");

  const all = dispatchToolDescription(targets, allow(true, true, true));
  ok(/都可直接派/.test(all) && !/未开启/.test(all), "团开着时：三类都可直接派，没有否定段");
  ok(/【专家团（多人协作）】/.test(all) && /【专家（单人）】/.test(all) && /【子智能体（你自定义的角色）】/.test(all),
    "三类各自分节（平铺会让模型靠名字猜、派错类型）");
  ok(dispatchToolDescription(targets, null).includes('kind="team"'),
    "allow=null 退化为全列（老调用方 / 描述通道降级时不让描述变空）");
}

/* ── ③ 告知：只有两态，且都说明"专家/子智能体不受影响" ───────────────────── */
{
  const on = dispatchSelectionChangeNotice(["team"], [], allow(true, true, true), targets);
  ok(/打开了「专家团」/.test(on), "开团告知：说清是「专家团」被打开");
  ok(/【专家团】一个团队按 SOP/.test(on), "开团告知：带该类职责说明（模型知道该怎么用）");
  ok(/可派对象：施工队/.test(on), "开团告知：附该团名单（中途开团时模型立刻知道有谁）");
  ok(/专家与子智能体一直可派，不受这次变化影响/.test(on), "开团告知：明确专家/子智能体不受影响");

  const off = dispatchSelectionChangeNotice([], ["team"], allow(true, false, true), targets);
  ok(/关掉了「专家团」/.test(off), "关团告知：说清是「专家团」被关掉");
  ok(/team" \/ "member" 的调用会被拒绝/.test(off) && /别再试/.test(off), "关团告知：明确会被拒、别重试");
  ok(/专家与子智能体仍然可以直接派/.test(off), "关团告知：明确其余两类照旧可用");

  const empty = dispatchSelectionChangeNotice(["team"], [], allow(true, true, true), []);
  ok(!empty.includes("可派对象"), "没传目录时不硬编「可派对象」（不撒谎）");
  const noChange = dispatchSelectionChangeNotice([], [], allow(true, false, true));
  ok(noChange.includes("（本次没有实际变化。）"), "差集为空：给中性说明（渲染层本不该发）");
  /* ⛔ 旧版"按类分段"的痕迹不许回来：那会暗示专家/子智能体也能被关掉 */
  ok(!/新开启（可以派它们干活）/.test(on) && !/已在本会话停用/.test(off),
    "⛔ 不再有「按勾选逐类分段」的旧文案（它暗示专家/子智能体也能关）");
}

/* ── ④ 静态：告知带会话作用域闸、且只有一条入队点 ─────────────────────────── */
{
  const activity = readFileSync(join(ROOT, "src/features/app-state/parts/part06/02-seg/01-turn-runtime-activity.tsx"), "utf8");
  const queues = activity.split("\n").filter((l) => l.includes("queueInlineNotice(id, text)"));
  ok(queues.length === 1, "调度告知恰好 1 个入队点（开团 / 关团收敛成一条路径）");
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

/* ── ⑤ 静态：独占锁下线 + 面板只剩一个开关 ───────────────────────────────── */
{
  const store = readFileSync(join(ROOT, "electron/thread-runtime-store.ts"), "utf8");
  ok(!/dispatchOwnerFromMap|releaseDispatch\(/.test(store), "⛔ store 里没有独占锁（dispatchOwner / releaseDispatch 已删）");
  const ipc = readFileSync(join(ROOT, "electron/features/thread-runtime-ipc.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok(!/dispatch-owner|release-dispatch/.test(ipc), "⛔ 两条锁通道已从 IPC 域删除（不留死通道）");
  const preload = readFileSync(join(ROOT, "electron/preload.ts"), "utf8");
  ok(!/dispatchOwner|releaseDispatch/.test(preload), "⛔ preload 不再暴露锁方法");
  const types = readFileSync(join(ROOT, "src/vite-env.d.ts"), "utf8");
  ok(!/dispatchOwner|releaseDispatch/.test(types), "⛔ d.ts 不再声明锁方法（签名漂移 ⇒ 运行时丢参）");

  const menu = readFileSync(join(ROOT, "src/features/dispatch/DispatchMenu.tsx"), "utf8");
  ok(!/lockedBy|onReleaseHolder/.test(menu), "⛔ 面板不再有「被占用 / 一键释放会话」（独占锁已下线）");
  ok(/className=\{`dispatch-master \$\{draft\.team \? "on" : ""\}`\}/.test(menu) && !/className=\{`dispatch-row/.test(menu),
    "面板只剩「专家团」一个开关（专家 / 子智能体是只读说明，不再并排成三行开关）");
  ok(/dispatch-always/.test(menu) && /onChange\(\{ expert: true, subagent: true, team: draft\.team \}\)/.test(menu),
    "确认时 expert/subagent 一律写 true（界面上没有关闭入口，就不留假的关闭态）");
}

console.log("\n【dnotice】" + (checks - fails) + "/" + checks + " 通过" + (fails ? " —— " + fails + " 条红" : ""));
process.exit(fails ? 1 : 0);
