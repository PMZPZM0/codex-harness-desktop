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

export function buildRemotePageHtml(code: string, botId?: string, botName?: string): string {
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
<div class="card"><h1>绑定机器人「${botName ?? ""}」</h1><p>确认后，这台手机将作为该机器人的控制端：<br>可查看对话、随时发消息，与电脑实时同步。</p><p id="state">正在校验绑定码…</p><div id="btns" style="display:none"><button onclick="doBind()">确认登录</button><button class="ghost" onclick="document.getElementById('btns').style.display='none'">取消</button></div></div>
<script>
const code = ${JSON.stringify(code)};
const botId = ${JSON.stringify(botId ?? "")};
async function check(){
  try{
    const r = await fetch("/api/bind-status?code=" + code + "&bot=" + botId);
    const j = await r.json();
    if(j.ok){ document.getElementById("state").textContent = "绑定码有效"; document.getElementById("btns").style.display = "block"; }
    else document.getElementById("state").textContent = "绑定码已失效，请回到应用重新生成二维码。";
  }catch(e){ document.getElementById("state").textContent = "网络错误：" + e.message; }
}
check();
async function doBind(){
  const r = await fetch("/api/bind-confirm", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ code, botId, deviceName: navigator.userAgent.includes("iPhone") ? "iPhone" : navigator.userAgent.includes("Android") ? "Android 手机" : "手机" }) });
  const j = await r.json();
  if (j.ok) { document.querySelector(".card").innerHTML = "<h1 class='ok'>✓ 绑定成功</h1><p>正在进入对话…</p>"; setTimeout(() => { location.href = "/r/" + code; }, 800); }
  else document.getElementById("state").textContent = "绑定失败：" + (j.error ?? "未知错误");
}
</script></html>`;
    }
    const pageHtml = `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Codex 对话</title><style>
*{box-sizing:border-box}
:root{--accent:#2f6bdd;--accent-soft:#eaf1fd;--line:#e8e8e4;--muted:#8a8a84;--ink:#23231f;--bg:#f7f7f5}
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);margin:0;color:var(--ink);display:flex;flex-direction:column;height:100vh;height:100dvh}
header{padding:10px 14px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px;flex:0 0 auto}
header h1{font-size:15px;font-weight:600;margin:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
header .status{font-size:11px;color:#1a7f37;background:#e7f3ea;border-radius:999px;padding:3px 9px;white-space:nowrap}
header button{flex:0 0 auto;width:auto;margin:0;padding:6px 12px;font-size:12px;background:#fff;color:var(--ink);border:1px solid var(--line);border-radius:999px}
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
#file-pick{display:none}
#imgs{display:none;gap:8px;padding:8px 12px 0;background:#fff;overflow-x:auto}
#imgs.on{display:flex}
#imgs .chip{position:relative;width:56px;height:56px;flex:0 0 auto;border-radius:10px;overflow:hidden;border:1px solid var(--line)}
#imgs .chip img{width:100%;height:100%;object-fit:cover;display:block}
#imgs .chip button{position:absolute;top:2px;right:2px;width:18px;height:18px;margin:0;padding:0;border:0;border-radius:9px;background:rgba(0,0,0,.55);color:#fff;font-size:11px;line-height:18px}
.mask{position:fixed;inset:0;background:rgba(0,0,0,.25);z-index:29;display:none}
.mask.on{display:block}
#sheet{position:fixed;left:0;right:0;bottom:0;z-index:30;display:none;background:#fff;border-top:1px solid var(--line);border-radius:16px 16px 0 0;box-shadow:0 -6px 24px rgba(0,0,0,.12);padding:12px 12px calc(14px + env(safe-area-inset-bottom))}
#sheet.open{display:block}
#sheet .grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
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
</style>
<header>
  <button id="btn-threads" onclick="toggleThreads()">会话</button>
  <h1 id="title">Codex 对话</h1>
  <span id="thread-label" style="font-size:11px;color:#8a8a84;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px"></span>
  <span class="status" id="status">连接中…</span>
</header>
<div id="threads"><div class="threads-head"><button onclick="toggleThreads()">← 返回</button><b>选择会话</b><button class="new-thread" onclick="newThread()">＋ 新建</button></div><div class="list" id="thread-list"></div></div>
<div id="msglist"></div>
<div id="imgs"></div>
<div id="inputbar"><button id="plus" onclick="openSheet()">＋</button><input id="cmd" placeholder="输入消息，发送给 Codex"><button id="send" onclick="handleSend()">发送</button></div>
<!-- 占位：构建时替换成 src/lib/mobile-markdown.mjs 的源码 -->
<script>/*__MOBILE_MARKDOWN__*/</script>
<input type="file" id="file-pick" accept="image/*" multiple>
<div id="sheet-mask" class="mask" onclick="closeSheet()"></div>
<div id="sheet"><div class="grid">
  <button onclick="pickImage()"><b>🖼</b>图片</button>
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
const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/" + code);
let rpcSeq = 0;
const rpcWaiters = new Map();
// 会话记忆 key 固定（不绑定随机 code）：同一地址下扫码进入都能恢复上次会话
const THREAD_KEY = "chm-thread";
let currentThreadId = localStorage.getItem(THREAD_KEY) || "";
let streaming = "";
// 当前回合的「运行步骤」容器（命令/文件/工具/思考）；回合结束收成可折叠块
let stepBox = null;
// 待发图片（本地预览，发送时才上传）+ 能力目录缓存 + 面板返回动作
let pendingImages = [];
let catalogCache = null;
let panelBack = null;
// 当前命令步骤的输出块（桌面对话框的命令卡里有结果，手机端挂在对应命令下面）
let currentOutputEl = null;
// 文件变更那一行（宿主追踪器每拍推一次，原地更新）
let filesEl = null;
// 当前会话是否在跑：发送键在运行时变成「停止」
let turnRunning = false;
const list = document.getElementById("msglist");
// 设备身份：localStorage 固定生成，服务端用它记住「这台手机上次用的会话」
let deviceId = localStorage.getItem("chm-device-id");
if (!deviceId) {
  deviceId = "dev-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  localStorage.setItem("chm-device-id", deviceId);
}
function saveSession() {
  try {
    fetch("/api/session", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ device: deviceId, threadId: currentThreadId }) });
  } catch { /* 忽略 */ }
}

async function rpc(payload) {
  const reqId = String(++rpcSeq);
  const res = await fetch("/api/rpc", { method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ ...payload, reqId }) });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}
function push(role, text, cls, pending) {
  const div = document.createElement("div");
  div.className = "msg " + (cls || role) + (role === "assistant" ? " md" : "");
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
    row.querySelector("b").textContent = threadTitle(t);
    row.querySelector("small").textContent = new Date(t.updatedAt * 1000).toLocaleString();
    row.onclick = () => { currentThreadId = t.id; localStorage.setItem(THREAD_KEY, t.id); document.getElementById("threads").classList.remove("open"); loadMessages(); updateThreadLabel(threadTitle(t)); saveSession(); };
    el.appendChild(row);
  }
}
function toggleThreads() { const el = document.getElementById("threads"); if (el.classList.contains("open")) el.classList.remove("open"); else { loadThreads(); el.classList.add("open"); } }
function updateThreadLabel(name) {
  const el = document.getElementById("thread-label");
  if (el) el.textContent = name || "";
}
async function newThread() {
  const r = await rpc({ type: "new-thread" });
  currentThreadId = r.threadId;
  localStorage.setItem(THREAD_KEY, currentThreadId);
  document.getElementById("threads").classList.remove("open");
  list.innerHTML = "";
  stepBox = null; // 旧容器已从 DOM 移除，不重置的话新回合的步骤会渲染到看不见的节点上
  currentOutputEl = null;
  setRunning(false);
  push("system", "已新建会话，直接发消息开始对话");
  updateThreadLabel("新会话");
  loadThreads();
  saveSession();
}
async function loadMessages() {
  if (!currentThreadId) return;
  try {
    list.innerHTML = "";
    stepBox = null;
    currentOutputEl = null;
    setRunning(false);
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
  } catch {
    // 会话已失效（被删除等）：退回新建
    currentThreadId = "";
    localStorage.removeItem(THREAD_KEY);
    await newThread();
  }
}
async function sendCmd() {
  const input = document.getElementById("cmd");
  const v = input.value.trim();
  if (!v && !pendingImages.length) return;
  stepBox = null; // 新一轮从空步骤列表开始
  currentOutputEl = null;
  const shots = pendingImages.slice();
  pendingImages = [];
  renderImages();
  const label = v + (shots.length ? (v ? "\\n" : "") + "📷 " + shots.length + " 张图" : "");
  push("user", label, "", true);
  input.value = "";
  showThinking();
  setRunning(true);
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
      const r = await rpc({ type: "new-thread" });
      currentThreadId = r.threadId;
      localStorage.setItem(THREAD_KEY, currentThreadId);
      loadThreads();
    }
    await rpc({ type: "send-message", threadId: currentThreadId, text: v, images: paths, effort: localStorage.getItem("chm-effort") || "high" });
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
async function uploadImage(shot) {
  const res = await fetch("/api/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dataUrl: shot.dataUrl, name: shot.name }) });
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
    const currentEffort = localStorage.getItem("chm-effort") || "high";
    const efforts = [["low", "低"], ["medium", "中"], ["high", "高"], ["xhigh", "极高"]];
    for (const pair of efforts) {
      const row = document.createElement("div");
      row.className = "cmd-row";
      row.textContent = pair[1] + (pair[0] === currentEffort ? " ✓" : "");
      row.onclick = () => { localStorage.setItem("chm-effort", pair[0]); openCommands(); };
      node.appendChild(row);
    }
  }).catch((error) => { node.innerHTML = ""; node.appendChild(panelMessage("加载失败：" + error.message)); });
}
function openApk() {
  closeSheet();
  // ⛔ 直接导航到 /apk：WebView 会把它交给 App 的 DownloadListener（带 cookie 走中转下载）
  location.href = baseUrl + "/apk";
}
async function runCommand(id) {
  closePanel();
  try {
    if (id === "new") {
      const r = await rpc({ type: "new-thread" });
      currentThreadId = r.threadId;
      localStorage.setItem(THREAD_KEY, currentThreadId);
      list.innerHTML = "";
      stepBox = null;
      currentOutputEl = null;
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
      if (first) { currentThreadId = first.id; localStorage.setItem(THREAD_KEY, first.id); await loadMessages(); }
      else { currentThreadId = ""; localStorage.removeItem(THREAD_KEY); await newThread(); }
      return;
    }
    if (id === "goal") {
      const input = document.getElementById("cmd");
      const objective = input.value.trim();
      if (!objective) { push("system", "先把目标写进输入框，再点这条指令"); return; }
      await rpc({ type: "goal", threadId: currentThreadId, objective });
      input.value = "";
      push("system", "已设为目标，Codex 会朝它自动推进");
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
let pollSince = Date.now() - 60000;
async function pollLoop() {
  try {
    const res = await fetch("/api/events?since=" + pollSince);
    const data = await res.json();
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
      } else if (event.kind === "done") {
        hideThinking();
        setRunning(false);
        const el = list.querySelector(".streaming");
        if (el) el.classList.remove("streaming");
        // 回合结束：没有任何文字的「思考：」空壳删掉（供应商标了 reasoning 却没内容）
        if (stepBox) {
          stepBox.querySelectorAll(".think").forEach((node) => {
            const body = node.querySelector(".think-text");
            if (!body || !String(body.textContent || "").trim()) node.remove();
          });
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
(async () => {
  // 恢复上次会话：① 本地记录 ② 服务端设备映射 ③ 最近会话兜底，全无才新建
  if (currentThreadId) { await loadMessages(); saveSession(); return; }
  try {
    const r = await fetch("/api/session?device=" + deviceId);
    const j = await r.json();
    if (j.threadId) { currentThreadId = j.threadId; localStorage.setItem(THREAD_KEY, currentThreadId); await loadMessages(); saveSession(); return; }
  } catch { /* 服务不可用则走兜底 */ }
  try {
    const r = await rpc({ type: "list-threads" });
    const threads = r.threads || [];
    if (threads.length) {
      const t = threads[0];
      currentThreadId = t.id;
      localStorage.setItem(THREAD_KEY, t.id);
      await loadMessages();
      updateThreadLabel(threadTitle(t));
      saveSession();
      return;
    }
  } catch { /* 引擎不可用则新建 */ }
  await newThread();
})();
</script>`;
    return pageHtml.replace("/*__MOBILE_MARKDOWN__*/", MOBILE_MARKDOWN_SOURCE);
}
