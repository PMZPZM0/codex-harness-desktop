/**
 * 桌面宠物 · 活动投影纯函数（主进程归约与守卫共用，2026-10-21）。
 *
 * Qoder 的桌宠不是「一个状态 + 一句气泡」，而是把每个会话投影成一条活动：
 *   waiting（等你处理）> running（执行中）> failed/interrupted > completed（本轮完成，等你看）
 *   ⛔ 这里只产出**相位**（completed 仍是 review，活动/气泡要留到已看）；
 *      宠物**姿态**多久回 idle 由 electron/features/pet-state.ts 的 REVIEW_HOLD_MS 管。
 * 宠物演最高优先级那条；活动气泡展示前两条。这里只放**纯函数**（无 Electron / 无 React），
 * 便于主进程与守卫同时 import、直接跑真值表。
 */

/** 状态优先级：数字越小越优先（与 Qoder `kMe` 同口径）。 */
export const PET_ACTIVITY_PRIORITY = Object.freeze({
  waiting: 0,
  running: 1,
  failed: 2,
  interrupted: 2,
  completed: 3,
});

/** 引擎 item 类型是 PascalCase（`CommandExecution` / `UserMessage`），内部统一成 camelCase。 */
export function normalizePetItemType(type) {
  const value = String(type ?? "");
  return value ? value[0].toLowerCase() + value.slice(1) : "";
}

/** 从 UserMessage / AgentMessage 的 content 里取正文（引擎 content part 的 type 是 `Text`）。 */
export function petItemText(item) {
  if (!item || typeof item !== "object") return "";
  const content = item.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      if (typeof part.text === "string" && part.text.trim()) return part.text;
    }
  }
  if (typeof item.text === "string" && item.text.trim()) return item.text;
  if (typeof item.message === "string" && item.message.trim()) return item.message;
  return "";
}

/** 任务标题：用户第一句的非空行，去掉 Markdown 前缀，最多 42 字。 */
export function petTitleFromText(text, fallback = "当前任务") {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[#>*+\-\d.\s]+/, "").trim())
    .filter(Boolean);
  const title = (lines[0] ?? "").replace(/[`*_~]/g, "").trim();
  if (!title) return fallback;
  return title.length > 42 ? `${title.slice(0, 41)}…` : title;
}

/** 活动详情：取正文最后一条非空行（Qoder 同款「最近一句」口径）。 */
export function petDetailFromText(text, max = 96) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[#>*+\-\d.\s]+/, "").replace(/[`*_~]/g, "").trim())
    .filter(Boolean);
  const line = lines.at(-1) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** 工具运行时给活动气泡的一句短说明（⛔ 不带文件正文/完整命令）。 */
export function petToolDetail(item) {
  const type = normalizePetItemType(item?.type);
  switch (type) {
    case "commandExecution": {
      const raw = Array.isArray(item?.command)
        ? [...item.command].reverse().find((part) => typeof part === "string" && part.trim())
        : item?.command;
      const command = String(raw ?? "").replace(/\s+/g, " ").trim();
      return command ? `正在执行 · ${command.length > 64 ? `${command.slice(0, 63)}…` : command}` : "正在执行命令…";
    }
    case "fileChange":
      return "正在修改文件…";
    case "webSearch": {
      const query = String(item?.query ?? "").trim();
      return query ? `正在搜索 · ${query.slice(0, 40)}` : "正在联网找资料…";
    }
    case "mcpToolCall":
    case "dynamicToolCall":
      return `正在使用 ${String(item?.tool ?? item?.server ?? "工具").slice(0, 28)}`;
    case "reasoning":
      return "正在推演…";
    case "agentMessage":
      return "正在写回复…";
    default:
      return "干活中…";
  }
}

/** 多会话活动 → 宠物相位（waiting > running > failed/interrupted > completed→review > idle）。 */
export function petPhaseOfActivities(activities) {
  const list = Array.isArray(activities) ? activities : [];
  if (list.some((item) => item?.status === "waiting")) return "waiting";
  if (list.some((item) => item?.status === "running")) return "running";
  if (list.some((item) => item?.status === "failed" || item?.status === "interrupted")) return "failed";
  if (list.some((item) => item?.status === "completed")) return "review";
  return "idle";
}

/** 气泡左上角提醒：有待处理 → pending；有失败 → error。 */
export function petAttentionOfActivities(activities) {
  const list = Array.isArray(activities) ? activities : [];
  if (list.some((item) => item?.status === "waiting")) return "pending";
  if (list.some((item) => item?.status === "failed")) return "error";
  return "";
}

/** 活动列表稳定排序：优先级高的在前，同优先级按更新时间倒序。 */
export function sortPetActivities(activities) {
  return [...(Array.isArray(activities) ? activities : [])].sort((a, b) => {
    const priority = (PET_ACTIVITY_PRIORITY[a?.status] ?? 9) - (PET_ACTIVITY_PRIORITY[b?.status] ?? 9);
    return priority !== 0 ? priority : Number(b?.updatedAt ?? 0) - Number(a?.updatedAt ?? 0);
  });
}

/** 主进程推送去重用的签名（活动气泡只关心这几个字段）。 */
export function petActivitySignature(activities) {
  return (Array.isArray(activities) ? activities : [])
    .map((item) => `${item.threadId}|${item.turnId}|${item.title}|${item.status}|${item.detail}|${item.updatedAt}`)
    .join(";");
}
