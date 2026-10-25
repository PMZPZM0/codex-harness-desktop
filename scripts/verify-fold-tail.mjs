/**
 * 10-25「折叠会话跑到消息尾部 / 汇总消息下面」的**独立回归脚本**（可单独跑，也可被守卫调）。
 *
 * 判据的事实源 = **真实引擎快照的 item 顺序**（真机 thread/turns/list 实测：
 *   userMessage > reasoning > commandExecution > agentMessage）
 *   ＋ 截图场景的根因形态（最终答复**之后**还有过程单元）。
 *
 * 断言（新不变量）：
 *   ① 最终汇总正文永远是计划的**最后一项**；
 *   ② 它后面**不许**再有折叠组；
 *   ③ 整个回合的过程收进**唯一一个大折叠组**（用户：必须全部进大折叠）；
 *   ④ 组外只有用户消息 + 最终汇总正文。
 */
import { planCompletedFold } from "../src/lib/turn-fold-plan.mjs";

const unit = (id, type, text = "") => ({
  item: { id, type, text, status: "completed" },
  kind: type === "agentMessage" ? "body" : (type === "reasoning" ? "thinking" : "foldable"),
});

const check = (ok, label, extra = "") => {
  if (ok) console.log("  ✓", label);
  else { console.log("  ✗", label, extra); process.exitCode = 1; }
};

const analyse = (units, finalId) => {
  const plan = planCompletedFold(units, finalId);
  const bodies = plan.filter((e) => e.kind === "body").map((e) => e.unit.item.id);
  const folds = plan.filter((e) => e.kind === "fold").map((e) => e.units.map((u) => u.item.id));
  const kinds = plan.map((e) => e.kind);
  return {
    plan, bodies, folds, kinds,
    lastIsBody: kinds[kinds.length - 1] === "body",
    // 汇总正文之后还有没有折叠组
    bodyIdx: kinds.lastIndexOf("body"),
    foldAfterBody: kinds.lastIndexOf("fold") > kinds.lastIndexOf("body"),
    order: plan.map((e) => e.kind === "fold" ? `FOLD[${e.units.map((u) => u.item.id).join(",")}]` : `BODY(${e.unit.item.id})`),
  };
};

console.log("【10-25】折叠会话不再跑到消息尾部 / 汇总消息下面");

/* ① 真实引擎快照形态（真机 thread/turns/list 实测顺序） */
{
  const r = analyse([
    unit("u1", "userMessage", "哈喽"),
    unit("r1", "reasoning"),
    unit("c1", "commandExecution"),      // 读技能
    unit("m1", "agentMessage", "在的，潘总 😄 要干什么直接说"),
  ], "m1");
  check(r.lastIsBody, "① 真实形态：汇总正文是最后一项", r.order.join(" → "));
  check(!r.foldAfterBody, "① 真实形态：汇总正文之后没有折叠组", r.order.join(" → "));
  check(r.folds.length === 1, "① 真实形态：过程收进唯一一个大折叠组", JSON.stringify(r.folds));
}

/* ② 截图场景的根因形态：最终答复**之后**还有过程单元 */
{
  const r = analyse([
    unit("u1", "userMessage", "哈喽"),
    unit("r1", "reasoning"),
    unit("m1", "agentMessage", "汇总正文"),
    unit("c1", "commandExecution"),      // ⛔ 答复之后才落定的工具调用
  ], "m1");
  check(r.lastIsBody, "② 尾巴形态：汇总正文仍是最后一项", r.order.join(" → "));
  check(!r.foldAfterBody, "② 尾巴形态：尾巴过程**并进**大折叠，不另起一组", r.order.join(" → "));
  check(r.folds.length === 1 && r.folds[0].includes("c1"), "② 尾巴形态：过程全在一个大折叠组", JSON.stringify(r.folds));
}

/* ③ 中间有正文（长汇报）+ 尾巴 */
{
  const r = analyse([
    unit("u1", "userMessage", "哈喽"),
    unit("r1", "reasoning"),
    unit("b1", "agentMessage", "中间汇报"),
    unit("c1", "commandExecution"),
    unit("m1", "agentMessage", "汇总正文"),
    unit("c2", "commandExecution"),
  ], "m1");
  check(r.lastIsBody, "③ 中间正文形态：汇总正文是最后一项", r.order.join(" → "));
  check(!r.foldAfterBody, "③ 中间正文形态：汇总正文之后没有折叠组", r.order.join(" → "));
  /* 中间正文（b1）必须进折叠组（不切碎）；组外的只有用户消息 + 最终汇总。 */
  check(!r.bodies.includes("b1") && r.folds.some((f) => f.includes("b1")),
    "③ 中间正文形态：中间正文进了折叠组（过程不切碎）", JSON.stringify(r.bodies));
  check(r.bodies.every((id) => id === "u1" || id === "m1"),
    "③ 中间正文形态：组外只有用户消息 + 最终汇总", JSON.stringify(r.bodies));
}

/* ④ finalAgentId 对不上（上游快照丢 id 的既有形态） */
{
  const r = analyse([
    unit("u1", "userMessage", "哈喽"),
    unit("r1", "reasoning"),
    unit("m1", "agentMessage", "汇总正文"),
    unit("c1", "commandExecution"),
  ], "none");
  check(r.lastIsBody, "④ id 对不上：汇总正文仍是最后一项", r.order.join(" → "));
  check(!r.foldAfterBody, "④ id 对不上：汇总正文之后没有折叠组", r.order.join(" → "));
}

/* ⑤ 用户中途插入的消息仍留在组外（09-13 定稿，不能被这次修复破坏） */
{
  const r = analyse([
    unit("t1", "commandExecution"),
    unit("uMid", "userMessage", "跑10轮"),
    unit("t2", "reasoning"),
    unit("m1", "agentMessage", "汇总正文"),
  ], "m1");
  check(r.bodies.includes("uMid"), "⑤ 用户中途插入的消息仍留在折叠组外", JSON.stringify(r.bodies));
}

console.log(process.exitCode ? "\n有红项 ❌" : "\n全绿 ✅");
