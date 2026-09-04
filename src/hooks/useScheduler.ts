import { useEffect, useState } from "react";
import { DEFAULT_EFFORT } from "../lib/effort";

export type ScheduledTask = {
  id: string;
  name: string;
  prompt: string;
  workspace: string;
  model?: string;
  effort: string;
  intervalMinutes: number;
  enabled: boolean;
  nextRunAt: number;
  lastRunAt?: number;
  lastError?: string;
  kind?: "interval" | "daily" | "weekly" | "monthly" | "yearly" | "once";
  timeOfDay?: string;
  weekdays?: number[];
  // WorkBuddy 对齐字段：RRULE 调度 + 有效区间 + 运行状态
  rrule?: string;
  scheduleType?: "recurring" | "once";
  scheduledAt?: string;
  validFrom?: string;
  validUntil?: string;
  monthDay?: number;
  month?: number;
  biweekly?: boolean;
  running?: boolean;
  displayStatus?: string;
  runKind?: "scheduled" | "missed" | "manual";
  threadId?: string;
};

export type ScheduleDraft = {
  name: string;
  prompt: string;
  workspace: string;
  model: string;
  effort: string;
  intervalMinutes: string;
  kind: "interval" | "daily" | "weekly" | "monthly" | "yearly" | "once";
  timeOfDay: string;
  weekdays: number[];
  monthDay: string;
  month: string;
  biweekly: boolean;
  scheduledAt: string;
  validUntil: string;
  threadId: string;
};

// datetime-local 输入框用的是「本地时间、无时区」字符串；主进程 parseIsoTimestamp 用 Date.parse 按本地时间解析。
// 这里必须生成本地时间字符串（不能用 toISOString 的 UTC 墙钟，否则北京时区会偏 8 小时，once 任务首 tick 即判过期）。
function toLocalDatetimeString(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function emptyScheduleDraft(workspace = ""): ScheduleDraft {
  return { name: "", prompt: "", workspace, model: "", effort: DEFAULT_EFFORT, intervalMinutes: "60", kind: "interval", timeOfDay: "09:00", weekdays: [1, 2, 3, 4, 5], monthDay: "1", month: "1", biweekly: false, scheduledAt: toLocalDatetimeString(Date.now() + 3600_000), validUntil: "", threadId: "" };
}

export function useScheduler() {
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([]);
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>(() => emptyScheduleDraft(localStorage.getItem("workspace") ?? ""));
  const [scheduleStatus, setScheduleStatus] = useState("");
  const [autoFormVisible, setAutoFormVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    void window.codex.listScheduledTasks().then((result) => setScheduledTasks(result ?? [])).catch(() => undefined);
  }, []);

  async function saveSchedule(): Promise<boolean> {
    try {
      const draft = scheduleDraft;
      const saved = await window.codex.saveScheduledTask({
        id: editingId || undefined,
        name: draft.name,
        prompt: draft.prompt,
        workspace: draft.workspace,
        model: draft.model,
        effort: draft.effort,
        kind: draft.kind,
        timeOfDay: draft.timeOfDay,
        weekdays: draft.weekdays,
        intervalMinutes: Number(draft.intervalMinutes) || 60,
        monthDay: draft.monthDay ? Number(draft.monthDay) : undefined,
        month: draft.month ? Number(draft.month) : undefined,
        biweekly: draft.kind === "weekly" ? draft.biweekly : undefined,
        scheduledAt: draft.kind === "once" ? draft.scheduledAt : undefined,
        validUntil: draft.validUntil || undefined,
        threadId: draft.threadId || undefined,
        enabled: true,
      });
      setScheduledTasks((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)]);
      setScheduleDraft((current) => ({ ...current, name: "", prompt: "" }));
      setEditingId(null);
      setScheduleStatus(editingId ? "定时任务已更新" : "定时任务已保存");
      return true;
    } catch (error: any) {
      setScheduleStatus(error.message);
      return false;
    }
  }

  function editSchedule(id: string) {
    const task = scheduledTasks.find((entry) => entry.id === id);
    if (!task) return;
    setEditingId(id);
    setScheduleDraft({
      name: task.name,
      prompt: task.prompt,
      workspace: task.workspace,
      model: task.model ?? "",
      effort: task.effort,
      intervalMinutes: String(task.intervalMinutes ?? 60),
      kind: task.kind ?? "interval",
      timeOfDay: task.timeOfDay ?? "09:00",
      weekdays: task.weekdays ?? [1, 2, 3, 4, 5],
      monthDay: String(task.monthDay ?? 1),
      month: String(task.month ?? 1),
      biweekly: task.biweekly ?? false,
      scheduledAt: task.scheduledAt ?? "",
      validUntil: task.validUntil ?? "",
      threadId: task.threadId ?? "",
    });
    setAutoFormVisible(true);
    setScheduleStatus("正在编辑：「" + task.name + "」");
  }

  async function toggleSchedule(task: ScheduledTask) {
    try {
      const saved = await window.codex.saveScheduledTask({ ...task, enabled: !task.enabled });
      setScheduledTasks((current) => current.map((entry) => entry.id === saved.id ? saved : entry));
    } catch (error: any) {
      setScheduleStatus(error.message);
    }
  }

  async function deleteSchedule(id: string) {
    await window.codex.deleteScheduledTask(id);
    setScheduledTasks((current) => current.filter((entry) => entry.id !== id));
  }

  async function runSchedule(id: string) {
    try {
      await window.codex.runScheduledTask(id);
      setScheduleStatus("定时任务已启动");
    } catch (error: any) {
      setScheduleStatus(error.message);
    }
  }

  return {
    scheduledTasks,
    setScheduledTasks,
    scheduleDraft,
    setScheduleDraft,
    scheduleStatus,
    autoFormVisible,
    setAutoFormVisible,
    saveSchedule,
    toggleSchedule,
    deleteSchedule,
    runSchedule,
    editSchedule,
  };
}
