/**
 * 办公室模拟层 · **真跑**判据（2026-10-05 晚立）
 *
 * ⛔⛔ 为什么必须真跑，而不是 grep `office-sim.ts`：
 *   本域已经栽过两次"判据看着在，其实什么都证明不了"（`11d` 的 TRUTH 存的是椅背；
 *   06 的六组断言被一个已删文件的 existsSync 整块关掉）。
 *   模拟层是**行为**（走位/避让/串门/派发/站位），行为只能靠跑出来。
 *
 * 做法（可复用的样板）：
 *   ① 把断言脚本写到 `.workbuddy/tmp/`（fs 写，⛔ 不走 shell —— 反引号/中文会被 shell 吃掉）；
 *   ② 子进程 `node --experimental-strip-types --import ./_ts-register.mjs` 跑它
 *      （`_ts-register/_ts-resolve` 负责把无扩展名的 `./office-format` 补成 `.ts`）；
 *   ③ 解析子进程输出的 ✓/✗ 行，逐条计入本守卫的断言总数。
 *
 * ⛔ 虚拟时钟是必须的：sim 内部多处读 `Date.now()`（站立截止/气泡/闲聊/派发动画），
 *   而空转循环几分钟才走几秒真实时间 ⇒ 不接管时钟测出来的行为是假的。
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./_ctx.mjs";

let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【sim】${m}`); if (!c) fails++; };

/* 断言脚本（模板串 ⇒ ⛔ 里面**不许**出现反引号或 ${}，否则会被这里吃掉）。 */
const BODY = `
import { OfficeSim } from "./src/features/team-office/office-sim.ts";

let vnow = 1800000000000;
Date.now = () => vnow;

const DT = 16.6;
const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: "m" + (i + 1), name: "成员" + i, running: false, hasThread: true, profession: "角色" }));
const say = (p, t) => console.log((p ? "OK " : "NO ") + t);

// ① 空转 1200 秒：防穿模 / 不越界 / 串门闲聊
const sim = new OfficeSim();
sim.sync(mk(6), vnow);
let minGap = Infinity, blocked = 0, talking = 0, attempts = 0;
const pairs = new Set();
const origChat = sim.startChat.bind(sim);
sim.startChat = (...a) => { attempts += 1; return origChat(...a); };
for (let t = 0; t < Math.round(1200000 / DT); t += 1) {
  vnow += DT;
  sim.tick(DT);
  if (t % 30 !== 0) continue;
  const list = sim.agents;
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i], b = list[j];
      if (a.action === "sit" && b.action === "sit") continue;
      minGap = Math.min(minGap, Math.hypot(a.x - b.x, (a.y - b.y) * 0.8));
    }
  }
  for (const a of list) {
    if (a.action !== "sit" && sim.grid[Math.floor(a.y / 32) * 30 + Math.floor(a.x / 32)] === 1) blocked += 1;
    if (a.chatWith) { pairs.add([a.id, a.chatWith].sort().join("~")); if (a.bubble) talking += 1; }
  }
}
say(minGap > 19, "防穿模：1200 秒内任意两人最近距离 " + minGap.toFixed(1) + "px（>19 ⇒ 没有叠在一起）");
say(blocked === 0, "不越界：站进阻挡格的采样数 = " + blocked);
say(attempts > 0 && pairs.size > 0 && talking > 0, "串门闲聊：发起 " + attempts + " 次 / 成对 " + [...pairs].join("|") + " / 说话采样 " + talking);

// ② 任务派发动画
const before = sim.dispatchFx.length;
sim.setEventState("m1", { phase: "thinking", since: vnow, runId: "run-a" });
say(sim.dispatchFx.length === before + 1, "新委派号触发派发动画（" + before + " → " + sim.dispatchFx.length + "）");
sim.setEventState("m1", { phase: "thinking", since: vnow, runId: "run-a" });
say(sim.dispatchFx.length === before + 1, "同一委派号重复上报不重复触发（仍 " + sim.dispatchFx.length + "）");
say(sim.dispatchFx[sim.dispatchFx.length - 1].from === 0, "派发动画起点 = 座位 0（派发方）");

// ③ 站位：物件正前方 + 并排不叠
const fresh = () => { const s = new OfficeSim(); s.sync(mk(6), vnow); for (let t = 0; t < 1500; t += 1) { vnow += DT; s.tick(DT); } return s; };
const send = (s, id, k) => { for (let t = 0; t < 4000; t += 1) { if (s.sendTo(id, k)) return true; vnow += DT; s.tick(DT); } return false; };
const until = (s, id) => {
  for (let t = 0; t < 9000; t += 1) {
    vnow += DT; s.tick(DT);
    const a = s.agents.find((x) => x.id === id);
    if (a.action === "stand" && a.activity) return { x: a.x, y: a.y, facing: a.facing };
  }
  const a = s.agents.find((x) => x.id === id);
  return { x: a.x, y: a.y, facing: a.facing };
};
const p1 = fresh();
say(send(p1, "m4", "water"), "派单：把 m4 派去接水");
const w = until(p1, "m4");
say(Math.abs(w.y - 146) < 3 && Math.abs(w.x - 790) <= 22 && w.facing === 1, "接水落点 (" + w.x.toFixed(0) + "," + w.y.toFixed(0) + ") 在饮水机正前方且面朝上");
say(send(p1, "m5", "water"), "派单：把 m5 也派去接水");
const w2 = until(p1, "m5");
say(Math.abs(w2.x - w.x) >= 15, "第二个人并排站（x " + w.x.toFixed(0) + " vs " + w2.x.toFixed(0) + "，错开 ≥15px）");
const p2 = fresh();
say(send(p2, "m6", "book"), "派单：把 m6 派去查资料");
const bk = until(p2, "m6");
say(Math.abs(bk.y - 146) < 3 && Math.abs(bk.x - 272) <= 22 && bk.facing === 1, "查资料落点 (" + bk.x.toFixed(0) + "," + bk.y.toFixed(0) + ") 在书架正前方且面朝上");

// ④ 「有工作就不要闲逛」：在跑的成员不被派出去
const p3 = new OfficeSim();
/* ⛔ 判据要打在**派单真正的输入**上：拒派的依据是 mode === "work"，
   而 mode 来自宿主同步的 running（不是 phase）—— 只 setEventState 不改 running
   测的是"空闲成员"，等于没测（第一版就是这么假绿的）。 */
p3.sync(mk(6).map((m, i) => (i === 0 ? { ...m, running: true } : m)), vnow);
say(p3.sendTo("m1", "water") === false, "有工作在跑的成员被拒派（sendTo 返回 false）");
say(p3.sendTo("m2", "water") === true, "空闲成员不受影响（m2 仍可派出）");
`;

/* ⛔ 用 `execFileSync` 而不是 `spawnSync`：本机沙箱里 spawnSync 直接 EBUSY，
   而 `execFileSync + -e` 可用（`11m-memory-ui.mjs` 也是这么做的）。
   ⛔ 脚本走 `-e` 内联、不落临时文件 —— 少一个能在中途残留的产物。 */
let output = "";
try {
  output = execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      /* ⛔ `--import` 必须给 **file:// URL**：绝对 Windows 路径（D:\…）会被 ESM 加载器拒
         （`ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'd:'`）—— 实测踩过。 */
      "--import", pathToFileURL(join(ROOT, "scripts", "guards", "_ts-register.mjs")).href,
      "--input-type=module", "-e", BODY,
    ],
    { cwd: ROOT, encoding: "utf8", timeout: 300000, stdio: ["ignore", "pipe", "pipe"] },
  );
} catch (error) {
  output = `${error?.stdout ?? ""}${error?.stderr ?? ""}`;
  if (!output) console.log(`     子进程没输出：${String(error?.message ?? error).slice(0, 200)}`);
}
output = output.replace(/^.*MODULE_TYPELESS.*$|^.*Reparsing.*$|^.*To eliminate.*$|^.*trace-warnings.*$/gm, "");
const lines = output.split("\n").filter((line) => /^(OK|NO) /.test(line.trim()));
ok(lines.length >= 12, `子进程真跑出 ${lines.length} 条断言（⛔ 0 条 = 脚本没跑起来，别当成通过）`);
/* ⛔ 一条都没解析到时**必须把子进程原始输出打出来** ——
   否则"0 条"这种失败看起来像"没有断言"，而不是"脚本炸了"，极难查。 */
if (!lines.length) console.log(`     子进程原始输出：${output.trim().slice(0, 500) || "（空）"}`);
for (const line of lines) {
  const good = line.trim().startsWith("OK ");
  checks += 1;
  if (!good) fails += 1;
  console.log(`  ${good ? "✓" : "✗"} 【sim】${line.trim().slice(3)}`);
}

console.log(`\n【sim】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
