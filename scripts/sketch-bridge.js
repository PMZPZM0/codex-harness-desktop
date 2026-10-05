/*
 * nuphus 草图桥 —— 运行在**草图文档**（sketch://app）里，把当前画布内容报给 Codex Harness 主窗口，
 * 并把宿主/模型送来的文档写回画布。
 *
 * ⛔ 这段代码不在我们渲染层执行：`scripts/build-sketch-bundle.mjs` 把它**原样内联**进
 *    `public/sketch/index.html`（第三方静态产物里唯一属于我们的一段）。改完必须重跑
 *    `node scripts/build-sketch-bundle.mjs --bridge-only`，只改本文件不改产物 = 没生效
 *    （守卫【283】比对两边的规范化文本 + 在 node VM 里真跑本文件）。
 *
 * 为什么只能靠 postMessage：草图站是 `sketch://app` 源，主窗口是 `file://` / dev 的
 * `http://localhost:*` 源 ⇒ 拿不到对方 DOM，也读不到对方 localStorage。
 * ⚠️ targetOrigin 用 "*"：出草图的只有"用户自己画的界面 JSON"，无凭据、无文件路径；
 *    换精确 origin 要处理打包版 `file://` 的 "null" origin（Chromium 语义），复杂度全花在
 *    一个本来就不是秘密的载荷上。入站一律按 `source` 标记过滤，不认别人的消息。
 *
 * 方向：
 *  · 读 = localStorage["m3e:doc"] 直接回传（宿主据此显示「N 屏 / M 部件」、复制 JSON、合成任务）。
 *  · 写 = **只用上游自己的导入通道**：把文档编码成它的分享哈希（`#docz=`，deflate-raw + base64url，
 *    与上游 agent.md 给模型的命令行编码逐字节同口径）→ `location.hash = …` → 上游 `hashchange`
 *    → `readShareHash → arrive()`（**可 Ctrl+Z 撤销**，且是它校验/归一化文档的唯一正门）。
 *    ⛔ 桥自己**不写 localStorage**：直接改存储会绕过上游的校验与撤销栈（10-05 纪律：
 *       写画布 = 走它自己的入口；组件库面板那条已被用户判掉，见守卫【283】负向断言）。
 *
 * 序列化口径与上游导出分享**逐字对齐**（源码 lib/share 的编码函数）：frames 去掉 noteHistory；
 * item 去掉 noteHistory、`src` 只在是 http(s) 时才保留（内联图片不进链接）。
 */
(function () {
  "use strict";
  var SOURCE = "codex-harness-sketch";
  var DOC_KEY = "m3e:doc";

  function rawDoc() {
    try {
      return localStorage.getItem(DOC_KEY);
    } catch (error) {
      return null;
    }
  }

  function currentDoc() {
    try {
      var raw = rawDoc();
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

  /* ───────────────────────── 写：编码成上游的分享哈希 ───────────────────────── */

  /** 与上游导出/分享同一口径（见文件头）；多出的字段一律原样带走。 */
  function shareable(doc) {
    var out = {};
    for (var key in doc) out[key] = doc[key];
    out.frames = (Array.isArray(doc.frames) ? doc.frames : []).map(function (frame) {
      var copy = {};
      for (var fk in frame) if (fk !== "noteHistory") copy[fk] = frame[fk];
      return copy;
    });
    out.groups = (Array.isArray(doc.groups) ? doc.groups : []).map(function (group) {
      var copy = {};
      for (var gk in group) copy[gk] = group[gk];
      copy.items = (Array.isArray(group.items) ? group.items : []).map(function (item) {
        var keep = {};
        for (var ik in item) if (ik !== "src" && ik !== "noteHistory") keep[ik] = item[ik];
        if (typeof item.src === "string" && /^https?:\/\//.test(item.src)) keep.src = item.src;
        return keep;
      });
      return copy;
    });
    return out;
  }

  /** base64url（无 padding）——与上游一致；分块拼接避免超长数组撑爆调用栈。 */
  function base64url(bytes) {
    var text = "";
    for (var i = 0; i < bytes.length; i += 8192) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /** `#docz=`（deflate-raw + base64url）；没有 CompressionStream 的老环境回落 `#doc=`（原文 URI 编码）。 */
  function shareHash(json) {
    if (typeof CompressionStream === "undefined") return Promise.resolve("#doc=" + encodeURIComponent(json));
    var stream = new CompressionStream("deflate-raw");
    var writer = stream.writable.getWriter();
    writer.write(new TextEncoder().encode(json)).catch(function () {});
    writer.close().catch(function () {});
    return new Response(stream.readable).arrayBuffer().then(function (buffer) {
      return "#docz=" + base64url(new Uint8Array(buffer));
    });
  }

  /** 内容没变时上游可能不落盘（无 hashchange 可观察）⇒ 用 frames/groups 的结构比较兜底判成功。 */
  function matchesSent(raw, sentJson) {
    try {
      var current = raw ? JSON.parse(raw) : null;
      var sent = JSON.parse(sentJson);
      return !!current
        && JSON.stringify(current.frames) === JSON.stringify(sent.frames)
        && JSON.stringify(current.groups) === JSON.stringify(sent.groups);
    } catch (error) {
      return false;
    }
  }

  /* 导入 = 设哈希 + 轮询确认（宿主跨源看不见里面，只能靠存储变化判结果）。
     ⛔ 只经上游 hashchange → arrive() 落盘；桥不碰 setItem/removeItem。 */
  function importDoc(doc) {
    var sent = JSON.stringify(shareable(doc));
    shareHash(sent).then(function (hash) {
      var before = rawDoc();
      try {
        location.hash = hash;
      } catch (error) {
        post({ type: "load-doc-result", ok: false, error: "无法写入地址哈希：" + String(error && error.message || error).slice(0, 120) });
        return;
      }
      var tries = 0;
      (function poll() {
        tries += 1;
        var now = rawDoc();
        if ((now !== null && now !== before) || matchesSent(now, sent)) {
          post({ type: "doc", doc: currentDoc() });
          post({ type: "load-doc-result", ok: true, doc: currentDoc() });
          return;
        }
        if (tries >= 20) {
          post({ type: "load-doc-result", ok: false, error: "导入后画布没有变化 —— 文档可能被上游判为无效（kind / variant 要取它的枚举值），或编辑器不是可写实例（Web Locks 被占）" });
          return;
        }
        setTimeout(poll, 150);
      })();
    }).catch(function (error) {
      post({ type: "load-doc-result", ok: false, error: "编码失败：" + String(error && error.message || error).slice(0, 120) });
    });
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.source !== SOURCE) return;
    if (data.type === "ping" || data.type === "get-doc") {
      post({ type: "doc", doc: currentDoc() });
    } else if (data.type === "load-doc" && data.doc) {
      importDoc(data.doc);
    }
  });

  /* 别的标签页/窗口改这份文档时同步上报（同源才有的事件；主路径仍是宿主按需 get-doc）。 */
  window.addEventListener("storage", function (event) {
    if (event.key === DOC_KEY) post({ type: "doc", doc: currentDoc() });
  });

  post({ type: "ready", doc: currentDoc() });
})();
