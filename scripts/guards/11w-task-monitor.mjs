#!/usr/bin/env node
/**
 * 【289】任务监控（右栏「监控」页，10-30 用户令）的接线守护。
 *
 * 用户原话：「右侧栏加一个任务监控按键……第一个进化建议（自我改进建议）可以同步给 Agent，
 * 由本会话 Codex 输出；一键净化就带上自我进化技能发给 Codex，内容可改；下面技能/MCP/插件，
 * 再下面会话产物（每回合、最多 30~40、分页）；每回合更新；每个会话独立不要串。」
 *
 * ⛔ 为什么要有它：这套东西横跨「引擎事件采集 → 落盘 → IPC → 面板 → 发送」五段，任何一段断了
 * 表面上都不报错（面板照开、只是永远空 / 点了没反应）。这里只钉**能被违反**的接线点。
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url)) + "/../..";
const read = (p) => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return ""; } };

let okCount = 0, failCount = 0;
const ok = (m) => { okCount++; console.log("  ✓ " + m); };
const fail = (m) => { failCount++; console.log("  ✗ " + m); };

console.log("\n【289】任务监控（右栏监控页：技能/MCP/插件 + 每轮产物 + 自我改进建议）");

const svc = read("electron/features/task-monitor.ts");
const panel = read("src/features/task-monitor/TaskMonitorPanel.tsx");
const rail = read("src/features/app-view/AppView/03-review-panel.tsx");
const boot = read("electron/features/boot.ts");
const manifest = (() => { try { return JSON.parse(read("electron/ipc-channels.manifest.json")); } catch { return { channels: [] }; } })();
const composition = (() => { try { return JSON.parse(read("electron/composition.json")); } catch { return { domains: [] }; } })();
const sendSrc = read("src/features/app-state/parts/part08/02-seg/send.tsx");
const barrel = read("src/features/app-state/index.ts");
/* 「进化」的接线面：bag 绑定那一层 + 类型真相源 */
const part08 = read("src/features/app-state/parts/part08/02-seg.tsx");
const bagTypes = read("src/features/app-state/parts/bag-types.ts");

/* ① 域注册 + 三通道（缺一个 ⇒ 面板永远读不到 / 建议存不下来） */
ok(existsSync(join(ROOT, "electron/features/task-monitor.ts")), "存在 electron/features/task-monitor.ts（采集 + 落盘 + 建议）");
(composition.domains.some((d) => d.id === "monitor" && d.enabled) ? ok : fail)(
  "composition.json 注册了 monitor 域（没注册 = 文件在但从不挂载）"
);
["monitor:read", "monitor:save-suggestion", "monitor:regenerate"].forEach((channel) => {
  (manifest.channels.some((c) => c.channel === channel) ? ok : fail)(`IPC 清单含 ${channel}`);
});

/* ② 采集必须挂在**全局**事件流上（挂到渲染层 = 历史回合与后台会话全漏） */
(/noteEngineEvent\(event\.method, p\)/.test(boot) ? ok : fail)(
  "boot 的引擎事件分发里调了 noteEngineEvent（⛔ 只挂渲染层会漏后台/历史回合）"
);
(/storedReportsForThread\(/.test(svc) ? ok : fail)("产物走 turn-file-watch 既有真相源（⛔ 不另扫盘）");
(/distillSummarize\(/.test(svc) ? ok : fail)("建议由本会话模型产出（复用一次性内部会话，不是模板拼字）");
(/MAX_TURNS\s*=\s*40/.test(svc) ? ok : fail)("每个会话最多留 40 轮（用户：最多展示 30~40）");

/* ③ 会话隔离：读写都只认传入 threadId，⛔ 不许"取最近一个"兜底 */
(/monitor:read", async \(_event: unknown, threadId\?: string\)/.test(svc) && /if \(!id\) return \{ threadId: "", turns: \[\]/.test(svc) ? ok : fail)(
  "读接口没拿到 threadId 就返回空表（⛔ 绝不跨会话兜底）"
);
(/parsed\.threadId === threadId/.test(svc) ? ok : fail)("落盘文件里的 threadId 与请求不一致时当损坏（防串会话）");

/* ④ 面板：三段 + 空态文案 + 分页 + 换会话清空 */
/* 10-30 改：空态不再写暂无建议占位（用户嫌丑且误导），改成**说明这一块在等什么**。 */
(["等这一轮结束", "暂无使用记录", "暂无文件"].every((t) => panel.includes(t)) ? ok : fail)(
  "三个板块的空态文案齐（等这一轮结束 / 暂无使用记录 / 暂无文件）"
);
(/PAGE_FILES\s*=\s*10/.test(panel) && /monitor-pager/.test(panel) ? ok : fail)("会话产物每页 10 轮 + 分页器");
(/slice\(0, 5\)/.test(panel) ? ok : fail)("技能/MCP/插件每页最多 5 条");
(/useEffect\(\(\) => \{ setTurns\(\[\]\); setDraft\(""\); setFilePage\(0\); void load\(\); \}, \[threadId, load\]\)/.test(panel) ? ok : fail)(
  "换会话立刻清空并重读（⛔ 保留上一会话的 turns = 串会话）"
);

/* ⑤ 右栏入口：监控排第一 + 页面区块真的挂了（只加按钮不加页面 = 点了空白） */
const tabs = [...rail.matchAll(/className=\{`panel-tab[^`]*`\} title="([^"]+)"/g)].map((m) => m[1].slice(0, 2));
(tabs[0] === "监控" ? ok : fail)(`右栏第一个 tab 是「监控」（实得 ${tabs.join(" / ") || "无"}）`);
(/<TaskMonitorPanel app=\{app\}[^>]*\/>/.test(rail) ? ok : fail)("右栏页面区块挂了 <TaskMonitorPanel>（⛔ 只加按钮会点了空白）");

/* ⑥ 一键进化：必须真发出去，且带上 self-review 技能（⛔ 不能用 setState 再 send —— 会发旧正文且丢技能） */
(/app\.sendPrefilled\(\{ text, skill: EVOLVE_SKILL \}\)/.test(panel) ? ok : fail)(
  "面板「进化」走 app.sendPrefilled（真发送，不是只填输入框、也不是拿 app 当 bag 硬转）"
);
(/export async function sendPrefilled/.test(sendSrc) && /pendingSkillRef\.current = input\.skill/.test(sendSrc) ? ok : fail)(
  "sendPrefilled 用一次性 ref 传文与技能（⛔ setPrompt/addSkillReference 是 setState，send 读到旧 bag）"
);
(/pendingSkill \? \[\.\.\.bag\.selectedSkills, pendingSkill\]/.test(sendSrc) ? ok : fail)(
  "发送拼 [本轮已引用技能] 时把一次性技能一起带上（漏了 = 进了对话但没技能）"
);
/* ⛔ 10-30 修正：sendPrefilled 必须绑在 **bag** 上（part08 包一层并 `as typeof bag.sendPrefilled`）。
   ⛔ 不许从 barrel 导出后让调用方 `sendPrefilled(app as any)` —— app 是各 part 返回值的合并对象，
     而 sendImpl 要读几十个 bag 字段，缺一个就在发送中途静默走错分支。 */
(/bag\.sendPrefilled = sendPrefilled as typeof bag\.sendPrefilled/.test(part08) ? ok : fail)(
  "sendPrefilled 绑在 bag 上（part08 包一层，拿到的是真 bag）"
);
(/sendPrefilled: \(input: \{ text: string; skill\?: \{ name: string; description: string \} \}\) => Promise<void>/.test(bagTypes) ? ok : fail)(
  "bag-types 声明了 sendPrefilled（跨 part 引用才有具体类型，【93】不许漂移）"
);
(!/export \{ sendPrefilled \}/.test(barrel) ? ok : fail)(
  "barrel 不再导出 sendPrefilled（⛔ 导出会诱使调用方把合并对象当 bag 传 —— 缺字段、静默失败）"
);

/* ── 10-30 用户两张截图：「技能还显示两行」+「监控面板完全没有跟当前会话联动 / 光做个壳」──
   三处根因，逐条钉住（都是"不报错、只是永远空"的形态，最容易被当成"还没做"）： */
const skillCard = read("src/features/skill-usage/SkillUsageCard.tsx");
const summarySrc = read("electron/main/03-turn-summary.ts");
const codexIpcSrc = read("electron/features/codex-ipc.ts");

/* ① 采集口径必须与技能卡同源：原先只看 item.command 找 `…/skills/<名>/SKILL.md`，
      而引擎把工具调用报成 mcpToolCall（server/tool）或 dynamicToolCall（tool + arguments）
      ⇒ 整轮一条技能都认不出来，面板永远是空的。 */
(/import \{ pluginOfItem, skillOfItem \} from "\.\.\/\.\.\/src\/lib\/tool-display\.mjs"/.test(svc) ? ok : fail)(
  "采集复用渲染层同一份 skillOfItem / pluginOfItem（⛔ 另写一套正则 = 卡上有、面板没有）"
);
(!/const skillOfCommand/.test(svc) ? ok : fail)("删掉了那份只看 command 的窄匹配（留着就会被误用）");
(/type === "mcpToolCall"[\s\S]{0,160}?item\?\.server/.test(svc) ? ok : fail)(
  "MCP 取 server / tool 两个真实字段（⛔ 不是 name）"
);
(/arguments?\)?\.tool \?\?|argTool/.test(svc) ? ok : fail)(
  "网关工具（harness_*）取 arguments.tool 作能力名（直接剥前缀只会得到 \"tools\"）"
);

/* ② 进行中也要能读到：原来只在 turn/completed 结算 ⇒ 正在跑的这一轮面板 0 轮、无技能、无文件。 */
(/function liveTurnOf\(/.test(svc) && /ongoingTurnId/.test(svc) ? ok : fail)(
  "monitor:read 把**进行中**那一轮一起返回（ongoingTurnId）"
);
(/liveFilesOf/.test(svc) ? ok : fail)("进行中/未落盘的产物走 liveFilesOf（⛔ 只等落盘报告 = 本轮 0 文件）");
(/本轮进行中/.test(panel) ? ok : fail)("面板标「本轮进行中」（不标就分不清「没跑完」和「没采到」）");

/* ③ 建议要**每轮结束自己产出**，且拿得到本轮的回复与模型。 */
(/item\?\.type \?\? ""\) === "agentMessage"|=== "agentMessage"/.test(svc) ? ok : fail)(
  "采集本轮最终回复（复盘要看着它自己说了什么，不能只给工具清单）"
);
(/generateSuggestion\(threadId, turnId, String\(bucket\?\.reply/.test(svc) ? ok : fail)(
  "回合结算时**自动**触发复盘，并带上本轮回复"
);
(/threadModelOf/.test(summarySrc) && /sessionModel\?\.model/.test(summarySrc) ? ok : fail)(
  "复盘通道在没有自定义模型时退回本会话模型（⛔ 否则官方供应商用户永远「暂无建议」）"
);
(/noteThreadModel\(/.test(codexIpcSrc) ? ok : fail)(
  "turn/start 时记录本会话真实使用的模型（thread-model 单点）"
);
/* 10-30：按钮文案压成「评估」（两个按钮同排，「让 Codex 评估」会被挤成竖排）。 */
(/title="评估：/.test(panel) && /app\.sendPrefilled/.test(panel) ? ok : fail)(
  "面板有「评估」按钮（窄栏里只放图标、文字进 title）：把本轮事实发进本会话，由 Codex 用自己的上下文复盘"
);

/* ④ 技能卡收成一行（用户：「技能还显示两行，不美观」）。 */
(!/subtitle=\{description \|\| action/.test(skillCard) ? ok : fail)(
  "技能卡不再传 subtitle（表头一行：已使用技能 <中文名>；动作留在右侧 info）"
);

/* ⑤ 采取建议（10-30 用户令）：点一下把建议交给 Codex，**以事件通知**（与群聊同通道），
      不是用户消息；采纳后它自己把建议沉淀成经验。 */
const chAdopt = manifest.channels.find((c) => c.channel === "monitor:adopt");
(chAdopt && chAdopt.invokeArgs === "input" ? ok : fail)(
  "IPC 清单有 monitor:adopt 且实参走 input（漏 invokeArgs = preload 静默丢参）"
);
(/GROUP_EVENT_TAG/.test(svc) && /hostQueueMessageId\("evolve"\)/.test(svc) ? ok : fail)(
  "采纳事件用 [群事件] 标记 + host: 队列 id（与群聊同通道；时间线按事件块渲染，排队面板不冒用户消息）"
);
(/turn\/steer/.test(svc) && /thread\/queue\/add/.test(svc) ? ok : fail)(
  "投递走 steer（回合进行中）/ queue.add（空闲）两条路"
);
(!/turn\/start/.test(svc.slice(svc.indexOf("async function deliverHostEvent"), svc.indexOf("function adoptEventText"))) ? ok : fail)(
  "⛔ 投递函数里不许出现 turn/start（会打断正在跑的回合）"
);
(/adoptedAt = Date.now\(\)/.test(svc) ? ok : fail)("采纳会落盘 adoptedAt（面板据此显示「已采取」）");
(/采取建议/.test(panel) && /adoptMonitorSuggestion/.test(panel) ? ok : fail)(
  "面板按钮是「采取建议」，走 adoptMonitorSuggestion（⛔ 不再是「发回对话」）"
);
(/沉淀|可复用的经验/.test(svc) ? ok : fail)("事件正文要求它**沉淀成经验**（记忆 / AGENTS.md / 技能），不是回一句「好的」");

/* ⑥ 自动同步到输入框 + 每轮都复盘（10-30 用户：「输入框摆设吗，完全没有自动同步功能」
      「还要我手动让他总结」） */
/* ⛔⛔ 10-30 用户纠正：「我说的是**自我进化那个输入框**，不是聊天输入框，没脑子」。
   正确形态 = **一个固定文件**：Codex 往里写、面板读出来展示，新的覆盖旧的。
   ⇒ 下面三条同时钉住：① 有建议文件；② 写是原子覆盖；③ 面板读文件、且**不许**再写聊天输入框。 */
(/suggestionFileOf/.test(svc) && /\.evolve\.md/.test(svc) ? ok : fail)(
  "建议落在一个固定文件里（<userData>/task-monitor/<会话>.evolve.md）"
);
(/async function writeSuggestionFile/.test(svc) && /\$\{file\}\.tmp/.test(svc) && /rename\(tmp, file\)/.test(svc) ? ok : fail)(
  "写建议文件是**原子整份覆盖**（tmp + rename）：新覆盖旧、强杀不留半截"
);
(/suggestion: file\.text \|\| /.test(svc) && /suggestionPath/.test(svc) ? ok : fail)(
  "monitor:read 直接返回建议文件的全文与路径（Codex 写完面板就能读到）"
);
(/setAdvice\(/.test(panel) && !/app\.setPrompt/.test(panel) ? ok : fail)(
  "面板读文件展示；⛔ 不许再往**聊天输入框**塞（用户明确否掉的那个形态）"
);
(/writeSuggestionFile\(id, suggestionFileOf\(id\)\)|suggestionFileOf\(id\)/.test(svc) ? ok : fail)(
  "采纳事件把**文件路径**直接给 Codex（让它写进去，新的覆盖旧的）"
);
(!/const acted = /.test(svc) ? ok : fail)(
  "⛔ 不再用「有工具动作才复盘」的门（纯聊天轮被整轮跳过 ⇒ 面板长期停在「暂无建议」）"
);
(/没有工具调用、也没改文件/.test(svc) ? ok : fail)("纯聊天轮也给检查面（答太长/来回追问/该动手却只解释）");
(/\.monitor-tools/.test(read("src/styles/58-task-monitor.css")) ? ok : fail)(
  "表头按钮有独立容器 + 单行省略（截图里被挤成竖排的根因：hint 抢满宽度且允许换行）"
);

/* ── 10-31 用户三连报：「监控面板串位 / 回合结束后刷新还显示下一回合、输出自动刷新 / 路径写死，注意 mac」──
   逐条钉根因（都是"看着像 UI，其实是数据与线程"的形态）： */
/* ① 建议生成失败（真机 dump：suggestionError = "This chat uses custom964, but your current provider is harness"）
      ⇒ provider 必须与传下去的 config 同源；cwd 不许写死 process.cwd()。 */
(/const sessionConfig = /.test(summarySrc) && /sessionConfig\?\.model_provider/.test(summarySrc) ? ok : fail)(
  "复盘/蒸馏的 provider 以会话 config.model_provider 为准（⛔ 否则引擎报 provider 不一致，建议永远失败）"
);
(/model_provider: provider, model_providers: \{ \[provider\]/.test(summarySrc) ? ok : fail)(
  "自建 provider 时 modelProvider 与 config.model_provider 用同一个变量（⛔ 两边不同 = 引擎直接拒）"
);
(/const cwd = String\(opts\?\.cwd \?\? ""\)\.trim\(\) \|\| process\.cwd\(\)/.test(summarySrc)
  && /cwd,\s*approvalPolicy: "never"/.test(summarySrc) ? ok : fail)(
  "蒸馏会话的 cwd 由调用方给（会话工作目录），不写死进程目录（mac 打包后是安装包内部路径）"
);
(/cwd: threadCwd\.get\(threadId\) \?\? ""/.test(svc) ? ok : fail)(
  "任务监控把本会话工作目录传给复盘通道（与上面 cwd 同源）"
);
/* ② 「回合结束后刷新还显示下一回合 / 自动刷新」：
      · 上次进程中断留下的 running 必须收敛，否则面板永远轮询；
      · 引擎已无活动回合但 bucket 还在（收尾事件丢失）要补幂等结算。 */
(/suggestionState: "failed" as const, suggestionError: "上次生成被中断/.test(svc) ? ok : fail)(
  "读盘时把遗留的 running 收敛为 failed（⛔ 否则每 3s 轮询永不停止）"
);
(/const stale = liveTurnOf\(id\);[\s\S]{0,260}?settleTurn\(id, stale\.turnId, staleBucket\)/.test(svc) ? ok : fail)(
  "引擎已无活动回合时补一次幂等结算（不补 ⇒ 面板永远「本轮进行中」，像自动冒出下一回合）"
);
(/const pendingWork = Boolean\(ongoingId\) \|\| turns\.some\(\(t\) => t\.suggestionState === "running"\)/.test(panel) ? ok : fail)(
  "面板只在这两种真实进行中状态下轮询（⛔ 不再按「最近一轮没建议」判 —— 用户清空建议后条件恒真）"
);
(!/!t\.suggestion && t\.suggestionState === "idle"/.test(panel) ? ok : fail)(
  "删掉恒真的旧轮询判据（清空/手改建议后永不停止，看起来像自动刷新下一回合）"
);
(/active && !pendingWork|!active \|\| !pendingWork/.test(panel) ? ok : fail)(
  "面板不在前台（active=false）不轮询"
);
/* ③ 路径只显示文件名：原来只切 `/`，Windows 的 C:\…\x.evolve.md 会整条铺进按钮。 */
(/baseName\(advice\.path\)/.test(panel) && !/advice\.path\.split\(\/\[\\\/\]\/\)/.test(panel) ? ok : fail)(
  "建议文件按钮用 baseName（正/反斜杠都认；⛔ 不再把整条 Windows 路径铺出来）"
);

/* ── 10-31 用户令（对照 Qoder 右栏截图）：产出里已删除文件划线 + 最新回合网页查阅接线 + 手动展开默认监控 ── */
(/const deleted = String\(file\.status \?\? ""\) === "deleted"/.test(panel)
  && /monitor-file\$\{deleted \? " is-deleted" : ""\}/.test(panel)
  && /disabled=\{deleted\}/.test(panel) ? ok : fail)(
  "产出里的已删除文件加删除线并禁止打开（文件已不在磁盘）"
);
(/\.monitor-file\.is-deleted b \{ text-decoration: line-through/.test(read("src/styles/58-task-monitor.css")) ? ok : fail)(
  "删除线样式真在（⛔ 只加 class 不写样式 = 看不出来）"
);
(/collectTurnWebSources/.test(panel) && /网页查阅/.test(panel) && /window\.codex\.openExternal\(source\.url\)/.test(panel) ? ok : fail)(
  "最新回合的网页查阅接进监控（与消息底部同一份 collectTurnWebSources，点击走默认浏览器）"
);
(/app\.thread\?\.turns\?\.at\(-1\)/.test(panel) ? ok : fail)(
  "网页查阅取**最新回合**（切会话/新回合自动换，不缓存旧数据）"
);
(/webSources\.slice\(0, 6\)/.test(panel) && /查看更多/.test(panel) ? ok : fail)(
  "网页列表默认前 6 条 + 查看更多（不一次性铺满）"
);

/* ── 10-31 用户：「这三个板块有做自适应上下吗，输出多了，会有翻页和滚轮吗，还有右侧栏的大滚轮，
   万一一屏展示不下」+「要不然不要底色了，看着怪怪的」──
   ⛔⛔ 真 bug：`.monitor-panel` 原来是 `height: 100% + overflow: hidden`，而滚动容器是**它的父级
   `.panel-page`（05 里已有 overflow-y: auto）**。本层被钉死在 100% ⇒ 永远不超过父容器 ⇒
   父层滚动条永不出现，底部板块被**裁掉且滚不到**（grow 块还会被上面内容多的块压到 0 高）。
   真机对照（同 CSS 复现页）：旧规则 scrollH 687 == clientH 687（不可滚）、b1 被压 160→75；
   修后 scrollH 1460 > 687，滚到底最后一块 bottom 764 ≤ 容器 778（完全可见）。 */
{
  const monCss = read("src/styles/58-task-monitor.css");
  const panelRule = (monCss.match(/\.monitor-panel \{[\s\S]*?\n\}/) || [""])[0];
  /* ⛔ 本文件的 ok/fail 是**单参函数**（`ok(msg)`），写 `ok(cond, msg)` 只会把 cond 当消息打印
     ⇒ 恒通过（假绿）。必须用下面这个 `(cond ? ok : fail)(msg)` 形式。 */
  (/overflow: visible/.test(panelRule) && /flex: 1 0 auto/.test(panelRule) ? ok : fail)(
    "监控面板**可被内容撑高**（overflow: visible + flex-shrink 0）：⛔ 别回到 `height:100% + overflow:hidden` —— 那样一屏放不下就裁掉且滚不到"
  );
  (!/height: 100%/.test(panelRule) && !/overflow: hidden/.test(panelRule) ? ok : fail)(
    "负向：面板层不再钉死 100% 高、不再 hidden（滚动交给父级 .panel-page 一层，避免双层滚动条）"
  );
  const blockRule = (monCss.match(/\.monitor-block \{[\s\S]*?\n\}/) || [""])[0];
  (/background: transparent/.test(blockRule) && !/background: var\(--panel-2\)/.test(monCss) ? ok : fail)(
    "板块**不再铺底色**（用户：「不要底色了，看着怪怪的」）—— 分区只靠 --line 边框；⛔ 别再写 --panel-2（皮肤/暗色下像卡片套卡片）"
  );
  (/flex: 1 0 auto; overflow: visible/.test(monCss) ? ok : fail)(
    "产物块 shrink 0（上面板块变长时不被压成 0 高）、且不自带滚动（单层滚动）"
  );

  /* ── 10-31 用户（截图 +「开个中枢新会话，一直自动新建这个，有病吗」）──
     内省会话自噬环：某轮结束 → 生成建议 → distillSummarize 建一条内省会话 →
     它的回合结束又触发复盘 → 再建一条。实测 30 秒刷出 9 条，侧栏被「你是这个桌面助手的…」刷屏。
     两道闸缺一不可（少一道就会重新长出来）： */
  (/if \(internalThreads\.has\(threadId\)\) return;/.test(svc) ? ok : fail)(
    "⛔ 内部会话（内省/蒸馏）的回合不参与复盘 —— 否则每轮复盘又建一条会话，自噬环"
  );
  const ipcSrc = read("electron/features/codex-ipc.ts");
  (/internalThreads\.has\(String\(entry\?\.id/.test(ipcSrc) ? ok : fail)(
    "⛔ 内部会话不进 thread/list（侧栏不显示；只挡事件转发挡不住列表）"
  );
}

console.log("");
console.log(`【289】任务监控守护：${failCount === 0 ? "通过" : "失败 " + failCount + " 项"}`);
process.exit(failCount === 0 ? 0 : 1);
