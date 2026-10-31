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

console.log("\n【289】任务监控（右栏监控页：技能/MCP/插件 + 每轮产物 + 网页查阅）");

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

/* ① 域注册 + 通道（缺了 ⇒ 面板永远读不到） */
ok(existsSync(join(ROOT, "electron/features/task-monitor.ts")), "存在 electron/features/task-monitor.ts（采集 + 落盘）");
(composition.domains.some((d) => d.id === "monitor" && d.enabled) ? ok : fail)(
  "composition.json 注册了 monitor 域（没注册 = 文件在但从不挂载）"
);
(manifest.channels.some((c) => c.channel === "monitor:read") ? ok : fail)("IPC 清单含 monitor:read");
/* ⛔ 10-31 用户令「自我进化建议这个板块和配套删了」——三个建议通道必须一起消失：
   只删 UI 留通道 = 死接口，守卫【2】的域 count 也会对不上。 */
(["monitor:save-suggestion", "monitor:regenerate", "monitor:adopt"].every((channel) => !manifest.channels.some((c) => c.channel === channel)) ? ok : fail)(
  "建议相关的三个 IPC 通道已删除（save-suggestion / regenerate / adopt）"
);

/* ② 采集必须挂在**全局**事件流上（挂到渲染层 = 历史回合与后台会话全漏） */
(/noteEngineEvent\(event\.method, p\)/.test(boot) ? ok : fail)(
  "boot 的引擎事件分发里调了 noteEngineEvent（⛔ 只挂渲染层会漏后台/历史回合）"
);
(/storedReportsForThread\(/.test(svc) ? ok : fail)("产物走 turn-file-watch 既有真相源（⛔ 不另扫盘）");
(!/distillSummarize\(/.test(svc) && !/generateSuggestion/.test(svc) ? ok : fail)(
  "⛔ 回合结束**不再**调模型复盘（删掉自动建议后，task-monitor 只做记录；调回来自噬环与烧 token 都会回来）"
);
(/MAX_TURNS\s*=\s*40/.test(svc) ? ok : fail)("每个会话最多留 40 轮（用户：最多展示 30~40）");

/* ③ 会话隔离：读写都只认传入 threadId，⛔ 不许"取最近一个"兜底 */
(/monitor:read", async \(_event: unknown, threadId\?: string\)/.test(svc) && /if \(!id\) return \{ threadId: "", turns: \[\]/.test(svc) ? ok : fail)(
  "读接口没拿到 threadId 就返回空表（⛔ 绝不跨会话兜底）"
);
(/parsed\.threadId === threadId/.test(svc) ? ok : fail)("落盘文件里的 threadId 与请求不一致时当损坏（防串会话）");

/* ④ 面板：三段（技能/MCP/插件 · 会话产物 · 网页查阅）+ 空态文案 + 分页 + 换会话清空 */
/* 空态要说明「这一块在等什么」，不是写一个丑陋的占位。 */
(["暂无使用记录", "暂无文件", "这一轮没有访问网页"].every((t) => panel.includes(t)) ? ok : fail)(
  "三个板块的空态文案齐（技能/MCP/插件 · 会话产物 · 网页查阅）"
);
(/PAGE_FILES\s*=\s*10/.test(panel) && /monitor-pager/.test(panel) ? ok : fail)("会话产物每页 10 轮 + 分页器");
(/slice\(0, 5\)/.test(panel) ? ok : fail)("技能/MCP/插件每页最多 5 条");
(/useEffect\(\(\) => \{ setTurns\(\[\]\); setFilePage\(0\); void load\(\); \}, \[threadId, load\]\)/.test(panel) ? ok : fail)(
  "换会话立刻清空并重读（⛔ 保留上一会话的 turns = 串会话）"
);

/* ⑤ 右栏入口：监控排第一 + 页面区块真的挂了（只加按钮不加页面 = 点了空白） */
const tabs = [...rail.matchAll(/className=\{`panel-tab[^`]*`\} title="([^"]+)"/g)].map((m) => m[1].slice(0, 2));
(tabs[0] === "监控" ? ok : fail)(`右栏第一个 tab 是「监控」（实得 ${tabs.join(" / ") || "无"}）`);
(/<TaskMonitorPanel app=\{app\}[^>]*\/>/.test(rail) ? ok : fail)("右栏页面区块挂了 <TaskMonitorPanel>（⛔ 只加按钮会点了空白）");

/* ⛔ 10-31：面板的「评估 / 进化」入口随建议板块一起删掉了；sendPrefilled 作为通用能力保留
   （它仍是「带一次性技能真发一条」的唯一正确做法），但**这里不再断言面板用到它**。
   ⛔ 10-30 修正：sendPrefilled 必须绑在 **bag** 上（part08 包一层并 `as typeof bag.sendPrefilled`）。
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

/* ⛔⛔ 10-31 用户令（对照截图）：「那就把自我进化建议修改个板块和配套删了吧，不要了，右侧栏同步更新」。
   删干净 = 面板段 + 主进程生成链 + 三个通道 + 建议文件 + 那段 CSS。⛔ 别只藏 UI：
   后台每轮调一次模型既烧 token，又会让侧栏冒出内部会话（30 秒 9 条那次的根）。 */
(!/自我改进建议/.test(panel) && !/monitor-suggestion/.test(panel) && !/suggestionFileOf|generateSuggestion|adoptMonitorSuggestion/.test(svc) ? ok : fail)(
  "「自我改进建议」整块已删除（面板 + 主进程 + 建议文件），右侧栏同步更新"
);
/* ④ 技能卡收成一行（用户：「技能还显示两行，不美观」）。 */
(!/subtitle=\{description \|\| action/.test(skillCard) ? ok : fail)(
  "技能卡不再传 subtitle（表头一行：已使用技能 <中文名>；动作留在右侧 info）"
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
(/const stale = liveTurnOf\(id\);[\s\S]{0,260}?settleTurn\(id, stale\.turnId, staleBucket\)/.test(svc) ? ok : fail)(
  "引擎已无活动回合时补一次幂等结算（不补 ⇒ 面板永远「本轮进行中」，像自动冒出下一回合）"
);
(/const pendingWork = Boolean\(ongoingId\);/.test(panel) ? ok : fail)(
  "面板只在「引擎还有进行中的回合」时轮询（⛔ 别用「最近一轮没建议」那种恒真判据）"
);
(/active && !pendingWork|!active \|\| !pendingWork/.test(panel) ? ok : fail)(
  "面板不在前台（active=false）不轮询"
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
