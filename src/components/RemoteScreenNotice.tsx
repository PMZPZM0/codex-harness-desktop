/**
 * 手机看屏的桌面提示（11-06 P1）。
 *
 * 为什么必须有：手机能看这台电脑的屏幕，桌面就**必须让人看得见**——否则就是后门。
 * 手机开始取帧 ⇒ 主进程广播 `remote:screen {active:true}` ⇒ 这里常驻一条，
 * 带「停止查看」（走 remote:screen-stop，停采后手机下次取帧拿到 409）。
 * 手机切后台/断网 ⇒ 15 秒租约到期，主进程自动停采并广播 active:false，这里自动收起。
 */
import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";

export function RemoteScreenNotice() {
  const [active, setActive] = useState(false);
  useEffect(() => window.codex.onHarnessEvent((payload) => {
    const event = payload as { type?: string; active?: boolean } | null;
    if (event?.type === "remote:screen") setActive(Boolean(event.active));
  }), []);
  if (!active) return null;
  return (
    <div className="remote-screen-notice" role="status" aria-live="polite">
      <Monitor size={14} />
      <span>手机正在查看这台电脑的屏幕（只读）</span>
      <button
        type="button"
        onClick={() => {
          setActive(false);
          void window.codex.remoteScreenStop().catch(() => undefined);
        }}
      >
        停止查看
      </button>
    </div>
  );
}
