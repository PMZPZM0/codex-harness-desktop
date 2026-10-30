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
(["暂无建议", "暂无使用记录", "暂无文件"].every((t) => panel.includes(t)) ? ok : fail)(
  "三个板块的空态文案齐（暂无建议 / 暂无使用记录 / 暂无文件）"
);
(/PAGE_FILES\s*=\s*10/.test(panel) && /monitor-pager/.test(panel) ? ok : fail)("会话产物每页 10 轮 + 分页器");
(/slice\(0, 5\)/.test(panel) ? ok : fail)("技能/MCP/插件每页最多 5 条");
(/useEffect\(\(\) => \{ setTurns\(\[\]\); setDraft\(""\); setFilePage\(0\); void load\(\); \}, \[threadId, load\]\)/.test(panel) ? ok : fail)(
  "换会话立刻清空并重读（⛔ 保留上一会话的 turns = 串会话）"
);

/* ⑤ 右栏入口：监控排第一 + 页面区块真的挂了（只加按钮不加页面 = 点了空白） */
const tabs = [...rail.matchAll(/className=\{`panel-tab[^`]*`\} title="([^"]+)"/g)].map((m) => m[1].slice(0, 2));
(tabs[0] === "监控" ? ok : fail)(`右栏第一个 tab 是「监控」（实得 ${tabs.join(" / ") || "无"}）`);
(/<TaskMonitorPanel app=\{app\} \/>/.test(rail) ? ok : fail)("右栏页面区块挂了 <TaskMonitorPanel>（⛔ 只加按钮会点了空白）");

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
(/让 Codex 评估/.test(panel) && /app\.sendPrefilled/.test(panel) ? ok : fail)(
  "面板有「让 Codex 评估」：把本轮事实发进本会话，由 Codex 用自己的上下文复盘"
);

/* ④ 技能卡收成一行（用户：「技能还显示两行，不美观」）。 */
(!/subtitle=\{description \|\| action/.test(skillCard) ? ok : fail)(
  "技能卡不再传 subtitle（表头一行：已使用技能 <中文名>；动作留在右侧 info）"
);

console.log("");
console.log(`【289】任务监控守护：${failCount === 0 ? "通过" : "失败 " + failCount + " 项"}`);
process.exit(failCount === 0 ? 0 : 1);
