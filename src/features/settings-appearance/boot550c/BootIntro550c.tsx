/**
 * 550C 启动片头 —— 把上游 dsh-550c-boot 的动画驱动装进一个 Shadow DOM。
 *
 * 设计（为什么这么做）：
 *  · **Shadow DOM 隔离**：整段 550C 资产（CSS/标记/驱动）活在影子树里，类名与样式不外泄，
 *    不怕与本仓海量全局 CSS 撞名（上游用的是 `:host` / `#boot` / `.wp-*` 这类短名）。
 *  · **宿主只做胶水**：上游资产（./assets.ts、./show.mjs）**逐字移植、零手改**；
 *    宿主 div 只负责「盖在最上层」——全屏与层级写在文档样式表的 `.boot550c-host`
 *    （position:fixed + z-index:9999），⛔ 不塞进影子树的 `:host`，免得与上游那套 `:host` 规则争同一批属性。
 *  · ⛔ **宿主 portal 到 `document.body`**：任何祖先把 `transform` / `filter` / `backdrop-filter` /
 *    `will-change` 加在自己身上，都会成为 containing block，把 `position:fixed` 从"相对视口"降级成
 *    "相对那个祖先"（本仓 10-06 事故同型）。设置抽屉里就有这样的祖先 ⇒ 不 portal 出去，预览只盖住
 *    设置内容列（实测截图：一块黑矩形，没铺满）。挂 body 与既有 `.boot-splash` 同模型。
 *  · ⛔ **挂载用 `useLayoutEffect`，不是 `useEffect`**：`useEffect` 在浏览器**首帧绘制之后**才跑
 *    ⇒ 会先绘制出 React 提交的那一帧（应用 UI + 一个还没内容的透明宿主）再被片头盖住 = **先闪一下主界面**。
 *    `useLayoutEffect` 在 DOM 变更后、首帧绘制前同步跑完 ⇒ 片头与 React 首帧同屏出现，不闪。
 *    宿主底色（`.boot550c-host` 的 `background`）是第二道保险：即便内容还没塞进去，也是黑的。
 *  · **跳过**：点击画面或 `Esc` ⇒ 驱动 `cancel()` 主动 unwind 所有 sleep，再回调 onDone。
 *
 * ⛔ 与上游同款约束：动画**不等待软件加载状态**，整段播完（或被跳过）才回调 onDone。
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { APP_MARKUP, BOOT_MARKUP, CSS_550C, ENHANCE_CSS } from "./assets";
import { createShow } from "./show.mjs";
import { bootIntroSchemeAttr } from "../../../lib/boot-intro.mjs";

/** 跳过时 sleep()/later() 的 reject 哨兵：只做身份比较，不落地、不展示。 */
const CANCELLED = Symbol("boot550c-cancelled");

export function BootIntro550c({
  mode,
  scheme = "amber",
  onDone,
}: {
  mode: "simple" | "full";
  scheme?: string;
  onDone: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const doneRef = useRef(onDone);
  // ⛔ 用 ref 承接回调：onDone 每次渲染都会换身份，直接进 deps 会让动画每渲染一次重播。
  useEffect(() => { doneRef.current = onDone; }, [onDone]);

  // ⛔ 用 useLayoutEffect：首帧绘制前就把影子内容挂好，否则会先闪一帧主界面（见文件头）。
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // 配色：琥珀 = 不设属性（上游没有 [data-scheme="amber"] 块，默认 :host 变量接管）。
    const schemeAttr = bootIntroSchemeAttr(scheme);
    if (schemeAttr) host.dataset.scheme = schemeAttr;
    else delete host.dataset.scheme;
    // StrictMode 是「挂载 → 卸载 → 再挂载同一个 DOM 节点」⇒ 复用已有的 shadow root，
    // 否则第二次 attachShadow 抛「host already hosts a shadow tree」。
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS_550C;
    root.appendChild(style);
    // 增强层样式表紧随其后（上游口径）：终端质感 --phos* 阶梯 + 四套配色块。
    const enhance = document.createElement("style");
    enhance.textContent = ENHANCE_CSS;
    root.appendChild(enhance);
    const holder = document.createElement("div");
    // 简易档只挂 BOOT_MARKUP（logo）；完整档再追加 APP_MARKUP（HUD / 终端 / 节点 / #final）。
    holder.innerHTML = mode === "full" ? BOOT_MARKUP + APP_MARKUP : BOOT_MARKUP;
    root.appendChild(holder);

    const show = createShow(root, { mode, cancelled: CANCELLED });
    let disposed = false;
    const finish = () => { if (!disposed) doneRef.current(); };
    const skip = () => { show.cancel(); finish(); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // ⛔ 捕获阶段拦下并吃掉：片头/预览「按 Esc 跳过」不该连带触发底下的 Esc 语义
      //    （设置页按 Esc 关抽屉 —— 预览时会把整页一起关掉；同款处理见开发工具错误弹窗）。
      event.preventDefault();
      event.stopPropagation();
      skip();
    };
    host.addEventListener("click", skip);
    window.addEventListener("keydown", onKey, true);

    void show.start().then(finish, (error: unknown) => { if (error !== CANCELLED) finish(); });

    return () => {
      disposed = true;
      window.removeEventListener("keydown", onKey, true);
      host.removeEventListener("click", skip);
      show.cancel();
      while (root.firstChild) root.removeChild(root.firstChild);
    };
  }, [mode, scheme]);

  // ⛔ portal 到 body：见文件头——祖先一旦成为 containing block，`position:fixed` 就不再相对视口。
  return createPortal(<div ref={hostRef} className="boot550c-host" aria-hidden="true" />, document.body);
}
