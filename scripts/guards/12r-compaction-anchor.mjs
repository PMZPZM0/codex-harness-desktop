/**
 * 压缩线锚点判据（10-18 立；用户：「每次发新消息他都在上面，没有跟着历史消息往上顶」）。
 *
 * 病根（真实数据实证）：大会话只加载最近几页回合（`resumeThreadWithTurns` 每页 200、最多 3 页、desc 取），
 * 而压缩常常发生在更早的历史里 ⇒ 压缩所在回合**不在已加载窗口**。旧实现在 `findIndex === -1` 时
 * 回退到「最后一回合」⇒ 线被钉在最新消息上方，每发一条新消息都跟着往下跑。
 *
 * 语义（纯函数 `src/lib/compaction-anchor.mjs`，本守卫跑真值表）：
 *   ① 边界在窗口里 ⇒ 从它往上找最近一条含 userMessage 的回合，插在那之上；
 *   ② 边界已知但不在窗口 ⇒ **窗口顶部**（它比我们手里的历史都早）；
 *   ③ 边界未知（只有 toast）⇒ 最后一回合。
 * ⛔ 独立守卫（不进 check-preflight 计数）；挂进 package.json 的 check 链。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCompactionAnchor } from "../../src/lib/compaction-anchor.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【compaction-anchor】${message}`);
  if (!condition) fails++;
};

/* ── ① 真值表（跑真实现） ── */
const u = (id, text = "u") => ({ id, items: [{ type: "userMessage", content: [{ type: "text", text }] }] });
const a = (id) => ({ id, items: [{ type: "agentMessage", text: "ok" }] });
const turns = [u("t1"), a("t2"), u("t3"), a("t4"), u("t5")];
ok(resolveCompactionAnchor(turns, "t3") === 2,
  "真值表①：边界回合在窗口里 ⇒ 锚在该回合（含）之前最近一条 userMessage 回合（t3）");
ok(resolveCompactionAnchor(turns, "t2") === 0,
  "真值表①b：边界是「没有 userMessage 的回合」⇒ 往上找到 t1");
ok(resolveCompactionAnchor(turns, "t-old-not-loaded") === 0,
  "真值表②：边界**已知但不在窗口** ⇒ 锚到窗口顶部（⛔ 旧 bug 回退到最后一回合 = 钉在最新消息上方）");
ok(resolveCompactionAnchor(turns, "") === 4,
  "真值表③：边界未知（只有 toast）⇒ 最后一回合（压缩就发生在当下）");
ok(resolveCompactionAnchor([], "t3") === -1 && resolveCompactionAnchor(null, "") === -1,
  "真值表：空列表 / 坏入参 ⇒ -1（不插）");
ok(resolveCompactionAnchor([a("x1"), a("x2")], "x2") === 1,
  "真值表：窗口里一条 userMessage 都没有 ⇒ 插在边界回合本身之前（不丢线）");

/* ── ② 接线：时间线必须走纯函数，且旧的「回退最后一回合」不许回来 ── */
const timeline = read("src/features/app-view/AppView/02-main-stage/01-timeline.tsx");
ok(/from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/compaction-anchor\.mjs"/.test(timeline) && /resolveCompactionAnchor\(visible, boundaryTurnId\)/.test(timeline),
  "时间线用 resolveCompactionAnchor(visible, boundaryTurnId) 算锚点（已完成 / 宿主记录那条路）");
ok(/resolveCompactionAnchor\(visible, runningCompactionTurnId\)/.test(timeline),
  "运行中的压缩线也用同一个纯函数（两处不许各写一份）");
ok(!/anchorFrom\s*>=\s*0 \? anchorFrom : ordered\.length - 1/.test(timeline),
  "⛔ 旧的「边界找不到 ⇒ 最后一回合」回退已删（那就是「每次发新消息都在上面」的根因）");
ok(!/visible\.indexOf\(ordered\[i\]\)/.test(timeline),
  "⛔ 不许再用 ordered 里的回合去 visible 里取下标（窗口外恒 -1 ⇒ 线凭空消失）");

console.log(fails ? `\n【compaction-anchor】${checks} 条断言 / ${fails} 条失败` : `\n【compaction-anchor】${checks} 条断言全部通过`);
process.exit(fails ? 1 : 0);
