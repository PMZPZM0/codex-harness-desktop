/**
 * 桌面宠物 · Qoder 式「活动气泡 + 持久状态」判据（10-21 立）
 *
 * 用户对照 Qoder：「宠物比我们好看很多，事件驱动和对应状态效果比我们好很多」。
 * 本轮先做行为层（不动美术）：每会话一条活动、waiting>running>failed>completed→review、
 * 独立活动气泡窗、打开/停止、悬停工具栏、手动拖拽方向反馈、看鼠标。
 *
 * 失效方式：退化成「一个状态 + 一句 4 秒气泡」/ completed 又自动回 idle / 活动窗塞进宠物窗 /
 * 拖拽又回到 app-region（拿不到 pointermove）/ 活动气泡按钮没有真接线。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { codeOnly } from "./_ctx.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
let checks = 0;
let fails = 0;
const ok = (condition, message) => {
  checks++;
  console.log(`  ${condition ? "✓" : "✗"} 【pet-activity】${message}`);
  if (!condition) fails++;
};

/* ── 一、纯函数真跑：状态优先级 / 标题 / 详情 / 工具文案 ───────────────── */
const lib = await import("../../src/lib/pet-activity.mjs");
{
  const waiting = { status: "waiting", updatedAt: 1 };
  const running = { status: "running", updatedAt: 9 };
  const completed = { status: "completed", updatedAt: 10 };
  ok(lib.petPhaseOfActivities([completed]) === "review", "completed → review（本轮完成等你看，不是回 idle）");
  ok(lib.petPhaseOfActivities([completed, running]) === "running", "running 优先于 completed");
  ok(lib.petPhaseOfActivities([running, waiting]) === "waiting", "waiting 优先于 running（需要用户操作最高）");
  ok(lib.petPhaseOfActivities([completed, { status: "failed" }]) === "failed", "failed 优先于 completed");
  ok(lib.petPhaseOfActivities([]) === "idle", "没有活动 → idle");
  ok(lib.petAttentionOfActivities([waiting, { status: "failed" }]) === "pending"
    && lib.petAttentionOfActivities([{ status: "failed" }]) === "error"
    && lib.petAttentionOfActivities([running]) === "", "attention：pending > error > 空");
  ok(lib.normalizePetItemType("CommandExecution") === "commandExecution"
    && lib.normalizePetItemType("UserMessage") === "userMessage", "引擎 PascalCase item 类型统一归一");
  const userText = lib.petItemText({ type: "UserMessage", content: [{ type: "Text", text: "帮我修一下登录\n第二行" }] });
  const firstLine = userText.split("\n")[0].trim();
  ok(lib.petTitleFromText(userText) === firstLine, `从 UserMessage.content 提取标题（引擎 part.type = Text 也要吃；实际 title=${JSON.stringify(lib.petTitleFromText(userText))}）`);
  ok(lib.petDetailFromText("第一行\n第二行") === "第二行", "活动详情取最后一条非空行");
  ok(lib.petToolDetail({ type: "CommandExecution", command: ["pwsh", "-Command", "Get-Content a.txt"] }).includes("正在执行")
    && lib.petToolDetail({ type: "FileChange" }) === "正在修改文件…"
    && lib.petToolDetail({ type: "WebSearch", query: "qoder pet" }).includes("qoder pet"), "工具 → 中文短句（命令/改文件/搜索）");
  const sorted = lib.sortPetActivities([completed, running, waiting]);
  ok(sorted[0].status === "waiting" && sorted[1].status === "running" && sorted[2].status === "completed", "活动按优先级稳定排序");
  ok(lib.petActivitySignature([{ threadId: "t", turnId: "u", title: "a", status: "running", detail: "d", updatedAt: 1 }]).includes("t|u|a|running|d|1"),
    "推送签名包含活动全部展示字段（改了就要推）");
}

/* ── 二、主进程归约：每会话活动 + 持久 review/failed + 请求等待 ─────────── */
const stateSrc = codeOnly(read("electron/features/pet-state.ts"));
{
  ok(stateSrc.includes("new Map<string, ActivityRecord>()") && stateSrc.includes("threadIdOf(") && stateSrc.includes("turnIdOf("),
    "活动按 threadId 存储，回合 id 用 turnIdOf 宽容取");
  ok(stateSrc.includes("petPhaseOfActivities") && stateSrc.includes("petAttentionOfActivities") && stateSrc.includes("petActivitySignature"),
    "状态/提醒/推送去重都走纯函数（不在归约里另写一套）");
  ok(stateSrc.includes("normalizePetItemType(item.type)") && stateSrc.includes("commandExecution") && !stateSrc.includes("TOOL_ITEM_TYPES"),
    "item 类型先归一（旧实现 camelCase 匹配 PascalCase = 工具事件全漏）");
  ok(stateSrc.includes('status: "completed"') && stateSrc.includes('pulseMotion("jumping"') && stateSrc.includes("markPetActivitySeen"),
    "turn/completed 落 completed（review 持久），只做一次 jumping 动作覆盖");
  ok(stateSrc.includes('status: "failed"') && stateSrc.includes('status: "interrupted"') && stateSrc.includes("isTurnEndMethod"),
    "失败/中断落 failed/interrupted（不自动回 idle）");
  ok(stateSrc.includes("pendingRequests") && stateSrc.includes("serverRequest/resolved") && stateSrc.includes('status: "waiting"'),
    "审批/提问 → waiting；serverRequest/resolved 后回 running");
  ok(stateSrc.includes("DETAIL_THROTTLE_MS") && stateSrc.includes("item/agentMessage/delta"), "流式正文详情有节流（不高频刷推送）");
  ok(stateSrc.includes("COMPLETED_TTL_MS") && stateSrc.includes("MAX_ACTIVITIES"), "完成项有 TTL / 活动数量有上限（不会无限堆）");
  ok(!stateSrc.includes("holdUntil") && !/current === "review"[\s\S]{0,120}?setState\("idle"\)/.test(stateSrc),
    "负向：不许回到「review/failed 到点自动抹成 idle」的旧模型");
  ok(stateSrc.includes("export function togglePetActivity") && stateSrc.includes("export function petActivityRecord")
    && stateSrc.includes("export function petActivityCollapsed"), "活动收起/停止记录查询有导出（IPC 用）");
}

/* ── 三、窗口层：独立活动窗 + 跟随宠物 + 手动拖拽 ───────────────────────── */
const winSrc = codeOnly(read("electron/features/pet-window.ts"));
{
  ok(winSrc.includes("activityWindow") && winSrc.includes("ACTIVITY_WIDTH = 320") && winSrc.includes("ACTIVITY_CARD_HEIGHT = 82"),
    "活动气泡是独立窗口（320px 宽，卡片高度与 CSS 82px 对齐）");
  ok(winSrc.includes('query: { pet: "activity" }') && winSrc.includes("pet=activity") && winSrc.includes("focusable: true"),
    "活动窗加载 ?pet=activity，且可聚焦（按钮/输入可点）");
  ok(winSrc.includes("positionPetActivityWindow") && winSrc.includes("petBounds.x + petBounds.width / 2")
    && winSrc.includes("petBounds.y - size.height"), "活动窗贴宠物上方居中，并夹进工作区");
  ok(winSrc.includes("syncPetActivityWindow") && winSrc.includes("signal.activityCollapsed") && winSrc.includes("signal.activities.length === 0"),
    "无活动/收起/宠物隐藏时活动窗不出现");
  ok(winSrc.includes("startPetDrag") && winSrc.includes("movePet") && winSrc.includes("endPetDrag")
    && winSrc.includes("petDragging") && winSrc.includes("setBounds"), "手动拖动：指针捕获 → 主进程 setBounds（能拿到方向反馈）");
  ok(winSrc.includes("if (petDragging) inside = true"), "拖动期间强制可交互（否则窗口跟随移动时会被判穿透、丢 pointer 事件）");
  ok(!winSrc.includes("registerBusWindow"), "负向：宠物/活动窗不登记 window-bus");
}

/* ── 四、IPC / preload / 渲染层动作真实接线 ─────────────────────────────── */
const ipcSrc = codeOnly(read("electron/features/pet-ipc.ts"));
const preloadSrc = read("electron/preload.ts");
const manifestSrc = JSON.parse(read("electron/ipc-channels.manifest.json"));
const registrySrc = read("electron/ipc-registry.ts");
const petActivitySrc = codeOnly(read("src/features/pet/PetActivity.tsx"));
const petFloatSrc = codeOnly(read("src/features/pet/PetFloat.tsx"));
const mainTsx = codeOnly(read("src/main.tsx"));
const appEvents = codeOnly(read("src/features/app-state/parts/part05/01-seg.tsx"));
const petCss = read("src/styles/22-pet.css");
{
  const channels = (manifestSrc.channels ?? []).map((entry) => entry.channel);
  const expected = ["pet:activity-open", "pet:activity-stop", "pet:activity-toggle", "pet:open-main", "pet:drag-start", "pet:drag-move", "pet:drag-end"];
  ok(expected.every((channel) => channels.includes(channel)), "manifest 登记 7 条新通道（活动 3 + 主窗 1 + 拖拽 3）");
  ok(expected.every((channel) => preloadSrc.includes(`"${channel}"`)), "preload 生成物包含 7 条新通道（不手改生成物）");
  ok(registrySrc.includes('"pet:activity-open"') && registrySrc.includes("count: 18"), "registry 账本通道数 = 18");
  ok(ipcSrc.includes('ipcHost.handle("pet:activity-open"') && ipcSrc.includes("markPetActivitySeen")
    && ipcSrc.includes('sendToWindow("harness:event", { type: "pet-open-thread"'), "活动「打开」：清已看 → 聚焦主窗 → 发 pet-open-thread");
  ok(ipcSrc.includes('ipcHost.handle("pet:activity-stop"') && ipcSrc.includes('server.request("turn/interrupt"'),
    "活动「停止」：主进程直接 turn/interrupt（主窗没开也能停）");
  ok(ipcSrc.includes('ipcHost.handle("pet:activity-toggle"') && ipcSrc.includes("togglePetActivity()"), "活动收起/展开走主进程状态（两个浮窗同步）");
  ok(ipcSrc.includes('ipcHost.handle("pet:open-main"') && ipcSrc.includes("showMainWindow()"), "工具栏「打开主界面」接 showMainWindow");
  ok(ipcSrc.includes('ipcHost.handle("pet:drag-start"') && ipcSrc.includes("startPetDrag(")
    && ipcSrc.includes('ipcHost.handle("pet:drag-move"') && ipcSrc.includes("movePet(")
    && ipcSrc.includes('ipcHost.handle("pet:drag-end"') && ipcSrc.includes("endPetDrag("), "拖拽三条通道全部接到窗口层");
  ok(petActivitySrc.includes("petActivityOpen") && petActivitySrc.includes("petActivityStop")
    && petActivitySrc.includes("正在执行") && petActivitySrc.includes("本轮已完成"), "活动气泡 UI：状态文案 + 打开/停止真调用");
  ok(petFloatSrc.includes("petOpenMain()") && petFloatSrc.includes("petActivityToggle()") && petFloatSrc.includes("petDragStart(")
    && petFloatSrc.includes("petDragMove(") && petFloatSrc.includes("petDragEnd("), "宠物浮窗：工具栏三键 + 手动拖拽三通道");
  ok(petFloatSrc.includes("running-right") && petFloatSrc.includes("running-left") && petFloatSrc.includes("jumping"),
    "拖动方向反馈：左右跑 / 竖向跳");
  ok(petFloatSrc.includes("showLookFrame") && petFloatSrc.includes("pkg.rows >= 11") && petFloatSrc.includes("lookDirection"),
    "v2 包（11 行）悬停直接切 16 向看帧；v1 用 CSS 轻倾兜底");
  ok(petFloatSrc.includes("GREETING_MS") && petFloatSrc.includes("waving"), "打开后先挥手 2.6s（Qoder 同款问候）");
  ok(!petCss.includes("-webkit-app-region: drag") && petCss.includes(".pet-toolbar") && petCss.includes(".pet-activity-card"),
    "样式：移除 app-region 拖动，加入悬停工具栏与活动卡");
  ok(mainTsx.includes('petSurface === "activity"') && mainTsx.includes("<PetActivity />"), "main.tsx 按 ?pet=activity 渲染活动气泡");
  ok(appEvents.includes('event.type === "pet-open-thread"') && appEvents.includes("openThread(tid)"), "主窗收到 pet-open-thread 会切到对应会话");
}

console.log(`\n【pet-activity】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
