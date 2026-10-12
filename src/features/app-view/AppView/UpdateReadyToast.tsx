/**
 * 更新就绪提示条（10-12）—— 左下角「更新已就绪 · 取消 / 重启安装」。
 *
 * 需求 3：发布新版本后后台已静默下好包 ⇒ 这里告知并给两个出口：
 *   · **取消** → 延后（同一版本不再打扰，但换版本仍会弹）；
 *   · **重启安装** → 调主进程 `updates:restart-install`，由它先 spawn 安装包再退出本应用。
 *
 * ⛔⛔ **必须 portal 到 `document.body`**（同 `.archive-toast` / `AppSelect` 的纪律）：
 *   输入框那层 `.composer-wrap.docked-center` 带 `transform`，而**带 transform 的祖先
 *   会成为 `fixed` 元素的包含块** —— 不 portal 的话这个 `position: fixed` 会变成
 *   「按输入框定位」，弹窗跟着输入框跑，还会被 `.timeline` 的 overflow 裁掉。
 *
 * ⛔ 本组件**不自己判断**「包是否已就绪」：那个权威状态在主进程
 *   （lastVerifiedUpdatePath），渲染层只照 `updateReady` 显示。
 * ⛔ 版本号从 `updateReadyVersion` 读而不是 `updateInfo.version` —— 后者是
 *   「最近一次检查」的结果，可能是另一个版本（旧检查比静默下载早）。
 */
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";

export function UpdateReadyToast({
  version,
  restarting,
  onCancel,
  onRestartInstall,
}: {
  version: string;
  restarting: boolean;
  onCancel: () => void;
  onRestartInstall: () => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="update-ready-toast" role="status" aria-live="polite">
      <Sparkles size={16} className="update-ready-icon" />
      <div className="update-ready-body">
        <div className="update-ready-title">更新已就绪{version ? ` · v${version}` : ""}</div>
        <div className="update-ready-desc">
          新版本已下载完成并校验通过。重启即可完成安装，未安装的第三方工具会一并恢复。
        </div>
        <div className="update-ready-actions">
          <button className="update-ready-btn" onClick={onCancel} disabled={restarting}>取消</button>
          <button className="update-ready-btn primary" onClick={onRestartInstall} disabled={restarting}>
            {restarting ? "正在重启…" : "重启安装"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}