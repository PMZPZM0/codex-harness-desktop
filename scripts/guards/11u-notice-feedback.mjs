/**
 * 通知回执与浮层单条化 · 守卫（2026-10-06 立）
 *
 * 守用户那条需求的两半：
 *   ① 「很多开发都没有通知提醒，全部检查一下，就比如你刚刚控制台里面加的那个，我开关就没反馈通知」
 *      ⇒ 拨动开关**必须**有回执（正在 / 成功 / 失败三态里，成功与失败至少各一条）。
 *   ② 「通知只展示最新的，不要一下上下展示好几个通知叠加」
 *      ⇒ 浮层同一时刻只留最新一条；通知中心（历史台账）不受影响。
 *
 * ⛔⛔ 为什么必须把 09-20 的旧判据改掉而不是"再加一条"：
 *   09-20 的口径是**反的**（「单槽被后到的顶掉 ⇒ 多会话并发看不见先到的那条」⇒ 改多条队列 +
 *   每条独立倒计时 + NOTICE_MAX=4）。10-06 用户明确改成"只看最新" ⇒ 旧断言「setNotice 是推一条入队」
 *   会**抵制正确修改**（它在 07-turn-fold.mjs 里，本轮已按新口径就地改写，行数不变以守住【265】棘轮）。
 *   ⛔ 教训：用户改口径时，要把它派生出来的每一处都找出来 —— 断言、常量、CSS 文案、组件注释。
 *
 * ⚠️ 覆盖边界（如实声明）：这里的"回执"判据看的是**接线**（成功/失败分支里有没有真的调通知），
 *   不测文案好不好、也不真跑 UI（点开关的 E2E 在 scripts/accept.mjs 那侧）。
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./_ctx.mjs";

let checks = 0, fails = 0;
const ok = (c, m) => { checks++; console.log(`  ${c ? "✓" : "✗"} 【notice-feedback】${m}`); if (!c) fails++; };

const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const has = (rel) => existsSync(path.join(ROOT, rel));
/** 剥注释（`//` 整行 + 块注释 + JSX 注释）。
 *  ⛔ 负向断言一律先剥注释 —— 本轮真跑踩到：这些注释里**引用了被禁的模式**，
 *  只剥行注释会让三条负向断言自己把自己顶红。 */
const codeOnly = (source) => String(source)
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split(/\r?\n/)
  .filter((line) => !/^\s*\/\//.test(line))
  .map((line) => line.replace(/\s\/\/[^'"`]*$/, ""))
  .join("\n");

/* ── ① 浮层：同一时刻只留最新一条 ─────────────────────────────────────── */
const HUB = "src/features/app-state/parts/part02/02-goal-browser-notice/02-approval-notice-center.tsx";
const hub = has(HUB) ? read(HUB) : "";
const hubCode = codeOnly(hub);
ok(/bag\.setNotices\(\[\{ id, text, threadId, scope \}\]\)/.test(hubCode),
  "⛔ setNotice 用**整体替换**入队（只留最新一条）—— 用户 10-06：不要上下叠加好几条");
ok(!/\[\.\.\.current,\s*\{\s*id,\s*text,\s*threadId,\s*scope\s*\}/.test(hubCode),
  "⛔ 负向：不许退回「追加进队列」的写法（那就是叠加本身）");
ok(/for \(const entry of bag\.notices\)[\s\S]{0,240}?clearTimeout\(timer\)[\s\S]{0,160}?noticeTimersRef\.current\.delete\(entry\.id\)/.test(hubCode),
  "被顶替的旧通知要**连同它的定时器**一起收掉（否则回调打在不存在的 id 上，定时器还一直挂着）");
ok(/noticeCenter/.test(hubCode) && /notice-center-v1/.test(hubCode),
  "⛔ 通知中心（历史台账）不受影响 —— 用户要的是浮层不叠，台账仍留全量");
ok(!/NOTICE_MAX/.test(hubCode),
  "队列上限常量不再是消费方（浮层恒 1 条）；⛔ 别顺手把它当「多条并列」的复活开关");

/* ── ② 开关回执：控制台「回复风格」（本轮用户点名的那个）───────────────── */
const SWITCH = "src/features/settings-general/BuiltinSkillSwitch.tsx";
const sw = codeOnly(has(SWITCH) ? read(SWITCH) : "");
ok((sw.match(/onNotice\?\.\(/g) || []).length >= 3,
  "内置技能开关有「正在…/成功/失败」三条回执（这条要重启引擎，按秒计，只留失败回执 = 点了没反应）");
ok(/else onNotice\?\.\(next \?/.test(sw),
  "⛔ 成功分支必须有回执（旧实现只在 `if (r.error)` 里通知 ⇒ 成功静默，正是用户报的那个）");

/* ── ③ 技能页「共享技能池」：同一技能的另一入口，此前成功+失败全静默 ────── */
const POOL = "src/features/settings-skills/SkillPoolSection.tsx";
const pool = codeOnly(has(POOL) ? read(POOL) : "");
ok((pool.match(/onNotice\?\.\(/g) || []).length >= 2,
  "池面板拨动给出回执（成功一条 + 失败一条）");
ok(!/\.catch\(\(\) => undefined\)/.test(pool),
  "⛔ 负向：池页不许再 `.catch(() => undefined)` —— 成功静默 + 失败也静默 = 用户完全不知道成没成");
ok(/onNotice=\{setNotice\}/.test(codeOnly(read("src/features/settings-skills/SkillsCenterSection.tsx"))),
  "池面板的回执由父级穿透（它按设计自取数据、不经 bag）—— 父级真的把 setNotice 传下去了");

/* ── ④ 开关静默吞错：本轮修掉的其余三处 ─────────────────────────────── */
const SCHED_ROWS = "src/features/settings-schedule/ScheduleSettingsSection.tsx";
const sched = codeOnly(has(SCHED_ROWS) ? read(SCHED_ROWS) : "");
ok(/toggleSchedule\(task\)\.then\(\(result: any\) => setNotice\(/.test(sched),
  "定时任务开关按**结果对象**回执（⛔ 吞错会让外层 then 报出假的「已启用」）");
ok(/setAwake\(on\)\.then\(\(\) => setNotice\([\s\S]{0,300}?\.catch\(\(error: any\) => setNotice\(/.test(sched),
  "「保持电脑唤醒」勾选也有回执（失败更要说 —— 主进程没开成功时电脑照样会睡）");

const MODEL = "src/features/settings-model/ModelSettingsSection.tsx";
const model = codeOnly(has(MODEL) ? read(MODEL) : "");
ok(/saveAppSettings\(\{ autoCompactRatio: v \}\)\.then\(\(\) => setNotice\(/.test(model),
  "自动压缩比例：**落盘成功才报成功**（原来即发即忘 —— 盘上没写成功也照报「已设为 N%」）");
ok(/return \{ ok: false, error: message \}/.test(codeOnly(read("src/hooks/useScheduler.ts"))),
  "useScheduler.toggleSchedule 失败时把原因交回调用方（不是只写页面状态行）");

const RPA = "src/features/settings-rpa/RpaSettingsSection.tsx";
const rpa = codeOnly(has(RPA) ? read(RPA) : "");
ok(/updateTask\(\{ id: task\.id, patch: \{ status: next \} \}\)\.then\([\s\S]{0,700}?setNotice\([\s\S]{0,500}?\.catch\(\(error: any\) => setNotice\(/.test(rpa),
  "RPA 待办开关：完成/恢复都给回执，失败不再 `.catch(() => undefined)` 吞掉");

const BOT = "src/features/app-state/parts/part02/04-runtime-commands-account/02-commands-hooks-account.tsx";
const bot = codeOnly(has(BOT) ? read(BOT) : "");
ok(/botStreamSet\?\.\(next\)[\s\S]{0,200}?\.catch\(\(error: any\) => bag\.setNotice\(/.test(bot)
  && /botsSet\?\.\(next\)[\s\S]{0,200}?\.catch\(\(error: any\) => bag\.setNotice\(/.test(bot),
  "机器人流式/机器人设置：落盘失败必须说出来（原来两个 `.catch(() => undefined)` 把失败吞干净）");

/* ── ⑤ 刷新回执（10-16）────────────────────────────────────────────────
   用户：「检查一下应用现在有的一些，刷新，现在很多刷新都没有弹窗反馈刷新状态」。
   实测清点：全应用 **30 处**用户可点的刷新里，27 处成功静默（点完什么都没发生），
   其中 **6 处连失败都静默**（`.catch(() => undefined)` / `catch { setX(null) }`）。
   口径 = 点刷新当场「正在…」⇒ 结束覆盖「完成」/「失败：原因」—— 与上面 ①② 同源。
   ⛔ 回执**包在按钮上**，不写进 `load()/refresh()` 里：那些函数同时被挂载时的首屏
     `useEffect` 调用，写进函数内部就变成「每开一个设置页弹一次」。 */

/* ⑤-1 纯函数真跑（成功 / 失败 / 抛异常 / 无通道 / 超长截断）—— 断言跑真实现，不看代码长相 */
const RECEIPT = "src/lib/refresh-receipt.mjs";
ok(has(RECEIPT) && has("src/lib/refresh-receipt.d.mts"),
  "回执纯函数与它的 .d.mts 声明都在（⛔ 缺声明 = 32 个调用点集体退化成 any，守卫就白钉了）");
const { refreshWithReceipt } = await import(pathToFileURL(path.join(ROOT, RECEIPT)).href);
const seen = [];
const into = (t) => seen.push(String(t));

seen.length = 0;
let rOk = await refreshWithReceipt(into, "刷新甲", () => undefined);
ok(rOk === true && seen.length === 2 && seen[0] === "正在刷新甲…" && seen[1] === "刷新甲完成",
  "真跑：成功 ⇒「正在…」+「完成」两条、返回 true（⛔ 成功静默就是用户眼里的「点了没反应」）");

seen.length = 0;
rOk = await refreshWithReceipt(into, "刷新乙", () => "后端 500");
ok(rOk === false && seen[1] === "刷新乙失败：后端 500",
  "真跑：失败 ⇒ 带原因、返回 false（这些刷新函数**吞异常**，不看返回值就会把失败报成「完成」并顶掉失败提示）");

seen.length = 0;
rOk = await refreshWithReceipt(into, "刷新丙", () => { throw new Error("炸了"); });
ok(rOk === false && /刷新丙失败：炸了/.test(seen[1]),
  "真跑：run() 抛异常也兜住按失败处理（不冒泡成未处理的 rejection）");

let ran = 0;
rOk = await refreshWithReceipt(undefined, "刷新丁", () => { ran++; return "x"; });
ok(ran === 1 && rOk === "x",
  "回执通道缺省/不是函数 ⇒ 直接跑、不报错（回执是锦上添花，不能卡住刷新本身）");

seen.length = 0;
await refreshWithReceipt(into, "刷新戊", () => "长".repeat(500));
ok(seen[1].length < 200 && seen[1].endsWith("…"),
  "超长原因截断（错误可能是一整段 HTML 或堆栈，不能糊满浮层）");

/* ⑤-2 结构：**每一个**用户可点的刷新入口都过了 refreshWithReceipt。
   ⛔ 棘轮式清单：这是**逐点登记**（文件 + 动作名），删掉任何一处的回执都会红；
     新加刷新入口时把它加进来（漏加 = 又一处静默刷新）。 */
const REFRESH_ENTRIES = [
  ["src/features/knowledge-base/KnowledgeBaseSection.tsx", ["刷新知识库"]],
  ["src/features/expert-market/ExpertMarketSection.tsx", ["刷新技能包列表"]],
  ["src/features/soul-market/SoulMarketSection.tsx", ["刷新人格列表"]],
  ["src/features/free-gateway/FreeGatewayCard.tsx", ["刷新网关状态"]],
  ["src/features/memory/MemoryPanels.tsx", ["重新读取常驻记忆"]],
  ["src/features/memory-ui/MemoryWorkbench.tsx", ["重新读取记忆"]],
  ["src/features/settings-memory/BackendConsolePanel.tsx", ["重新读取后端状态"]],
  ["src/features/settings-devtools/LayaCard.tsx", ["刷新 Laya 状态"]],
  ["src/features/settings-devtools/DomainsPanel.tsx", ["刷新功能域清单"]],
  ["src/features/settings-skills/SkillPoolSection.tsx", ["刷新共享技能池"]],
  ["src/features/settings-skills/SkillsCenterSection.tsx", ["刷新技能市场"]],
  ["src/features/settings-automation/AutomationSettingsSection.tsx", ["检查自动更新"]],
  ["src/features/settings-general/AutoUpdateCard.tsx", ["重新检测组件版本"]],
  ["src/features/storage-settings/StorageSettings.tsx", ["刷新变更列表"]],
  ["src/features/storage-settings/WorkLogsSection.tsx", ["重新扫描工作日志"]],
  ["src/features/settings-pet/PetSettingsSection.tsx", ["重新扫描宠物目录"]],
  ["src/features/relay/RelayCenterPage/01-subscription-banner.tsx", ["刷新中转站状态"]],
  ["src/features/relay/RelayCenterPage/03-manage-modal.tsx", ["刷新账号余额与套餐"]],
  ["src/features/openai/OpenaiSubscriptionPage.tsx", ["刷新额度"]],
  ["src/features/app-view/AppView/03-review-panel.tsx", ["刷新工作区文件"]],
  ["src/features/app-view/AppView/01-sidebar-shell.tsx", ["刷新会话列表"]],
  ["src/features/app-view/AppView/08-settings-sheet/01-settings-layout/02-settings-content.tsx", ["刷新设置资源"]],
  ["src/features/app-view/AppView/04-remote-approval.tsx", ["刷新配对码", "刷新二维码"]],
  ["src/features/app-view/AppView/05-remote-console.tsx", ["刷新配对码"]],
  ["src/features/settings-mcp/McpSettingsSection.tsx", ["刷新 MCP 状态"]],
  ["src/features/settings-hooks/HooksSettingsSection.tsx", ["刷新钩子"]],
  ["src/features/settings-agents/AgentsSettingsSection.tsx", ["刷新子智能体"]],
  ["src/features/settings-teams/TeamsSettingsSection.tsx", ["刷新专家团"]],
  ["src/features/settings-plugins/PluginsMarketSection.tsx", ["刷新插件与市场"]],
  ["src/features/settings-commands/CommandsSettingsSection.tsx", ["刷新命令"]],
];
/* ⛔ 动作名必须**落在 `refreshWithReceipt(...)` 的实参里**（不是"文件里出现过"）：
   裸 `includes(label)` 是恒真型的弱断言 —— 实测（10-16 变异）在标签后面追加一个字，
   或把标签只留在 `title="…"` 属性/别处字面量里，断言照样绿，等于没守。 */
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const receiptLabelNear = (src, label) =>
  new RegExp(`refreshWithReceipt\\([\\s\\S]{0,300}?["'\`]${escRe(label)}["'\`]`).test(src);
let entryMiss = 0;
for (const [file, labels] of REFRESH_ENTRIES) {
  const src = codeOnly(has(file) ? read(file) : "");
  const bad = labels.some((l) => !receiptLabelNear(src, l));
  if (bad) { entryMiss++; console.log(`      ✗ ${file}（缺 refreshWithReceipt 或动作名：${labels.join(" / ")}）`); }
}
ok(entryMiss === 0, `刷新入口逐个登记：${REFRESH_ENTRIES.length} 处全部带三态回执（少一处 = 又一处静默刷新）`);

/* ⑤-3 共享 handler 把成败交回调用方（不吞成返回值 void —— 那样按钮只能瞎报「完成」） */
const SETTINGS_RES = codeOnly(read("src/features/app-state/parts/part04/03-seg/02-browser-queue-settings.tsx"));
ok(/return failures\.length \? failures\.join\("、"\) : ""/.test(SETTINGS_RES),
  "refreshSettingsResources 把子资源的失败原因拼好交回（设置页 8 个刷新按钮共用同一份判定）");
ok(/return market \|\| resources \|\| ""/.test(codeOnly(read("src/features/app-state/parts/part07/01-seg/02-files-market-connectors.tsx"))),
  "插件页聚合刷新继续往上带失败（⛔ 只 `await` 不取返回值 = 市场挂了也报「完成」）");

/* ⑤-4 负向：本轮修掉的「失败也静默」不许复活 */
ok(!/\.catch\(\(\) => setData\(null\)\)/.test(codeOnly(read("src/features/memory/MemoryPanels.tsx"))),
  "⛔ 负向：常驻记忆预览不许回到 `.catch(() => setData(null))`（失败把界面清空、一个字不报）");
ok(!/\.catch\(\(\) => setSkills\(\[\]\)\)/.test(codeOnly(read("src/features/settings-skills/SkillPoolSection.tsx"))),
  "⛔ 负向：技能池不许回到 `.catch(() => setSkills([]))`（失败清空列表 = 看着像「这个项目没有技能」）");
ok(!/catch \{ setStatus\(null\)\s*;?\s*\}/.test(codeOnly(read("src/features/settings-devtools/LayaCard.tsx"))),
  "⛔ 负向：Laya 卡片不许回到 `catch { setStatus(null) }`（点刷新失败时界面「没变化」）");
ok(!/catch \{ setStatus\(null\)\s*;?\s*\}/.test(codeOnly(read("src/features/settings-memory/BackendConsolePanel.tsx"))),
  "⛔ 负向：记忆后端面板不许回到 `catch { setStatus(null) }`");
ok(!/remotePairRotate\(\)\s*\.then\(\(r\) => setPairCode\(r\.code\)\)\s*\.catch\(\(\) => undefined\)/
  .test(codeOnly(read("src/features/app-view/AppView/05-remote-console.tsx"))),
  "⛔ 负向：机器人面板的「换配对码」不许回到 `.catch(() => undefined)`（全仓最典型的静默失败）");

/* ⑤-5 侧栏视图工具条：刷新按钮必须真的在按钮上（10-25 用户实测「会话刷新按键被挤掉了」）。
   ⛔ 上面 ⑤-2 只验「label 落在 refreshWithReceipt 实参里」——按钮被整段删掉时那条仍可能绿，
      所以这里单独锚 JSX 里的 title="刷新会话列表" 与四个工具同排的不换行口径。 */
const sidebarTabsSrc = codeOnly(read("src/features/app-view/AppView/01-sidebar-shell.tsx"));
const tabsCss = codeOnly(read("src/styles/15-queued-messages.css"));
ok(/view-toolbar[\s\S]{0,400}?title="刷新会话列表"/.test(sidebarTabsSrc),
  "⑤-5 侧栏视图工具条保留「刷新会话列表」按钮（重排时被挤掉过 —— 用户点名）");
ok(/\.view-tab \{[^}]*white-space:\s*nowrap/.test(tabsCss),
  "⑤-5 视图 tab 不换行（工具图标同排时，tab 文字会被压成上下两行「项/目」）");

console.log(`\n【notice-feedback】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
