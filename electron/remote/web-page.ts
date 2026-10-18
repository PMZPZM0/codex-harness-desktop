/**
 * remote/web-page.ts —— 手机远控的**内嵌 H5 页面**（字符串模板）。
 *
 * 从 electron/remote.ts（1026 行单类）抽出（P2 批次 3）：原 `html()` 实测 **0 处 this.** 引用，
 * 是对 (code, botId, botName) 的纯函数 —— 抽出去零行为变化，且让服务类只剩「协议与生命周期」。
 * ⛔ 页面内容（HTML/CSS/JS）原样搬运，一个字都没动。
 */

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
    return `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Codex 对话</title><style>
*{box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:#f7f7f5;margin:0;color:#23231f;display:flex;flex-direction:column;height:100vh}
header{padding:12px 16px;background:#fff;border-bottom:1px solid #e7e7e4;display:flex;align-items:center;gap:10px;flex:0 0 auto}
header h1{font-size:15px;margin:0;flex:1}
header .status{font-size:11px;color:#1a7f37;background:#e7f3ea;border-radius:10px;padding:2px 8px}
header button{flex:0 0 auto;width:auto;margin:0;padding:6px 10px;font-size:12px;background:#fff;color:#23231f;border:1px solid #d7d9d4;border-radius:8px}
#threads{position:fixed;inset:0;background:#fff;z-index:20;display:none;flex-direction:column}
#threads.open{display:flex}
#threads .list{flex:1;overflow:auto;padding:8px}
.thread-row{padding:12px;border-bottom:1px solid #f0f0ee;cursor:pointer}
.thread-row b{display:block;font-size:14px}
.thread-row small{color:#8a8a84;font-size:12px}
#msglist{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}
.msg{max-width:86%;padding:10px 13px;border-radius:14px;font-size:14.5px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}
.msg.user{align-self:flex-end;background:#1e1e1c;color:#fff;border-bottom-right-radius:4px}
.msg.assistant{align-self:flex-start;background:#fff;border:1px solid #e7e7e4;border-bottom-left-radius:4px}
.msg.assistant.streaming{border-color:#e8b34b}
.msg.system{align-self:center;background:transparent;color:#8a8a84;font-size:12px}
.thinking-indicator{align-self:flex-start;display:flex;align-items:center;gap:6px;padding:8px 0;color:#8a8a84;font-size:12px}
.thinking-indicator .dot{width:6px;height:6px;background:#e8b34b;border-radius:50%;animation:throb 1.2s infinite}
@keyframes throb{0%,100%{opacity:.4;transform:scale(.8)}50%{opacity:1;transform:scale(1.2)}}
.empty-tip{text-align:center;color:#b0b0a8;padding:40px 16px;font-size:13px}
.thread-row.active{background:#f4f4f2}
#inputbar{flex:0 0 auto;display:flex;gap:8px;padding:10px 12px;background:#fff;border-top:1px solid #e7e7e4;padding-bottom:calc(10px + env(safe-area-inset-bottom))}
#cmd{flex:1;padding:11px 14px;border:1px solid #d7d9d4;border-radius:12px;font-size:15px}
#send{width:auto;margin:0;padding:11px 20px;font-size:14px;border-radius:12px}
.confirm-card{margin:40vh auto 0;max-width:340px;text-align:center}
</style>
<header>
  <button id="btn-threads" onclick="toggleThreads()">会话</button>
  <h1 id="title">Codex 对话</h1>
  <span id="thread-label" style="font-size:11px;color:#8a8a84;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px"></span>
  <span class="status" id="status">连接中…</span>
</header>
<div id="threads"><div style="padding:12px 16px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center"><b>选择会话</b><button onclick="newThread()" style="margin:0">＋ 新会话</button></div><div class="list" id="thread-list"></div></div>
<div id="msglist"></div>
<div id="inputbar"><input id="cmd" placeholder="输入消息，发送给 Codex"><button id="send" onclick="sendCmd()">发送</button></div>
<script>
const code = ${JSON.stringify(code)};
const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/" + code);
let rpcSeq = 0;
const rpcWaiters = new Map();
// 会话记忆 key 固定（不绑定随机 code）：同一地址下扫码进入都能恢复上次会话
const THREAD_KEY = "chm-thread";
let currentThreadId = localStorage.getItem(THREAD_KEY) || "";
let streaming = "";
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
  div.className = "msg " + (cls || role);
  if (pending) div.dataset.pending = "1";
  div.textContent = text;
  list.appendChild(div);
  list.scrollTop = list.scrollHeight;
  return div;
}
async function loadThreads() {
  const r = await rpc({ type: "list-threads" });
  const el = document.getElementById("thread-list");
  el.innerHTML = "";
  const threads = r.threads || [];
  if (!threads.length) {
    el.innerHTML = "<div class='empty-tip'>暂无会话，点击右上角「＋ 新会话」开始</div>";
    return;
  }
  for (const t of threads) {
    const row = document.createElement("div");
    row.className = "thread-row" + (t.id === currentThreadId ? " active" : "");
    row.innerHTML = "<b></b><small></small>";
    row.querySelector("b").textContent = t.name || t.preview || "未命名任务";
    row.querySelector("small").textContent = new Date(t.updatedAt * 1000).toLocaleString() + " · " + (t.preview || "").slice(0, 40);
    row.onclick = () => { currentThreadId = t.id; localStorage.setItem(THREAD_KEY, t.id); document.getElementById("threads").classList.remove("open"); loadMessages(); updateThreadLabel(t.name || t.preview || "未命名任务"); saveSession(); };
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
  push("system", "已新建会话，直接发消息开始对话");
  updateThreadLabel("新会话");
  loadThreads();
  saveSession();
}
async function loadMessages() {
  if (!currentThreadId) return;
  try {
    list.innerHTML = "";
    const r = await rpc({ type: "get-messages", threadId: currentThreadId });
    const msgs = r.messages || [];
    for (const m of msgs) push(m.role, m.text);
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
function sendCmd() {
  const input = document.getElementById("cmd");
  const v = input.value.trim();
  if (!v) return;
  push("user", v, "", true);
  input.value = "";
  showThinking();
  if (!currentThreadId) {
    rpc({ type: "new-thread" }).then((r) => { currentThreadId = r.threadId; localStorage.setItem(THREAD_KEY, currentThreadId); loadThreads(); return rpc({ type: "send-message", threadId: currentThreadId, text: v }); }).then(() => { updateThreadLabel(v.slice(0, 20)); saveSession(); }).catch((e) => { hideThinking(); push("system", "发送失败：" + e.message); });
  } else rpc({ type: "send-message", threadId: currentThreadId, text: v }).catch((e) => { hideThinking(); push("system", "发送失败：" + e.message); });
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
        let el = list.querySelector(".streaming");
        if (!el) el = push("assistant", "", "assistant streaming");
        el.textContent += event.text;
        list.scrollTop = list.scrollHeight;
      } else if (event.kind === "done") {
        hideThinking();
        const el = list.querySelector(".streaming");
        if (el) el.classList.remove("streaming");
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
      updateThreadLabel(t.name || t.preview || "未命名任务");
      saveSession();
      return;
    }
  } catch { /* 引擎不可用则新建 */ }
  await newThread();
})();
</script>`;
}
