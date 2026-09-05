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

// 版本列表折叠：默认只显示最近 PAGE_SIZE 条，其余收进「显示更多」。
// 避免历史发布一多页面被拖得很长。
const PAGE_SIZE = 5;
let allReleases = [];
let activeChannel = "stable";
let expanded = false;

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

// 平台显示名映射（服务端 platform 字段：windows / mac-arm64 / mac-x64）
const PLATFORM_LABEL = {
  windows: "Windows x64",
  "mac-arm64": "macOS Apple Silicon",
  "mac-x64": "macOS Intel",
};
const PLATFORM_ORDER = ["windows", "mac-arm64", "mac-x64"];
function platformOf(r) {
  return r.platform || "windows";
}
function platformLabel(r) {
  return PLATFORM_LABEL[platformOf(r)] || platformOf(r);
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

  // 同一版本可能有多个平台包（Windows / macOS 双芯片）→ 合并成一张卡片
  const groups = [];
  const byVersion = new Map();
  list.forEach((r) => {
    if (!byVersion.has(r.version)) {
      const g = { version: r.version, items: [], uploaded_at: r.uploaded_at, changelog: r.changelog, mandatory: r.mandatory };
      byVersion.set(r.version, g);
      groups.push(g);
    }
    const g = byVersion.get(r.version);
    g.items.push(r);
    if (r.uploaded_at > g.uploaded_at) g.uploaded_at = r.uploaded_at;
    if (!g.changelog && r.changelog) g.changelog = r.changelog;
    if (r.mandatory) g.mandatory = true;
  });
  groups.forEach((g) => {
    g.items.sort((a, b) => PLATFORM_ORDER.indexOf(platformOf(a)) - PLATFORM_ORDER.indexOf(platformOf(b)));
  });

  const visible = expanded ? groups : groups.slice(0, PAGE_SIZE);
  grid.innerHTML = visible
    .map((g) => {
      const downloads = g.items
        .map((r) => {
          const isWin = platformOf(r) === "windows";
          return `
          <div class="dl-row">
            <span class="dl-platform">${escapeHtml(platformLabel(r))}</span>
            <span class="dl-size">${fmtSize(r.size)}</span>
            <a class="btn ${isWin ? "btn-primary" : ""}" href="${r.downloadUrl}">下载</a>
            ${r.sha256 ? `<button class="btn btn-ghost btn-copy" data-copy="${r.sha256}" title="复制 ${escapeHtml(platformLabel(r))} 的 SHA-256">SHA-256</button>` : ""}
          </div>`;
        })
        .join("");
      return `
      <div class="card">
        <div class="head">
          <span class="ver">v${escapeHtml(g.version)}</span>
          <span class="channel-tag ${escapeHtml(activeChannel)}">${escapeHtml(activeChannel)}</span>
          ${g.mandatory ? `<span class="mandatory">强制更新</span>` : ""}
        </div>
        <div class="dl-list">${downloads}</div>
        <div class="meta">
          <span><b>上传时间</b> ${fmtTime(g.uploaded_at)}</span>
        </div>
        ${g.changelog ? `<div class="changelog">${escapeHtml(g.changelog)}</div>` : ""}
      </div>
    `;
    })
    .join("");

  // 折叠：剩余版本收进「显示更多 / 收起」按钮
  if (groups.length > PAGE_SIZE) {
    const more = document.createElement("button");
    more.className = "btn btn-ghost load-more";
    more.style.gridColumn = "1 / -1";
    more.textContent = expanded ? `收起旧版本（共 ${groups.length} 条）↑` : `显示更多（还有 ${groups.length - PAGE_SIZE} 条旧版本）↓`;
    more.addEventListener("click", () => {
      expanded = !expanded;
      render();
    });
    grid.appendChild(more);
  }

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
  // 主版本取 Windows 包（顶部「下载 Windows 版」按钮），没有则退回该 channel 的第一条
  const latest =
    allReleases.find((r) => r.channel === activeChannel && platformOf(r) === "windows") ||
    allReleases.find((r) => r.channel === activeChannel);
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