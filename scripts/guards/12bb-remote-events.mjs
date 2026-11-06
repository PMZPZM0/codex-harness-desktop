/**
 * 12bb —— 手机远控事件流「可续传」（11-06 P0-3）
 *
 * 旧实现拿**时间戳**当游标（`at > since`）：同一毫秒内会漏事件，客户端/服务端时钟一漂就整段错位；
 * 而且断线太久被环形缓冲挤掉的事件**静默消失**，手机上看起来就是「运行过程少了一段」。
 *
 * 现在：单调 seq 当游标 + `lastSeq` 回执 + `dropped` 标记（缓冲里最早的都比游标新 ⇒ 有空洞）。
 * 判据：缓冲**真跑**（require 构建产物）+ 接线**结构**（服务端接口 / 手机页轮询）。
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require_ = createRequire(import.meta.url);
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/[^'"`]*$/, "")).join("\n");
let checks = 0;
let fails = 0;
const ok = (cond, msg) => { checks += 1; console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) fails += 1; };

console.log("【12bb】手机远控事件流续传（seq 游标 + 空洞告知）");

const artifact = join(ROOT, "dist-electron", "remote-event-buffer.js");
if (!existsSync(artifact)) {
  ok(false, "构建产物存在（缺 dist-electron/remote-event-buffer.js —— 先 npm run build:electron）");
} else {
  const { createEventBuffer } = require_(artifact);
  const buf = createEventBuffer(4);
  const mk = (text) => ({ threadId: "t1", kind: "step", text });
  buf.push(mk("a")); buf.push(mk("b")); buf.push(mk("c"));

  const all = buf.since(0);
  ok(all.events.length === 3 && all.lastSeq === 3 && all.dropped === false,
    "真跑：从 0 开始拿到全部 3 条，lastSeq=3，不误报 dropped", JSON.stringify({ n: all.events.length, lastSeq: all.lastSeq, dropped: all.dropped }));
  ok(all.events.map((e) => e.seq).join(",") === "1,2,3",
    "真跑：seq 单调递增（时间戳游标做不到「同毫秒不漏」）");
  ok(buf.since(2).events.map((e) => e.text).join(",") === "c",
    "真跑：since=2 只回第 3 条（游标之后）");
  ok(buf.since(3).events.length === 0,
    "真跑：游标已是最后一条 ⇒ 不回放（避免重复铺气泡）");

  const ring = createEventBuffer(2);
  ring.push(mk("1")); ring.push(mk("2")); ring.push(mk("3")); ring.push(mk("4"));
  const trimmed = ring.since(0);
  ok(trimmed.events.length === 2 && trimmed.events.map((e) => e.text).join(",") === "3,4",
    "真跑：环形缓冲只留最新 2 条");
  ok(ring.since(1).dropped === true,
    "真跑：游标比缓冲里最早的还老 ⇒ dropped=true（断线太久，必须告知，不能静默留空洞）");
  ok(ring.since(2).dropped === false,
    "真跑：游标正好是最早那条 ⇒ 没有空洞，不误报");

  const ts = createEventBuffer(10);
  const now = Date.now();
  ts.push(mk("old"), now - 5000);
  ts.push(mk("new"), now);
  ok(ts.since(now - 1000).events.map((e) => e.text).join(",") === "new",
    "真跑：老页面传时间戳（>1e12）仍按 at 过滤 —— 刷新后不会全空");
  ok(createEventBuffer(10).since(7).events.length === 0,
    "真跑：空缓冲不抛错");
}

/* ── 接线：服务端接口 + 手机页轮询 ─────────────────────────────────────────── */
const remoteSrc = stripComments(read("electron/remote.ts"));
ok(/private pollBuffer = createEventBuffer\(400\)/.test(remoteSrc)
  && !/pollBuffer\.splice\(/.test(remoteSrc),
  "服务端用 createEventBuffer（旧的「push + 手动 splice 400」已退役）");
ok(/lastSeq: slice\.lastSeq, dropped: slice\.dropped/.test(remoteSrc),
  "/api/events 回执带 lastSeq 与 dropped");

const pageSrc = read("electron/remote/web-page.ts");
ok(/let pollSince = 0;/.test(pageSrc) && !/let pollSince = Date\.now\(\)/.test(pageSrc),
  "手机页初始游标是 0（seq），不再用「当前时间减 60 秒」");
ok(/if \(!pollPrimed\) \{[\s\S]{0,200}?pollSince = nextCursor;[\s\S]{0,120}?return;/.test(pageSrc),
  "首包只对齐游标、不回放（页面加载时 loadMessages 已经拿过全量，回放会重复铺气泡）");
ok(/if \(data\.dropped\) \{[\s\S]{0,200}?loadMessages\(\)/.test(pageSrc),
  "服务端说 dropped ⇒ 手机明确提示并重新拉消息（不留静默空洞）");
ok(/typeof data\.lastSeq === "number" \? data\.lastSeq : \(data\.now \|\| Date\.now\(\)\)/.test(pageSrc),
  "客户端优先用 lastSeq，老服务端（只有 now）仍能跑 —— 前后端可分别升级");

console.log(fails ? `\n【remote-events】失败 ${fails} 项` : `\n【remote-events】通过 ${checks} 项`);
process.exit(fails ? 1 : 0);
