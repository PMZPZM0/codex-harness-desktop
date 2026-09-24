/**
 * app-view/helpers/text（09-22 架构改造：从 helpers.tsx 按功能域拆出，纯搬迁）
 *
 * 域：时间与文案格式化（相对时间 / 计划描述 / 模型徽标 / 运行短语）
 * 符号（21）：fmtImportTime / prettifyHookLabel / noticeTone / modelName / botChannelName / botOnlineOf / localFormatDurationMs / isActivityItem / formatTimestamp / timeAgo / ago / uniqueModelCount / clampRruleNum / describeRrule / describeSchedule / greetingForHour / modelBadges / pickRunPhrase / pickRunPhraseExact / pluginDisplayName / pluginDescription
 *
 * 代码与拆分前逐字一致；依赖边经 AST 依赖图核对，**不跨模块** ⇒ 本文件不 import 同目录其他模块。
 */
import { matchModelSpec, formatTokenCount } from "../../../lib/model-specs";
import { ThreadItem } from "../../../lib/thread-item";
import { CHANNEL_STATUS_KEY, HOOK_EVENT_LABELS, RRULE_DAY_NAMES, RUN_PHRASES, RUN_PHRASES_BY_ACTIVITY } from "../constants";
import type { Model } from "../types";



export function fmtImportTime(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return iso; }
}

export function prettifyHookLabel(raw: string): string {
  // 剥掉事件名/序号后面跟的盘符路径（C:\... 或 D:/...，可能含空格直到串尾）
  const stripped = (raw || "").replace(/\s*[A-Za-z]:[\\/].*$/, "").trim() || raw;
  const match = stripped.match(/^([A-Za-z0-9_-]+?)[\s:_]*(\d+)?$/);
  if (!match) return stripped;
  const label = HOOK_EVENT_LABELS[match[1].toLowerCase()] ?? match[1];
  return match[2] ? `${label} #${match[2]}` : label;
}

export function noticeTone(text: string): "success" | "error" | "warning" | "info" {
  if (/失败|错误|无效|无法|不存在|请先|剪贴板中没有|不能为空/i.test(text)) return "error";
  if (/已复制|已保存|已安装|已卸载|已切换|已生效|成功|已发送|已提供|已开启|已关闭|已更新|已重命名|已创建|已启动/i.test(text)) return "success";
  if (/警告|注意|即将|可能|建议|重试|部分/.test(text)) return "warning";
  return "info";
}

export function modelName(value: string) {
  return value.startsWith("custom:") ? value.split(":").slice(2).join(":") : value;
}

export /** 机器人渠道中文名（bot-detail 已连接卡等处展示用） */
function botChannelName(channel: string) {
  return channel === "wechat" ? "微信" : channel === "feishu" ? "飞书" : channel === "telegram" ? "Telegram" : channel === "dingtalk" ? "钉钉" : channel === "wecom-webhook" ? "企微推送" : channel === "qq" ? "QQ 机器人" : "";
}

export function botOnlineOf(bot: { channel: string; enabled: boolean }, channelOnline: Record<string, boolean | undefined>) {
  if (!bot.channel) return false;
  return Boolean(channelOnline[CHANNEL_STATUS_KEY[bot.channel] ?? bot.channel]);
}

export function localFormatDurationMs(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "";
  if (milliseconds < 1000) return `${Math.max(1, Math.round(milliseconds))} 毫秒`;
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${(milliseconds / 1000).toFixed(milliseconds >= 10_000 ? 0 : 1)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainder}s`;
}

export function isActivityItem(item: ThreadItem) {
  return item.type !== "userMessage" && item.type !== "agentMessage" && item.type !== "reasoning";
}

export function formatTimestamp(value: unknown) {
  const timestamp = typeof value === "number" ? value : Number(value);
  return Number.isFinite(timestamp) ? new Date(timestamp * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "";
}

export /** 把图片显示源的 path 还原成本地文件路径；非本地（http/data/相对）返回 null。
 *  支持三种形态：本地绝对路径、harness-image://（双编码）、http(s) URL（返回 null 走外部打开）。 */

function timeAgo(timestamp: number) {
  const seconds = Math.max(0, Date.now() / 1000 - timestamp);
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return new Date(timestamp * 1000).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

export function ago(ts: number) {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - ts / 1000));
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  return `${Math.floor(seconds / 3600)} 小时前`;
}

export function uniqueModelCount(models: { id: string }[] | undefined) {
  if (!models?.length) return 0;
  const seen = new Set<string>();
  for (const m of models) if (m?.id) seen.add(m.id);
  return seen.size;
}

export function clampRruleNum(value: string | undefined, min: number, max: number, fallback: number) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function describeRrule(rrule: string) {
  const map = new Map<string, string>();
  for (const pair of (rrule || "").split(";")) {
    const [key, value] = pair.split("=");
    if (key && value) map.set(key.trim().toUpperCase(), value.trim().toUpperCase());
  }
  const freq = map.get("FREQ") || "DAILY";
  const interval = clampRruleNum(map.get("INTERVAL"), 1, 999, 1);
  const hour = String(clampRruleNum(map.get("BYHOUR"), 0, 23, 9)).padStart(2, "0");
  const minute = String(clampRruleNum(map.get("BYMINUTE"), 0, 59, 0)).padStart(2, "0");
  const time = `${hour}:${minute}`;
  if (freq === "HOURLY") return interval <= 1 ? "每小时" : `每 ${interval} 小时`;
  if (freq === "DAILY") return `每天 ${time}`;
  if (freq === "WEEKLY") {
    const days = (map.get("BYDAY") ?? "").split(",").map((day) => RRULE_DAY_NAMES[day.trim().toUpperCase()] ?? day.trim()).filter(Boolean);
    if (days.length === 7) return interval > 1 ? `每 ${interval} 周 · 每天 ${time}` : `每天 ${time}`;
    const head = interval > 1 ? `每 ${interval} 周` : "每周";
    return days.length ? `${head} ${days.join("、")} ${time}` : `${head} ${time}`;
  }
  if (freq === "MONTHLY") return `每月 ${clampRruleNum(map.get("BYMONTHDAY"), 1, 31, 1)} 日 ${time}`;
  if (freq === "YEARLY") return `每年 ${clampRruleNum(map.get("BYMONTH"), 1, 12, 1)} 月 ${clampRruleNum(map.get("BYMONTHDAY"), 1, 31, 1)} 日 ${time}`;
  return freq.toLowerCase();
}

export function describeSchedule(task: { kind?: string; timeOfDay?: string; weekdays?: number[]; intervalMinutes: number; rrule?: string; scheduleType?: string; scheduledAt?: string; monthDay?: number; month?: number }) {
  if (task.rrule) return describeRrule(task.rrule);
  if (task.scheduleType === "once" || task.kind === "once") {
    const at = task.scheduledAt;
    return at ? `一次性 ${at.replace("T", " ").slice(5, 16)}` : "一次性";
  }
  const time = task.timeOfDay ?? "09:00";
  if (task.kind === "daily") return "每天 " + time;
  if (task.kind === "weekly") return "每周" + (task.weekdays ?? [1]).map((day) => "日一二三四五六"[day]).join("、") + " " + time;
  if (task.kind === "monthly") return `每月 ${task.monthDay ?? 1} 日 ${time}`;
  if (task.kind === "yearly") return `每年 ${task.month ?? 1} 月 ${task.monthDay ?? 1} 日 ${time}`;
  if (task.intervalMinutes % 60 === 0) return task.intervalMinutes === 60 ? "每小时" : `每 ${task.intervalMinutes / 60} 小时`;
  return `每 ${task.intervalMinutes} 分钟`;
}

export /** 按时段返回问候语 */
function greetingForHour(hour: number): string {
  if (hour < 5) return "夜深了";
  if (hour < 9) return "早上好";
  if (hour < 12) return "上午好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  if (hour < 22) return "晚上好";
  return "夜深了";
}

export /** 下拉菜单一行：title 主文案、desc 次要说明、badges 右侧徽标（模型菜单标 图片/视频/额度）。 */


/** 模型下拉右侧徽标：图片/视频（能不能看图）+ 上下文 + 输出。数据取该模型生效值。 */
function modelBadges(model: Model): { text: string; kind?: "vision" | "video" }[] {
  const spec = matchModelSpec(model.model);
  const inputs = model.inputTypes ?? spec?.inputTypes ?? [];
  const ctx = model.contextWindow ?? spec?.contextWindow;
  const out = model.maxOutputTokens ?? spec?.maxOutputTokens;
  const badges: { text: string; kind?: "vision" | "video" }[] = [];
  if (inputs.includes("image")) badges.push({ text: "图片", kind: "vision" });
  if (inputs.includes("video")) badges.push({ text: "视频", kind: "video" });
  if (ctx) badges.push({ text: `${formatTokenCount(ctx)} 上下文` });
  if (out) badges.push({ text: `出 ${formatTokenCount(out)}` });
  return badges;
}

export /** 取一句：专属池在前、通用池兜底；专属句更少，所以自然以通用句为主。 */
function pickRunPhrase(activity: string): string {
  const pool = [...(RUN_PHRASES_BY_ACTIVITY[activity] ?? []), ...RUN_PHRASES];
  return pool[Math.floor(Math.random() * pool.length)] ?? "";
}

export /** 只从专属池取一句（**不过通用池**）：给语义必须精确的状态用 —— 通用池里有
 *  「正在把改动收拢干净」「正在给答案做最后一遍质检」这类**干活句**，用在「正文已经
 *  给完了，只是在等上游结束信号」上会让人以为还在干活（09-18 真机验收实测）。 */
function pickRunPhraseExact(activity: string): string {
  const pool = RUN_PHRASES_BY_ACTIVITY[activity] ?? [];
  return pool[Math.floor(Math.random() * pool.length)] ?? activity;
}

export /** 通知分级：按文案判定语气——失败/错误红、成功/已完成绿、其余中性。
 * 覆盖全部 setNotice 调用点，无需逐个改调用方 */
/** 机器人渠道绑定卡：
 * 微信 → 腾讯官方 iLink bot 协议（真微信机器人：get_bot_qrcode 出微信可扫的码 → confirmed 拿 token → 微信里直接聊）
 * 其他渠道 → 控制端绑定码（手机扫码确认后作为该机器人的控制端） */

/** 二维码是否为图片源（data URL / http URL / 裸 base64 图片），否则视为 SVG 字符串 */

/** 插件展示名：优先用市场声明的 displayName，其次回落到 id/name */
function pluginDisplayName(plugin: any): string {
  return String(plugin?.interface?.displayName || plugin?.name || plugin?.id || "未命名插件");
}

export function pluginDescription(plugin: any): string {
  return String(plugin?.interface?.shortDescription || plugin?.interface?.longDescription || plugin?.description || "这个插件没有提供描述。");
}