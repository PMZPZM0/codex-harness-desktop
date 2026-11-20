/**
 * 更新流程常驻进度条 + 安装遮罩（11-16 用户令）
 *
 * 用户原话：「更新的时候应用界面关了，而不是应用界面开着，做一个更新进度进度条显示」
 *   · 后台静默下载时：左下角常驻进度条（百分比 + 已下载/总大小），不打断任何操作；
 *   · 点「重启安装」后：全屏「正在安装更新，应用即将重启」遮罩，直到主进程退出。
 *
 * ⛔ 数据源是主进程 `updates:download-state`（静默下载原来一个进度事件都没有）；
 *   `harness:update-state` 是验收/调试用的本地事件口，两者共用同一个状态形状。
 * ⛔ 必须 portal 到 body：输入框那层带 transform 会成为 fixed 的包含块。
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, LoaderCircle, X } from "lucide-react";
import { UpdateProgressBar } from "../../../components/UpdateProgressBar";

type UpdateFlowState = {
  active: boolean;
  phase: "download" | "installing";
  percent: number;
  receivedBytes?: number;
  totalBytes?: number;
  version?: string;
};

/** 字节 → 人类可读（进度条副行用；未知大小返回空串）。 */
function sizeText(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 更新下载进度条 / 安装遮罩（自订阅，无数据时不渲染）。 */
export function UpdateFlowBanner() {
  const [state, setState] = useState<UpdateFlowState | null>(null);
  /* 11-19 用户令：「这个更新弹窗关都关不掉」—— 收起来只影响显示，下载继续跑；
     下次开始新一轮（active 从 false 变 true）或进入安装阶段时自动恢复显示。 */
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const off = window.codex.updateOnState?.((next) => setState(next as UpdateFlowState));
    const onLocal = (event: Event) => {
      const detail = (event as CustomEvent<UpdateFlowState>)?.detail;
      if (detail) setState(detail);
    };
    window.addEventListener("harness:update-state", onLocal);
    return () => {
      off?.();
      window.removeEventListener("harness:update-state", onLocal);
    };
  }, []);

  /* 收起只在「这一轮下载」里有效：下载结束 / 换版本 / 进入安装阶段，自动恢复显示。 */
  useEffect(() => {
    if (!state?.active || state.phase !== "download") setHidden(false);
  }, [state?.active, state?.phase, state?.version]);

  if (!state || typeof document === "undefined") return null;

  if (state.phase === "installing" && state.active) {
    return createPortal(
      <div className="update-install-overlay" role="alert" aria-live="assertive">
        <div className="update-install-card">
          <LoaderCircle size={22} className="spin" />
          <strong>正在安装更新{state.version ? ` v${state.version}` : ""}</strong>
          <span>应用即将自动重启；安装期间会保留一个小提示窗，请勿重复启动，完成后会自动打开新版本。</span>
          <UpdateProgressBar active indeterminate />
        </div>
      </div>,
      document.body,
    );
  }

  if (!state.active || hidden) return null;
  const percent = Math.max(0, Math.min(1, Number(state.percent) || 0));
  const pct = Math.round(percent * 100);
  const received = sizeText(state.receivedBytes);
  const total = sizeText(state.totalBytes);
  return createPortal(
    <div className="update-flow-banner" role="status" aria-live="polite">
      <button type="button" className="update-flow-close" title="收起提示（下载继续）" aria-label="收起更新提示，下载继续" onClick={() => setHidden(true)}><X size={13} /></button>
      <span className="update-flow-icon"><Download size={14} /></span>
      <div className="update-flow-body">
        <div className="update-flow-title">
          <strong>正在下载更新{state.version ? ` v${state.version}` : ""}</strong>
          <span>{pct}%</span>
        </div>
        <UpdateProgressBar active progress={percent} />
        <div className="update-flow-sub">
          {received && total ? `${received} / ${total} · ` : ""}
          后台进行中，不影响你继续使用
        </div>
      </div>
    </div>,
    document.body,
  );
}
