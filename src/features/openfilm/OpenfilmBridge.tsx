/**
 * OpenFilm Studio 的渲染层桥（10-27 批次二）。
 *
 * 主进程跑完 `openfilm open <dir>` 后广播 `openfilm` 事件的 `phase:"studio"`，
 * 这里把它**开进右栏内置浏览器** —— 同一实例（Studio）+ 同一目录（影片）就是需求里说的
 * 「连接与配对」；用内置浏览器而不是系统浏览器，是因为用户与模型看的是同一个页面，
 * 手改立刻写回影片文件，模型下一轮 `openfilm_check` 就能看到。
 *
 * ⛔ 主进程不自己开浏览器：内置浏览器是渲染层的 webview，主进程没有它的句柄。
 * ⛔ 只认当前窗口（弹窗会话也挂一份不冲突：它只是把 URL 交给自己的右栏）。
 * ⛔ 按需挂载：未安装 OpenFilm 的用户永远收不到这个事件，等于零成本。
 */
import { useEffect, useRef } from "react";

/** 本板块真正用到的宿主能力（结构化 props，⛔ 不深链 HarnessAppApi —— 守卫【130】）。 */
export type OpenfilmHost = {
  openInBrowserPane: (url: string) => void;
  setNotice?: (text: string) => void;
  /** 右栏当前状态：用来判断"同一个 URL 是不是已经显示着"（⛔ 不传就退回"只按 URL 去重"） */
  rightOpen?: boolean;
  rightTab?: string;
};

export function OpenfilmBridge({ app }: { app: OpenfilmHost }) {
  /* 同一 URL 连续广播只开一次，避免右栏反复重载。
     ⛔ 但"去重"不能只看 URL：用户把右栏关掉（或切到别的页签）后再点「打开 Studio」，
        广播的 URL 与上次**完全相同**，只看 URL 就会静默什么都不做（用户以为按钮坏了）。
     ⇒ 只有「同一 URL **且** 右栏正开着浏览器页」才跳过。 */
  const lastUrlRef = useRef("");
  const actionsRef = useRef(app);
  actionsRef.current = app;

  useEffect(() => {
    const off = window.codex.onEvent((event: any) => {
      if (event?.type !== "openfilm") return;
      if (String(event?.phase ?? "") !== "studio") return;
      const url = String(event?.url ?? "");
      if (!/^https?:\/\//.test(url)) return;
      const alreadyShowing = url === lastUrlRef.current
        && actionsRef.current.rightOpen === true
        && String(actionsRef.current.rightTab ?? "") === "browser";
      if (alreadyShowing) return;
      lastUrlRef.current = url;
      actionsRef.current.openInBrowserPane(url);
      /* 让用户知道"谁在改我的片子"：Studio 打开 = 模型接下来的改动会实时落在这个页面里 */
      actionsRef.current.setNotice?.("OpenFilm Studio 已在内置浏览器打开：改动会实时落到影片目录，你也可以直接在里面对着改。");
    });
    return () => { off?.(); };
  }, []);

  return null;
}
