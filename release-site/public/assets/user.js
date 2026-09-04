// public/assets/user.js
// 普通用户下载页：拉取 /api/releases-public，按 channel 过滤渲染卡片

const grid = document.getElementById("grid");
const tabs = document.getElementById("channel-tabs");
const btnLatest = document.getElementById("btn-latest");
const btnRefresh = document.getElementById("btn-refresh");
const heroVersion = document.getElementById("hero-version");
const heroChannel = document.getElementById("hero-channel");
const heroSize = document.getElementById("hero-size");
const heroTime = document.getElementById("hero-time");

let allReleases = [];
let activeChannel = "stable";

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  document.getElementById("toast-host").appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

function fmtSize(n) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function fmtTime(t) {
  if (!t) return "—";
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function render() {
  const list = allReleases.filter((r) => r.channel === activeChannel);
  if (!list.length) {
    grid.innerHTML = `
      <div class="empty" style="grid-column: 1 / -1;">
        <h3>暂无发布版本</h3>
        <p>该 channel 还没有任何 release。试试切换 channel，或者刷新列表。</p>
      </div>`;
    return;
  }
  grid.innerHTML = list
    .map((r) => `
      <div class="card">
        <div class="head">
          <span class="ver">v${escapeHtml(r.version)}</span>
          <span class="channel-tag ${escapeHtml(r.channel)}">${escapeHtml(r.channel)}</span>
          ${r.mandatory ? `<span class="mandatory">强制更新</span>` : ""}
        </div>
        <div class="filename">${escapeHtml(r.filename)}</div>
        <div class="meta">
          <span><b>大小</b> ${fmtSize(r.size)}</span>
          <span><b>上传时间</b> ${fmtTime(r.uploaded_at)}</span>
        </div>
        ${r.changelog ? `<div class="changelog">${escapeHtml(r.changelog)}</div>` : ""}
        <div class="actions">
          <a class="btn btn-primary" href="${r.downloadUrl}" download>下载安装包</a>
          <button class="btn btn-ghost" data-copy="${r.sha256}">复制 SHA-256</button>
        </div>
      </div>
    `)
    .join("");

  grid.querySelectorAll("button[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(btn.dataset.copy).then(
        () => toast("SHA-256 已复制", "success"),
        () => toast("复制失败", "error")
      );
    });
  });
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setHero() {
  const latest = allReleases.find((r) => r.channel === activeChannel);
  if (!latest) {
    heroVersion.textContent = "—";
    heroChannel.textContent = activeChannel;
    heroSize.textContent = "—";
    heroTime.textContent = "—";
    btnLatest.disabled = true;
    btnLatest.removeAttribute("href");
    return;
  }
  heroVersion.textContent = `v${latest.version}`;
  heroChannel.textContent = latest.channel;
  heroSize.textContent = fmtSize(latest.size);
  heroTime.textContent = fmtTime(latest.uploaded_at);
  btnLatest.disabled = false;
  btnLatest.onclick = () => {
    window.location.href = latest.downloadUrl;
  };
}

async function load() {
  try {
    const res = await fetch("/api/releases-public");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    allReleases = data.releases || [];
    setHero();
    render();
  } catch (err) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">
      <h3>加载失败</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

tabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  tabs.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  btn.classList.add("active");
  activeChannel = btn.dataset.channel;
  setHero();
  render();
});

btnRefresh.addEventListener("click", () => {
  toast("刷新中…");
  load();
});

load();
setInterval(load, 60_000); // 每分钟自动刷新