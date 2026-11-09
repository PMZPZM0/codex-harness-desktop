/**
 * 工作伙伴窗口 · 关闭确认（11-09 用户令：「群聊有任务在跑的时候，关闭工作伙伴弹窗要加弹窗提示；
 * 没有在跑就不用提示」）。
 *
 * ⛔ 只在**独立窗口**里生效（`?teamPopout=1`）；主界面内嵌的团队页不拦窗口钮。
 * ⛔ 拦的是自绘窗口钮这一次点击（renderer 侧守卫），OS 级关闭不经过这里。
 * ⛔ 关闭窗口**不会中断任务**（引擎在主进程继续跑）—— 提示里要如实这么说，别吓成"会停止工作"。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useEscapeLayer } from "../../hooks/useEscapeLayer";
import { isTeamPopoutWindow } from "../../lib/team-popout";
import { registerWindowCloseGuard } from "../../lib/window-close-guard.mjs";

/** 群聊里"还在跑"的群数（busy 名单与 live 运行取并集，⛔ 不重复计数）。 */
function activeGroupIds(busyByGroup: Record<string, string[]>, liveByGroup: Record<string, Record<string, { status?: string }>>): string[] {
  const ids = new Set<string>();
  for (const [gid, list] of Object.entries(busyByGroup ?? {})) if (Array.isArray(list) && list.length) ids.add(gid);
  for (const [gid, runs] of Object.entries(liveByGroup ?? {})) {
    if (Object.values(runs ?? {}).some((run) => String(run?.status ?? "") === "running")) ids.add(gid);
  }
  return [...ids];
}

/** 工作伙伴窗口的关窗守卫：有群任务在跑时弹确认，没有就直接放行。 */
export function TeamCloseGuard({ busyByGroup, liveByGroup }: {
  busyByGroup: Record<string, string[]>;
  liveByGroup: Record<string, Record<string, { status?: string }>>;
}) {
  const [open, setOpen] = useState(false);
  const active = useMemo(() => activeGroupIds(busyByGroup, liveByGroup), [busyByGroup, liveByGroup]);
  const activeRef = useRef(active.length);
  activeRef.current = active.length;

  useEffect(() => {
    if (!isTeamPopoutWindow()) return;
    return registerWindowCloseGuard(() => {
      if (activeRef.current <= 0) return false;
      setOpen(true);
      return true;
    });
  }, []);

  useEscapeLayer(open, () => setOpen(false));
  if (!open) return null;

  const closeNow = () => {
    setOpen(false);
    void window.codex.windowClose?.();
  };
  return createPortal(
    <div className="close-confirm-backdrop" role="dialog" aria-modal="true" aria-label="关闭工作伙伴窗口">
      <div className="close-confirm-card">
        <div className="close-confirm-head">
          <span className="close-confirm-title">关闭工作伙伴窗口？</span>
          <button type="button" className="close-confirm-x" onClick={() => setOpen(false)} aria-label="取消">
            <X size={15} />
          </button>
        </div>
        <p className="close-confirm-desc">
          还有 <strong>{active.length}</strong> 个群的任务在运行。关闭这个窗口<strong>不会中断</strong>它们（后台继续跑），
          只是暂时看不到进度；重新打开工作伙伴就能接着看。
        </p>
        <div className="close-confirm-actions">
          <button type="button" className="close-confirm-btn" onClick={() => setOpen(false)}>取消</button>
          <button type="button" className="close-confirm-btn danger" onClick={closeNow}>仍然关闭</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
