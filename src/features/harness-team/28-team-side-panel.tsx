/**
 * 群聊 · 右侧栏（11-09 用户令：「不要那么大的浮动弹窗，放右边；在展开折叠右边加一个侧栏浮窗按键」）。
 *
 * ⛔ 不复制一套侧栏：直接渲染主对话的 `AppViewReviewPanel`（变更 / 审阅 / 浏览器 / 文件 + 监控）。
 * ⛔ **贴群右缘的抽屉**（不是居中模态）：绝对定位在 `.team-group` 内，占 ~400px，可随时关闭。
 * ⛔ 用**克隆的 app** 只覆盖 `rightOpen / rightTab / workspace`，不改本窗全局状态。
 * ⛔ 文件树按**群工作目录**加载；文件卡/正文文件引用的点击都切到「文件」页并选中该文件。
 */
import { useEffect, useMemo, useRef } from "react";
import { PanelRight, X } from "lucide-react";
import { useEscapeLayer } from "../../hooks/useEscapeLayer";
import type { HarnessAppApi } from "../app-state";
import { AppViewReviewPanel } from "../app-view/components";

export type TeamSideTab = "monitor" | "review" | "turn-review" | "browser" | "tree" | "terminal";

/** 群右侧栏：贴边抽屉，复用主对话的右侧面板。 */
export function TeamSidePanel({ app, workspace, tab, onTab, onClose }: {
  app: HarnessAppApi;
  workspace: string;
  tab: TeamSideTab;
  onTab: (tab: TeamSideTab) => void;
  onClose: () => void;
}) {
  useEscapeLayer(true, onClose);
  const rootRef = useRef<HTMLElement | null>(null);
  const resolvedWorkspace = String(workspace ?? "").trim() || String(app.workspace ?? "");
  /* 打开即按**群的**工作目录读一层树（右栏的文件页原本靠主界面 effect 触发，这里不跑主界面）。 */
  useEffect(() => {
    if (!resolvedWorkspace) return;
    void app.loadTree(resolvedWorkspace);
  }, [resolvedWorkspace]);
  const panelApp = useMemo(
    () => ({
      ...app,
      rightOpen: true,
      rightTab: tab,
      setRightTab: onTab as typeof app.setRightTab,
      workspace: resolvedWorkspace,
    }),
    [app, tab, onTab, resolvedWorkspace],
  );
  return (
    <aside ref={rootRef} className="team-side-panel" role="complementary" aria-label="右侧栏">
      <header className="team-side-panel__head">
        <PanelRight size={14} className="ic-blue" />
        <strong>右侧栏</strong>
        <small title={resolvedWorkspace}>{resolvedWorkspace || "未设置群工作目录"}</small>
        <button type="button" className="team-side-panel__close" title="收起侧栏（Esc）" aria-label="收起侧栏" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="team-side-panel__body">
        <AppViewReviewPanel app={panelApp} />
      </div>
    </aside>
  );
}
