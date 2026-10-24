/**
 * 压缩线锚点 + 刻度尺绿段判据（10-18 立；用户两次实测：
 *   ①「每次发新消息他都在上面，没有跟着历史消息往上顶」；
 *   ②「我刚刚压缩的，压缩完成就不见了」+「刻度线里面如那两个中间产生压缩线，就在那两个中间产生一个绿色线」）。
 *
 * 病根与语义（纯函数 `src/lib/compaction-anchor.mjs`，本守卫跑真值表）：
 *   · 大会话只加载最近几页回合（每页 200、最多 3 页、desc 取），压缩常发生在更早的历史 ⇒ 边界不在窗口；
 *     旧代码回退「最后一回合」⇒ 线钉在最新消息上方、跟着新消息往下跑。
 *   · 手动压缩跑成**空回合**，时间线「空推进回合整组不渲染」把它过滤掉 ⇒ 记录里的 turnId 在回合列表里
 *     根本不存在，却确实刚发生 ⇒ 必须落到**末尾**（压缩发生处），不能扔到窗口顶部（视口外）。
 *   · 刻画度尺的绿段必须与压缩线**同源**（同一纯函数），否则两处口径会分叉。
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
const u = (id, t = 1000) => ({ id, startedAt: t, completedAt: t + 10, items: [{ type: "userMessage", content: [{ type: "text", text: "u" }] }] });
const a = (id, t = 1000) => ({ id, startedAt: t, completedAt: t + 10, items: [{ type: "agentMessage", text: "ok" }] });
const turns = [u("t1", 1000), a("t2", 2000), u("t3", 3000), a("t4", 4000), u("t5", 5000)];
ok(resolveCompactionAnchor(turns, "t3") === 2,
  "真值表①：压缩所在回合在窗口里 ⇒ 插在它自己之前（它自带 userMessage = 那条消息的正上方）");
ok(resolveCompactionAnchor(turns, "t2") === 1,
  "真值表①b：压缩所在回合是**空回合**（手动压缩那种）⇒ 插在它自己之前 = 前一条真实消息之后");
ok(resolveCompactionAnchor(turns, "t-not-loaded", { compactionAt: 4100 }) === 4,
  "真值表②：压缩所在回合不在窗口 ⇒ 按**压缩时间**落在最后一个「先于压缩」的回合之后（4100 → t4 之后）");
ok(resolveCompactionAnchor(turns, "t-not-loaded", { compactionAt: 6000 }) === turns.length,
  "真值表②b：刚压缩完（时间比窗口里所有回合都新）⇒ 末尾（压缩发生处，用户看得见；用户 10-18「压缩完成就不见了」）");
ok(resolveCompactionAnchor(turns, "t-not-loaded", { compactionAt: 500 }) === 0,
  "真值表②c：压缩比窗口里所有回合都早 ⇒ 窗口顶部（历史项；⛔ 旧 bug 回退最后一回合 = 钉在最新消息上方）");
ok(resolveCompactionAnchor(turns, "t-old") === 0,
  "真值表②d：老记录没有时间信息 ⇒ 保守按「更早的历史」= 顶部");
/* ⛔ 10-19 实测单位坑（用户：「压缩线一直显示在最新消息下面」）：应用里的回合时间是**秒**
   （formatTimestamp 按秒），而压缩记录的 at 是宿主 Date.now() 的**毫秒** ⇒ 旧代码直接比较时
   「秒 <= 毫秒」恒成立，锚点每次都命中最后一回合。这两条用真实数量级钉住。 */
const secTurns = [
  { id: "s1", startedAt: 1700000000, completedAt: 1700000100, items: [] },
  { id: "s2", startedAt: 1700000200, completedAt: 1700000300, items: [] },
];
ok(resolveCompactionAnchor(secTurns, "ghost", { compactionAt: 1600000000000 }) === 0,
  "真值表④：回合=秒 / 记录=毫秒，旧记录比窗口都早 ⇒ 顶部（⛔ 旧 bug 恒落末尾）");
ok(resolveCompactionAnchor(secTurns, "ghost", { compactionAt: 1700000250000 }) === 1,
  "真值表④b：压缩发生在 s1 之后、s2 之前 ⇒ 插在 s2 之前（下标 1）");
ok(resolveCompactionAnchor(turns, "") === 4,
  "真值表③：完全没有回合信息（只有 toast）⇒ 最后一回合（压缩就发生在当下）");
ok(resolveCompactionAnchor([], "t3") === -1 && resolveCompactionAnchor(null, "") === -1,
  "真值表：空列表 / 坏入参 ⇒ -1（不插）");
ok(resolveCompactionAnchor([a("x1", 1000), a("x2", 2000)], "x2") === 1,
  "真值表：窗口里一条 userMessage 都没有 ⇒ 插在压缩所在回合本身之前（不丢线）");
/* ── ② 接线：时间线必须走纯函数，且旧的「回退最后一回合」不许回来 ── */
const timeline = read("src/features/app-view/AppView/02-main-stage/01-timeline.tsx");
ok(/import \{ resolveCompactionAnchor \}/.test(timeline) && /resolveCompactionAnchor\(visible, boundaryTurnId, \{ compactionAt \}\)/.test(timeline),
  "时间线用 resolveCompactionAnchor(visible, boundaryTurnId, { afterNewest }) 算锚点（已完成 / 宿主记录那条路）");
ok(/const compactionAt = Number\(hostCompaction\?\.at \?\? 0\);/.test(timeline) && !/isCompactionNewest/.test(timeline),
  "压缩时间取记录的 at（⛔ 组件里不许再写一份时间比较）");
ok(/resolveCompactionAnchor\(visible, runningCompactionTurnId\)/.test(timeline),
  "运行中的压缩线也用同一个纯函数（两处不许各写一份）");
ok(/insertBefore === visible\.length/.test(timeline),
  "末尾插槽在（手动压缩的锚点 = visible.length ⇒ 渲染在最后一回合之后）");
ok(!/anchorFrom\s*>=\s*0 \? anchorFrom : ordered\.length - 1/.test(timeline),
  "⛔ 旧的「边界找不到 ⇒ 最后一回合」回退已删（那就是「每次发新消息都在上面」的根因）");
ok(!/visible\.indexOf\(ordered\[i\]\)/.test(timeline),
  "⛔ 不许再用 ordered 里的回合去 visible 里取下标（窗口外恒 -1 ⇒ 线凭空消失）");

ok(/while \(j < win\.visible\.length && !hasUser\(win\.visible\[j\]\)\) j \+= 1;/.test(timeline),
  "⛔ 刻度尺只给用户消息画刻度：锚点落在空回合（手动压缩）时，绿段要挪到「之后第一个有用户消息的回合」；后续没有 ⇒ 末尾（漏了 = 绿段永远不出现，实测踩过）");
/* ── ③ 刻度尺绿段（与压缩线同源） ── */
const ruler = read("src/features/session-turn/SessionTurn/01-message-ruler.tsx");
ok(/compactionTurnId\?: string/.test(ruler) && /compactionAtEnd\?: boolean/.test(ruler),
  "刻度尺接受 compactionTurnId / compactionAtEnd（由时间线用同一个纯函数算好传进来）");
ok(/ruler-compaction/.test(ruler) && /mark\.turnId === compactionTurnId/.test(ruler),
  "绿段画在**该回合用户消息的刻度之前**（= 两条刻度之间）");
ok(/compactionAtEnd && \([\s\S]{0,600}?className=\{\`ruler-compaction/.test(ruler),
  "末尾情形也画绿段（手动压缩：最后一条消息之后；10-21 起是可点击按钮 + 参与波浪）");
ok(/ruler-compaction[\s\S]{0,260}?onClick=\{\(\) => onJump\(mark\.turnId\)\}/.test(ruler)
  && /ruler-compaction[\s\S]{0,320}?onJump\(last\.turnId\)/.test(ruler),
  "绿段本身可点击（回合处跳到该回合；末尾跳到最新回合）");
ok(/prev\.compactionTurnId === next\.compactionTurnId/.test(ruler) && /prev\.compactionAtEnd === next\.compactionAtEnd/.test(ruler),
  "⛔ memo 比较器带上这两个 prop（漏了 = 压缩发生/完成时刻度尺不刷新，绿段永远不出现）");
const css = read("src/styles/09-settings-workspace-memory.css");
ok(/\.message-ruler \.ruler-compaction\s*\{[\s\S]{0,260}var\(--green\)/.test(css),
  "绿段颜色与压缩线同一个 token（var(--green)）");
ok(/\.message-ruler \.ruler-compaction\s*\{[\s\S]{0,260}margin:\s*4px 0 4px 12px/.test(css),
  "绿段与刻度同槽（2px 线 + 上下 4px margin + gap 4px = 14px，不撑乱 visibleCount = h/14）");
ok(/\.message-ruler \.ruler-compaction\s*\{[\s\S]{0,300}?width:\s*12px/.test(css)
  && /className=\{`ruler-compaction\$\{wave\}`\}/.test(ruler)
  && /className=\{`ruler-compaction\$\{endWave\}`\}/.test(ruler)
  && /\.message-ruler \.ruler-compaction\.wave-0 \{ width: 26px; margin-left: 12px/.test(css)
  && /\.message-ruler \.ruler-compaction\.wave-1 \{ width: 18px; margin-left: 12px/.test(css)
  && /\.message-ruler \.ruler-compaction\.wave-2 \{ width: 15px; margin-left: 12px/.test(css),
  "绿段跟随波浪长短：静止 12px，波浪中心/邻位与普通刻度同宽（26/18/15px，含末尾绿段）");
ok(/\.ruler-tick\.wave-0,[\s\S]{0,160}?\.ruler-tick:hover \{[\s\S]{0,120}?width:\s*26px;[\s\S]{0,40}?margin-left:\s*12px/.test(css)
  && /\.ruler-tick\.wave-1 \{[^}]*margin-left:\s*12px/.test(css)
  && /\.ruler-tick\.wave-2 \{[^}]*margin-left:\s*12px/.test(css)
  && !/\.ruler-(?:tick|compaction)\.wave-[012][^{]*\{[^}]*margin-left:\s*(?:2|5|8)px/.test(css),
  "⛔ 波浪只朝聊天一侧变长：左端 margin-left 恒 12px（旧版两边同时伸缩的 2/5/8px 不许回来）");
/* ── ④ 刻度尺联动（10-24 用户：波浪只在滚轮滚动时触发，默认不呼吸；点击跳转） ── */
ok(/const currentPos = currentItemId \? marks\.findIndex\(\(m\) => m\.itemId === currentItemId\) : -1/.test(ruler)
  && /const activeIndex = hoverIndex != null \? hoverIndex : \(wheelWave && currentPos >= 0 \? currentPos : null\)/.test(ruler)
  && /const wave = dist === 0 \? " wave-0" : dist === 1 \? " wave-1" : dist === 2 \? " wave-2" : ""/.test(ruler),
  "⛔ 波浪只在滚轮滚动期间触发（默认静止无波浪；hover 仍以鼠标为准），上下两格按距离衰减");
ok(/addEventListener\("wheel", onWheel/.test(ruler)
  && /setWheelWave\(true\)/.test(ruler)
  && /setWheelWave\(false\), 600\)/.test(ruler)
  && /removeEventListener\("wheel", onWheel\)/.test(ruler),
  "滚轮点亮波浪 + 停止 600ms 自动收起 + 卸载时摘监听（⛔ 程序化滚动/贴底/跳转都不许触发）");
ok(/const threadCompactToast = thread && compactToast && compactToast\.threadId === thread\.id \? compactToast : null/.test(timeline)
  && /compactionStateOf\(win\.ordered, threadCompactToast\?\.state\)/.test(timeline)
  && /compactionStateOf\(ordered, threadCompactToast\?\.state\)/.test(timeline),
  "⛔ 压缩 toast 按会话隔离（A 会话的压缩成功切到 B 会话后，B 的刻度尺会凭空长出绿线 —— 10-24 用户实测）");
ok(/contentOffsetTop\(el, scroller\) <= probe/.test(ruler) && !/if \(el\.offsetTop <= probe\)/.test(ruler),
  "⛔ 当前刻度用内容坐标（offsetTop 相对 .turn-group 恒接近 0 ⇒ 永远高亮最后一条）");
ok(/className=\{`ruler-tick[\s\S]{0,900}?onClick=\{\(\) => onJump\(mark\.turnId\)\}/.test(ruler)
  && /data-turn-id=\{mark\.turnId\}/.test(ruler),
  "每根刻度线都可点击跳转（带 data-turn-id，验收/键盘可用）");

console.log(fails ? `\n【compaction-anchor】${checks} 条断言 / ${fails} 条失败` : `\n【compaction-anchor】${checks} 条断言全部通过`);
process.exit(fails ? 1 : 0);
