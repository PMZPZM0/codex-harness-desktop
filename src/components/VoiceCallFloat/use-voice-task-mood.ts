/**
 * 悬浮球的「任务姿态」（10-29 用户令：人性化联动 + 情绪价值）。
 *
 * 悬浮球原先只知道自己「开没开麦」，不知道你在干什么。这里把**引擎回合状态**折算成
 * 六个姿态，喂给表情与气泡池：
 *   idle      没在跑
 *   thinking  回合在跑、还没出工具调用（在想）
 *   working   正在调工具 / 执行命令（在干活）
 *   waiting   引擎发起了**等你确认**的请求（审批 / 询问）
 *   done      回合正常结束（保留 6 秒，给一个收尾小反馈）
 *   failed    回合失败 / 中断（保留 4 秒，垂眼不说话）
 *
 * ⛔ 单一来源是引擎事件（`onEvent` + `onHarnessEvent`），不读 UI 卡片 DOM：
 *   卡片是渲染结果，读它会把「同类状态两份真相」带进来。
 * ⛔ 事件必须按**当前会话**过滤：后台专家/其它会话的回合不能点亮这颗球。
 *   事件不带 threadId 时按当前会话处理（与宠物域 `pet-state` 的兜底同口径）。
 * ⛔ waiting 优先级最高（与宠物域一致）：确认期间模型是停着的，后续 item 不改姿态；
 *   只有 done/failed/idle 能结束它。
 */
import { useEffect, useRef, useState } from "react";

export type TaskMood = "idle" | "thinking" | "working" | "waiting" | "done" | "failed";

const DONE_HOLD_MS = 6000;
const FAILED_HOLD_MS = 4000;
/** 引擎 item 类型是 PascalCase（CommandExecution / AgentMessage / Reasoning…），统一小写判断。 */
const WORK_ITEM_RE = /command|exec|tool|mcp|websearch|webfetch|web_search|filechange|patch|applypatch|image|screenshot|browser/i;
const THINK_ITEM_RE = /reasoning|agentmessage|message|plan|todo/i;

export function useVoiceTaskMood(threadId?: string): TaskMood {
  const [mood, setMood] = useState<TaskMood>("idle");
  const moodRef = useRef<TaskMood>("idle");
  const threadRef = useRef<string>("");
  threadRef.current = String(threadId ?? "");
  const timerRef = useRef<number>(0);

  /* 切会话：姿态立刻归零 —— 新会话的球不该继承上一个会话的「干完了」。 */
  useEffect(() => {
    moodRef.current = "idle";
    setMood("idle");
  }, [threadId]);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = 0; }
    };
    const apply = (next: TaskMood, holdMs?: number) => {
      clearTimer();
      if (moodRef.current === "waiting" && next !== "idle" && next !== "done" && next !== "failed") return;
      moodRef.current = next;
      setMood(next);
      if (holdMs) {
        timerRef.current = window.setTimeout(() => {
          moodRef.current = "idle";
          setMood("idle");
        }, holdMs);
      }
    };
    const sameThread = (params: Record<string, unknown> | undefined) => {
      const id = String((params as any)?.threadId ?? (params as any)?.thread?.id ?? "");
      if (!id) return true;
      return id === threadRef.current;
    };
    const onCodex = (event: any) => {
      const method = String(event?.method ?? "");
      const params: Record<string, unknown> = event?.params ?? {};
      if (!sameThread(params)) return;
      if (method === "turn/started") { apply("thinking"); return; }
      if (method === "turn/completed") {
        const status = String((params as any)?.turn?.status ?? (params as any)?.status ?? "");
        const failed = /fail|error|abort|interrupt/i.test(status);
        apply(failed ? "failed" : "done", failed ? FAILED_HOLD_MS : DONE_HOLD_MS);
        return;
      }
      if (method === "turn/aborted" || method === "turn/failed" || method === "error") {
        apply("failed", FAILED_HOLD_MS);
        return;
      }
      if (method === "serverRequest/resolved") {
        if (moodRef.current === "waiting") apply("thinking");
        return;
      }
      if (method === "item/started" || method === "item/completed") {
        const type = String((params as any)?.item?.type ?? (params as any)?.itemType ?? "");
        if (WORK_ITEM_RE.test(type)) apply("working");
        else if (THINK_ITEM_RE.test(type)) apply("thinking");
      }
    };
    const onHarness = (event: any) => {
      const kind = String(event?.kind ?? "");
      const params: Record<string, unknown> = event?.params ?? {};
      if (kind === "request") { if (sameThread(params)) apply("waiting"); return; }
      if (kind === "status" && event?.status === "error") apply("failed", FAILED_HOLD_MS);
    };
    const offEvent = window.codex.onEvent(onCodex);
    const offHarness = window.codex.onHarnessEvent(onHarness);
    return () => {
      clearTimer();
      offEvent?.();
      offHarness?.();
    };
  }, [threadId]);

  return mood;
}
