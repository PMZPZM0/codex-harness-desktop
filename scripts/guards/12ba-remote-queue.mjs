/**
 * 12ba —— 手机远控：RPC 白名单 + 运行中排队（11-06 用户令「P0-1 / P0-2 一起开工」）
 *
 * P0-1：`/api/rpc` 的类型必须是一张**显式白名单**，且拒绝发生在任何 handler 之前。
 *   白名单单独放在零依赖叶子 `electron/remote-rpc-types.ts`（remote.ts 依赖 electron，守卫 require 不了），
 *   表与 `data.type === "..."` 分支**双向核对**：加分支忘登记、登记了没实现，都打红。
 *
 * P0-2：手机在「运行中」也能发 —— 入队 / 立即（插队）/ 撤回。⛔ 立即与撤回的**语义只实现一份**：
 *   主进程只做引擎队列的增删查，并把两条宿主事件广播给桌面渲染层
 *   （`remote:queue-start` → startQueued，`remote:queue-withdraw` → cancelPendingSteer）。
 *
 * 判据两半：白名单**真跑**（require 构建产物）+ 接线**结构**（手机页 / 主进程 / 渲染层三处）。
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

console.log("【12ba】手机远控：RPC 白名单 + 运行中排队");

const remoteSrc = stripComments(read("electron/remote.ts"));
const typesSrc = stripComments(read("electron/remote-rpc-types.ts"));
const mainSrc = stripComments(read("electron/main.ts"));
const pageSrc = read("electron/remote/web-page.ts");
const partSrc = stripComments(read("src/features/app-state/parts/part04/03-seg/02-browser-queue-settings.tsx"));

/* ── ① 白名单真跑 ───────────────────────────────────────────────────────────── */
const artifact = join(ROOT, "dist-electron", "remote-rpc-types.js");
if (!existsSync(artifact)) {
  ok(false, "构建产物存在（缺 dist-electron/remote-rpc-types.js —— 先 npm run build:electron）");
} else {
  const mod = require_(artifact);
  const queueTypes = ["queue-list", "queue-add", "queue-start", "queue-delete"];
  ok(queueTypes.every((t) => mod.isAllowedRemoteRpc(t) === true),
    "真跑：四个排队类型都在白名单里（queue-list / queue-add / queue-start / queue-delete）");
  ok(["turn/start", "thread/queue/add", "thread/queue/delete", "", undefined, "list-threads2"].every((t) => mod.isAllowedRemoteRpc(t) === false),
    "真跑：**引擎方法名**和近似名都不在白名单里（手机只能调我们封装的类型，不能直接打引擎）");
}

/* ── ② 表 ↔ 分支 双向核对（只扫 `/api/rpc` 这一段）──────────────────────────── */
/* ⛔ 必须按区间截取：`ping` / `command` 是**WebSocket** 消息的类型（另一条通道），
   混进来会误判成「有分支没登记」。 */
const rpcStart = remoteSrc.indexOf('url.startsWith("/api/rpc")');
const rpcEnd = remoteSrc.indexOf("const m = url.match(/^\\/r\\/", rpcStart);
const rpcBlock = rpcStart < 0 || rpcEnd < 0 ? "" : remoteSrc.slice(rpcStart, rpcEnd);
const tableTypes = new Set([...typesSrc.matchAll(/"([a-z][a-z0-9-]+)"/g)].map((m) => m[1])
  .filter((t) => !["remote", "electron", "node"].includes(t)));
const branchTypes = new Set([...rpcBlock.matchAll(/data\.type === "([a-z][a-z0-9-]+)"/g)].map((m) => m[1]));
const missingInTable = [...branchTypes].filter((t) => !tableTypes.has(t));
const missingInBranch = [...tableTypes].filter((t) => !branchTypes.has(t));
ok(tableTypes.size >= 18 && branchTypes.size >= 18,
  `白名单与分支都有实质内容（表 ${tableTypes.size} 项 / 分支 ${branchTypes.size} 项）—— ⛔ 两边都空也会"相等"`);
ok(missingInTable.length === 0 && missingInBranch.length === 0,
  `表与分支**完全一致**（有分支没登记：${missingInTable.join("、") || "无"}；登记了没实现：${missingInBranch.join("、") || "无"}）`);

/* ── ③ 拒绝先于分发 + 无通用转发 ───────────────────────────────────────────── */
const gateAt = remoteSrc.indexOf("isAllowedRemoteRpc(rpcType)");
const firstBranchAt = remoteSrc.indexOf('data.type === "');
ok(gateAt > 0 && firstBranchAt > gateAt,
  "白名单检查排在**第一个分支之前**（放后面 = 未登记类型已经被 handler 处理过了）");
ok(/if \(!isAllowedRemoteRpc\(rpcType\)\) \{[\s\S]{0,160}?unsupported rpc type/.test(remoteSrc),
  "未登记类型直接回 unsupported rpc type（不是静默继续）");
ok(!/data\.method\b/.test(remoteSrc) && !/events\.forward\(/.test(remoteSrc),
  "⛔ `/api/rpc` 里没有「把 data.method 原样转给引擎」的通用转发（那等于令牌泄露即全开）");

/* ── ④ 手机页：排队 UI + 四个调用 ──────────────────────────────────────────── */
ok(/<div id="queuebar" hidden><\/div>/.test(pageSrc) && /id="queue" onclick="queueSend\(\)"/.test(pageSrc),
  "手机页有排队条与「排队」按钮");
ok(["queue-list", "queue-add", "queue-start", "queue-delete"].every((t) => pageSrc.includes(`type: "${t}"`)),
  "手机页四个动作都接了（列表 / 入队 / 立即 / 撤回）");
/* ⛔ 11-08 审查：手机端思考档位不能写死四档（模型规格已有 minimal…max）——
   主进程给「当前模型支持的档位」，手机页据此渲染；取不到才回退四档。 */
ok(/getEfforts\?: \(\) => Promise<string\[\]>/.test(remoteSrc)
  && /remoteEffortOf\(data\.effort\)/.test(remoteSrc)
  && /type: "efforts"/.test(pageSrc) && /appendEfforts/.test(pageSrc)
  && !/\[\["low", "低"\], \["medium", "中"\]/.test(pageSrc),
  "手机端思考档位跟模型规格联动（⛔ 不再写死四档；取不到才回退，11-08 审查）");
ok(/queueBtn\.hidden = !turnRunning/.test(pageSrc),
  "「排队」按钮只在运行中出现（空闲时发消息就是正常发送）");
ok(/void refreshQueue\(\);/.test(pageSrc) && /function renderQueue\(\)/.test(pageSrc),
  "排队条有渲染与刷新（切会话 / 运行态切换都会刷）");

/* ── ④b 手机页内联脚本语法（真跑构建产物）───────────────────────────────────
   页面是一大段模板字符串拼出来的：里面写坏一个括号，手机上就是整页白屏，
   而 tsc 只检查模板字符串本身（不检查里面的 JS）。这里把生成结果里的 <script> 抠出来编译一次。 */
const pageArtifact = join(ROOT, "dist-electron", "remote", "web-page.js");
if (!existsSync(pageArtifact)) {
  ok(false, "构建产物存在（缺 dist-electron/remote/web-page.js —— 先 npm run build:electron）");
} else {
  const { buildRemotePageHtml } = require_(pageArtifact);
  const html = String(buildRemotePageHtml("probecode"));
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((code) => code.trim());
  let syntaxError = "";
  for (const code of scripts) {
    try { new (require_("node:vm").Script)(code); } catch (error) { syntaxError = String(error?.message ?? error); break; }
  }
  ok(scripts.length >= 1 && !syntaxError, `手机页内联脚本语法合法（${scripts.length} 段）${syntaxError ? `：${syntaxError}` : ""}`);
  ok(/id="queuebar"/.test(html) && /function queueSend\(\)/.test(html) && /function renderQueue\(\)/.test(html),
    "生成的 HTML 里真的带排队条、排队发送与渲染函数");
}

/* ── ⑤ 主进程：只做队列增删查，语义交给渲染层 ──────────────────────────────── */
ok(/queueList: async \(threadId\)[\s\S]{0,400}?thread\/queue\/list/.test(mainSrc),
  "queueList 走引擎 thread/queue/list");
ok(/queueAdd: async \([\s\S]{0,500}?thread\/queue\/add[\s\S]{0,200}?clientUserMessageId: randomUUID\(\)/.test(mainSrc),
  "queueAdd 走 thread/queue/add（带 clientUserMessageId，与桌面同口径）");
ok(/queueStart: async \(threadId, id\)[\s\S]{0,600}?broadcastHarnessEvent\(\{ type: "remote:queue-start", threadId, id \}\)/.test(mainSrc)
  && /thread\/queue\/start/.test(mainSrc.slice(mainSrc.indexOf("queueStart: async"))),
  "queueStart 广播给渲染层执行，无窗口时退回引擎 thread/queue/start");
ok(/queueDelete: async \(threadId, id\)[\s\S]{0,400}?type: "remote:queue-withdraw"[\s\S]{0,300}?thread\/queue\/delete/.test(mainSrc),
  "queueDelete 先让桌面撤销待并入登记、再删引擎条目（顺序反了：界面气泡挂着但点撤回失败）");
ok(/function mobileInputOf\([\s\S]{0,900}?uploadsRoot/.test(mainSrc)
  && (mainSrc.match(/mobileInputOf\(/g) || []).length >= 3,
  "发送与排队共用同一个入参闸 mobileInputOf（图片只认 remote-uploads）");

/* ── ⑥ 渲染层：两条宿主事件的落点 ──────────────────────────────────────────── */
ok(/remote:queue-start"\) void bag\.startQueued\(id\)/.test(partSrc),
  "渲染层：remote:queue-start → startQueued（运行中会挂「待并入 · 可撤回」）");
ok(/remote:queue-withdraw"\) cancelPendingSteer\(threadId, id\)/.test(partSrc),
  "渲染层：remote:queue-withdraw → cancelPendingSteer（撤销待并入登记）");
/* ⛔ 11-07 审查：广播送达**每个窗口**（主窗 + 独立会话窗）—— 必须只认本窗当前会话那条，
   否则别的窗口拿自己的 threadId 去启动这条排队消息（引擎报错 + 桌面假弹「发送失败」）。 */
ok(/threadId !== String\(bag\.thread\?\.id \?\? ""\)\) return;/.test(partSrc),
  "渲染层：只处理 threadId == 本窗当前会话的事件（多窗口不重复处理）");

console.log(fails ? `\n【remote-queue】失败 ${fails} 项` : `\n【remote-queue】通过 ${checks} 项`);
process.exit(fails ? 1 : 0);
