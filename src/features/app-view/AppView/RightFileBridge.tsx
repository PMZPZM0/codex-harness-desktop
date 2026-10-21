/**
 * 文件卡 → 右栏「工作区文件」的桥（10-22，Qoder 式联动）。
 *
 * 卡片在回合深处、右栏在 AppView 顶层；这里订阅 `right-file` 事件箱，
 * 统一做四件事：补全相对路径 → 高亮项目树 → 展开父目录 → 打开右栏并切到文件页。
 * ⛔ 不打开居中预览（那是「在编辑器打开」的路径），避免点文件卡时被弹窗盖住右栏。
 */
import { useEffect, useRef } from "react";
import type { HarnessAppApi } from "../../app-state/useHarnessApp";
import { subscribeRightFile } from "../../../lib/right-file.mjs";

export function RightFileBridge({ app }: { app: HarnessAppApi }) {
  const ref = useRef(app);
  ref.current = app;

  useEffect(() => subscribeRightFile(({ path }) => {
    const current = ref.current;
    let resolved = path;
    const looksRelative = !/^[A-Za-z]:[\\/]/.test(path) && !path.startsWith("/") && !path.startsWith("~/");
    if (looksRelative && current.workspace) {
      const sep = current.workspace.includes("\\") ? "\\" : "/";
      resolved = `${current.workspace.replace(/[\\/]+$/, "")}${sep}${path.replace(/^[\\/]+/, "")}`;
    }
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
