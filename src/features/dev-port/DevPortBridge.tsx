/**
 * 本机测试端口 → 右栏浏览器自动打开（10-29 用户令，对照 Qoder 的效果）。
 *
 * 与 `html-preview`（写 HTML 文件自动预览）同一族，但数据源是**命令执行**：
 *   · `item/commandExecution/outputDelta`（流式输出）与 `item/started|completed`（命令行 + 聚合输出）
 *     里出现**带端口**的 localhost / 127.0.0.1 URL ⇒ 打开右栏浏览器 + 加宽面板。
 *
 * ⛔ 只认**当前会话正在跑的回合**（turn/started..turn/ended 之间）：历史输出 / resume 重播不触发；
 *    事件带 threadId 就按会话过滤，不带时只在回合进行中才认领。
 * ⛔ 每个 URL 每个渲染会话只自动开一次（dev server 的输出会不停打印同一个地址，
 *    反复 open 会抢走用户正在看的标签）。
 * ⛔ 不往 bag 塞状态（自包含桥，同 html-preview 的结构化 props，⛔ 不深链 HarnessAppApi）。
 */
import { useEffect, useRef } from "react";
import { pickDevServerUrl } from "./dev-port.mjs";

export type DevPortHost = {
  openInBrowserPane: (url: string) => void;
  setPanelWidth: (width: number) => void;
  panelWidth: number;
  rightOpen: boolean;
};

const PANEL_RATIO = 0.45;
const PANEL_MIN = 360;
const PANEL_MAX = 560;

export function DevPortBridge({ app, threadId }: { app: DevPortHost; threadId?: string }) {
  const seenRef = useRef<Set<string>>(new Set());
  const runningRef = useRef(false);
  const threadRef = useRef<string>("");
  threadRef.current = String(threadId ?? "");
  const actionsRef = useRef({
    open: app.openInBrowserPane,
    setPanelWidth: app.setPanelWidth,
    panelWidth: app.panelWidth,
  });
  actionsRef.current = {
    open: app.openInBrowserPane,
    setPanelWidth: app.setPanelWidth,
    panelWidth: app.panelWidth,
  };

  useEffect(() => {
    const sameThread = (params: Record<string, unknown> | undefined) => {
      const id = String(params?.threadId ?? "");
      if (!id) return true;
      return id === threadRef.current;
    };
    const openUrl = (url: string) => {
      /* ⛔ 去重收口在 open 本身：dev server 会反复打印同一地址，重复 open 会抢走用户标签。 */
      if (seenRef.current.has(url)) return;
      seenRef.current.add(url);
      actionsRef.current.open(url);
      const target = Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(window.innerWidth * PANEL_RATIO)));
      if (actionsRef.current.panelWidth < target) actionsRef.current.setPanelWidth(target);
    };
    const consider = (text: unknown) => {
      if (!runningRef.current) return;
      const url = pickDevServerUrl(text, seenRef.current);
      if (!url) return;
      openUrl(url);
    };
    const onCodex = (event: CodexEvent) => {
      const method = String(event?.method ?? "");
      const params: Record<string, unknown> = event?.params ?? {};
      if (method === "turn/started") {
        if (sameThread(params)) runningRef.current = true;
        return;
      }
      if (/^turn\/(completed|aborted|failed|interrupted)$/.test(method)) {
        if (sameThread(params)) runningRef.current = false;
        return;
      }
      if (method === "item/commandExecution/outputDelta") {
        consider(String(params.delta ?? ""));
        return;
      }
      if (method === "item/started" || method === "item/completed") {
        if (!sameThread(params)) return;
        const item = (params?.item ?? {}) as { type?: unknown; command?: unknown; aggregatedOutput?: unknown };
        if (String(item?.type ?? "") !== "commandExecution") return;
        consider(`${item.command ?? ""}\n${item.aggregatedOutput ?? ""}`);
      }
    };
    /* 确定性入口（验收/扩展用）：页面派发 CustomEvent("dev-port:open", {detail:{url}}) 走同一条
       open 路径。⛔ 能力上不新增面 —— 页面 JS 本就摸得到 window.codex 的浏览器桥。 */
    const onProbe = (event: Event) => {
      const url = String((event as CustomEvent)?.detail?.url ?? "");
      if (url) openUrl(url);
    };
    window.addEventListener("dev-port:open", onProbe);
    const off = window.codex.onEvent(onCodex);
    return () => {
      window.removeEventListener("dev-port:open", onProbe);
      off?.();
    };
  }, [threadId]);

  return null;
}
