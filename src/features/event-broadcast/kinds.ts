/**
 * 播报类型的展示映射（图标 / 标签 / 色调）。
 * ⛔ 新增 `BroadcastKind` 时**只改这里**（store 的联合类型 + 这张表），Pod 气泡与历史面板
 *    共用同一份，不会出现"气泡一个图标、历史里另一个图标"的漂移。
 */
import { AlertTriangle, Info, Megaphone, Minimize2, ShieldQuestion, Volume2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { BroadcastKind, BroadcastTone } from "./store";

export const KIND_META: Record<BroadcastKind, { label: string; icon: LucideIcon; tone: BroadcastTone }> = {
  group: { label: "群事件", icon: Megaphone, tone: "info" },
  voice: { label: "语音播报", icon: Volume2, tone: "info" },
  system: { label: "系统提示", icon: Info, tone: "warn" },
  turn: { label: "回合异常", icon: AlertTriangle, tone: "error" },
  compact: { label: "上下文压缩", icon: Minimize2, tone: "info" },
  approval: { label: "等待确认", icon: ShieldQuestion, tone: "warn" },
};

export function kindMetaOf(kind: BroadcastKind) {
  /* 未知 kind（旧历史/新类型先上线后补映射）走系统提示，不让历史条目变成空白行 */
  return KIND_META[kind] ?? KIND_META.system;
}

/** 相对时间：刚刚 / N 分钟 / N 小时 / HH:mm（跨天再加日期）。 */
export function relativeTime(at: number): string {
  const diff = Date.now() - at;
  if (!Number.isFinite(diff) || diff < 0) return "";
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  const date = new Date(at);
  const sameDay = new Date().toDateString() === date.toDateString();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  if (sameDay) return `${hh}:${mm}`;
  return `${date.getMonth() + 1}/${date.getDate()} ${hh}:${mm}`;
}
