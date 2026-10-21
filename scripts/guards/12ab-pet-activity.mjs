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
import { existsSync, readFileSync } from "node:fs";
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
  ok(stateSrc.includes("freshTitle") && stateSrc.includes("existing.turnId !== nextTurnId"), "回复/steer 追加用户消息时不改原任务标题（只认本轮第一条）");
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
  const expected = ["pet:activity-open", "pet:activity-stop", "pet:activity-reply", "pet:activity-toggle", "pet:open-main", "pet:drag-start", "pet:drag-move", "pet:drag-end"];
  ok(expected.every((channel) => channels.includes(channel)), "manifest 登记 8 条新通道（活动 4 + 主窗 1 + 拖拽 3）");
  ok(expected.every((channel) => preloadSrc.includes(`"${channel}"`)), "preload 生成物包含 8 条新通道（不手改生成物）");
  ok(registrySrc.includes('"pet:activity-open"') && registrySrc.includes("count: 19"), "registry 账本通道数 = 19");
  ok(ipcSrc.includes('ipcHost.handle("pet:activity-open"') && ipcSrc.includes("markPetActivitySeen")
    && ipcSrc.includes('sendToWindow("harness:event", { type: "pet-open-thread"'), "活动「打开」：清已看 → 聚焦主窗 → 发 pet-open-thread");
  ok(ipcSrc.includes('ipcHost.handle("pet:activity-stop"') && ipcSrc.includes('server.request("turn/interrupt"'),
    "活动「停止」：主进程直接 turn/interrupt（主窗没开也能停）");
  ok(ipcSrc.includes('ipcHost.handle("pet:activity-reply"') && ipcSrc.includes('server.request("turn/steer"') && ipcSrc.includes("expectedTurnId"),
    "活动「回复」：主进程 turn/steer 把一句话补进当前回合（不新起回合）");
  ok(ipcSrc.includes('ipcHost.handle("pet:activity-toggle"') && ipcSrc.includes("togglePetActivity()"), "活动收起/展开走主进程状态（两个浮窗同步）");
  ok(ipcSrc.includes('ipcHost.handle("pet:open-main"') && ipcSrc.includes("showMainWindow()"), "工具栏「打开主界面」接 showMainWindow");
  ok(ipcSrc.includes('ipcHost.handle("pet:drag-start"') && ipcSrc.includes("startPetDrag(")
    && ipcSrc.includes('ipcHost.handle("pet:drag-move"') && ipcSrc.includes("movePet(")
    && ipcSrc.includes('ipcHost.handle("pet:drag-end"') && ipcSrc.includes("endPetDrag("), "拖拽三条通道全部接到窗口层");
  ok(petActivitySrc.includes("petActivityOpen") && petActivitySrc.includes("petActivityStop") && petActivitySrc.includes("petActivityReply")
    && petActivitySrc.includes("正在执行") && petActivitySrc.includes("本轮已完成") && petActivitySrc.includes("回复当前任务"), "活动气泡 UI：状态文案 + 回复/停止/打开真调用");
  ok(petFloatSrc.includes("petOpenMain()") && petFloatSrc.includes("petActivityToggle()") && petFloatSrc.includes("petDragStart(")
    && petFloatSrc.includes("petDragMove(") && petFloatSrc.includes("petDragEnd("), "宠物浮窗：工具栏三键 + 手动拖拽三通道");
  ok(petFloatSrc.includes("running-right") && petFloatSrc.includes("running-left") && petFloatSrc.includes("jumping"),
    "拖动方向反馈：左右跑 / 竖向跳");
  ok(petFloatSrc.includes("showSheetLook") && petFloatSrc.includes("pkg.rows >= 11") && petFloatSrc.includes("lookDirection")
    && petFloatSrc.includes("showAnimationLook") && petFloatSrc.includes("pkg.lookFrameSet?.length === 16"),
    "看鼠标：v2 图集切 16 向帧，动画包切 lookFrameSet，v1 用 CSS 轻倾兜底");
  ok((petFloatSrc.match(/show(?:Sheet|Animation)Look = Boolean\(/g) || []).length === 2
    && (petFloatSrc.match(/effectiveState === "idle"/g) || []).length >= 2,
    "看帧只在 idle 生效（工作时抱电脑的动画不会被看帧换成站姿）");
  ok(petFloatSrc.includes("GREETING_MS") && petFloatSrc.includes("waving"), "打开后先挥手 2.6s（Qoder 同款问候）");
  ok(!petCss.includes("-webkit-app-region: drag") && petCss.includes(".pet-toolbar") && petCss.includes(".pet-activity-card"),
    "样式：移除 app-region 拖动，加入悬停工具栏与活动卡");
  ok(mainTsx.includes('petSurface === "activity"') && mainTsx.includes("<PetActivity />"), "main.tsx 按 ?pet=activity 渲染活动气泡");
  ok(appEvents.includes('event.type === "pet-open-thread"') && appEvents.includes("openThread(tid)"), "主窗收到 pet-open-thread 会切到对应会话");
}

/* ── 五、美术替代：30fps 动画包 + 16 向看帧（10-21 第二轮）───────────────── */
const settingsPetSrc = codeOnly(read("src/features/settings-pet/PetSettingsSection.tsx"));
{
  const metaPath = join(ROOT, "public", "pets", "harness-fox", "pet.json");
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  const dir = join(ROOT, "public", "pets", "harness-fox");
  const STATES = ["idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review"];
  const vp8xSize = (buf) => {
    if (buf.length < 30 || buf.subarray(0, 4).toString() !== "RIFF" || buf.subarray(8, 12).toString() !== "WEBP") return null;
    if (buf.subarray(12, 16).toString() !== "VP8X") return null;
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  };
  const countTag = (buf, tag) => {
    let at = 0;
    let n = 0;
    while ((at = buf.indexOf(tag, at)) !== -1) { n++; at += 4; }
    return n;
  };
  const firstAnmf = (buf) => {
    const at = buf.indexOf("ANMF");
    if (at < 0 || at + 24 > buf.length) return null;
    return { duration: buf.readUIntLE(at + 20, 3), width: (buf.readUIntLE(at + 14, 3) + 1) * 2, height: (buf.readUIntLE(at + 17, 3) + 1) * 2 };
  };

  ok(ipcSrc.includes('active: "harness-fox"') && /active: typeof value\.active[\s\S]{0,140}?DEFAULT_SETTINGS\.active/.test(ipcSrc),
    "默认宠物 = 阿焰（harness-fox；老档案 active 为空也回落到它，已有用户显式选别的宠物不被改写）");
  ok(petFloatSrc.includes("pkg?.animationSet") && petFloatSrc.includes("if (pkg?.animationSet) return;"),
    "动画包走 <img> 自己播，图集帧循环按 animationSet 早退（两套格式互不打架）");
  ok(/\}, \[pkg\?\.columns, pkg\?\.animationSet\]\);/.test(petFloatSrc),
    "帧循环依赖含 animationSet（切包时能取消/重启，否则切回图集同列数会冻结）");
  ok(petFloatSrc.includes('className={`pet-sprite${pkg.animationSet ? " pet-sprite-anim" : ""}`}')
    && petFloatSrc.includes("backgroundImage: pkg.animationSet ? undefined :"),
    "动画包不挂 background-image（图集切帧路径保持原样）");
  ok(petFloatSrc.includes("<picture>") && petFloatSrc.includes('media="(prefers-reduced-motion: reduce)"') && petFloatSrc.includes("animationStill"),
    "减少动效偏好回落静帧（<picture> source，不靠 JS 判断）");
  ok(ipcSrc.includes("animationSet") && ipcSrc.includes("lookFrameSet") && ipcSrc.includes("function resolvePetFile")
    && ipcSrc.includes("abs.startsWith(root + path.sep)"),
    "主进程解析动画包，且素材路径被限制在宠物目录内（防目录穿越）");
  ok(ipcSrc.includes('missing.push("lookFrameSet（必须 16 个有效文件）")') && ipcSrc.includes("problem: missing.length"),
    "缺帧/缺文件显式报 problem（不静默空白，设置页照实显示）");

  ok(JSON.stringify(meta.states) === JSON.stringify(STATES) && meta.fps === 30 && meta.supportsLookTracking === true,
    "pet.json：九态顺序 = 官方规范、声明 30fps、支持看鼠标");
  ok(meta.animationSet && Object.keys(meta.animationSet).length === 9
    && Object.values(meta.animationSet).every((entry) => entry && entry.animatedSrc && entry.stillSrc),
    "animationSet 九态全齐（每态 animatedSrc + stillSrc）");

  const bad = [];
  let totalBytes = 0;
  for (const state of STATES) {
    const entry = meta.animationSet?.[state];
    for (const key of ["animatedSrc", "stillSrc"]) {
      const file = entry && join(dir, String(entry[key] ?? ""));
      if (!entry || !existsSync(file)) { bad.push(`${state}.${key} 缺失`); continue; }
      const buf = readFileSync(file);
      totalBytes += buf.length;
      const size = vp8xSize(buf);
      if (!size || size.width !== 192 || size.height !== 208) bad.push(`${state}.${key} 尺寸 ${size ? `${size.width}x${size.height}` : "非 WebP"}`);
      if (key === "animatedSrc") {
        const frames = countTag(buf, "ANMF");
        const head = firstAnmf(buf);
        if (frames < 10) bad.push(`${state} 只有 ${frames} 帧`);
        if (!head || head.duration !== 33) bad.push(`${state} 首帧时长 ${head ? head.duration : "?"}ms（应为 33ms ≈ 30fps）`);
      }
    }
  }
  ok(bad.length === 0, `九态动画与静帧全部合规（192×208 / ≥10 帧 / 33ms；问题：${bad.slice(0, 6).join("、") || "无"}）`);

  const lookMissing = [];
  for (let i = 0; i < 16; i++) {
    const file = join(dir, `look-${String(i).padStart(2, "0")}.webp`);
    if (!existsSync(file)) { lookMissing.push(`look-${i} 缺失`); continue; }
    const buf = readFileSync(file);
    totalBytes += buf.length;
    const size = vp8xSize(buf);
    if (!size || size.width !== 192 || size.height !== 208) lookMissing.push(`look-${i} 尺寸异常`);
  }
  ok(Array.isArray(meta.lookFrameSet) && meta.lookFrameSet.length === 16 && lookMissing.length === 0,
    `16 向看帧全部存在且 192×208（问题：${lookMissing.join("、") || "无"}）`);
  ok(totalBytes > 0 && totalBytes <= 4 * 1024 * 1024,
    `整包体积受控（实测 ${(totalBytes / 1024 / 1024).toFixed(1)}MB ≤ 4MB，不为美术再翻倍）`);
  ok(settingsPetSrc.includes("pkg.animationSet?.idle?.stillSrc") && settingsPetSrc.includes('"contain"'),
    "设置页缩略图用 idle 静帧（动画包没有图集可切）");
  ok(petCss.includes(".pet-sprite-anim img") && petCss.includes("object-fit: contain"),
    "动画帧铺满本体且不拦截指针（object-fit: contain）");
}

console.log(`\n【pet-activity】${checks - fails}/${checks} 通过${fails ? ` —— ${fails} 条红` : ""}`);
process.exit(fails ? 1 : 0);
