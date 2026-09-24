import { useEffect, useRef } from "react";
import { ArchiveRestore, CircleCheck, X } from "lucide-react";

/** 归档会话后的提示浮层（09-17 建；09-23 用户三轮定稿：**窗口顶部居中** + **3 秒**自动消失）。
 *
 *  为什么不用现成的 showToast：那是一条纯文字状态行（复用 setNotice），既不能点、也没有倒计时。
 *  这里要的是**可交互 + 有时限**的浮层：看完能直接跳去归档管理，不感兴趣就等它自己消失。
 *  ⛔ 位置与动画都在 CSS（`.archive-toast`：`position: fixed` + `top: 54px` + `left: 50%` +
 *     `translateX(-50%)`），渲染点 = `02-main-stage/03-composer.tsx` 里 **portal 到 document.body**
 *     —— 带 transform 的祖先（空态 `.composer-wrap.docked-center` 就有）会成为 `fixed` 的包含块，
 *     不 portal 就会变成"按输入框定位"。改位置要连 keyframes 里的 `translateX(-50%)` 一起改。
 *
 *  ⛔ 两个必须注意的实现点：
 *  ① **回调要用 ref 持有**，effect 只依赖 token。若依赖里带 onClose（调用方通常传内联箭头函数），
 *     每次父组件渲染都会重置计时器 —— 提示就**永远不会自己消失**了。
 *  ② 鼠标悬停暂停倒计时（正在读却消失了最恼人），移开重新计时。
 */
export function ArchiveToast({
  token,
  threadName,
  onOpenArchive,
  onClose,
  durationMs = 3000,
}: {
  /** 每次归档递增；变化即重置倒计时（连续归档不会继承上一个的剩余时间）。 */
  token: number;
  threadName: string;
  onOpenArchive: () => void;
  onClose: () => void;
  /** 停留时长（默认 3 秒；悬停期间不计时）。 */
  durationMs?: number;
}) {
  const timerRef = useRef<number | null>(null);
  const hoverRef = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const durationRef = useRef(durationMs);
  durationRef.current = durationMs;

  useEffect(() => {
    const clear = () => { if (timerRef.current != null) { window.clearTimeout(timerRef.current); timerRef.current = null; } };
    const start = () => {
      clear();
      if (hoverRef.current) return;   // 悬停中不倒计时
      timerRef.current = window.setTimeout(() => { timerRef.current = null; closeRef.current(); }, durationRef.current);
    };
    start();
    return clear;
  }, [token]);   // ⛔ 只依赖 token（见上方注释①）

  const pause = () => {
    hoverRef.current = true;
    if (timerRef.current != null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
  };
  const resume = () => {
    hoverRef.current = false;
    if (timerRef.current != null) return;
    timerRef.current = window.setTimeout(() => { timerRef.current = null; closeRef.current(); }, durationRef.current);
  };

  return (
    <div className="archive-toast" role="status" aria-live="polite" onMouseEnter={pause} onMouseLeave={resume}>
      <span className="archive-toast-icon"><CircleCheck size={16} /></span>
      <div className="archive-toast-body">
        <strong>已归档</strong>
        <span title={threadName}>{threadName || "当前会话"}</span>
      </div>
      <button type="button" className="archive-toast-action" onClick={() => { onOpenArchive(); onClose(); }}>
        <ArchiveRestore size={13} />查看归档
      </button>
      <button type="button" className="archive-toast-close" title="关闭" aria-label="关闭" onClick={onClose}><X size={13} /></button>
    </div>
  );
}
