import { useEffect, useMemo, useState } from "react";

/** 启动太快时不显示启动页（一闪而过比没有更刺眼）。低于这个值直接跳过。 */
const MIN_SHOW_MS = 300;
/** 淡出动画时长，必须与 index.html 的 boot-fade-out 保持一致。 */
const FADE_MS = 280;

export type BootStage = "starting" | "engine" | "threads" | "ready";

const STAGE_TEXT: Record<BootStage, string> = {
  starting: "正在启动 Codex Harness…",
  engine: "正在连接引擎…",
  threads: "正在加载会话…",
  ready: "即将就绪…",
};

/** 启动加载页（渲染层接手段）。
 *
 *  为什么渲染层还要再来一份：index.html 里那份只能活到 `createRoot().render()`
 *  ——React 会整块替换 #root，动画在 React 挂载那一刻就消失了。而实测（09-17）
 *  从挂载到首屏会话数据到达还有 1.3~2.1s，这段时间界面上什么反馈都没有。
 *
 *  所以这里用**同一套 .boot-splash 类名**（样式定义在 index.html，JS 未加载时也要能显示）
 *  在挂载瞬间接手，一直盖到 `done`（首屏数据到达）再淡出。
 *
 *  `stage` 由真实状态驱动（引擎状态 / 会话加载），不是放假进度条。
 */
export function BootSplash({ stage, done }: { stage: BootStage; done: boolean }) {
  // 挂载时就定好：启动太快（<300ms）直接不渲染，避免闪一下
  const [visible, setVisible] = useState(() => performance.now() >= MIN_SHOW_MS);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    // 阶段观测（09-17）：写进 window.__boot.stages，供验收断言"阶段由真实状态驱动"
    // 与线上诊断（启动卡在哪一段）。与 electron/boot-timing.ts 的落盘互补。
    const boot = (window as unknown as { __boot?: Record<string, unknown> }).__boot;
    if (boot) {
      const list = (boot.stages ??= []) as string[];
      if (list[list.length - 1] !== stage) list.push(stage);
    }
  }, [stage]);

  useEffect(() => {
    if (!visible || !done) return;
    setLeaving(true);
    const timer = window.setTimeout(() => setVisible(false), FADE_MS + 40);
    return () => window.clearTimeout(timer);
  }, [visible, done]);

  const text = useMemo(() => STAGE_TEXT[stage], [stage]);
  if (!visible) return null;

  return <div className={`boot-splash${leaving ? " boot-splash-leaving" : ""}`} role="status" aria-live="polite">
    <img className="boot-splash-logo" src={`${import.meta.env.BASE_URL}icon.png`} alt="" />
    <div className="boot-splash-spinner" />
    <p>{text}</p>
  </div>;
}
