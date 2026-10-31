/**
 * remote/web-page.ts —— 手机远控的**内嵌 H5 页面**（字符串模板）。
 *
 * 从 electron/remote.ts（1026 行单类）抽出（P2 批次 3）：原 `html()` 实测 **0 处 this.** 引用，
 * 是对 (code, botId, botName) 的纯函数 —— 抽出去零行为变化，且让服务类只剩「协议与生命周期」。
 * ⛔ 页面内容（HTML/CSS/JS）原样搬运，一个字都没动。
 */

import fs from "node:fs";
import path from "node:path";

/** 手机端 Markdown 渲染器：**内联同一份纯模块源码**（预检真跑的就是它，别在页面里另写一套）。
 *  ⛔ 读不到也不能把页面打挂：退回纯文本。 */
const MOBILE_MARKDOWN_SOURCE = (() => {
  try {
    return fs
      .readFileSync(path.join(__dirname, "..", "..", "src", "lib", "mobile-markdown.mjs"), "utf8")
      .replace(/^export\s+/gm, "");
  } catch {
    return "function renderMarkdownHtml(value) { return String(value || ''); }\nfunction renderMarkdownInline(value) { return String(value || ''); }";
  }
})();

/** ⛔ botName 来自 URL 查询串：拼进 HTML 前必须转义（已配对用户点一个构造链接就能在本域执行脚本，
 *  同源 cookie 可直接调 /api/rpc 控制电脑）。 */
function escapeHtmlText(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[ch] ?? ch);
}

export function buildRemotePageHtml(code: string, botId?: string, botName?: string, brandName = "Codex Harness", brandIcon = ""): string {
    const bindingMode = Boolean(botId);
    if (bindingMode) {
      // 绑定模式：确认登录 → 确认成功后 location 换成不带 ?bot= 的对话页
      return `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>绑定机器人</title><style>
body{font-family:system-ui,sans-serif;background:#f7f7f5;margin:0;color:#23231f}
.card{background:#fff;border:1px solid #e7e7e4;border-radius:14px;padding:20px;margin:40px 16px;text-align:center}
h1{font-size:18px;margin:0 0 6px} p{color:#6f6f69;font-size:13px;line-height:1.7;margin:8px 0}
button{width:100%;margin-top:14px;padding:13px;border:0;border-radius:12px;background:#1e1e1c;color:#fff;font-size:15px;cursor:pointer}
button.ghost{background:#fff;color:#23231f;border:1px solid #d7d9d4}
.ok{color:#1a7f37;font-weight:600}
</style>
<div class="card"><h1>绑定机器人「${escapeHtmlText(botName)}」</h1><p>确认后，这台手机将作为该机器人的控制端：<br>可查看对话、随时发消息，与电脑实时同步。</p><p id="state">正在校验绑定码…</p><div id="btns" style="display:none"><button onclick="doBind()">确认登录</button><button class="ghost" onclick="document.getElementById('btns').style.display='none'">取消</button></div></div>
<script>
const code = ${JSON.stringify(code)};
const botId = ${JSON.stringify(botId ?? "")};
/* 中转前缀（10-29）：手机经 /t/<设备ID> 访问时，所有接口都要带上这段前缀 */
const API_BASE = (function(){ const p = location.pathname; const i = p.indexOf("/r/"); return i > 0 ? p.slice(0, i) : ""; })();
async function check(){
  try{
    const r = await fetch(API_BASE + "/api/bind-status?code=" + code + "&bot=" + botId);
    const j = await r.json();
    if(j.ok){ document.getElementById("state").textContent = "绑定码有效"; document.getElementById("btns").style.display = "block"; }
    else document.getElementById("state").textContent = "绑定码已失效，请回到应用重新生成二维码。";
  }catch(e){ document.getElementById("state").textContent = "网络错误：" + e.message; }
}
check();
async function doBind(){
  const r = await fetch(API_BASE + "/api/bind-confirm", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ code, botId, deviceName: navigator.userAgent.includes("iPhone") ? "iPhone" : navigator.userAgent.includes("Android") ? "Android 手机" : "手机" }) });
  const j = await r.json();
  if (j.ok) { document.querySelector(".card").innerHTML = "<h1 class='ok'>✓ 绑定成功</h1><p>正在进入对话…</p>"; setTimeout(() => { location.href = API_BASE + "/r/" + code; }, 800); }
  else document.getElementById("state").textContent = "绑定失败：" + (j.error ?? "未知错误");
}
</script></html>`;
    }
    const pageHtml = `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<meta name="theme-color" content="#f7f7f5">
<title>Codex 对话</title><style>
*{box-sizing:border-box}
html,body{max-width:100%;overflow-x:hidden}
:root{--accent:#2f6bdd;--accent-soft:#eaf1fd;--line:#e8e8e4;--muted:#8a8a84;--ink:#23231f;--bg:#f7f7f5}
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);margin:0;color:var(--ink);display:flex;flex-direction:column;height:100vh;height:100dvh}
header{position:relative;padding:10px 14px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px;flex:0 0 auto}
/* 10-30 用户：「把应用顶上中间的 logo 删了」⇒ 顶栏只留 ☰ + 当前会话名 + 状态点（不再放品牌 logo） */
.menu-btn,.icon-btn{flex:none;width:34px;height:34px;padding:0;margin:0;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);font-size:16px;line-height:1}
html[data-theme="dark"] .menu-btn,html[data-theme="dark"] .icon-btn{background:#1b2029}
.thread-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:600;color:var(--ink)}
header .status{width:8px;height:8px;flex:none;margin-left:8px;border-radius:50%;background:#1a7f37;padding:0;font-size:0;overflow:hidden}
#top-menu{position:absolute;top:52px;left:12px;z-index:40;width:236px;padding:6px;background:var(--panel,#fff);border:1px solid var(--line);border-radius:16px;box-shadow:0 18px 44px rgba(0,0,0,.18);transform-origin:12px 0}
#top-menu[hidden]{display:none}
#top-menu.open{animation:menu-in .18s cubic-bezier(.2,.9,.3,1.2)}
#top-menu .menu-group{border-bottom:1px solid var(--line);padding-bottom:6px;margin-bottom:6px}
#top-menu button{display:flex;align-items:center;gap:10px;width:100%;margin:0;padding:10px 10px;border:0;border-radius:11px;background:transparent;color:var(--ink);font-size:13px;text-align:left;transition:background .15s}
#top-menu button:active{background:color-mix(in srgb,var(--accent) 12%,transparent)}
#top-menu button i{flex:none;width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:16px;background:var(--accent-soft);font-style:normal}
#top-menu button span{display:flex;flex-direction:column;gap:2px;min-width:0}
#top-menu button b{font-size:13.5px;font-weight:600}
#top-menu button small{font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#top-menu button.danger b{color:#d0463b}
#top-menu button.danger i{background:color-mix(in srgb,#d0463b 14%,transparent)}
@keyframes menu-in{from{opacity:0;transform:scale(.92) translateY(-6px)}to{opacity:1;transform:none}}
#threads{position:fixed;inset:0;background:#fff;z-index:20;display:none;flex-direction:column}
#threads.open{display:flex}
#threads .list{flex:1;overflow:auto;padding:4px 0 20px}
.threads-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line);background:#fff}
.threads-head b{flex:1;font-size:15px;font-weight:600;text-align:center}
.threads-head button{width:auto;margin:0;padding:7px 12px;font-size:12px;background:#fff;color:var(--ink);border:1px solid var(--line);border-radius:999px}
.threads-head .new-thread{background:var(--accent-soft);color:var(--accent);border-color:transparent;font-weight:600}
.empty-tip{text-align:center;color:#adada6;padding:40px 16px;font-size:13px;line-height:1.8}
.empty-tip button{width:auto;margin-top:10px;padding:7px 16px;font-size:13px;background:#fff;color:var(--accent);border:1px solid #cfdcf7;border-radius:999px}
.thread-row{padding:13px 16px;border-bottom:1px solid #f2f2ef;cursor:pointer}
.thread-row:active{background:#f6f6f3}
.thread-row b{display:block;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.thread-row small{display:block;margin-top:3px;color:var(--muted);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.thread-row.active{background:var(--accent-soft)}
#msglist{flex:1;overflow-y:auto;padding:16px 14px 24px;display:flex;flex-direction:column;gap:12px}
#msglist[hidden]{display:none}
.msg{max-width:84%;padding:11px 14px;border-radius:16px;font-size:15px;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}
.msg.user{align-self:flex-end;background:var(--accent-soft);color:var(--ink);border:1px solid #d9e4fb;border-bottom-right-radius:6px}
.msg.assistant{align-self:flex-start;background:#fff;border:1px solid var(--line);border-bottom-left-radius:6px;box-shadow:0 1px 2px rgba(35,35,31,.04)}
.msg.assistant.streaming{border-color:#e8b34b;box-shadow:0 1px 2px rgba(232,179,75,.12)}
.msg.system{align-self:center;background:#efefec;color:var(--muted);font-size:12px;padding:4px 12px;border-radius:999px}
.run-steps{align-self:flex-start;max-width:84%;font-size:12px;color:var(--muted);background:#f1f1ee;border:1px solid #e6e6e2;border-radius:12px;padding:6px 10px;box-sizing:border-box}
.run-steps summary{cursor:pointer;list-style:none;color:var(--muted)}
.run-steps summary::-webkit-details-marker{display:none}
.run-steps summary::before{content:"▸ "}
.run-steps[open] summary::before{content:"▾ "}
.run-steps .step{padding:2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.run-steps .step-files{white-space:pre-line;word-break:break-all;max-height:120px;overflow:auto}
.run-steps .step-notice{color:#8a6d1f;background:#fdf6e0;border-radius:6px;padding:3px 6px;white-space:normal;overflow:visible;text-overflow:clip}
.ask-card{margin:6px 0;padding:8px;border:1px solid #e6d9a8;background:#fffdf3;border-radius:10px;display:flex;flex-direction:column;gap:6px}
.ask-q{font-size:12.5px;color:#6a5a1f;line-height:1.5;white-space:pre-wrap}
.ask-opts{display:flex;flex-wrap:wrap;gap:6px}
.ask-opt{padding:6px 12px;font-size:12px;color:var(--accent);background:#fff;border:1px solid #cfdcf7;border-radius:999px}
.step-more{align-self:flex-start;margin-top:3px;padding:2px 8px;font-size:11px;color:var(--accent);background:none;border:1px solid #cfdcf7;border-radius:999px}
#goalbar{padding:6px 12px;background:#fff6f8;border-top:1px solid var(--line);font-size:12px;color:#8a2f4a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#taskbar{padding:6px 12px;background:#fff;border-top:1px solid var(--line);font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.run-steps .think{margin-top:5px;padding-top:5px;border-top:1px dashed #ddd9d2;color:#6f6f69;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto}
.run-steps .step-out{display:none;margin:2px 0 6px;padding:6px 8px;background:#fff;border:1px solid var(--line);border-radius:8px;font-size:11px;line-height:1.5;max-height:160px;overflow:auto;white-space:pre-wrap;word-break:break-all;color:#4a4a46}
.run-steps .step-out.on{display:block}
.msg.assistant.md{white-space:normal}
.msg p{margin:6px 0}
.msg p:first-child{margin-top:0}
.msg p:last-child{margin-bottom:0}
.md-h{font-weight:600;margin:10px 0 4px}
.md-h1{font-size:17px}.md-h2{font-size:16px}.md-h3{font-size:15px}
.md-h4,.md-h5,.md-h6{font-size:14px}
.msg .md-pre{margin:8px 0;padding:8px 10px;background:#f4f4f1;border:1px solid var(--line);border-radius:8px;overflow:auto;font-size:12px;line-height:1.5}
.msg .md-pre code{font-family:ui-monospace,Consolas,monospace;white-space:pre;background:none;padding:0}
.msg code{font-family:ui-monospace,Consolas,monospace;background:#f0f0ec;border-radius:4px;padding:0 4px;font-size:12.5px}
.msg .md-table{overflow:auto;margin:8px 0}
.msg table{border-collapse:collapse;font-size:12.5px}
.msg th,.msg td{border:1px solid var(--line);padding:4px 8px;text-align:left;white-space:nowrap}
.msg th{background:#f6f6f3;font-weight:600}
.msg blockquote{margin:8px 0;padding:2px 10px;border-left:3px solid var(--line);color:#6f6f69}
.msg ul,.msg ol{margin:6px 0;padding-left:20px}
.msg li{margin:2px 0}
.msg li.md-sub{margin-left:14px;list-style:circle}
.msg a{color:var(--accent);text-decoration:underline}
.msg hr{border:0;border-top:1px solid var(--line);margin:10px 0}
#plus{flex:0 0 auto;width:44px;height:44px;margin:0;padding:0;font-size:22px;line-height:40px;color:var(--ink);background:#f2f2ef;border:1px solid var(--line);border-radius:14px}
#voice{flex:0 0 auto;width:38px;height:38px;margin:0;padding:0;font-size:18px;line-height:36px;color:var(--ink);background:#f2f2ef;border:1px solid var(--line);border-radius:12px}
html[data-theme="dark"] #voice{background:#1b2029}
#file-pick{display:none}
#camera-pick{display:none}
.emoji-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;padding:6px 14px 4px}
.emoji-grid button{border:1px solid var(--line);background:var(--panel);border-radius:10px;padding:8px 0;font-size:20px;line-height:1}
#imgs{display:none;gap:8px;padding:8px 12px 0;background:#fff;overflow-x:auto}
#imgs.on{display:flex}
#imgs .chip{position:relative;width:56px;height:56px;flex:0 0 auto;border-radius:10px;overflow:hidden;border:1px solid var(--line)}
#imgs .chip img{width:100%;height:100%;object-fit:cover;display:block}
#imgs .chip button{position:absolute;top:2px;right:2px;width:18px;height:18px;margin:0;padding:0;border:0;border-radius:9px;background:rgba(0,0,0,.55);color:#fff;font-size:11px;line-height:18px}
.mask{position:fixed;inset:0;background:rgba(0,0,0,.25);z-index:29;display:none}
.mask.on{display:block}
#sheet{position:fixed;left:0;right:0;bottom:0;z-index:30;display:none;background:#fff;border-top:1px solid var(--line);border-radius:16px 16px 0 0;box-shadow:0 -6px 24px rgba(0,0,0,.12);padding:12px 12px calc(14px + env(safe-area-inset-bottom))}
#sheet.open{display:block}
#sheet .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
#sheet .grid button{border:0;background:#f4f4f1;border-radius:12px;padding:12px 6px;font-size:12px;color:var(--ink);display:flex;flex-direction:column;align-items:center;gap:6px}
#sheet .grid button b{font-size:18px;font-weight:600}
.panel{position:fixed;inset:0;z-index:40;display:none;flex-direction:column;background:#fff}
.panel.open{display:flex}
.panel-head{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line)}
.panel-head b{flex:1;font-size:15px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.panel-head button{width:auto;margin:0;padding:7px 12px;font-size:12px;border:1px solid var(--line);border-radius:999px;background:#fff;color:var(--ink)}
.panel-body{flex:1;overflow:auto;padding:4px 0 24px}
.panel-body pre{margin:0;padding:14px;font-size:12.5px;line-height:1.65;white-space:pre-wrap;word-break:break-word;color:var(--ink)}
.panel-body img{max-width:100%;display:block;margin:12px auto}
.file-row,.cmd-row{display:flex;gap:8px;align-items:center;padding:12px 16px;border-bottom:1px solid #f2f2ef;font-size:13.5px}
.file-row .nm{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.file-row small{color:var(--muted);font-size:11px}
.cmd-row{flex-direction:column;align-items:flex-start}
.cmd-row small{color:var(--muted);font-size:12px;margin-top:3px}
.thinking-indicator{align-self:flex-start;display:flex;align-items:center;gap:6px;padding:6px 4px;color:var(--muted);font-size:12px}
.thinking-indicator .dot{width:6px;height:6px;background:#e8b34b;border-radius:50%;animation:throb 1.2s infinite}
@keyframes throb{0%,100%{opacity:.4;transform:scale(.8)}50%{opacity:1;transform:scale(1.2)}}
#inputbar{flex:0 0 auto;display:flex;gap:8px;align-items:center;padding:10px 12px;background:#fff;border-top:1px solid var(--line);padding-bottom:calc(10px + env(safe-area-inset-bottom))}
#cmd{flex:1;padding:12px 14px;border:1px solid var(--line);border-radius:14px;font-size:15px;background:#fafaf8;color:var(--ink);outline:none}
#cmd:focus{border-color:var(--accent);background:#fff}
#send{flex:0 0 auto;width:auto;margin:0;height:44px;padding:0 18px;font-size:14px;font-weight:600;color:#fff;background:var(--accent);border:0;border-radius:14px}
#send:active{opacity:.85}
#send.stop{background:#c0392b}
.confirm-card{margin:40vh auto 0;max-width:340px;text-align:center}
/* ── 首页（普通 / 中枢）── */
#home{flex:1;overflow-y:auto;overflow-x:hidden;padding:16px 14px 24px}
#home[hidden]{display:none}
.home-tabs{display:flex;gap:6px;padding:3px;border:1px solid var(--line);border-radius:999px;background:#f4f4f1;width:max-content;margin:0 auto 16px}
.home-tab{border:0;background:transparent;color:var(--muted);font-size:12.5px;padding:7px 16px;border-radius:999px;cursor:pointer}
.home-tab.on{background:#fff;color:var(--ink);box-shadow:0 1px 2px rgb(0 0 0 / 7%)}
.home-hero{display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px;padding:26px 10px 6px}
.home-logo{width:64px;height:64px;border-radius:18px;display:flex;align-items:center;justify-content:center;font-size:30px;background:linear-gradient(135deg,var(--accent),#6aa8ff);color:#fff;margin-bottom:4px}
/* 应用图标（PPcode / Codex Harness 各自的 public/icon.png）：铺满圆角块、不带内置渐变底 */
img.home-logo{object-fit:cover;background:#fff;padding:0}
.home-hero h2{margin:0;font-size:20px;color:var(--ink)}
.home-hero p{margin:0;color:var(--muted);font-size:13px;line-height:1.7;text-align:center;white-space:nowrap}
.home-hint{margin:14px auto 0;color:var(--faint,#a3a39c);font-size:11.5px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:92%}
.home-sec-head{display:flex;align-items:center;justify-content:space-between;margin:4px 2px 8px}
.home-sec-head b{font-size:13.5px;color:var(--ink)}
.home-sec-head button{border:0;background:transparent;color:var(--accent);font-size:12.5px;padding:4px 2px}
.home-group{display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--line);border-radius:14px;background:#fff;margin-bottom:10px}
.home-group.has-news{border-color:#e6c07a}
.home-group-head{display:flex;align-items:center;gap:10px;min-width:0}
.home-group-title{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.home-group-title b{font-size:14px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.home-group-title small{font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.home-dot{width:8px;height:8px;border-radius:50%;background:#e0a33f;flex:none}
.home-avatars{position:relative;width:42px;height:42px;flex:none}
.home-avatar{position:absolute;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:600;border:1.5px solid #fff}
.home-avatar.news{box-shadow:0 0 0 2px #e0a33f}
.home-members{display:flex;gap:4px;flex-wrap:wrap}
.home-mchip{padding:2px 8px;border-radius:999px;background:#f4f4f1;color:var(--muted);font-size:11px}
.home-mchip.news{background:#fdf3e0;color:#8a5c0e}
.home-events{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:3px}
.home-events li{display:flex;gap:8px;font-size:11.5px;color:var(--muted);min-width:0}
.home-events time{color:#a3a39c;flex:none;font-variant-numeric:tabular-nums}
.home-events span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.home-actions{display:flex;gap:8px;margin-top:2px}
.home-actions button{flex:1;padding:9px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);font-size:12.5px}
.home-actions button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.home-empty{padding:36px 16px;text-align:center;color:var(--muted);font-size:12.5px;line-height:1.8}
.home-empty button{margin-top:12px;padding:9px 16px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);font-size:12.5px}
.thread-tag{display:inline-block;margin-right:5px;padding:1px 6px;border-radius:6px;font-size:10.5px;font-style:normal;vertical-align:1px}
.thread-tag.boss{background:#fdf3e0;color:#8a5c0e}
.thread-tag.member{background:#eef4ff;color:#3b5fa8}
.panel-row{padding:11px 16px;border-bottom:1px solid #f2f2ef;font-size:13px;display:flex;gap:8px;align-items:center;justify-content:space-between}
.panel-row small{color:var(--muted);font-size:11.5px}
.panel-note{padding:14px 16px;color:#8a8a84;font-size:11.5px;line-height:1.7}
.home-retry{margin:14px auto 0;display:block;padding:8px 16px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);font-size:12.5px}
.home-manage-enter{margin:12px 16px;display:block;width:calc(100% - 32px);padding:11px;border:0;border-radius:11px;background:var(--accent);color:#fff;font-size:13.5px;font-weight:600}
/* ── 首页 v2（10-31 用户：「首页花点心思，看着有点 low」）──
   结构：品牌卡（渐变+光晕）→ 两个主行动 → 继续上次 → 最近会话。
   ⛔ 全部走主题变量：暗色下自动跟着变，不另写一套。 */
.home-page{display:flex;flex-direction:column;gap:12px;padding:2px 0 8px}
.home-recent{display:flex;flex-direction:column;gap:8px}
.home-hero{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;gap:2px;padding:22px 18px;border:1px solid var(--line);border-radius:20px;overflow:hidden;background:linear-gradient(140deg,color-mix(in srgb,var(--accent) 16%,var(--panel)),var(--panel) 62%)}
.home-hero::after{content:"";position:absolute;right:-54px;top:-64px;width:170px;height:170px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--accent) 38%,transparent),transparent 68%);pointer-events:none}
.home-hero img.home-logo,.home-hero .home-logo{width:52px;height:52px;border-radius:14px;margin:0 0 12px;box-shadow:0 8px 20px color-mix(in srgb,var(--accent) 28%,transparent)}
.home-greet{font-size:22px;font-weight:700;letter-spacing:.2px;line-height:1.25}
.home-sub{margin-top:4px;font-size:12.5px;color:var(--muted);line-height:1.6}
.home-quick{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.home-quick button{display:flex;align-items:center;justify-content:center;gap:6px;padding:13px 8px;border-radius:14px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font-size:13.5px;font-weight:600}
.home-quick button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.home-quick button:active{opacity:.86}
.home-section{display:flex;align-items:center;justify-content:space-between;margin:4px 2px -2px}
.home-section b{font-size:12px;font-weight:600;color:var(--muted);letter-spacing:.4px}
.home-section span{font-size:11.5px;color:var(--faint,#a3a39c)}
.home-thread{display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--panel)}
.home-thread:active{background:color-mix(in srgb,var(--accent) 6%,var(--panel))}
.home-thread .ht-main{flex:1;min-width:0}
.home-thread .ht-title{display:block;font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.home-thread .ht-meta{margin-top:3px;font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.home-thread .ht-go{flex:none;color:var(--faint,#a3a39c);font-size:16px}
.home-thread .ht-badge{flex:none;padding:1px 7px;border-radius:6px;font-size:10.5px;background:var(--accent-soft);color:var(--accent)}
.home-empty-hint{font-size:12px;color:var(--faint,#a3a39c);text-align:center;padding:8px 0 2px}
.home-skel{height:52px;border:1px dashed var(--line);border-radius:14px;background:color-mix(in srgb,var(--text) 3%,var(--panel))}
.hub-logo{display:flex;align-items:center;justify-content:center;font-size:26px;background:linear-gradient(135deg,#f0b13b,#e0873f)!important;color:#fff;box-shadow:0 8px 20px rgba(224,135,63,.28)!important}
.home-groups{display:flex;flex-direction:column;gap:10px}
html[data-theme="dark"] .home-hero{background:linear-gradient(140deg,color-mix(in srgb,var(--accent) 22%,#161a20),#161a20 62%)}
html[data-theme="dark"] .home-thread{background:#161a20}
/* ── 动效系统（10-31 用户：随系统动画、现代化过渡）──
   ⛔ 全部走 CSS；系统开「减弱动效」时整段自动失效（最后一条 media query）。 */
:root{--ease:cubic-bezier(.22,.61,.36,1);--spring:cubic-bezier(.34,1.4,.64,1)}
@keyframes fade-up{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes fade-slide{from{opacity:0;transform:translateX(10px)}to{opacity:1;transform:none}}
@keyframes pop-in{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}
@keyframes sheet-up{from{transform:translateY(100%)}to{transform:none}}
@keyframes panel-in{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
@keyframes hero-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes home-in{from{opacity:0;transform:translateY(14px) scale(.985);filter:blur(5px)}to{opacity:1;transform:none;filter:none}}
#home.home-enter .home-page{animation:home-in .34s var(--ease) both}
@keyframes glow-drift{from{transform:translate(0,0) scale(1)}to{transform:translate(-16px,12px) scale(1.15)}}
@keyframes ripple{to{transform:scale(2.8);opacity:0}}
.home-page > *{animation:fade-up .3s var(--ease) both}
.home-page > *:nth-child(2){animation-delay:.05s}
.home-page > *:nth-child(3){animation-delay:.1s}
.home-page > *:nth-child(4){animation-delay:.15s}
.home-page > *:nth-child(5){animation-delay:.2s}
.home-hero::after{animation:glow-drift 9s ease-in-out infinite alternate}
.home-hero img.home-logo,.home-hero .home-logo{animation:hero-float 4.6s ease-in-out infinite}
#home:not([hidden]),#msglist:not([hidden]),#threads.open{animation:fade-slide .22s var(--ease)}
.msg-enter{animation:pop-in .22s var(--ease)}
#sheet.open{animation:sheet-up .26s var(--spring)}
.panel.open{animation:panel-in .24s var(--ease)}
body,header,#inputbar,#taskbar,#msglist,.msg,.home-thread,.home-group,#top-menu{transition:background-color .25s var(--ease),color .25s var(--ease),border-color .25s var(--ease)}
.ripple{position:absolute;border-radius:50%;pointer-events:none;background:currentColor;opacity:.18;transform:scale(0);animation:ripple .5s ease-out forwards}
button,.home-thread,.thread-row{position:relative;overflow:hidden}
@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
/* ── 主题：白天 / 黑夜（10-31 用户令）──
   ⛔ 只换背景不够：气泡、输入框、面板、代码块、卡片都是浅色字面量，必须逐个覆盖，
      否则暗色下会出现"白底白字 / 浅灰上浅灰"看不见。 */
html[data-theme="dark"]{--accent:#5b95ff;--accent-soft:#1b2a41;--line:#2a3038;--muted:#9aa3ad;--ink:#e7eaee;--bg:#0f1115;color-scheme:dark}
html[data-theme="dark"] body{background:var(--bg);color:var(--ink)}
html[data-theme="dark"] header,html[data-theme="dark"] #threads,html[data-theme="dark"] .threads-head,html[data-theme="dark"] #inputbar,html[data-theme="dark"] #taskbar,html[data-theme="dark"] #sheet,html[data-theme="dark"] .panel,html[data-theme="dark"] .panel-head,html[data-theme="dark"] #top-menu{background:#161a20}
html[data-theme="dark"] .menu-btn,html[data-theme="dark"] .threads-head button,html[data-theme="dark"] .panel-head button,html[data-theme="dark"] .empty-tip button,html[data-theme="dark"] .home-actions button,html[data-theme="dark"] .home-empty button,html[data-theme="dark"] .home-retry,html[data-theme="dark"] .home-group,html[data-theme="dark"] .home-tab.on{background:#1b2029;color:var(--ink);border-color:var(--line)}
html[data-theme="dark"] #cmd{background:#12161c;border-color:var(--line);color:var(--ink)}
html[data-theme="dark"] #plus{background:#1b2029;color:var(--ink);border-color:var(--line)}
html[data-theme="dark"] #sheet .grid button{background:#1b2029;color:var(--ink)}
html[data-theme="dark"] .msg.user{background:#1c2b44;border-color:#2a4468;color:#e7eaee}
html[data-theme="dark"] .msg.assistant{background:#161a20;border-color:var(--line);box-shadow:none}
html[data-theme="dark"] .msg.system{background:#1d2229;color:#a9b1ba}
html[data-theme="dark"] .run-steps{background:#151a20;border-color:#262d36}
html[data-theme="dark"] .run-steps .think{color:#a9b1ba;border-top-color:#2b323b}
html[data-theme="dark"] .run-steps .step-out{background:#12161c;border-color:var(--line);color:#c3c9d1}
html[data-theme="dark"] .ask-card{background:#1a1a12;border-color:#4a4326}
html[data-theme="dark"] .ask-q{color:#d8c98a}
html[data-theme="dark"] .ask-opt,html[data-theme="dark"] .step-more{color:#8fb4ff;border-color:#2f4a75;background:#141a23}
html[data-theme="dark"] #goalbar{background:#1a1418;color:#e9a6bd;border-top-color:var(--line)}
html[data-theme="dark"] .thread-row{border-bottom-color:#222831}
html[data-theme="dark"] .thread-row:active{background:#1b2029}
html[data-theme="dark"] .thread-row.active{background:var(--accent-soft)}
html[data-theme="dark"] .home-group{background:#161a20}
html[data-theme="dark"] .home-tabs{background:#1b2029;border-color:var(--line)}
html[data-theme="dark"] .home-tab{color:var(--muted)}
html[data-theme="dark"] .home-tab.on{background:#222a35;color:var(--ink);box-shadow:none}
html[data-theme="dark"] .home-sec-head b,html[data-theme="dark"] .home-group-title b{color:var(--ink)}
html[data-theme="dark"] .home-hint,html[data-theme="dark"] .home-events time{color:#7c8591}
html[data-theme="dark"] .panel-row,html[data-theme="dark"] .file-row,html[data-theme="dark"] .cmd-row{border-bottom-color:#222831}
html[data-theme="dark"] .panel-note{color:#9aa3ad}
html[data-theme="dark"] .msg code{background:#222831;color:#e7eaee}
html[data-theme="dark"] .msg .md-pre{background:#12161c;border-color:var(--line)}
html[data-theme="dark"] .msg .md-pre code{background:none}
html[data-theme="dark"] .msg th{background:#1b2029}
html[data-theme="dark"] .msg th,html[data-theme="dark"] .msg td{border-color:#2a3038}
html[data-theme="dark"] .msg blockquote{color:#a9b1ba;border-left-color:#2a3038}
html[data-theme="dark"] .msg hr{border-top-color:#2a3038}
html[data-theme="dark"] .thread-tag.boss{background:#3a2c12;color:#e5bc74}
html[data-theme="dark"] .thread-tag.member{background:#1c2b44;color:#9db9ef}
html[data-theme="dark"] #imgs{background:#161a20}
html[data-theme="dark"] .thinking-indicator{color:#9aa3ad}
</style>
<header>
  <button id="btn-menu" class="menu-btn" aria-label="菜单" onclick="toggleTopMenu()">☰</button>
  <span id="thread-label" class="thread-label"></span>
  <button type="button" id="theme-btn" class="icon-btn" aria-label="切换白天/黑夜" onclick="toggleTheme()">🌙</button>
  <span class="status" id="status" title="连接中…">连接中…</span>
  <div id="top-menu" hidden>
    <div class="menu-group">
      <button type="button" onclick="toggleTopMenu(false);openHome()"><i>🏠</i><span><b>首页</b><small>回到首页，直接开始</small></span></button>
      <button type="button" onclick="toggleTopMenu(false);toggleThreads()"><i>🗂️</i><span><b>选择会话</b><small>最近会话与中枢</small></span></button>
      <button type="button" onclick="toggleTopMenu(false);toggleTheme()"><i id="menu-theme-icon">🌙</i><span><b id="menu-theme-label">夜间模式</b><small>也可以跟随系统</small></span></button>
    </div>
    <button type="button" class="danger" id="menu-disconnect" hidden onclick="topMenuDisconnect()"><i>⏏️</i><span><b>断开连接</b><small>同时移除电脑端这台设备</small></span></button>
  </div>
</header>
<div id="threads"><div class="threads-head"><button onclick="toggleThreads()">← 返回</button><b>选择会话</b><button class="new-thread" onclick="openNewThreadMenu()">＋ 新建</button></div><div class="list" id="thread-list"></div></div>
<div id="home" hidden>
  <div class="home-tabs"><button class="home-tab on" data-tab="normal" onclick="switchHome('normal')">普通会话</button><button class="home-tab" data-tab="hub" onclick="switchHome('hub')">👑 中枢会话</button></div>
  <div class="home-body" id="home-body"></div>
</div>
<div id="msglist"></div>
<div id="goalbar" hidden></div>
<div id="taskbar" hidden></div>
<div id="imgs"></div>
<div id="inputbar"><button id="plus" onclick="openSheet()">＋</button><button id="voice" title="语音输入" onclick="voiceInput()">🎤</button><input id="cmd" placeholder="输入消息，发送给 Codex"><button id="send" onclick="handleSend()">发送</button></div>
<!-- 占位：构建时替换成 src/lib/mobile-markdown.mjs 的源码 -->
<script>/*__MOBILE_MARKDOWN__*/</script>
<input type="file" id="file-pick" accept="image/*" multiple>
<input type="file" id="camera-pick" accept="image/*" capture="environment">
<div id="sheet-mask" class="mask" onclick="closeSheet()"></div>
<div id="sheet"><div class="grid">
  <button onclick="pickImage()"><b>🖼</b>图片</button>
  <button onclick="takePhoto()"><b>📷</b>拍照</button>
  <button onclick="openEmoji()"><b>😊</b>表情</button>
  <button onclick="openMentions()"><b>@</b>提及</button>
  <button onclick="openFiles()"><b>📄</b>文件</button>
  <button onclick="openSkills()"><b>#</b>技能</button>
  <button onclick="openCommands()"><b>/</b>指令</button>
  <button onclick="openApk()"><b>⬇</b>安装包</button>
</div></div>
<div id="panel" class="panel">
  <div class="panel-head"><button onclick="closePanel()">← 返回</button><b id="panel-title"></b><span style="width:64px"></span></div>
  <div class="panel-body" id="panel-body"></div>
</div>
<script>
const code = ${JSON.stringify(code)};
// 品牌面（⛔ 各仓自有：桌面版 Codex Harness / PPcode 仓 PPcode；首页与标题都读它）
const BRAND = ${JSON.stringify(brandName)};
/* 首页图标：本仓自己的应用图标（data URI）。⛔ 各仓图标不许互相串（品牌面差异，见 AGENTS.md） */
const BRAND_ICON = ${JSON.stringify(brandIcon)};
/* 10-30 用户：首页 / 会话 / 断开连接收进左上角一个「☰」选项，品牌 logo 居中。
   ⛔ 断开连接只有 App 里可用（安卓注入 AndroidRemote 才显示）。 */
function toggleTopMenu(force) {
  const menu = document.getElementById("top-menu");
  if (!menu) return;
  const nextOpen = force === false ? false : (force === true ? true : menu.hidden);
  menu.classList.remove("open");
  menu.hidden = !nextOpen;
  if (nextOpen) { void menu.offsetWidth; menu.classList.add("open"); }
}
/* 手机主动断开：**同时通知电脑端撤销这台设备**（否则电脑端还留着、下次也不用重配，两边不一致）。
   ⛔ 先让用户确认；电脑端没响应也清本机状态，并把实情说出来，不许静默。 */
async function remoteDisconnect() {
  try {
    const res = await fetch(apiUrl("/api/disconnect"), { method: "POST" });
    return res.ok;
  } catch (error) { return false; }
}
function topMenuDisconnect() {
  toggleTopMenu(false);
  let confirmed = true;
  try { confirmed = window.confirm("断开后电脑端会移除这台手机，下次需要重新配对。确定断开？"); } catch (e) { confirmed = true; }
  if (!confirmed) return;
  void remoteDisconnect().then((done) => {
    try {
      localStorage.removeItem(storeKey("chm-pair-secret"));
      localStorage.removeItem(storeKey("chm-pair-device"));
      localStorage.removeItem(storeKey("chm-pair-code"));
      dropStore(THREAD_KEY);
    } catch (error) { /* 忽略 */ }
    if (!done) { try { alert("电脑端没有确认断开（可能已离线）；本机登录状态已清除。"); } catch (e) { /* 忽略 */ } }
    location.replace(apiUrl("/r/mobile"));
  });
}
/* 按钮涟漪（跟随 Android 触感）：按下时在元素内扩散一个圆 */
document.addEventListener("pointerdown", function (event) {
  const host = event.target && event.target.closest ? event.target.closest("button, .home-thread, .thread-row") : null;
  if (!host) return;
  const rect = host.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  if (!size) return;
  const dot = document.createElement("span");
  dot.className = "ripple";
  dot.style.width = size + "px";
  dot.style.height = size + "px";
  dot.style.left = (event.clientX - rect.left - size / 2) + "px";
  dot.style.top = (event.clientY - rect.top - size / 2) + "px";
  host.appendChild(dot);
  window.setTimeout(function () { if (dot.parentNode) dot.parentNode.removeChild(dot); }, 520);
}, { passive: true });
document.addEventListener("click", function (event) {
  const menu = document.getElementById("top-menu");
  if (!menu || menu.hidden) return;
  const target = event.target;
  if (!target) return;
  if (target.closest && (target.closest("#top-menu") || target.closest("#btn-menu"))) return;
  menu.hidden = true;
});
(function () {
  try {
    if (window.AndroidRemote && typeof window.AndroidRemote.disconnect === "function") {
      const item = document.getElementById("menu-disconnect");
      if (item) item.hidden = false;
    }
  } catch (e) { /* 非 App 环境 */ }
})();
/* 中转前缀（10-29）：经 /t/<设备ID> 访问时给所有接口加上前缀；直连（局域网/旧固定地址）时为空串 */
const PATH_PREFIX = (function(){ const p = location.pathname; const i = p.indexOf("/r/"); return i > 0 ? p.slice(0, i) : ""; })();
const apiUrl = (path) => PATH_PREFIX + path;
/* 事件走 HTTP 轮询；原来那条 WebSocket 从未挂处理器（死代码），中转路径下也没有 WS，直接去掉 */
let rpcSeq = 0;
const rpcWaiters = new Map();
// 会话记忆 key 固定（不绑定随机 code）：同一地址下扫码进入都能恢复上次会话
/* ⛔ 全部 localStorage 键都带 PATH_PREFIX：同一部手机连两台电脑时，线程/偏好/秘密互不覆盖 */
/* ⛔ 10-30：手机侧记忆（会话/设备 id/偏好/设备秘密）按**主机**分桶，不再按 URL 前缀。
   旧实现用「/」与「/t/设备ID」两套前缀 ⇒ 同一部手机在不同入口读不到自己的状态，
   设备秘密丢失 = 每次重开都要重新输码配对（用户实测「同一个手机反复配对」）。
   ⛔ 旧键做一次性迁移（读到旧键就搬到新键），别让升级把老用户状态清空。 */
const STORAGE_HOST = location.host || "local";
const legacyKey = (name) => name + PATH_PREFIX;
const storeKey = (name) => name + "@" + STORAGE_HOST;
function readStore(name) {
  try {
    const value = localStorage.getItem(storeKey(name));
    if (value != null) return value;
    const legacy = localStorage.getItem(legacyKey(name));
    if (legacy != null) { localStorage.setItem(storeKey(name), legacy); return legacy; }
  } catch (error) { /* 隐私模式：忽略 */ }
  return null;
}
function writeStore(name, value) { try { localStorage.setItem(storeKey(name), value); } catch (error) { /* 忽略 */ } }
function dropStore(name) {
  try { localStorage.removeItem(storeKey(name)); localStorage.removeItem(legacyKey(name)); } catch (error) { /* 忽略 */ }
}
/* 主题（10-31 用户：白天/黑夜切换）：按主机记住；没选过跟随系统 */
const THEME_KEY = "chm-theme";
function currentTheme() {
  try { const saved = localStorage.getItem(storeKey(THEME_KEY)); if (saved === "dark" || saved === "light") return saved; } catch (error) { /* 忽略 */ }
  try { return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch (error) { return "light"; }
}
function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  const btn = document.getElementById("theme-btn");
  if (btn) { btn.textContent = next === "dark" ? "☀️" : "🌙"; btn.setAttribute("aria-label", next === "dark" ? "切换到白天模式" : "切换到夜间模式"); }
  const menuIcon = document.getElementById("menu-theme-icon");
  const menuLabel = document.getElementById("menu-theme-label");
  if (menuIcon) menuIcon.textContent = next === "dark" ? "☀️" : "🌙";
  if (menuLabel) menuLabel.textContent = next === "dark" ? "白天模式" : "夜间模式";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", next === "dark" ? "#161a20" : "#f7f7f5");
}
function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  try { localStorage.setItem(storeKey(THEME_KEY), next); } catch (error) { /* 忽略 */ }
  applyTheme(next);
}
applyTheme(currentTheme());
const THREAD_KEY = "chm-thread";
let currentThreadId = readStore(THREAD_KEY) || "";
let streaming = "";
// 当前回合的「运行步骤」容器（命令/文件/工具/思考）；回合结束收成可折叠块
let stepBox = null;
// 待发图片（本地预览，发送时才上传）+ 能力目录缓存 + 面板返回动作
let pendingImages = [];
let catalogCache = null;
/* @ 点名（10-31）：与电脑端同一个调度目录，选中后随消息一起发（正文里也留 @名字 给人看） */
let pendingMentions = [];
let panelBack = null;
// 当前命令步骤的输出块（桌面对话框的命令卡里有结果，手机端挂在对应命令下面）
let currentOutputEl = null;
// 文件变更那一行（宿主追踪器每拍推一次，原地更新）
let filesEl = null;
let filesBtn = null;
// 本回合的实时文件清单（「查看改动」运行中优先用它，落盘报告只到回合结束才有）
let lastFilesData = null;
/* 首页（10-28）：应用不再一进去就是一段对话。
   · normal = 普通会话首页（发消息 = 建普通会话）
   · hub   = 中枢会话首页（群卡 / 群事件 / 群管理；发消息 = 建中枢会话）
   ⛔ 首页态不隶属任何会话：currentThreadId 置空，选中会话或发送时才真正进入会话。 */
let homeMode = "normal";
let homeVisible = false;
let groupSeen = {};
// 当前会话是否在跑：发送键在运行时变成「停止」
let turnRunning = false;
const list = document.getElementById("msglist");
// 设备身份：localStorage 固定生成，服务端用它记住「这台手机上次用的会话」
// ⛔ 键按主机分桶（见 readStore）：设备 id 换了 = 电脑端多一台陌生设备、还得重新审批
let deviceId = readStore("chm-device-id");
if (!deviceId) {
  deviceId = "dev-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  writeStore("chm-device-id", deviceId);
}
function saveSession() {
  // 首页态没有会话可记：别用空 id 覆盖「上次会话」映射（否则下次进来永远回到首页也找不到上次）
  if (!currentThreadId) return;
  try {
    fetch(apiUrl("/api/session"), { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ device: deviceId, threadId: currentThreadId }) });
  } catch { /* 忽略 */ }
}

/* 电脑端每启动一次都会换 accessToken ⇒ 旧页面会突然 401「unauthorized」。
   ⛔ 不能只弹「加载失败」：自动重载一次，让页面走配对页的自动登录把凭据换新
      （同一个页面里再点重试是没用的，cookie 已经失效）。 */
let reauthing = false;
function maybeReauth(message) {
  if (!/unauthorized/i.test(String(message || ""))) return false;
  if (reauthing) return true;
  reauthing = true;
  try {
    if (sessionStorage.getItem("chm-reauth") === "1") return true;
    sessionStorage.setItem("chm-reauth", "1");
  } catch (error) { /* 隐私模式：忽略，仍重载一次 */ }
  push("system", "连接已失效（电脑端重启过），正在重新连接…");
  window.setTimeout(() => location.reload(), 600);
  return true;
}
async function rpc(payload) {
  const reqId = String(++rpcSeq);
  const res = await fetch(apiUrl("/api/rpc"), { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ ...payload, reqId }) });
  const data = await res.json();
  if (data.error) {
    maybeReauth(data.error);
    throw new Error(data.error);
  }
  try { sessionStorage.removeItem("chm-reauth"); } catch (error) { /* 忽略 */ }
  return data;
}
function push(role, text, cls, pending) {
  const div = document.createElement("div");
  div.className = "msg msg-enter " + (cls || role) + (role === "assistant" ? " md" : "");
  if (pending) div.dataset.pending = "1";
  if (role === "assistant") {
    // 助手消息走 Markdown（渲染器输出已转义，见 src/lib/mobile-markdown.mjs）
    div._mdText = String(text || "");
    div.innerHTML = renderMarkdownHtml(div._mdText);
  } else {
    div.textContent = text;
  }
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
  return div;
}
// 历史里的思考：折叠成一块（默认收起，点开看全文）
function pushThinkHistory(text) {
  const box = document.createElement("details");
  box.className = "run-steps";
  const summary = document.createElement("summary");
  summary.textContent = "思考";
  const body = document.createElement("div");
  body.className = "think";
  body.textContent = text;
  box.appendChild(summary);
  box.appendChild(body);
  list.appendChild(box);
}
// 会话行只显示标题：引擎的 preview 是**整条消息正文**（常含换行），直接当标题会把列表撑成一屏一条
function clipText(value, max) {
  const chars = [...value];
  return chars.length > max ? chars.slice(0, max).join("") + "…" : value;
}
function threadTitle(t) {
  const named = (t.name || "").trim();
  if (named) return clipText(named, 24);
  const line = (t.preview || "").split("\\n").map((s) => s.trim()).find(Boolean) || "";
  return line ? clipText(line, 24) : "未命名任务";
}
async function loadThreads() {
  const el = document.getElementById("thread-list");
  el.innerHTML = "<div class='empty-tip'>加载中…</div>";
  let threads = [];
  try {
    const r = await rpc({ type: "list-threads" });
    threads = r.threads || [];
  } catch (e) {
    // 引擎未就绪 / 凭据失效时不能只留一片白：给出原因与重试（手机上看不到控制台）
    el.innerHTML = "";
    const tip = document.createElement("div");
    tip.className = "empty-tip";
    tip.textContent = "会话列表加载失败：" + (e.message || "未知错误");
    const retry = document.createElement("button");
    retry.textContent = "重试";
    retry.onclick = () => loadThreads();
    tip.appendChild(document.createElement("br"));
    tip.appendChild(retry);
    el.appendChild(tip);
    return;
  }
  el.innerHTML = "";
  if (!threads.length) {
    el.innerHTML = "<div class='empty-tip'>暂无会话，点右上角「＋ 新建」开始</div>";
    return;
  }
  for (const t of threads) {
    const row = document.createElement("div");
    row.className = "thread-row" + (t.id === currentThreadId ? " active" : "");
    row.innerHTML = "<b></b><small></small>";
    const title = row.querySelector("b");
    /* 10-28 会话列表标签：中枢（带群名） / 中枢调度 —— 一眼分清会话类型 */
    if (t.kind === "boss") title.appendChild(makeEl("i", "thread-tag boss", "中枢" + (t.groupName ? " · " + t.groupName : "")));
    else if (t.kind === "bossMember") title.appendChild(makeEl("i", "thread-tag member", "中枢调度"));
    title.appendChild(document.createTextNode(threadTitle(t)));
    row.querySelector("small").textContent = new Date(t.updatedAt * 1000).toLocaleString();
    row.onclick = () => { hideHome(); currentThreadId = t.id; writeStore(THREAD_KEY, t.id); document.getElementById("threads").classList.remove("open"); loadMessages(); updateThreadLabel(threadTitle(t)); saveSession(); };
    el.appendChild(row);
  }
}
function toggleThreads() { const el = document.getElementById("threads"); if (el.classList.contains("open")) el.classList.remove("open"); else { loadThreads(); el.classList.add("open"); } }
function updateThreadLabel(name) {
  const el = document.getElementById("thread-label");
  if (el) el.textContent = name || "";
}
/* 新建会话统一入口（10-28）：boss=true ⇒ 中枢会话；其余走默认会话。
   ⛔ 首页只负责「选类型」，真正建会话都在这里（与弹窗菜单共用一条链）。 */
async function newThread(boss) {
  return startSession(Boolean(boss));
}
async function loadMessages() {
  if (!currentThreadId) return;
  try {
    list.innerHTML = "";
    stepBox = null;
    currentOutputEl = null;

    lastFilesData = null;
    setRunning(false);
    void refreshGoal();
    void refreshTasks();
    const r = await rpc({ type: "get-messages", threadId: currentThreadId });
    const msgs = r.messages || [];
    for (const m of msgs) {
      if (m.role === "think") pushThinkHistory(m.text);
      else push(m.role, m.text);
    }
    if (msgs.length > 0) {
      const firstUser = msgs.find((m) => m.role === "user");
      updateThreadLabel(firstUser ? firstUser.text.slice(0, 20) : "会话");
    }
  } catch (error) {
    // 只有「会话真的不在了」才退回新建；引擎重启 / 网络抖动一律留人 + 重试 ——
    // 一抖就悄悄换会话，用户看到的是「我的会话没了」。
    const message = String(error?.message ?? error ?? "未知错误");
    if (/not found|no such|unknown thread|不存在|未找到/i.test(message)) {
      currentThreadId = "";
      dropStore(THREAD_KEY);
      await newThread();
      push("system", "原会话已不存在（可能被删除），已新建会话");
      return;
    }
    list.innerHTML = "";
    push("system", "会话加载失败：" + message);
    const retry = document.createElement("button");
    retry.className = "step-more";
    retry.textContent = "重试";
    retry.onclick = () => { retry.remove(); void loadMessages(); };
    list.appendChild(retry);
  }
}
async function sendCmd() {
  const input = document.getElementById("cmd");
  const v = input.value.trim();
  if (!v && !pendingImages.length) return;
  /* 10-28：首页发消息 = 建会话。中枢首页 ⇒ 中枢会话（其余入口一律普通会话）。 */
  const startAsBoss = homeVisible && homeMode === "hub";
  const fromHome = homeVisible;
  hideHome();
  /* 10-30：从首页进入时必须清空上一段会话的残留气泡 —— 否则新建会话后仍挂着旧消息，
     看起来像"发到了旧会话里"（用户实测「首页直接发」的观感问题之一）。 */
  if (fromHome) list.innerHTML = "";
  stepBox = null; // 新一轮从空步骤列表开始
  currentOutputEl = null;

  lastFilesData = null;
  const shots = pendingImages.slice();
  pendingImages = [];
  renderImages();
  const label = v + (shots.length ? (v ? "\\n" : "") + "📷 " + shots.length + " 张图" : "");
  push("user", label, "", true);
  input.value = "";
  showThinking();
  setRunning(true);
  void refreshTasks();
  try {
    const paths = [];
    for (const shot of shots) {
      try { paths.push(await uploadImage(shot)); }
      catch (error) { push("system", "图片上传失败：" + error.message); }
    }
    // 图全传失败了又没有文字：不能发空回合，否则「思考中」会一直挂着
    if (!v && !paths.length) {
      hideThinking();
      push("system", "没有可发送的内容（图片上传失败？）");
      return;
    }
    if (!currentThreadId) {
      const r = await rpc({ type: "new-thread", boss: startAsBoss });
      currentThreadId = r.threadId;
      writeStore(THREAD_KEY, currentThreadId);
      loadThreads();
    }
    await rpc({ type: "send-message", threadId: currentThreadId, text: v, images: paths, effort: readStore("chm-effort") || "high", mentions: pendingMentions });
    pendingMentions = [];
    updateThreadLabel((v || "图片").slice(0, 20));
    saveSession();
  } catch (error) {
    hideThinking();
    setRunning(false);
    push("system", "发送失败：" + error.message);
  }
}
function setRunning(on) {
  turnRunning = !!on;
  const btn = document.getElementById("send");
  if (btn) {
    btn.textContent = turnRunning ? "停止" : "发送";
    btn.classList.toggle("stop", turnRunning);
  }
  const status = document.getElementById("status");
  if (status) status.textContent = turnRunning ? "● 运行中" : "● 在线";
}
function handleSend() {
  if (turnRunning) { void stopTurn(); return; }
  void sendCmd();
}
async function stopTurn() {
  if (!currentThreadId) { setRunning(false); return; }
  try {
    await rpc({ type: "interrupt", threadId: currentThreadId });
    push("system", "已请求停止");
    // 兜底：中断事件万一没回来，别让按钮永远停在「停止」
    setTimeout(() => { if (turnRunning) setRunning(false); }, 10000);
  } catch (error) {
    setRunning(false);
    push("system", "停止失败：" + error.message);
  }
}
function showThinking() {
  if (list.querySelector(".thinking-indicator")) return;
  const div = document.createElement("div");
  div.className = "msg thinking-indicator";
  div.innerHTML = '<span class="dot"></span>思考中…';
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
}
function hideThinking() {
  const el = list.querySelector(".thinking-indicator");
  if (el) el.remove();
}
/* ── 首页（10-28 用户立项）：普通 / 中枢两种，默认普通 ─────────────────────
   ⛔ 首页不隶属任何会话（currentThreadId 置空）；发消息时才建会话：
       普通首页 → 普通会话；中枢首页 → 中枢会话（主进程 cwd=boss-home + 登记中枢身份）。
   ⛔ 纯字符串拼接，别用模板字符串（整页本身是 TS 模板串，插值会被外层吃掉）。 */
function makeEl(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}
function greetingHome() {
  const h = new Date().getHours();
  return h < 6 ? "夜深了" : h < 11 ? "早上好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好";
}
function readHomePrefs() {
  try {
    homeMode = readStore("chm-home") === "hub" ? "hub" : "normal";
    groupSeen = JSON.parse(readStore("chm-group-seen") || "{}") || {};
  } catch (error) { homeMode = "normal"; groupSeen = {}; }
}
function markGroupSeen(groupId) {
  if (!groupId) return;
  groupSeen[String(groupId)] = Date.now();
  try { writeStore("chm-group-seen", JSON.stringify(groupSeen)); } catch (error) { /* 忽略 */ }
}
function groupHasNews(group) {
  const seen = Number(groupSeen[String(group && group.id || "")] || 0);
  return (group && group.recentEvents || []).some((event) => Number(event && event.at || 0) > seen);
}
function memberHasNews(group, memberId, seenOverride) {
  /* ⛔ seenOverride：群管理面板会先 markGroupSeen 再渲染 —— 不传旧值的话「有新动静」永远是空的 */
  const seen = seenOverride != null ? Number(seenOverride) : Number(groupSeen[String(group && group.id || "")] || 0);
  return (group && group.recentEvents || []).some((event) => String(event && event.memberId || "") === String(memberId)
    && Number(event && event.at || 0) > seen
    && ["submitted", "chat-member", "done", "escalated"].indexOf(String(event && event.kind || "")) >= 0);
}
function openHome() { homeVisible = true; showHome(); }
function showHome() {
  homeVisible = true;
  currentThreadId = "";
  try { dropStore(THREAD_KEY); } catch (error) { /* 忽略 */ }
  const homeEl = document.getElementById("home");
  homeEl.hidden = false;
  /* 每次进首页都重放整页入场动画（先摘类再强制 reflow，否则同一个类不会重新触发） */
  homeEl.classList.remove("home-enter");
  void homeEl.offsetWidth;
  homeEl.classList.add("home-enter");
  document.getElementById("msglist").hidden = true;
  document.getElementById("goalbar").hidden = true;
  document.getElementById("taskbar").hidden = true;
  document.getElementById("threads").classList.remove("open");
  setRunning(false);
  updateThreadLabel("首页");
  const input = document.getElementById("cmd");
  if (input) input.placeholder = homeMode === "hub" ? "发消息给中枢：会新建一条中枢会话" : "输入消息，发送给 " + BRAND;
  renderHome();
}
function hideHome() {
  if (!homeVisible) return;
  homeVisible = false;
  document.getElementById("home").hidden = true;
  document.getElementById("msglist").hidden = false;
  const input = document.getElementById("cmd");
  if (input) input.placeholder = "输入消息，发送给 " + BRAND;
}
function switchHome(tab) {
  homeMode = tab === "hub" ? "hub" : "normal";
  try { writeStore("chm-home", homeMode); } catch (error) { /* 忽略 */ }
  showHome();
}
function avatarTone(seed) {
  const tones = ["#e0873f", "#3f9a6a", "#4a6fd0", "#b3578a", "#7357c9", "#3f8e96"];
  let hash = 0;
  const text = String(seed || "");
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 997;
  return tones[hash % tones.length];
}
function initialOf(name) {
  const text = String(name || "").trim();
  if (!text) return "?";
  const first = Array.from(text)[0];
  return /[a-z]/.test(first) ? first.toUpperCase() : first;
}
function groupAvatarNode(group, size) {
  const box = makeEl("div", "home-avatars");
  box.style.width = size + "px";
  box.style.height = size + "px";
  const members = (group && group.members || []).filter((member) => member && member.name).slice(0, 3);
  if (!members.length) {
    const solo = makeEl("div", "home-avatar", initialOf(group && group.name));
    solo.style.background = avatarTone(group && group.name);
    solo.style.width = (size * 0.62) + "px";
    solo.style.height = (size * 0.62) + "px";
    solo.style.left = (size * 0.19) + "px";
    solo.style.top = (size * 0.19) + "px";
    box.appendChild(solo);
    return box;
  }
  const base = Math.round(size * 0.44);
  members.forEach((member, index) => {
    const face = makeEl("div", "home-avatar" + (memberHasNews(group, member.id) ? " news" : ""), initialOf(member.name));
    face.style.background = avatarTone(member.name);
    face.style.width = base + "px";
    face.style.height = base + "px";
    face.style.left = (members.length === 1 ? (size - base) / 2 : size * 0.06 + index * (size * 0.24)) + "px";
    face.style.top = (members.length === 1 ? (size - base) / 2 : size * 0.1 + (index % 2) * (size * 0.36)) + "px";
    box.appendChild(face);
  });
  return box;
}
function clockOf(ms) {
  const at = Number(ms || 0);
  if (!at) return "";
  const d = new Date(at);
  const pad = (n) => String(n).padStart(2, "0");
  /* 跨天的事件要带日期：只给「21:30」会让人以为是今天 */
  const today = new Date();
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  return (sameDay ? "" : (d.getMonth() + 1) + "/" + d.getDate() + " ") + pad(d.getHours()) + ":" + pad(d.getMinutes());
}
let homeRenderSeq = 0;
async function renderHome() {
  /* ⛔ 防串台：切页签会重新渲染；群列表慢的时候旧请求回来不许覆盖新页签的内容 */
  const seq = ++homeRenderSeq;
  document.querySelectorAll(".home-tab").forEach((button) => {
    button.classList.toggle("on", button.getAttribute("data-tab") === homeMode);
  });
  const body = document.getElementById("home-body");
  if (!body) return;
  body.innerHTML = "";
  if (homeMode !== "hub") {
    const page = makeEl("div", "home-page");
    /* 品牌卡：图标 + 问候 + 一句说明（渐变光晕，暗色自动跟随主题变量） */
    const hero = makeEl("div", "home-hero");
    if (BRAND_ICON) {
      const logo = document.createElement("img");
      logo.className = "home-logo";
      logo.alt = BRAND;
      logo.src = BRAND_ICON;
      hero.appendChild(logo);
    } else {
      hero.appendChild(makeEl("div", "home-logo", "✦"));
    }
    hero.appendChild(makeEl("div", "home-greet", greetingHome()));
    hero.appendChild(makeEl("div", "home-sub", "今天想做点什么？直接说，我来干。"));
    page.appendChild(hero);

    /* 两个主行动：普通 / 中枢（比让小字提示"发消息即新建会话"更好点） */
    const quick = makeEl("div", "home-quick");
    const newChat = makeEl("button", "primary", "＋ 新建会话");
    newChat.type = "button";
    newChat.onclick = () => { void startSession(false); };
    const hubChat = makeEl("button", null, "👑 中枢会话");
    hubChat.type = "button";
    hubChat.onclick = () => { void startSession(true); };
    quick.appendChild(newChat);
    quick.appendChild(hubChat);
    page.appendChild(quick);

    /* 最近会话：进页面最常用的动作是"回到刚才那个" */
    const head = makeEl("div", "home-section");
    head.appendChild(makeEl("b", null, "最近会话"));
    head.appendChild(makeEl("span", null, "点击继续"));
    page.appendChild(head);
    const recent = makeEl("div", "home-recent");
    recent.appendChild(makeEl("div", "home-skel"));
    page.appendChild(recent);
    body.appendChild(page);

    void (async () => {
      try {
        const result = await rpc({ type: "list-threads" });
        if (seq !== homeRenderSeq) return;
        const threads = (result && result.threads || []).slice(0, 4);
        recent.innerHTML = "";
        if (!threads.length) {
          recent.appendChild(makeEl("div", "home-empty-hint", "还没有会话，点上面的「新建会话」开始"));
          return;
        }
        threads.forEach((thread) => {
          const row = makeEl("div", "home-thread");
          const main = makeEl("div", "ht-main");
          main.appendChild(makeEl("span", "ht-title", threadTitle(thread)));
          const meta = (thread.kind === "boss" ? "中枢 · " : thread.kind === "bossMember" ? "团队成员 · " : "") + (clockOf(thread.updatedAt) || "刚刚");
          main.appendChild(makeEl("span", "ht-meta", meta));
          row.appendChild(main);
          if (thread.kind === "boss") row.appendChild(makeEl("span", "ht-badge", "中枢"));
          row.appendChild(makeEl("span", "ht-go", "›"));
          row.onclick = () => {
            hideHome();
            currentThreadId = thread.id;
            writeStore(THREAD_KEY, thread.id);
            list.innerHTML = "";
            stepBox = null;
            currentOutputEl = null;
            lastFilesData = null;
            setRunning(false);
            updateThreadLabel(threadTitle(thread));
            void loadMessages();
            saveSession();
          };
          recent.appendChild(row);
        });
      } catch (error) {
        if (seq !== homeRenderSeq) return;
        recent.innerHTML = "";
        recent.appendChild(makeEl("div", "home-empty-hint", "会话列表读取失败：" + (error.message || "未知错误")));
        const retry = makeEl("button", "home-retry", "重试");
        retry.onclick = () => { void renderHome(); };
        recent.appendChild(retry);
      }
    })();
    return;
  }
  body.appendChild(makeEl("div", "empty-tip", "加载群…"));
  let groups = [];
  try {
    const result = await rpc({ type: "boss-groups" });
    if (seq !== homeRenderSeq) return;
    groups = result && result.groups || [];
  } catch (error) {
    if (seq !== homeRenderSeq) return;
    body.innerHTML = "";
    body.appendChild(makeEl("div", "empty-tip", "群加载失败：" + (error.message || "未知错误")));
    const retry = makeEl("button", "home-retry", "重试");
    retry.onclick = () => { void renderHome(); };
    body.appendChild(retry);
    return;
  }
  body.innerHTML = "";
  /* 中枢首页 v2（10-31 用户：「没做中枢会话首页」）：与普通首页同一套骨架 */
  const page = makeEl("div", "home-page");
  const hero = makeEl("div", "home-hero hub-hero");
  hero.appendChild(makeEl("div", "home-logo hub-logo", "👑"));
  hero.appendChild(makeEl("div", "home-greet", "中枢工作台"));
  hero.appendChild(makeEl("div", "home-sub", "群、成员、任务都在这里；发消息即开中枢会话。"));
  page.appendChild(hero);
  const quick = makeEl("div", "home-quick");
  const newHub = makeEl("button", "primary", "＋ 新建中枢会话");
  newHub.type = "button";
  newHub.onclick = () => { void startSession(true); };
  const refresh = makeEl("button", null, "↻ 刷新群");
  refresh.type = "button";
  refresh.onclick = () => { void renderHome(); };
  quick.appendChild(newHub);
  quick.appendChild(refresh);
  page.appendChild(quick);
  const head = makeEl("div", "home-section");
  head.appendChild(makeEl("b", null, "我的群"));
  head.appendChild(makeEl("span", null, groups.length ? groups.length + " 个" : ""));
  page.appendChild(head);
  const listHost = makeEl("div", "home-groups");
  page.appendChild(listHost);
  body.appendChild(page);
  if (!groups.length) {
    const empty = makeEl("div", "home-empty");
    empty.appendChild(makeEl("div", null, "还没有群。"));
    empty.appendChild(makeEl("div", null, "还没有群。点上面「新建中枢会话」直接开工，或去电脑端建群。"));
    listHost.appendChild(empty);
    return;
  }
  groups.forEach((group) => {
    const news = groupHasNews(group);
    const card = makeEl("div", "home-group" + (news ? " has-news" : ""));
    card.setAttribute("data-gid", String(group.id));
    const header = makeEl("div", "home-group-head");
    header.onclick = () => openGroupThread(group);
    header.appendChild(groupAvatarNode(group, 42));
    const title = makeEl("div", "home-group-title");
    title.appendChild(makeEl("b", null, group.name || "未命名群"));
    title.appendChild(makeEl("small", null, (group.memberCount || 0) + " 位成员"
      + (group.paused ? " · 已暂停" : "")
      + (typeof group.openTaskCount === "number" ? " · " + group.openTaskCount + " 项未完成" : "")));
    header.appendChild(title);
    if (news) header.appendChild(makeEl("span", "home-dot"));
    header.appendChild(makeEl("span", "ht-go", "›"));
    card.appendChild(header);

    if (group.members && group.members.length) {
      const chips = makeEl("div", "home-members");
      group.members.slice(0, 6).forEach((member) => {
        chips.appendChild(makeEl("span", "home-mchip" + (memberHasNews(group, member.id) ? " news" : ""), String(member.name || "")));
      });
      card.appendChild(chips);
    }

    const events = makeEl("ul", "home-events");
    const recent = (group.recentEvents || []).slice(0, 1);
    if (!recent.length) events.appendChild(makeEl("li", null, "群里还没有动静"));
    recent.forEach((event) => {
      const line = makeEl("li");
      line.appendChild(makeEl("time", null, clockOf(event.at)));
      line.appendChild(makeEl("span", null, String(event.text || "")));
      events.appendChild(line);
    });
    card.appendChild(events);

    const actions = makeEl("div", "home-actions");
    const enter = makeEl("button", "primary", "进入中枢");
    enter.onclick = () => openGroupThread(group);
    const manage = makeEl("button", null, "群管理");
    manage.onclick = () => openGroupManage(group);
    actions.appendChild(enter);
    actions.appendChild(manage);
    card.appendChild(actions);
    listHost.appendChild(card);
  });
  body.appendChild(makeEl("div", "home-hint", "群增删 / 派活 / 审查在电脑端操作；手机上直接说话即可。"));
}
function clearGroupNewsUI(groupId) {
  const id = String(groupId || "");
  document.querySelectorAll(".home-group").forEach((card) => {
    if (card.getAttribute("data-gid") !== id) return;
    card.classList.remove("has-news");
    const dot = card.querySelector(".home-dot");
    if (dot) dot.remove();
    card.querySelectorAll(".home-avatar.news, .home-mchip.news").forEach((node) => node.classList.remove("news"));
  });
}
function openGroupThread(group) {
  const threadId = String(group && group.bossThreadId || "");
  if (!threadId) { push("system", "这个群还没有中枢会话"); return; }
  markGroupSeen(group.id);
  clearGroupNewsUI(group.id);
  hideHome();
  currentThreadId = threadId;
  try { writeStore(THREAD_KEY, threadId); } catch (error) { /* 忽略 */ }
  document.getElementById("threads").classList.remove("open");
  void loadMessages();
  updateThreadLabel(group.name || "中枢会话");
  saveSession();
}
function openGroupManage(group) {
  const node = document.createElement("div");
  showPanel("群管理 · " + String(group && group.name || "群"), node, null);
  const seenAt = Number(groupSeen[String(group && group.id || "")] || 0);
  markGroupSeen(group && group.id);
  clearGroupNewsUI(group && group.id);
  const members = (group && group.members || []);
  const rowHead = makeEl("div", "panel-row");
  rowHead.appendChild(makeEl("b", null, "成员 " + members.length));
  rowHead.appendChild(makeEl("small", null, (group && group.paused ? "已暂停" : "运行中")));
  node.appendChild(rowHead);
  if (!members.length) node.appendChild(makeEl("div", "panel-note", "这个群还没有成员。"));
  members.forEach((member) => {
    const row = makeEl("div", "panel-row");
    row.appendChild(makeEl("span", null, String(member.name || "成员") + (member.role ? " · " + member.role : "")));
    row.appendChild(makeEl("small", null, memberHasNews(group, member.id, seenAt) ? "有新动静" : ""));
    node.appendChild(row);
  });
  const taskRow = makeEl("div", "panel-row");
  taskRow.appendChild(makeEl("b", null, "任务"));
  taskRow.appendChild(makeEl("small", null, (group && typeof group.openTaskCount === "number" ? group.openTaskCount + " 项未完成 / " : "") + (group && group.taskCount || 0) + " 项总计"));
  node.appendChild(taskRow);
  node.appendChild(makeEl("div", "panel-row")).appendChild(makeEl("b", null, "最近事件"));
  (group && group.recentEvents || []).forEach((event) => {
    const row = makeEl("div", "panel-row");
    row.appendChild(makeEl("span", null, String(event.text || "")));
    row.appendChild(makeEl("small", null, (Number(event.at || 0) > seenAt ? "NEW · " : "") + clockOf(event.at)));
    node.appendChild(row);
  });
  const enter = makeEl("button", "home-manage-enter", "进入中枢会话");
  enter.onclick = () => { closePanel(); openGroupThread(group); };
  node.appendChild(enter);
  node.appendChild(makeEl("div", "panel-note", "成员的增删 / 派活 / 审查 / 打回请在电脑端群面板操作（手机只做查看与对话）。"));
}
function openNewThreadMenu() {
  const node = document.createElement("div");
  showPanel("新建会话", node, null);
  const add = (title, desc, boss) => {
    const row = makeEl("div", "cmd-row");
    row.appendChild(makeEl("b", null, title));
    row.appendChild(makeEl("small", null, desc));
    row.onclick = () => { startSession(boss); };
    node.appendChild(row);
  };
  add("默认会话", "普通对话，直接开干", false);
  add("中枢会话", "带群，能派活、盯进度、验收", true);
}
/* 表情：与电脑端「心情表情」同一套（48 个，三组）——用户：「同步电脑端表情」 */
const EMOJI_GROUPS = [
  ["正向", "👍🎉🚀🙏💡👏🔥✅👌💪🥳🤩😎🫡⭐🧠"],
  ["负向", "😤🤔😑🫠⏳😡🤦🙃😮‍💨🥲🚩🔁🧱❗"],
  ["中性", "👀🤝🧪📌🤷🕐📝🔍🎯🔧📦☕🤖🫵👋📊🔗🗂️"],
];
function insertAtCursor(text) {
  const input = document.getElementById("cmd");
  if (!input) return;
  const start = typeof input.selectionStart === "number" ? input.selectionStart : input.value.length;
  const end = typeof input.selectionEnd === "number" ? input.selectionEnd : input.value.length;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  const caret = start + text.length;
  try { input.setSelectionRange(caret, caret); } catch (error) { /* 忽略 */ }
  input.focus();
}
/* 语音输入：APK 有原生识别桥就用原生（Android WebView 不支持网页语音识别），网页版退回 Web Speech */
function voiceInput() {
  try {
    if (window.AndroidRemote && typeof window.AndroidRemote.startVoice === "function") { window.AndroidRemote.startVoice(); return; }
  } catch (error) { /* 继续尝试网页方案 */ }
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) { push("system", "当前环境不支持语音输入：请用新版 APK，或使用键盘自带的语音"); return; }
  const recognition = new Recognition();
  recognition.lang = "zh-CN";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => { const text = event.results && event.results[0] && event.results[0][0] ? event.results[0][0].transcript : ""; if (text) insertAtCursor(text + " "); };
  recognition.onerror = (event) => { push("system", "语音输入失败：" + String(event && event.error || "未知错误")); };
  try { recognition.start(); } catch (error) { push("system", "语音输入启动失败：" + (error.message || error)); }
}
window.onVoiceResult = function (text) { const value = String(text || "").trim(); if (value) insertAtCursor(value + " "); };
window.onVoiceError = function (message) { push("system", "语音输入失败：" + String(message || "未识别到语音")); };
const MENTION_KIND_LABEL = { expert: "专家", member: "团队成员", team: "专家团", subagent: "子智能体", cli: "CLI 智能体" };
function openMentions() {
  closeSheet();
  const node = document.createElement("div");
  node.appendChild(panelMessage("加载中…"));
  showPanel("@ 提及", node, null);
  loadCatalog().then((catalog) => {
    const agents = catalog.agents || [];
    node.innerHTML = "";
    if (!agents.length) { node.appendChild(panelMessage("电脑端还没有可点名的专家 / 子智能体 / CLI")); return; }
    const groups = {};
    agents.forEach((agent) => { const key = MENTION_KIND_LABEL[agent.kind] || agent.kind; (groups[key] = groups[key] || []).push(agent); });
    Object.keys(groups).forEach((label) => {
      node.appendChild(makeEl("div", "panel-note", label));
      groups[label].forEach((agent) => {
        const row = makeEl("div", "cmd-row");
        row.appendChild(makeEl("b", null, "@" + agent.name));
        row.appendChild(makeEl("small", null, [agent.profession, agent.installed === false ? "未安装" : ""].filter(Boolean).join(" · ") || MENTION_KIND_LABEL[agent.kind]));
        if (agent.installed === false) { row.style.opacity = "0.45"; }
        else row.onclick = () => {
          pendingMentions = pendingMentions.filter((entry) => entry.key !== agent.key).slice(0, 4).concat([{ kind: agent.kind, key: agent.key, name: agent.name }]);
          insertAtCursor("@" + agent.name + " ");
          closePanel();
        };
        node.appendChild(row);
      });
    });
  }).catch((error) => { node.innerHTML = ""; node.appendChild(panelMessage("@ 列表加载失败：" + (error.message || "未知错误"))); });
}
function openEmoji() {
  closeSheet();
  const node = document.createElement("div");
  EMOJI_GROUPS.forEach(([label, chars]) => {
    node.appendChild(makeEl("div", "panel-note", label));
    const grid = makeEl("div", "emoji-grid");
    Array.from(chars).forEach((emoji) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = emoji;
      button.onclick = () => { insertAtCursor(emoji); closePanel(); };
      grid.appendChild(button);
    });
    node.appendChild(grid);
  });
  showPanel("表情", node, null);
}
function takePhoto() { closeSheet(); const input = document.getElementById("camera-pick"); if (input) input.click(); }
async function startSession(boss) {
  closePanel();
  closeSheet();
  try {
    const result = await rpc({ type: "new-thread", boss: Boolean(boss) });
    hideHome();
    currentThreadId = result.threadId;
    try { writeStore(THREAD_KEY, currentThreadId); } catch (error) { /* 忽略 */ }
    document.getElementById("threads").classList.remove("open");
    list.innerHTML = "";
    stepBox = null;
    currentOutputEl = null;
    lastFilesData = null;
    setRunning(false);
    push("system", boss ? "已新建中枢会话：可以直接派活，或让它建群" : "已新建会话，直接发消息开始对话");
    updateThreadLabel(boss ? "中枢会话" : "新会话");
    void loadThreads();
    saveSession();
  } catch (error) {
    /* ⛔ 失败时首页还盖着消息区：报错必须显示在首页上，否则用户只看到「点了没反应」 */
    const text = "新建会话失败：" + (error.message || "未知错误");
    if (homeVisible) {
      const body = document.getElementById("home-body");
      if (body) body.appendChild(makeEl("div", "empty-tip", text));
    } else push("system", text);
  }
}
/* ── ＋ 菜单：图片 / 文件 / 技能 / 指令（都在电脑端执行，手机只发请求） ── */
function openSheet() {
  document.getElementById("sheet-mask").classList.add("on");
  document.getElementById("sheet").classList.add("open");
}
function closeSheet() {
  document.getElementById("sheet-mask").classList.remove("on");
  document.getElementById("sheet").classList.remove("open");
}
function pickImage() {
  closeSheet();
  document.getElementById("file-pick").click();
}
function renderImages() {
  const box = document.getElementById("imgs");
  box.innerHTML = "";
  pendingImages.forEach((shot, index) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    const img = document.createElement("img");
    img.src = shot.dataUrl;
    chip.appendChild(img);
    const del = document.createElement("button");
    del.textContent = "×";
    del.onclick = () => { pendingImages.splice(index, 1); renderImages(); };
    chip.appendChild(del);
    box.appendChild(chip);
  });
  box.classList.toggle("on", pendingImages.length > 0);
}
document.getElementById("file-pick").addEventListener("change", (event) => {
  const picked = Array.prototype.slice.call(event.target.files || []);
  const room = Math.max(0, 4 - pendingImages.length);
  const files = picked.slice(0, room);
  if (picked.length > room) push("system", "一次最多 4 张图");
  let left = files.length;
  const done = () => { if (--left <= 0) event.target.value = ""; };
  if (!left) { event.target.value = ""; return; }
  files.forEach((file) => {
    if (file.size > 8 * 1024 * 1024) { push("system", "图片太大（上限 8MB）：" + file.name); done(); return; }
    const reader = new FileReader();
    reader.onload = () => { pendingImages.push({ dataUrl: String(reader.result || ""), name: file.name }); renderImages(); done(); };
    reader.onerror = () => { push("system", "读取图片失败：" + file.name); done(); };
    reader.readAsDataURL(file);
  });
});
document.getElementById("camera-pick").addEventListener("change", (event) => {
  const picked = Array.prototype.slice.call(event.target.files || []);
  const room = Math.max(0, 4 - pendingImages.length);
  const files = picked.slice(0, room);
  if (picked.length > room) push("system", "一次最多 4 张图");
  let left = files.length;
  const done = () => { if (--left <= 0) event.target.value = ""; };
  if (!left) { event.target.value = ""; return; }
  files.forEach((file) => {
    if (file.size > 8 * 1024 * 1024) { push("system", "图片太大（上限 8MB）"); done(); return; }
    const reader = new FileReader();
    reader.onload = () => { pendingImages.push({ dataUrl: String(reader.result || ""), name: "camera.jpg" }); renderImages(); done(); };
    reader.onerror = () => { push("system", "拍照图片读取失败"); done(); };
    reader.readAsDataURL(file);
  });
});
async function uploadImage(shot) {
  const res = await fetch(apiUrl("/api/upload"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dataUrl: shot.dataUrl, name: shot.name }) });
  const data = await res.json();
  if (!data || !data.ok) throw new Error((data && data.error) || "上传失败");
  return data.path;
}
function insertText(text) {
  const input = document.getElementById("cmd");
  input.value = (input.value ? input.value.replace(/\s*$/, " ") : "") + text;
  input.focus();
}
function showPanel(title, node, back) {
  panelBack = back || null;
  document.getElementById("panel-title").textContent = title;
  const body = document.getElementById("panel-body");
  body.innerHTML = "";
  body.appendChild(node);
  document.getElementById("panel").classList.add("open");
}
function closePanel() {
  if (panelBack) { const back = panelBack; panelBack = null; back(); return; }
  document.getElementById("panel").classList.remove("open");
}
function panelMessage(text) {
  const node = document.createElement("div");
  node.className = "empty-tip";
  node.textContent = text;
  return node;
}
async function loadCatalog() {
  if (catalogCache) return catalogCache;
  catalogCache = await rpc({ type: "catalog" });
  return catalogCache;
}
function humanSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + "B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + "KB";
  return (n / 1024 / 1024).toFixed(1) + "MB";
}
function openFiles() {
  closeSheet();
  const node = document.createElement("div");
  node.appendChild(panelMessage("加载中…"));
  showPanel("工作区文件", node, null);
  rpc({ type: "files-list", threadId: currentThreadId }).then((r) => {
    const files = (r.files || []).filter((f) => !f.dir);
    node.innerHTML = "";
    if (!files.length) { node.appendChild(panelMessage("这个会话还没有可预览的文件")); return; }
    for (const file of files) {
      const row = document.createElement("div");
      row.className = "file-row";
      const name = document.createElement("span");
      name.className = "nm";
      name.textContent = file.path;
      const size = document.createElement("small");
      size.textContent = humanSize(file.size);
      row.appendChild(name);
      row.appendChild(size);
      row.onclick = () => openPreview(file.path);
      node.appendChild(row);
    }
  }).catch((error) => { node.innerHTML = ""; node.appendChild(panelMessage("加载失败：" + error.message)); });
}
function openPreview(path) {
  const node = document.createElement("div");
  node.appendChild(panelMessage("加载中…"));
  showPanel(String(path).split("/").pop(), node, () => openFiles());
  rpc({ type: "file-read", threadId: currentThreadId, path }).then((r) => {
    node.innerHTML = "";
    if (r.error) { node.appendChild(panelMessage(r.error)); return; }
    if (r.kind === "image" && r.dataUrl) {
      const img = document.createElement("img");
      img.src = r.dataUrl;
      node.appendChild(img);
      return;
    }
    const pre = document.createElement("pre");
    pre.textContent = r.text || "";
    node.appendChild(pre);
  }).catch((error) => { node.innerHTML = ""; node.appendChild(panelMessage("读取失败：" + error.message)); });
}
function openTurnFiles() {
  const node = document.createElement("div");
  showPanel("本轮改动", node, null);
  const render = (files) => {
    node.innerHTML = "";
    if (!files.length) { node.appendChild(panelMessage("这一轮没有文件改动记录")); return; }
    for (const file of files) {
      const row = document.createElement("div");
      row.className = "file-row";
      const name = document.createElement("span");
      name.className = "nm";
      name.textContent = (file.status === "added" ? "新建 " : "") + file.path;
      const meta = document.createElement("small");
      meta.textContent = file.status === "deleted" ? "已删除" : ("+" + file.added + " −" + file.deleted);
      row.appendChild(name);
      row.appendChild(meta);
      row.onclick = () => openTurnDiff(file.path);
      node.appendChild(row);
    }
  };
  // 运行中优先用实时清单：落盘报告要回合结束才写，拿它会是上一轮的
  if (lastFilesData && lastFilesData.length) { render(lastFilesData); return; }
  node.appendChild(panelMessage("加载中…"));
  rpc({ type: "turn-files", threadId: currentThreadId }).then((r) => render(r.files || []))
    .catch((error) => { node.innerHTML = ""; node.appendChild(panelMessage("加载失败：" + error.message)); });
}
function openTurnDiff(path) {
  const node = document.createElement("div");
  node.appendChild(panelMessage("加载中…"));
  showPanel(String(path).split("/").pop(), node, () => openTurnFiles());
  rpc({ type: "file-diff", threadId: currentThreadId, path }).then((r) => {
    node.innerHTML = "";
    if (r.error || !r.diff) { node.appendChild(panelMessage(r.error || "这条改动没有 diff")); return; }
    const pre = document.createElement("pre");
    pre.textContent = r.diff;
    node.appendChild(pre);
  }).catch((error) => { node.innerHTML = ""; node.appendChild(panelMessage("读取失败：" + error.message)); });
}
function setTaskText(text) {
  const el = document.getElementById("taskbar");
  if (!el) return;
  el.textContent = text || "";
  el.hidden = !text;
}
async function refreshTasks() {
  if (!currentThreadId) { setTaskText(""); return; }
  try {
    const r = await rpc({ type: "tasks" });
    const pending = (r.tasks || []).filter((task) => task.state !== "done");
    setTaskText(pending.length ? ("清单 · " + pending.length + " 项未完成 · " + pending[0].title) : "");
  } catch { setTaskText("清单读取失败"); }
}
function setGoalText(text) {
  const el = document.getElementById("goalbar");
  if (!el) return;
  el.textContent = text || "";
  el.hidden = !text;
}
async function refreshGoal() {
  if (!currentThreadId) { setGoalText(""); return; }
  try {
    const r = await rpc({ type: "goal-get", threadId: currentThreadId });
    const objective = String(r.objective || "").trim();
    const status = String(r.status || "");
    const state = status === "paused" ? "（已暂停）" : status === "complete" || status === "completed" ? "（已完成）" : "";
    setGoalText(objective ? ("🎯 目标：" + objective + state) : "");
  } catch { setGoalText("目标读取失败"); }
}
function openSkills() {
  closeSheet();
  const node = document.createElement("div");
  node.appendChild(panelMessage("加载中…"));
  showPanel("技能", node, null);
  loadCatalog().then((catalog) => {
    const skills = catalog.skills || [];
    node.innerHTML = "";
    if (!skills.length) { node.appendChild(panelMessage("没有可用技能（引擎可能还没就绪）")); return; }
    for (const skill of skills) {
      const row = document.createElement("div");
      row.className = "cmd-row";
      const name = document.createElement("b");
      name.textContent = "#" + skill.name;
      row.appendChild(name);
      if (skill.description) {
        const desc = document.createElement("small");
        desc.textContent = skill.description;
        row.appendChild(desc);
      }
      row.onclick = () => { insertText("#" + skill.name + " "); closePanel(); };
      node.appendChild(row);
    }
  }).catch((error) => { node.innerHTML = ""; node.appendChild(panelMessage("加载失败：" + error.message)); });
}
function openCommands() {
  closeSheet();
  const node = document.createElement("div");
  node.appendChild(panelMessage("加载中…"));
  showPanel("指令", node, null);
  loadCatalog().then((catalog) => {
    node.innerHTML = "";
    for (const command of catalog.commands || []) {
      const row = document.createElement("div");
      row.className = "cmd-row";
      row.textContent = "/" + command.label;
      row.onclick = () => runCommand(command.id);
      node.appendChild(row);
    }
    const archiveRow = document.createElement("div");
    archiveRow.className = "cmd-row";
    archiveRow.textContent = "/归档当前会话";
    archiveRow.onclick = () => runCommand("archive");
    node.appendChild(archiveRow);
    const goalRow = document.createElement("div");
    goalRow.className = "cmd-row";
    goalRow.textContent = "/设为目标（用输入框里的内容）";
    goalRow.onclick = () => runCommand("goal");
    node.appendChild(goalRow);
    const effHead = document.createElement("div");
    effHead.className = "cmd-row";
    effHead.style.fontWeight = "600";
    effHead.textContent = "思考强度（对后面的消息生效）";
    node.appendChild(effHead);
    const currentEffort = readStore("chm-effort") || "high";
    const efforts = [["low", "低"], ["medium", "中"], ["high", "高"], ["xhigh", "极高"]];
    for (const pair of efforts) {
      const row = document.createElement("div");
      row.className = "cmd-row";
      row.textContent = pair[1] + (pair[0] === currentEffort ? " ✓" : "");
      row.onclick = () => { writeStore("chm-effort", pair[0]); openCommands(); };
      node.appendChild(row);
    }
  }).catch((error) => { node.innerHTML = ""; node.appendChild(panelMessage("加载失败：" + error.message)); });
}
function openApk() {
  closeSheet();
  // ⛔ 直接导航到 /apk：WebView 会把它交给 App 的 DownloadListener（带 cookie 走中转下载）
  location.href = apiUrl("/apk");
}
async function runCommand(id) {
  closePanel();
  try {
    if (id === "new") {
      const r = await rpc({ type: "new-thread" });
      currentThreadId = r.threadId;
      writeStore(THREAD_KEY, currentThreadId);
      list.innerHTML = "";
      stepBox = null;
      currentOutputEl = null;

      lastFilesData = null;
      push("system", "已新建会话");
      loadThreads();
      saveSession();
      return;
    }
    if (!currentThreadId) { push("system", "先选一个会话"); return; }
    if (id === "stop") { await stopTurn(); return; }
    if (id === "compact") { await rpc({ type: "compact", threadId: currentThreadId }); push("system", "已请求压缩上下文"); return; }
    if (id === "archive") {
      await rpc({ type: "archive", threadId: currentThreadId });
      push("system", "已归档当前会话");
      const r = await rpc({ type: "list-threads" });
      const first = (r.threads || [])[0];
      loadThreads();
      if (first) { currentThreadId = first.id; writeStore(THREAD_KEY, first.id); await loadMessages(); }
      else { currentThreadId = ""; dropStore(THREAD_KEY); await newThread(); }
      return;
    }
    if (id === "goal") {
      const input = document.getElementById("cmd");
      const objective = input.value.trim();
      if (!objective) { push("system", "先把目标写进输入框，再点这条指令"); return; }
      await rpc({ type: "goal", threadId: currentThreadId, objective });
      input.value = "";
      push("system", "已设为目标，Codex 会朝它自动推进");
      void refreshGoal();
      return;
    }
  } catch (error) {
    push("system", "指令失败：" + error.message);
  }
}
// 安卓系统返回键：先收面板 / ＋ 菜单，再考虑退出（MainActivity 会先问这个钩子）
window.__remoteBack = function () {
  const panel = document.getElementById("panel");
  if (panel && panel.classList.contains("open")) { closePanel(); return true; }
  const sheet = document.getElementById("sheet");
  if (sheet && sheet.classList.contains("open")) { closeSheet(); return true; }
  return false;
};
document.getElementById("cmd").addEventListener("keydown", (e) => { if (e.key === "Enter") sendCmd(); });
/* 助手正文里的链接是 target="_blank"：安卓壳没有新窗口能力（点了没反应）⇒ 壳内改成当前窗导航，
   由 WebViewClient 把外部域名交给系统浏览器（桌面浏览器照旧新开标签页）。 */
document.addEventListener("click", (event) => {
  if (navigator.userAgent.indexOf("CodexHarnessRemote") < 0) return;
  const link = event.target && event.target.closest ? event.target.closest("a") : null;
  if (!link || !/^https?:/i.test(link.href)) return;
  if (link.href.indexOf(location.origin) === 0) return;
  event.preventDefault();
  location.href = link.href;
});
let pollSince = Date.now() - 60000;
async function pollLoop() {
  try {
    const res = await fetch(apiUrl("/api/events?since=" + pollSince));
    const data = await res.json();
    if (data && data.error === "unauthorized") {
      /* 旧页面凭据过期（电脑端重启）：自动重连一次，别停在这里一直「在线」却收不到消息 */
      document.getElementById("status").textContent = "重连中…";
      maybeReauth(data.error);
      window.setTimeout(pollLoop, 3000);
      return;
    }
    pollSince = data.now || Date.now();
    for (const event of data.events || []) {
      if (event.threadId !== currentThreadId) continue;
      if (event.kind === "delta") {
        hideThinking();
        setRunning(true);
        let el = list.querySelector(".streaming");
        if (!el) el = push("assistant", "", "assistant streaming");
        // 流式：每次把累计文本重新渲染（聊天量级下开销可忽略，换来边流边排版）
        el._mdText = (el._mdText || "") + event.text;
        el.innerHTML = renderMarkdownHtml(el._mdText);
        list.scrollTop = list.scrollHeight;
      } else if (event.kind === "step") {
        // 运行步骤：与桌面对话框同一批事件（命令 / 文件 / 工具 / 搜索 / 思考）
        hideThinking();
        setRunning(true);
        if (!stepBox) {
          stepBox = document.createElement("div");
          stepBox.className = "run-steps";
          list.appendChild(stepBox);
        }
        const lastStep = stepBox.lastElementChild;
        if (!lastStep || lastStep.textContent !== event.text) {
          const line = document.createElement("div");
          line.className = "step";
          line.textContent = event.text;
          stepBox.appendChild(line);
          if (event.text.indexOf("命令") === 0) {
            currentOutputEl = document.createElement("pre");
            currentOutputEl.className = "step-out";
            stepBox.appendChild(currentOutputEl);
          }
          list.scrollTop = list.scrollHeight;
        }
      } else if (event.kind === "output") {
        // 命令输出：接在最近一条命令步骤下面（超过 6000 字只留尾部，别把页面撑爆）
        hideThinking();
        setRunning(true);
        if (!stepBox) {
          stepBox = document.createElement("div");
          stepBox.className = "run-steps";
          list.appendChild(stepBox);
        }
        if (!currentOutputEl) {
          currentOutputEl = document.createElement("pre");
          currentOutputEl.className = "step-out";
          stepBox.appendChild(currentOutputEl);
        }
        currentOutputEl.textContent += event.text;
        if (currentOutputEl.textContent.length > 6000) currentOutputEl.textContent = currentOutputEl.textContent.slice(-6000);
        currentOutputEl.classList.add("on");
        currentOutputEl.scrollTop = currentOutputEl.scrollHeight;
        list.scrollTop = list.scrollHeight;
      } else if (event.kind === "files") {
        // 文件变更：一行原地更新（宿主每拍都会推，不能一行行追加）
        hideThinking();
        setRunning(true);
        if (!stepBox) {
          stepBox = document.createElement("div");
          stepBox.className = "run-steps";
          list.appendChild(stepBox);
        }
        if (!filesEl || !stepBox.contains(filesEl)) {
          filesEl = document.createElement("div");
          filesEl.className = "step step-files";
          stepBox.appendChild(filesEl);
        }
        filesEl.textContent = event.text;
        // 实时清单随事件到位：落盘报告要回合结束才写，运行中点「查看改动」只能用这份
        if (Array.isArray(event.data?.files)) lastFilesData = event.data.files;
        if (!filesBtn || !stepBox.contains(filesBtn)) {
          filesBtn = document.createElement("button");
          filesBtn.className = "step-more";
          filesBtn.textContent = "查看改动";
          filesBtn.onclick = () => openTurnFiles();
          stepBox.appendChild(filesBtn);
        }
        list.scrollTop = list.scrollHeight;
      } else if (event.kind === "notice") {
        // 审批 / 询问：手机端没有交互，明确让用户去电脑上点
        hideThinking();
        setRunning(true);
        if (!stepBox) {
          stepBox = document.createElement("div");
          stepBox.className = "run-steps";
          list.appendChild(stepBox);
        }
        const notice = document.createElement("div");
        notice.className = "step step-notice";
        notice.textContent = event.text;
        stepBox.appendChild(notice);
        list.scrollTop = list.scrollHeight;
      } else if (event.kind === "ask") {
        // 询问 / 审批：可直接在手机上点（引擎原生请求由主进程回包；agent_ask 走渲染层桥）
        hideThinking();
        setRunning(true);
        if (!stepBox) {
          stepBox = document.createElement("div");
          stepBox.className = "run-steps";
          list.appendChild(stepBox);
        }
        const askData = event.data || {};
        const card = document.createElement("div");
        card.className = "ask-card";
        const question = document.createElement("div");
        question.className = "ask-q";
        question.textContent = event.text || "请选择";
        card.appendChild(question);
        const optionsRow = document.createElement("div");
        optionsRow.className = "ask-opts";
        (askData.options || []).forEach((option) => {
          const button = document.createElement("button");
          button.className = "ask-opt";
          button.textContent = String(option.label ?? "");
          button.onclick = async () => {
            try {
              await rpc({
                type: "answer",
                kind: askData.kind,
                requestId: askData.requestId,
                questionId: askData.questionId,
                choice: button.textContent,
                threadId: event.threadId,
              });
              card.remove();
              push("system", "已选择：" + button.textContent);
            } catch (error) {
              push("system", "提交失败：" + error.message);
            }
          };
          optionsRow.appendChild(button);
        });
        card.appendChild(optionsRow);
        stepBox.appendChild(card);
        list.scrollTop = list.scrollHeight;
      } else if (event.kind === "think") {
        // 思考内容：与桌面折叠区同一股摘要流，实时展开显示
        hideThinking();
        setRunning(true);
        if (!stepBox) {
          stepBox = document.createElement("div");
          stepBox.className = "run-steps";
          list.appendChild(stepBox);
        }
        let thinkEl = stepBox.querySelector(".think");
        if (!thinkEl) {
          thinkEl = document.createElement("div");
          thinkEl.className = "think";
          thinkEl.appendChild(document.createTextNode("思考："));
          const body = document.createElement("span");
          body.className = "think-text";
          thinkEl.appendChild(body);
          stepBox.appendChild(thinkEl);
        }
        thinkEl.querySelector(".think-text").textContent += event.text;
        list.scrollTop = list.scrollHeight;
      } else if (event.kind === "running") {
        /* 电脑端发起的回合：手机同步成「运行中」，按钮变「停止」，否则用户既看不到在跑、也停不了 */
        if (!turnRunning) { setRunning(true); showThinking(); }
      } else if (event.kind === "error") {
        /* 失败/被停的明确反馈：旧实现只发 done，手机端看起来什么都没发生 */
        hideThinking();
        setRunning(false);
        push("system", String(event.text || "运行出错"));
      } else if (event.kind === "done") {
        hideThinking();
        setRunning(false);
        const el = list.querySelector(".streaming");
        if (el) el.classList.remove("streaming");
        // 回合结束：空「思考：」壳、以及没来得及答的询问卡都清掉（卡已失效，留着点了也是死请求）
        if (stepBox) {
          stepBox.querySelectorAll(".think").forEach((node) => {
            const body = node.querySelector(".think-text");
            if (!body || !String(body.textContent || "").trim()) node.remove();
          });
          stepBox.querySelectorAll(".ask-card").forEach((node) => node.remove());
        }
        // 步骤收成「运行过程 · N 步」，点开可看
        if (stepBox && stepBox.children.length) {
          const box = document.createElement("details");
          box.className = "run-steps";
          const sum = document.createElement("summary");
          const hasThink = Boolean(stepBox.querySelector(".think .think-text"));
          sum.textContent = "运行过程 · " + stepBox.children.length + " 步" + (hasThink ? " · 含思考" : "");
          box.appendChild(sum);
          while (stepBox.firstChild) box.appendChild(stepBox.firstChild);
          stepBox.replaceWith(box);
        }
        stepBox = null;
        currentOutputEl = null;

        lastFilesData = null;
        void refreshTasks();
      } else if (event.kind === "user") {
        const pending = list.querySelector('.msg.user[data-pending="1"]');
        if (pending && pending.textContent === event.text) {
          delete pending.dataset.pending;
        } else {
          push("user", event.text);
        }
      }
    }
    document.getElementById("status").textContent = "● 在线";
  } catch { document.getElementById("status").textContent = "重连中…"; }
  setTimeout(pollLoop, 1500);
}
pollLoop();
/* ⛔ 10-28 用户令：应用默认停在**首页**（「不会一进去就是对话」）。
   以前这里会自动恢复上次会话、没有会话就连带新建一条（留一堆空会话）；
   现在首页负责落地，点会话或发第一条消息时才进入会话。 */
readHomePrefs();
/* 进到对话页 = 登录已生效：清掉配对页的自动登录尝试计数，避免下一次误判"循环" */
try { sessionStorage.removeItem("chm-autologin-tries@" + STORAGE_HOST); } catch (error) { /* 忽略 */ }
showHome();
</script>`;
    return pageHtml.replace("/*__MOBILE_MARKDOWN__*/", MOBILE_MARKDOWN_SOURCE);
}
