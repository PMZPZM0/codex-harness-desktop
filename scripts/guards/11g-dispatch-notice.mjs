// 逐类通知的 8 态映射判据：真跑 dispatch.ts 的编译产物（不是字符串比对）
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
const { dispatchSelectionChangeNotice, dispatchEnabledNotice, activeDispatchKinds, dispatchOffNoticeText } =
  req(join(ROOT, "dist-electron/dispatch.js"));

const K = { E: "expert", T: "team", S: "subagent" };
const allow = (e, t, s) => ({ expert: e, team: t, subagent: s });

// ── 勾选 1 个（3 态）──
for (const [nm, a] of [["仅专家", allow(true, false, false)], ["仅专家团", allow(false, true, false)], ["仅子智能体", allow(false, false, true)]]) {
  const t = dispatchSelectionChangeNotice(activeDispatchKinds(a), [], a);
  const label = { expert: "专家", team: "专家团", subagent: "子智能体" }[activeDispatchKinds(a)[0]];
  ok(t.includes("【" + label + "】") && t.includes("新开启"), "勾 1 个（" + nm + "）：该类有独立段落");
  
  ok(t.includes("当前仍可调度：" + label), "勾 1 个（" + nm + "）：末尾状态正确");
}

// ── 勾选 2 个（3 态）──
{
  const a = allow(true, true, false);
  const t = dispatchSelectionChangeNotice(activeDispatchKinds(a), [], a);
  ok(t.includes("【专家】一个独立的专业角色"), "勾 2 个：专家段独立");
  ok(t.includes("【专家团】一个团队按 SOP"), "勾 2 个：专家团段独立");
  ok(t.includes("⛔ 未开启（用户没勾选，不要派）：子智能体"),
    "勾 2 个：未勾的子智能体有否定行（首次勾选无'停用'语义，用'未开启'）");
  ok(t.includes("当前仍可调度：专家、专家团"), "勾 2 个：末尾状态正确");
  const b = allow(true, false, true);
  const t2 = dispatchSelectionChangeNotice(activeDispatchKinds(b), [], b);
  ok(t2.includes("当前仍可调度：专家、子智能体"), "勾 2 个（专家+子智能体）：状态正确");
  const c = allow(false, true, true);
  const t3 = dispatchSelectionChangeNotice(activeDispatchKinds(c), [], c);
  ok(t3.includes("当前仍可调度：专家团、子智能体"), "勾 2 个（专家团+子智能体）：状态正确");
}

// ── 勾选 3 个 ──
{
  const a = allow(true, true, true);
  const t = dispatchSelectionChangeNotice(activeDispatchKinds(a), [], a);
  ok(t.includes("【专家】一个独立的专业角色") && t.includes("【专家团】一个团队按 SOP") && t.includes("【子智能体】你在设置里配置"),
    "勾 3 个：三段各不相同（不共用一段文案）");
  ok(t.includes("当前仍可调度：专家、专家团、子智能体"), "勾 3 个：末尾状态正确");
  ok(!t.includes("已在本会话停用"), "勾 3 个：没有任何停用段");
}

// ── 取消某一项、其余仍开（3 态）──
{
  const t = dispatchSelectionChangeNotice([], ["subagent"], allow(true, true, false));
  ok(t.includes("【子智能体】已在本会话停用"), "取消子智能体：有停用段");
  ok(t.includes("当前仍可调度：专家、专家团"), "取消子智能体：其余两类保持开启写明");
  const t2 = dispatchSelectionChangeNotice([], ["expert"], allow(false, true, true));
  ok(t2.includes("【专家】已在本会话停用") && t2.includes("当前仍可调度：专家团、子智能体"), "取消专家：其余保持");
  const t3 = dispatchSelectionChangeNotice([], ["team"], allow(true, false, true));
  ok(t3.includes("【专家团】已在本会话停用") && t3.includes("当前仍可调度：专家、子智能体"), "取消专家团：其余保持");
}

// ── 同时一开一关（差异驱动）──
{
  const t = dispatchSelectionChangeNotice(["subagent"], ["expert"], allow(false, true, true));
  ok(t.includes("【专家】已在本会话停用") && t.includes("【子智能体】你在设置里配置"), "一开一关：两段都有");
  ok(t.includes("当前仍可调度：专家团、子智能体"), "一开一关：状态正确");
}

// ── 全部取消（仍开着总开关）──
{
  const t = dispatchSelectionChangeNotice([], ["expert", "team", "subagent"], allow(false, false, false));
  ok(t.includes("当前仍可调度：（无）") && t.includes("不要尝试调度"), "三类全取消：明确告知无可调度对象");
}

// ── 总开关开启通知（勾 N 类就 N 段）──
{
  const targets = [
    { kind: "expert", key: "e1", name: "洞明", profession: "", description: "" },
    { kind: "subagent", key: "s1", name: "评审", profession: "", description: "" },
  ];
  const one = dispatchEnabledNotice(targets, allow(false, false, true));
  ok(one.includes("开启的对象类别：子智能体") && one.includes("可派对象：评审"), "开启通知（勾1类）：只列该类对象");
  ok(!one.includes("洞明"), "开启通知（勾1类）：未勾类的对象不出现");
  const three = dispatchEnabledNotice(targets, allow(true, true, true));
  ok(three.includes("【专家】") && three.includes("【专家团】") && three.includes("【子智能体】"), "开启通知（勾3类）：三段都有");
  ok(three.includes("【专家团】一个团队按 SOP") && three.includes("（该类当前没有已启用的对象"), "开启通知：该类无对象也写明（不静默）");
}

// ── 反证：before 取错（拿 next 当 before）⇒ 差集恒空 ──
{
  const same = dispatchSelectionChangeNotice([], [], allow(true, false, false));
  ok(same.includes("（本次没有实际变化。）"), "差集为空：给中性说明（渲染层本不该发）");
}

// ── 静态：通知发送必须带会话作用域闸（10-04 用户报「新会话冒出调度已关闭」）──
//   IPC 往返期间切会话 ⇒ bag.thread 已变 ⇒ 旧会话的通知漏进新会话。三个分支都要核对 thread id。
{
  const activity = readFileSync(join(ROOT, "src/features/app-state/parts/part06/02-seg/01-turn-runtime-activity.tsx"), "utf8");
  const sends = activity.split("\n").filter((l) => l.includes("pendingCommandTextRef.current = text"));
  ok(sends.length === 3, "调度通知恰好 3 个发送点（开启/关闭/范围变化）");
  ok(sends.every((l) => l.includes("threadRef.current?.id === id")), "每个发送点都核对目标会话 id（防跨会话泄漏）");
}

console.log("\n【dnotice】" + (checks - fails) + "/" + checks + " 通过" + (fails ? " —— " + fails + " 条红" : ""));
process.exit(fails ? 1 : 0);
