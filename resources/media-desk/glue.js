/* 把开源客户端的 main 面挂到独立画布里（宿主插槽的最小适配）。 */
(function () {
  const el = document.getElementById("root");
  const fatal = (message) => {
    el.innerHTML = '<pre id="md-fatal"></pre>';
    document.getElementById("md-fatal").textContent = message;
  };
  const mod = window.__mdModule;
  if (!mod || typeof mod.apply !== "function") return fatal("客户端模块没有导出 apply()");
  const ctx = {
    get() { return undefined; },
    effect(fn) { try { const d = fn(); return typeof d === "function" ? d : () => {}; } catch (e) { console.error("[media-desk] effect", e); return () => {}; } },
    slots: {
      inject(_name, cb) { try { const d = cb(); return typeof d === "function" ? d : () => {}; } catch (e) { console.error("[media-desk] inject", e); return () => {}; } },
      register(config, component) {
        if (config && config.name === "main") window.__mdMain = component;
        return () => {};
      },
    },
  };
  try { mod.apply(ctx); } catch (e) { return fatal("启动失败：" + (e && e.message || e)); }
  const React = window.MDReact.React;
  if (!window.__mdMain) return fatal("没有注册主界面");
  window.MDReact.createRoot(el).render(React.createElement(window.__mdMain));
  mountBottomXScroll();

  /* 顶部横向滚动条（11-12 用户令「这底下滚轮放错了，我要滚下去才能看见，放上面来」）。
     上游的横向滚动在 `.md-board` 上，而它高 1700+px，原生横条在内容底部 ——
     要先把整页滚到底才够得着。这里在看板之后插一条 sticky 的镜像横条，
     贴可视区底部常驻，scrollLeft 双向同步；原生横条隐藏，避免出现两条。 */
  function mountBottomXScroll() {
    var boundBoard = null, ro = null, syncing = false, raf = 0, scrollRaf = 0;
    var bar = null;

    function board() { return document.querySelector(".md-board"); }
    function page() { return document.querySelector(".md-page"); }

    function sync() {
      var b = board();
      if (!bar) return;
      if (!b) { bar.style.display = "none"; return; }
      var overflow = b.scrollWidth - b.clientWidth;
      bar.style.display = overflow > 2 ? "block" : "none";
      var inner = bar.firstElementChild;
      /* ⛔ 只在值变了才写样式：这个 sync 会被 ResizeObserver / 结构变化频繁触发，
         无脑赋值会每帧刷新布局（助手流式输出时页面 DOM 变动很密）。 */
      var innerW = Math.max(b.scrollWidth, b.clientWidth) + "px";
      if (inner && inner.style.width !== innerW) inner.style.width = innerW;
      var c = document.querySelector(".md-content");
      if (c) {
        var cr = c.getBoundingClientRect(), br = b.getBoundingClientRect();
        var left = Math.max(0, Math.round(br.left - cr.left)) + "px";
        var width = b.clientWidth + "px";
        if (bar.style.left !== left) bar.style.left = left;
        if (bar.style.width !== width) bar.style.width = width;
      }
      if (Math.abs(bar.scrollLeft - b.scrollLeft) > 1) bar.scrollLeft = b.scrollLeft;
    }

    function ensure() {
      var b = board(), p = page();
      if (!b || !p) { if (bar) bar.style.display = "none"; return; }
      var c = document.querySelector(".md-content");
      if (!c) { if (bar) bar.style.display = "none"; return; }
      /* 挂在 .md-content（不滚动的可视面板）里贴底，CSS 的 absolute + bottom:6px 负责纵向；
         若 React 重渲染把它摘掉，下面的 MutationObserver 会重新挂回来。 */
      if (!bar || !bar.isConnected || bar.parentElement !== c) {
        bar = document.createElement("div");
        bar.className = "md-bottom-xscroll";
        bar.setAttribute("aria-label", "看板横向滚动");
        bar.appendChild(document.createElement("div")).className = "md-bottom-xscroll-inner";
        c.appendChild(bar);
      }
      if (boundBoard !== b) {
        boundBoard = b;
        if (ro) ro.disconnect();
        ro = new ResizeObserver(sync);
        ro.observe(b);
      }
      sync();
    }

    /* 滚动事件不冒泡，但捕获阶段能拿到所有元素；用一条文档级监听避免反复绑新看板。 */
    document.addEventListener("scroll", function (event) {
      var b = board();
      if (!b) return;
      /* 任何滚动都顺手重算一次贴底坐标：md-content 有入场动画（md-rise 的 transform），
         动画期间量的位置会差几像素，滚动时补一次就对齐了。 */
      if (!scrollRaf) scrollRaf = requestAnimationFrame(function () { scrollRaf = 0; sync(); });
      if (syncing) return;
      if (event.target === b) { syncing = true; if (bar) bar.scrollLeft = b.scrollLeft; requestAnimationFrame(function () { syncing = false; }); }
      else if (bar && event.target === bar) { syncing = true; b.scrollLeft = bar.scrollLeft; requestAnimationFrame(function () { syncing = false; }); }
    }, true);

    /* 看板/页面会被 React 重建（切「看板/表格」、切顶部 tab）⇒ 结构变化后重新挂一次。 */
    new MutationObserver(function () {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; ensure(); });
    }).observe(el, { childList: true, subtree: true });

    ensure();
    /* 入场动画结束前再补量两次，避免贴底坐标停在动画中间态 */
    setTimeout(sync, 150);
    setTimeout(sync, 500);
  }
})();
