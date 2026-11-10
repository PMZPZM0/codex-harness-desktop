/**
 * 工作伙伴独立窗口的根组件（11-08 用户令：「群聊弹窗做成独立窗口」）。
 *
 * ⛔ 这个窗口只跑群聊板块，⛔ 不渲染主界面（侧栏 / 时间线 / 设置页）。
 * ⛔ app 仍由 useHarnessApp() 完整初始化：群输入框的 ComposerRail 与 harness 事件订阅都靠它。
 * ⛔ 主应用真正关闭时由主进程带走本窗口；最小化 / 隐藏到托盘时本窗口继续运行。
 */
import { useEffect } from "react";
import type { HarnessAppApi } from "../app-state";
import { teamChatOpen } from "./00-open-store";
import { TeamChatOverlay } from "./index";
import { MediaPreviewBridge } from "../media";
import { ImageLightbox } from "../preview";

/** 团队独立窗的根组件：置团队开启态、加 body 类名与窗口标题「工作伙伴」。 */
export function TeamPopoutRoot({ app }: { app: HarnessAppApi }) {
  useEffect(() => {
    teamChatOpen.set(true);
    document.body.classList.add("is-team-popout");
    document.title = "工作伙伴";
    return () => {
      document.body.classList.remove("is-team-popout");
      teamChatOpen.set(false);
    };
  }, []);
  return (
    <div className="team-popout-root">
      <TeamChatOverlay
        app={app}
        /* ⛔ 11-08 审查：独立窗原来没传 onOpenThread ⇒ 办公室预览里点角色是**死按钮**
           （面板先关、然后静默无事发生）。独立窗没有主聊天区可切，这里改为打开该会话的独立窗口。 */
        onOpenThread={(threadId) => { void window.codex.popoutThread(threadId); }}
        onCloseWindow={() => { void window.codex.popoutTeamClose(); }}
      />
      {/* ⛔ 11-09：独立窗口不渲染 AppView，媒体播放器/大图灯箱没人挂载 ⇒ 汇总媒体卡点了没反应。
         这里补上（仅独立窗；内嵌主界面已由 AppView 挂载，不重复）。 */}
      <MediaPreviewBridge threadId="" runningTurnIdsRef={app.runningTurnIdsRef} />
      {app.lightbox && <ImageLightbox path={app.lightbox.path} alt={app.lightbox.alt} onClose={() => app.setLightbox(null)} />}
    </div>
  );
}
