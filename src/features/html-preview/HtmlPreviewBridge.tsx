/**
 * HTML 实时预览桥（10-18 用户：「写 html 文件的时候，自动打开右边浏览器，会话窗口自动缩小
 * 一点比例，把右边展示全，实时渲染 html 内容」）。
 *
 * 链路：
 *   ① 当前会话的回合文件变更（live 或收尾）里出现 `.html` ⇒ 记住路径 → 主进程 watch → 打开右栏浏览器；
 *   ② 右栏按比例加宽（最多 560 = 现有拖拽上限），让出空间给预览；
 *   ③ 主进程 html-preview:changed ⇒ store 通知 ⇒ BrowserPane 无缓存重载当前标签。
 *
 * ⛔ 只认**当前会话的回合**：后台专家 / 被调度会话写 HTML 不应抢用户的右栏。
 * ⛔ 不往 bag 里塞预览状态（独立板块自包含）；这里只借用已有的 openInBrowserPane / setPanelWidth。
 */
import { useEffect, useRef } from "react";
import { toFileUrl } from "../../lib/file-url.mjs";
import { pickHtmlPreviewPath, isHtmlPath } from "./html-file.mjs";
import { notifyHtmlPreviewChanged, setHtmlPreview } from "../../lib/html-preview-store.mjs";

/** 本板块真正用到的宿主能力（结构化 props，⛔ 不深链 app-state 的 HarnessAppApi —— 守卫【130】）。 */
export type HtmlPreviewHost = {
  openInBrowserPane: (url: string) => void;
  setPanelWidth: (width: number) => void;
  panelWidth: number;
  rightOpen: boolean;
  thread: { turns?: Array<{ id?: string }> } | null;
};

const PANEL_RATIO = 0.45;
const PANEL_MIN = 360;
const PANEL_MAX = 560;

function currentThreadHasTurn(thread: HtmlPreviewHost["thread"], turnId: string): boolean {
  if (!turnId) return true;
  const turns = thread?.turns;
  if (!Array.isArray(turns) || turns.length === 0) return true;
  return turns.some((turn) => String(turn?.id ?? "") === turnId);
}

export function HtmlPreviewBridge({ app }: { app: HtmlPreviewHost }) {
  const lastPathRef = useRef("");
  const seenRef = useRef<Set<string>>(new Set());
  /* 本渲染会话里真跑过的回合（出现过 live 事件）。⛔ 切换/重开会话时主进程会把**历史**
     回合报告重播成同样的 turn-file-changes 事件；没有这个集合就会把用户已有的 HTML
     当成「刚生成」自动打开（10-18 用户实测：「正常我进去不要每次都打开对话框里面已有的html文件」）。 */
  const liveTurnsRef = useRef<Set<string>>(new Set());
  const actionsRef = useRef({
    open: app.openInBrowserPane,
    setPanelWidth: app.setPanelWidth,
    panelWidth: app.panelWidth,
    rightOpen: app.rightOpen,
    thread: app.thread,
  });
  actionsRef.current = {
    open: app.openInBrowserPane,
    setPanelWidth: app.setPanelWidth,
    panelWidth: app.panelWidth,
    rightOpen: app.rightOpen,
    thread: app.thread,
  };

  useEffect(() => {
    const off = window.codex.onHarnessEvent((payload: any) => {
      const type = String(payload?.type ?? "");
      if (type === "html-preview:changed") {
        const path = String(payload?.path ?? "");
        if (path && path === lastPathRef.current) notifyHtmlPreviewChanged(path);
        return;
      }
      if (type !== "turn-file-changes" && type !== "turn-file-changes-live") return;
      const turnId = String(payload?.turnId ?? "");
      if (type === "turn-file-changes-live") {
        if (!turnId) return;
        liveTurnsRef.current.add(turnId);
      } else {
        /* 收尾报告：只认本会话里 live 过的回合。resume 重播的历史报告没有 live 记录 ⇒ 忽略。 */
        if (!turnId || !liveTurnsRef.current.has(turnId)) return;
        liveTurnsRef.current.delete(turnId);
      }
      if (!currentThreadHasTurn(actionsRef.current.thread, turnId)) return;
      const files = Array.isArray(payload?.files) ? payload.files : [];
      const path = pickHtmlPreviewPath(files, lastPathRef.current, [...seenRef.current]);
      if (!path) return;
      for (const file of files) {
        if (file && String(file.status ?? "") !== "deleted" && isHtmlPath(file.path)) seenRef.current.add(String(file.path));
      }
      const isNew = path !== lastPathRef.current;
      if (isNew) {
        lastPathRef.current = path;
        const url = toFileUrl(path);
        setHtmlPreview({ path, url });
        void Promise.resolve(window.codex.htmlPreviewWatch?.({ path })).catch(() => undefined);
        actionsRef.current.open(url);
        const target = Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(window.innerWidth * PANEL_RATIO)));
        if (actionsRef.current.panelWidth < target) actionsRef.current.setPanelWidth(target);
        return;
      }
      // 同一个文件：面板被用户关了 ⇒ 再变时重新打开；否则只通知重载（隐藏的浏览器标签也会更新）
      if (!actionsRef.current.rightOpen) actionsRef.current.open(toFileUrl(path));
      else notifyHtmlPreviewChanged(path);
    });
    return () => {
      off?.();
      void Promise.resolve(window.codex.htmlPreviewUnwatch?.()).catch(() => undefined);
    };
  }, []);

  return null;
}
