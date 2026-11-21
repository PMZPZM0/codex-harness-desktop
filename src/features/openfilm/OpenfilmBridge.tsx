/**
 * OpenFilm Studio 的渲染层桥（10-27 批次二）。
 *
 * 主进程跑完 `openfilm open <dir>` 后广播 `openfilm` 事件的 `phase:"studio"`，
 * 这里把它**开在独立预览窗口**（browser:popout）——右栏内置浏览器与主对话重叠，用户明确要求
 * 「直接浏览独立弹窗打开，不要打开侧边栏」。独立窗口仍是同一个 Studio 实例 + 同一影片目录，
 * 改动实时写回，模型下一轮 openfilm_check 照样能看到。
 * ⛔ 主进程不自己开浏览器：URL 由 openfilm 事件下发，渲染层转成 browser:popout。
 * ⛔ 按需挂载：未安装 OpenFilm 的用户永远收不到这个事件，等于零成本。
 */
import { useEffect, useRef } from "react";

/** 本板块真正用到的宿主能力（结构化 props，⛔ 不深链 HarnessAppApi —— 守卫【130】）。 */
export type OpenfilmHost = {
  setNotice?: (text: string) => void;
  /** 兜底（极老版本没有 browserPopout 时）：退回右栏内置浏览器。 */
  openInBrowserPane?: (url: string) => void;
};

/** OpenFilm 桥：把「打开 Studio」转成独立预览窗口（browser:popout）；同一 URL 1.5s 内只开一次。 */
export function OpenfilmBridge({ app }: { app: OpenfilmHost }) {
  /* 同一次广播只开一个窗口：主进程一次 openStudio 只发一条 phase=studio，这里再做 1.5s 去重
     （防止重连广播立刻重复开两个独立窗口）。
     ⛔ 用户关掉独立窗口后再点「连接 Studio」必须能重开 ⇒ 去重只按时间窗口，不按 URL 永久记忆。 */
  const lastOpenRef = useRef<{ url: string; at: number } | null>(null);
  const actionsRef = useRef(app);
  actionsRef.current = app;

  useEffect(() => {
    const off = window.codex.onEvent((event: any) => {
      if (event?.type !== "openfilm") return;
      if (String(event?.phase ?? "") !== "studio") return;
      const url = String(event?.url ?? "");
      if (!/^https?:\/\//.test(url)) return;
      const last = lastOpenRef.current;
      if (last && last.url === url && Date.now() - last.at < 1500) return;
      lastOpenRef.current = { url, at: Date.now() };
      /* 11-21 用户令：「直接浏览独立弹窗打开，这里还打开侧边栏就有的鸡肋了」 */
      void window.codex.browserPopout?.(url).catch(() => {
        actionsRef.current.openInBrowserPane?.(url);
      });
      actionsRef.current.setNotice?.("OpenFilm Studio 已在独立窗口打开：改动会实时落到影片目录，你也可以直接在里面对着改。");
    });
    return () => { off?.(); };
  }, []);

  return null;
}
