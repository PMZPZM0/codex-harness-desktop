// public/assets/admin.js
// 管理面板：登录 / 上传 / 列表 / 删除

const TOKEN_KEY = "codex_release_admin_token";

const loginView = document.getElementById("login-view");
const adminView = document.getElementById("admin-view");
const adminBadge = document.getElementById("admin-badge");
const loginUser = document.getElementById("login-user");
const loginPass = document.getElementById("login-pass");
const btnLogin = document.getElementById("btn-login");

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const picked = document.getElementById("picked");
const upVersion = document.getElementById("up-version");
const upChannel = document.getElementById("up-channel");
const upChangelog = document.getElementById("up-changelog");
const upMandatory = document.getElementById("up-mandatory");
const btnUpload = document.getElementById("btn-upload");
const uploadForm = document.getElementById("upload-form");
const listBody = document.getElementById("list-body");
const listCount = document.getElementById("list-count");

let chosenFile = null;
let allReleases = [];

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  document.getElementById("toast-host").appendChild(el);
  setTimeout(() => el.remove(), 2800);
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
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function showLogin() {
  loginView.style.display = "block";
  adminView.style.display = "none";
  adminBadge.innerHTML = `<span class="badge"><span class="dot"></span>未登录</span>`;
}
function showAdmin(user) {
  loginView.style.display = "none";
  adminView.style.display = "block";
  adminBadge.innerHTML = `<span class="badge online"><span class="dot"></span>${escapeHtml(user)}</span>
    <button class="btn btn-ghost" id="btn-logout">登出</button>`;
  document.getElementById("btn-logout").addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    showLogin();
  });
  loadList();
  // 通知反馈中心模块：已登录，可以初始化
  if (window.fbAdmin && window.fbAdmin.onShown) window.fbAdmin.onShown();
}

async function login() {
  const user = loginUser.value.trim() || "admin";
  const password = loginPass.value;
  btnLogin.disabled = true;
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, password }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${res.status}`);
    }
    const j = await res.json();
    localStorage.setItem(TOKEN_KEY, j.token);
    showAdmin(j.user);
    toast("登录成功", "success");
  } catch (err) {
    toast("登录失败：" + err.message, "error");
  } finally {
    btnLogin.disabled = false;
  }
}

btnLogin.addEventListener("click", login);
loginPass.addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });

// 文件选择
dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("drag");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag");
  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
    setFile(e.dataTransfer.files[0]);
  }
});
fileInput.addEventListener("change", (e) => {
  if (e.target.files && e.target.files[0]) setFile(e.target.files[0]);
});

function setFile(f) {
  chosenFile = f;
  picked.style.display = "block";
  picked.textContent = `已选：${f.name}  ·  ${fmtSize(f.size)}`;
}

// 上传
uploadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!chosenFile) {
    toast("请先选择安装包", "error");
    return;
  }
  const version = upVersion.value.trim();
  if (!version) {
    toast("请输入版本号", "error");
    return;
  }
  btnUpload.disabled = true;
  btnUpload.textContent = "上传中…";
  try {
    const fd = new FormData();
    fd.append("file", chosenFile);
    fd.append("version", version);
    fd.append("channel", upChannel.value);
    fd.append("changelog", upChangelog.value);
    fd.append("mandatory", upMandatory.checked ? "1" : "0");
    const token = localStorage.getItem(TOKEN_KEY);
    const res = await fetch("/api/releases", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
    toast(`v${version} 发布成功`, "success");
    // 清空表单
    upVersion.value = "";
    upChangelog.value = "";
    upMandatory.checked = false;
    chosenFile = null;
    picked.style.display = "none";
    fileInput.value = "";
    loadList();
  } catch (err) {
    toast("上传失败：" + err.message, "error");
  } finally {
    btnUpload.disabled = false;
    btnUpload.textContent = "上传并发布";
  }
});

async function loadList() {
  const token = localStorage.getItem(TOKEN_KEY);
  try {
    const res = await fetch("/api/releases", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      showLogin();
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    allReleases = j.releases || [];
    listCount.textContent = `共 ${allReleases.length} 条`;
    if (!allReleases.length) {
      listBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--text-mute);">还没有发布版本</td></tr>`;
      return;
    }
    listBody.innerHTML = allReleases
      .map((r) => `
        <tr>
          <td class="mono"><b>v${escapeHtml(r.version)}</b></td>
          <td><span class="channel-tag ${escapeHtml(r.channel)}">${escapeHtml(r.channel)}</span></td>
          <td class="mono" title="${escapeHtml(r.filename)}">${escapeHtml(r.filename)}</td>
          <td>${fmtSize(r.size)}</td>
          <td class="mono" title="${escapeHtml(r.sha256)}">${escapeHtml(r.sha256.slice(0, 12))}…</td>
          <td>${fmtTime(r.uploaded_at)}</td>
          <td>${r.mandatory ? `<span class="mandatory" style="margin:0;">强制</span>` : "—"}</td>
          <td>
            <div class="actions">
              <a class="btn btn-ghost" href="${r.downloadUrl}">下载</a>
              <button class="btn btn-danger" data-del="${r.id}">删除</button>
            </div>
          </td>
        </tr>
      `)
      .join("");
    listBody.querySelectorAll("button[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("确定删除此 release？文件也会被一并删除。")) return;
        const id = btn.dataset.del;
        const res = await fetch(`/api/releases/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          toast("已删除", "success");
          loadList();
        } else {
          toast("删除失败", "error");
        }
      });
    });
  } catch (err) {
    listBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:30px; color:var(--danger);">${escapeHtml(err.message)}</td></tr>`;
  }
}

// 启动：判断是否已登录
const existing = localStorage.getItem(TOKEN_KEY);
if (existing) {
  // 试探一下 token 是否有效（直接拉列表）
  fetch("/api/releases", { headers: { Authorization: `Bearer ${existing}` } })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((j) => {
      allReleases = j.releases || [];
      showAdmin("admin");
    })
    .catch(() => {
      localStorage.removeItem(TOKEN_KEY);
      showLogin();
    });
} else {
  showLogin();
}