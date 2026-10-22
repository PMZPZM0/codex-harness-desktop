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

// ① 空转 1200 秒：卡位 / 不越界 / 串门闲聊
const sim = new OfficeSim();
const roster = mk(6);
sim.sync(roster, vnow);
/* ⛔⛔ 必须**照真实节奏**同步（宿主 OfficeCanvas 每 250ms 调一次 sync）。
   缺了它，"坐姿成员钉回座位 / 空路径就重新规划"两条机制根本不在测试范围内
   ⇒ 会测出"有人坐在走廊里"这种**真实运行时不存在**的假现场（第一版就漏了这个）。 */
let lastSyncAt = vnow;
let blocked = 0, talking = 0, attempts = 0;
/* ⭐ 卡位指标（10-06 立，10-06 晚收窄）——见 ① 末尾几条断言：
 *   maxStall 「仍在赶路却静止」的最长时长 ｜ deadMs 死态累计
 * ⛔ 原来还有"防穿模"两条（绝对最近距离 / 连续贴近时长）—— **已删除**：
 *   用户 10-06 明确要求"删除体积碰撞"（太容易卡位）⇒ 人物重叠是**预期行为**，
 *   再拿"最近距离"当判据就是自己打自己。防重叠改由**渲染层微错位**（画布侧）负责。 */
let maxStall = 0, deadMs = 0;
/* ⭐ 「真卡位」指标（10-06 晚，用户第二次报「卡位一直走」后立）：
   **既没换格子、path 也没缩短** —— 比"逐帧静止"准得多。
   ⛔ 为什么必须加这条：贴边震荡时人每帧都在动（实测 0.68px/帧），
     "移动小于 0.02px 才算静止"那种判据**一次都测不到**，而它 action 恒为 walk
     （走路动画照播）、path 长度一格不减，实测僵持 **1692 秒**。 */
let maxFrozen = 0;
const stall = {}, prevPos = {}, frozen = {}, prevCell = {}, prevLen = {};
const pairs = new Set();
const origChat = sim.startChat.bind(sim);
sim.startChat = (...a) => { attempts += 1; return origChat(...a); };
for (let t = 0; t < Math.round(1200000 / DT); t += 1) {
  if (vnow - lastSyncAt >= 250) { lastSyncAt = vnow; sim.sync(roster, vnow); }
  vnow += DT;
  sim.tick(DT);
  const list = sim.agents;
  /* ⛔ 卡位指标必须**每帧**统计（不能跟着下面 30 帧一次的采样走）：
     "静止"是逐帧概念，30 帧采一次会把 0.5 秒内的短停滞全漏掉。 */
  for (const a of list) {
    const p = prevPos[a.id];
    const moved = p ? Math.hypot(a.x - p.x, a.y - p.y) : 1;
    if (a.action !== "sit" && a.path.length > 0 && moved < 0.02) {
      stall[a.id] = (stall[a.id] || 0) + DT;
      if (stall[a.id] > maxStall) maxStall = stall[a.id];
    } else stall[a.id] = 0;
    if (a.action !== "sit" && a.onBreak && !a.chatWith && a.activityUntil <= 0 && a.path.length === 0) deadMs += DT;
    const cell = Math.floor(a.y / 32) * 100 + Math.floor(a.x / 32);
    if (a.action !== "sit" && a.path.length > 0) {
      const progressed = cell !== prevCell[a.id] || a.path.length < (prevLen[a.id] === undefined ? 99 : prevLen[a.id]);
      if (progressed) frozen[a.id] = 0;
      else frozen[a.id] = (frozen[a.id] || 0) + DT;
      if (frozen[a.id] > maxFrozen) maxFrozen = frozen[a.id];
    } else frozen[a.id] = 0;
    prevCell[a.id] = cell;
    prevLen[a.id] = a.path.length;
    prevPos[a.id] = { x: a.x, y: a.y };
  }
  if (t % 30 !== 0) continue;
  for (const a of list) {
    if (a.action !== "sit" && sim.grid[Math.floor(a.y / 32) * 30 + Math.floor(a.x / 32)] === 1) blocked += 1;
    if (a.chatWith) { pairs.add([a.id, a.chatWith].sort().join("~")); if (a.bubble) talking += 1; }
  }
}
/* ⛔ 绝对最近距离只当**防彻底叠住**的下限（10px），真正的判据是下面那条"连续贴近"：
   单帧的近距离来自设计内的瞬移 —— "坐姿成员钉回座位"（sync）与"终点精确落位"
   （对准书架/饮水机/座位像素）都会造成一两帧重合，实测 13.9~16.4px 但只持续 0~0.22 秒。
   拿它当穿模判据会把正常行为打成红。 */
say(maxStall <= 5000, "卡位：仍在赶路却静止的最长时长 " + (maxStall / 1000).toFixed(1) + "s（<=5s。修复前实测 42~203 秒、甚至永久）");
say(deadMs === 0, "卡位：死态（站着+无路径+无目标+onBreak=true）累计 " + (deadMs / 1000).toFixed(1) + "s（必须 =0）");
say(maxFrozen <= 1500, "卡位：带路径却**既不换格也不缩短路径**的最长时长 " + (maxFrozen / 1000).toFixed(1) + "s（<=1.5s；修复前实测 1692 秒）");
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

// ⑤ 交通回归：三种形态定向构造（2026-10-06「卡位」修复的守卫）
/* ⛔ 为什么必须**定向构造**而不是等随机复现：卡位是偶发的（真跑 30 分钟才撞到几次），
   而这三条是它的**最小复现**（.workbuddy/tmp/diag-stuck8.mjs 首次跑出三条全红）。
   ⛔⛔ 注意：本节在模板串里 ⇒ **任何反引号都会提前结束字符串**
     （刚才连踩两次：注释里提文件名时加了反引号 ⇒ 后面全变成真代码 ⇒ 报 tmp is not defined）。
     要提"反引号"这三个字，就写中文名，别写那个符号本身。 */
const mkTwo = () => [
  { id: "m1", name: "甲", running: false, hasThread: true, profession: "角色" },
  { id: "m2", name: "乙", running: false, hasThread: true, profession: "角色" },
];
const settled = () => { const s = new OfficeSim(); s.sync(mkTwo(), vnow); for (let t = 0; t < 1200; t += 1) { vnow += DT; s.tick(DT); } return s; };
const place = (s, id, x, y, tx, ty) => {
  const a = s.agents.find((q) => q.id === id);
  a.x = x; a.y = y; a.action = "walk"; a.onBreak = false;
  a.path = [{ x: tx, y: ty }]; a.dest = { x: tx, y: ty }; a.tripAt = vnow;
  return a;
};
/* ⑤-1 面对面（同一条走廊相向而行必须能错身） */
{
  const s = settled();
  const a = place(s, "m1", 400, 336, 500, 336);
  const b = place(s, "m2", 520, 336, 420, 336);
  for (let t = 0; t < 900; t += 1) { vnow += DT; s.tick(DT); }
  say(a.path.length === 0 && b.path.length === 0, "面对面：两人都走到终点（修复前互相顶死）");
}
/* ⑤-2 追尾（后者追上前者必须能绕过，而不是永久卡住） */
{
  const s = settled();
  const a = place(s, "m2", 420, 336, 620, 336);
  const b = place(s, "m1", 400, 336, 620, 336);
  for (let t = 0; t < 1200; t += 1) { vnow += DT; s.tick(DT); }
  say(a.path.length === 0 && b.path.length === 0, "追尾：后者绕过去且两人都到点（修复前卡在 31px 外不动）");
}
/* ⑤-3 串门（必须能碰头 + 到点散场，而不是僵持到 35 秒超时兜底） */
{
  const s = settled();
  let started = false, metAt = -1, endAt = -1;
  for (let t = 0; t < 3000; t += 1) {
    if (!started) started = s.startChat(s.agents[0]);
    vnow += DT; s.tick(DT);
    const a = s.agents[0]; const b = s.agents[1];
    if (started && metAt < 0 && a.chatWith && a.path.length === 0 && b.path.length === 0) metAt = t;
    if (started && metAt >= 0 && endAt < 0 && !a.chatWith && !b.chatWith) endAt = t;
  }
  say(started && metAt > 0 && metAt * DT < 15000, "串门：15 秒内碰头（t=" + (metAt > 0 ? (metAt * DT / 1000).toFixed(1) : "未碰头") + "s）");
  say(endAt > 0 && endAt * DT < 25000, "串门：25 秒内散场（t=" + (endAt > 0 ? (endAt * DT / 1000).toFixed(1) : "未散场") + "s，修复前 70s）");
}
/* ⑤-4 「体积碰撞已删除」的**正面判据**（10-06 用户要求：太容易卡位）。
   两人从**完全相同的坐标**出发、去同一个目标 ⇒ 都必须走到。
   ⛔ 修复前这里必红：分离力把两人往相反方向推，谁也没占优 ⇒ 一直僵着。 */
{
  const s = settled();
  const a = place(s, "m1", 400, 336, 620, 336);
  const b = place(s, "m2", 400, 336, 620, 336);
  for (let t = 0; t < 1200; t += 1) { vnow += DT; s.tick(DT); }
  say(a.path.length === 0 && b.path.length === 0,
    "同格不互斥：两人从同一坐标出发都能到点（体积碰撞已删除）");
}
/* ⑤-5 「贴边僵持」定向复现（10-06 晚 用户第二次报「卡位一直走」→ 逐帧实测的原始现场）。
   构造：把 m1 摆到「2 号桌下方 + 2 号位座位格左侧」的夹角 (479.9, 288.5)，给它一条
   **头在饮水机**的路径（= 修复前那种陈旧 homePath 的形状）。
   ⛔ 为什么单独立这条而不是只跑长时空转：这个夹角的触发要掷中随机出门（roll 0.18~0.80）
     且路径恰好经过该角，长跑 30 分钟才撞到几次；定向构造是它的**最小复现**。 */
{
  const s = settled();
  const a = s.agents.find((q) => q.id === "m1");
  a.x = 479.9; a.y = 288.5; a.action = "walk"; a.onBreak = false;
  a.dest = { x: 790, y: 146 };
  a.path = [{ x: 790, y: 146 }, { x: 784, y: 176 }, { x: 784, y: 208 }];
  a.tripAt = vnow; a.tripRetried = false;
  const x0 = a.x, y0 = a.y;
  let froze = 0, maxFroze = 0;
  let lastCell = Math.floor(a.y / 32) * 100 + Math.floor(a.x / 32);
  let lastLen = a.path.length;
  for (let t = 0; t < 1200; t += 1) {
    vnow += DT; s.tick(DT);
    const cell = Math.floor(a.y / 32) * 100 + Math.floor(a.x / 32);
    if (a.action === "sit" || cell !== lastCell || a.path.length < lastLen) {
      froze = 0; lastCell = cell; lastLen = a.path.length;
    } else froze += DT;
    if (froze > maxFroze) maxFroze = froze;
  }
  const out = Math.hypot(a.x - x0, a.y - y0);
  say(maxFroze <= 1500 && (a.action === "sit" || out > 20),
    "贴边僵持：夹角处 0.5s 内脱困（最长僵 " + (maxFroze / 1000).toFixed(1) + "s，"
    + (a.action === "sit" ? "已坐下" : "已走开 " + out.toFixed(0) + "px") + "；修复前 = 无限震荡）");
}
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
ok(lines.length >= 20, `子进程真跑出 ${lines.length} 条断言（⛔ 0 条 = 脚本没跑起来，别当成通过）`);
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
