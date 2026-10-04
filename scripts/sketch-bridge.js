/*
 * nuphus 草图桥 —— 运行在**草图文档**（sketch://app）里，与 Codex Harness 主窗口双向传话。
 *
 * ⛔ 这段代码不在我们渲染层执行：`scripts/build-sketch-bundle.mjs` 把它**原样内联**进
 *    `public/sketch/index.html`（第三方静态产物里唯一属于我们的一行）。改完必须重跑那个脚本，
 *    只改本文件不改产物 = 没生效（守卫【283】比对两边的规范化文本）。
 *
 * 为什么只能靠 postMessage：草图站是 `sketch://app` 源，主窗口是 `file://` / dev 的
 * `http://localhost:*` 源 ⇒ 拿不到对方 DOM，也读不到对方 localStorage。
 * ⚠️ targetOrigin 用 "*"：出草图的只有"用户自己画的界面 JSON"，无凭据、无文件路径；
 *    换精确 origin 要处理打包版 `file://` 的 "null" origin（Chromium 语义），复杂度全花在
 *    一个本来就不是秘密的载荷上。入站一律按 `source` 标记过滤，不认别人的消息。
 *
 * 写通道用它**自己的**导入机制（lib/share.ts 的 `#doc=` + lib/project.ts 的 isProject 校验）：
 * 改 hash ⇒ 它的 hashchange 监听 ⇒ arrive()：设计落到画布、被替换的那份留在 draftBefore
 * 里可一键撤销 ⇒ 我们不重载页面，用户的草图不会被我们冲掉。
 * ⛔ 必须 encodeURIComponent：JSON 里的 `&` 会被 URLSearchParams 当分隔符、`+` 会变成空格，
 *    颜色值 `#6750A4` 里的 `#` 反倒无害。
 */
(function () {
  "use strict";
  var SOURCE = "codex-harness-sketch";
  var DOC_KEY = "m3e:doc";

  function currentDoc() {
    try {
      var raw = localStorage.getItem(DOC_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function post(message) {
    message.source = SOURCE;
    message.diag = diag();
    try {
      window.parent.postMessage(message, "*");
    } catch (error) {
      /* 独立打开这份产物（没有父窗口）时静默：桥是可选通道，不是页面的前提 */
    }
  }

  /* 诊断包：宿主这一侧看不见 iframe 里面（跨源），一旦"画布没内容"就只能靠这里带出来的
     几个布尔值判断卡在哪一步（编辑器没挂载 / 骨架屏没退 / Web Locks 缺失 / 脚本报错）。
     ⛔ 只带布尔值与首条错误摘要，不带用户内容。 */
  var errors = [];
  window.addEventListener("error", function (event) {
    if (errors.length < 3) errors.push((String(event.message || event.type || "error").slice(0, 120)) + " @" + String(event.filename || "?").split("/").pop() + ":" + event.lineno);
  });
  window.addEventListener("unhandledrejection", function (event) {
    if (errors.length < 3) errors.push(("rejection: " + String((event.reason && event.reason.message) || event.reason || "")).slice(0, 160));
  });

  function diag() {
    try {
      return {
        locks: typeof navigator.locks !== "undefined",
        root: !!document.querySelector(".app-root"),
        boot: !!document.querySelector(".m3e-boot"),
        keys: Object.keys(localStorage).length,
        errors: errors,
      };
    } catch (error) {
      return { unavailable: String(error && error.message || error).slice(0, 120) };
    }
  }

  /** 同一个文档推两次也要触发 hashchange：先把 hash 抹干净再写（它的 offer() 也会自己清）。 */
  function pushHash(json) {
    try {
      history.replaceState(null, "", location.pathname + location.search);
    } catch (error) {
      /* 个别源上 replaceState 会被拒：最坏是"同样的文档推第二次没反应"，不影响第一次落地 */
    }
    location.hash = "#doc=" + encodeURIComponent(json);
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.source !== SOURCE) return;
    if (data.type === "ping") {
      post({ type: "pong", doc: currentDoc() });
      return;
    }
    if (data.type === "get-doc") {
      post({ type: "doc", doc: currentDoc() });
      return;
    }
    if (data.type === "load-doc") {
      var doc = data.doc;
      if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
        post({ type: "error", error: "文档不是一个对象" });
        return;
      }
      var json;
      try {
        json = JSON.stringify(doc);
      } catch (error) {
        post({ type: "error", error: "文档无法序列化" });
        return;
      }
      pushHash(json);
      return;
    }
  });

  /* 别的标签页/窗口改这份文档时同步上报（同源才有的事件；主路径仍是宿主按需 get-doc）。 */
  window.addEventListener("storage", function (event) {
    if (event.key === DOC_KEY) post({ type: "doc", doc: currentDoc() });
  });

  post({ type: "ready", doc: currentDoc() });
})();
