/**
 * 文件卡 → 右栏「工作区文件」的桥（10-22，Qoder 式联动）。
 *
 * 卡片在回合深处、右栏在 AppView 顶层；这里订阅 `right-file` 事件箱，
 * 统一做四件事：补全相对路径 → 高亮项目树 → 展开父目录 → 打开右栏并切到文件页。
 * ⛔ 不打开居中预览（那是「在编辑器打开」的路径），避免点文件卡时被弹窗盖住右栏。
 *
 * ★ 10-30 用户令：「这后面的文件跳转预览也同步修一下，只要是电脑上有的文件，不管在哪里都能打开」——
 *   原来这里**自己拼一次** `workspace + path` 就往下发 ⇒ 卡片给的是死链时，右栏拿到死链、
 *   文件树去展开一个不存在的目录、预览报「文件不存在」。现在把解析**提前到广播前**：
 *   本组件注册 `registerRightFileResolver`（统一入口 `resolveForOpen`：补绝对 → 台账 → 扫盘找回），
 *   所有订阅方拿到的都是**真实可打开**的路径；这里只负责高亮 / 展开 / 开栏。
 */
import { useEffect, useRef } from "react";
import type { HarnessAppApi } from "../../app-state/useHarnessApp";
import { registerRightFileResolver, subscribeRightFile } from "../../../lib/right-file.mjs";
import { joinWorkspacePath, resolveForOpen } from "../../../lib/path-fallback.mjs";
import { lookupKnownFile } from "../../../lib/ui-channels";

export function RightFileBridge({ app }: { app: HarnessAppApi }) {
  const ref = useRef(app);
  ref.current = app;

  useEffect(() => {
    registerRightFileResolver((raw) => resolveForOpen(raw, {
      workspace: ref.current.workspace,
      lookup: (target) => lookupKnownFile(target),
      /* ★ 10-30 用户令：能打开就是成功，别用红色 —— 语气由这里显式给，不靠文案猜。 */
      notify: (message, tone) => ref.current.showToast("已打开文件", message, undefined, tone ?? "success"),
    }));
    return () => { registerRightFileResolver(null); };
  }, []);

  useEffect(() => subscribeRightFile(({ path }) => {
    const current = ref.current;
    /* 解析已在广播前完成；这里只在「解析器尚未注册」时兜一层（保持旧行为，不猜）。 */
    const resolved = /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("\\\\")
      ? path
      : joinWorkspacePath(path, current.workspace);
    current.setHighlightedFilePath(resolved);
    const dir = resolved.replace(/[\\/][^\\/]+$/, "");
    if (dir) {
      void current.fetchChildren(dir);
      current.setTreeExpanded((existing) => {
        const next = new Set(existing);
        next.add(dir);
        return next;
      });
    }
    current.setRightOpen(true);
    current.setRightTab("tree");
    /* Qoder 的文件预览要能放下正文；右栏默认 308 太窄，打开文件时顺手放宽到 420。 */
    if (current.panelWidth < 420) current.setPanelWidth(420);
  }), []);

  return null;
}
