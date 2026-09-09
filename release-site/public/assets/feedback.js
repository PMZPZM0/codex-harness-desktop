// public/assets/feedback.js
// 用户反馈页：提交（多截图）/ 我的反馈列表 / 追加留言 / 大图查看
// 无账号体系，用 localStorage 里的 client_id 匿名跟踪「我的反馈」

const CLIENT_KEY = "codex_feedback_client_id";
const TYPE_META = {
  bug: { label: "问题反馈", ic: "🐞", cls: "bug" },
  suggestion: { label: "功能建议", ic: "💡", cls: "suggestion" },
  question: { label: "使用咨询", ic: "❓", cls: "question" },
  other: { label: "其他", ic: "💬", cls: "other" },
};
const STATUS_META = {
  pending: { label: "待处理", cls: "pending" },
  in_progress: { label: "处理中", cls: "in_progress" },
  resolved: { label: "已解决", cls: "resolved" },
  closed: { label: "已关闭", cls: "closed" },
};

// ---------- DOM ----------
const els = {
  typeChips: document.getElementById("type-chips"),
  title: document.getElementById("fb-title"),
  content: document.getElementById("fb-content"),
  contentLen: document.getElementById("content-len"),
  contact: document.getElementById("fb-contact"),
  version: document.getElementById("fb-version"),
  os: document.getElementById("fb-os"),
  imgDrop: document.getElementById("img-drop"),
  imgInput: document.getElementById("img-input"),
  imgPreviews: document.getElementById("img-previews"),
  btnSubmit: document.getElementById("btn-submit"),
  mineFilters: document.getElementById("mine-filters"),
  mineList: document.getElementById("mine-list"),
  myCount: document.getElementById("my-count"),
  btnRefreshMine: document.getElementById("btn-refresh-mine"),
  lightbox: document.getElementById("lightbox"),
  lbImg: document.getElementById("lb-img"),
  lbCaption: document.getElementById("lb-caption"),
  lbClose: document.getElementById("lb-close"),
  lbPrev: document.getElementById("lb-prev"),
  lbNext: document.getElementById("lb-next"),
};

let type = "bug";
let pickedImages = []; // { file, url }
let mine = []; // 我的反馈（服务端数据）
let mineFilter = "all";

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  document.getElementById("toast-host").appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function fmtTime(t) {
  if (!t) return "—";
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtSize(n) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ---------- client_id ----------
function getClientId() {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) ||
      "cid-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}

// ---------- URL 预填（桌面端可打开 ?v=0.4.1&os=Windows） ----------
function prefillFromUrl() {
  const sp = new URLSearchParams(location.search);
  const v = sp.get("v");
  const os = sp.get("os");
  if (v) els.version.value = v;
  if (os) els.os.value = os;
}

// ---------- 图片选择 ----------
function addImages(files) {
  const room = 6 - pickedImages.length;
  const list = [...files].slice(0, room);
  if (!list.length) {
    toast("最多上传 6 张截图", "error");
    return;
  }
  for (const f of list) {
    if (!/\.(png|jpe?g|gif|webp)$/i.test(f.name)) {
      toast(`「${f.name}」不是支持的图片格式`, "error");
      continue;
    }
    if (f.size > 10 * 1024 * 1024) {
      toast(`「${f.name}」超过 10 MB`, "error");
      continue;
    }
    pickedImages.push({ file: f, url: URL.createObjectURL(f) });
  }
  renderPicked();
  els.imgInput.value = "";
}

function renderPicked() {
  els.imgPreviews.innerHTML = pickedImages
    .map((p, i) => `
      <div class="img-thumb">
        <img src="${p.url}" alt="预览 ${i + 1}" />
        <button class="img-del" data-i="${i}" title="移除">✕</button>
        <span class="img-size">${fmtSize(p.file.size)}</span>
      </div>`)
    .join("");
  els.imgPreviews.querySelectorAll(".img-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = +btn.dataset.i;
      URL.revokeObjectURL(pickedImages[i].url);
      pickedImages.splice(i, 1);
      renderPicked();
    });
  });
}

els.imgDrop.addEventListener("click", () => els.imgInput.click());
els.imgDrop.addEventListener("dragover", (e) => { e.preventDefault(); els.imgDrop.classList.add("drag"); });
els.imgDrop.addEventListener("dragleave", () => els.imgDrop.classList.remove("drag"));
els.imgDrop.addEventListener("drop", (e) => {
  e.preventDefault();
  els.imgDrop.classList.remove("drag");
  if (e.dataTransfer.files && e.dataTransfer.files.length) addImages(e.dataTransfer.files);
});
els.imgInput.addEventListener("change", (e) => {
  if (e.target.files && e.target.files.length) addImages(e.target.files);
});

// ---------- 类型选择 ----------
els.typeChips.addEventListener("click", (e) => {
  const chip = e.target.closest(".type-chip");
  if (!chip) return;
  els.typeChips.querySelectorAll(".type-chip").forEach((c) => c.classList.remove("active"));
  chip.classList.add("active");
  type = chip.dataset.type;
});

// 字数统计
els.content.addEventListener("input", () => {
  els.contentLen.textContent = els.content.value.length;
});

// ---------- 提交 ----------
els.btnSubmit.addEventListener("click", async () => {
  const title = els.title.value.trim();
  const content = els.content.value.trim();
  if (!title) return toast("请填写标题", "error");
  if (!content) return toast("请填写详细描述", "error");

  els.btnSubmit.disabled = true;
  els.btnSubmit.textContent = "提交中…";
  try {
    const fd = new FormData();
    fd.append("type", type);
    fd.append("title", title);
    fd.append("content", content);
    fd.append("contact", els.contact.value.trim());
    fd.append("client_id", getClientId());
    fd.append("client_version", els.version.value.trim());
    fd.append("os", els.os.value.trim());
    for (const p of pickedImages) fd.append("images", p.file, p.file.name);

    const res = await fetch("/api/feedback", { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
    toast(`反馈 #${j.id} 已提交，我们会尽快处理`, "success");
    // 清空表单
    els.title.value = "";
    els.content.value = "";
    els.contact.value = "";
    pickedImages.forEach((p) => URL.revokeObjectURL(p.url));
    pickedImages = [];
    renderPicked();
    els.contentLen.textContent = "0";
    loadMine();
    // 滚动到我的反馈
    document.querySelector(".fb-mine").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    toast("提交失败：" + err.message, "error");
  } finally {
    els.btnSubmit.disabled = false;
    els.btnSubmit.textContent = "提交反馈";
  }
});

// ---------- 我的反馈 ----------
els.mineFilters.addEventListener("click", (e) => {
  const b = e.target.closest(".chip-filter");
  if (!b) return;
  els.mineFilters.querySelectorAll(".chip-filter").forEach((c) => c.classList.remove("active"));
  b.classList.add("active");
  mineFilter = b.dataset.s;
  renderMine();
});
els.btnRefreshMine.addEventListener("click", () => { toast("刷新中…"); loadMine(); });

async function loadMine() {
  try {
    const res = await fetch(`/api/feedback?client_id=${encodeURIComponent(getClientId())}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    mine = j.feedbacks || [];
    els.myCount.textContent = mine.length;
    renderMine();
  } catch (err) {
    els.mineList.innerHTML = `<div class="empty"><h3>加载失败</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function imgUrl(stored) {
  return `/api/feedback/images/${encodeURIComponent(stored)}?cid=${encodeURIComponent(getClientId())}`;
}

// timeline 渲染
function timelineHtml(fb) {
  const evs = [...(fb.events || [])].sort((a, b) => a.at - b.at);
  const items = evs.map((ev) => {
    const t = `<span class="ev-time">${fmtTime(ev.at)}</span>`;
    if (ev.kind === "status") {
      return `<div class="ev ev-status">${t}<span>状态由 <b>${STATUS_META[ev.from] ? STATUS_META[ev.from].label : ev.from}</b> 变更为 <b>${STATUS_META[ev.to] ? STATUS_META[ev.to].label : ev.to}</b></span></div>`;
    }
    const admin = ev.kind === "reply";
    return `<div class="ev ${admin ? "ev-admin" : "ev-user"}">
      <div class="ev-role">${admin ? "🛡️ 官方回复" : "🙋 我的留言"}</div>
      <div class="ev-bubble">${escapeHtml(ev.content)}</div>
      ${t}
    </div>`;
  });
  return items.join("");
}

function fbCard(fb) {
  const st = STATUS_META[fb.status] || { label: fb.status, cls: "pending" };
  const tp = TYPE_META[fb.type] || { label: fb.type, cls: "other", ic: "💬" };
  const hasImgs = (fb.images || []).length > 0;
  const imgs = hasImgs
    ? `<div class="fb-imgs">${fb.images.map((im, i) =>
        `<img class="fb-thumb" src="${imgUrl(im.stored)}" data-fb="${fb.id}" data-i="${i}" alt="截图 ${i + 1}" loading="lazy" />`
      ).join("")}</div>`
    : "";
  const replyCount = (fb.events || []).filter((e) => e.kind === "reply" || e.kind === "comment").length;
  return `
    <div class="fb-item" data-id="${fb.id}">
      <div class="fb-item-head">
        <span class="type-tag ${tp.cls}">${tp.ic} ${tp.label}</span>
        <span class="fb-status ${st.cls}">${st.label}</span>
        ${fb.priority === "high" ? `<span class="prio high">高优先级</span>` : ""}
        <span class="fb-id">#${fb.id}</span>
        <span class="fb-time">${fmtTime(fb.created_at)}</span>
        <button class="fb-fold" data-fold="1">展开 ▸</button>
      </div>
      <div class="fb-item-title">${escapeHtml(fb.title)}</div>
      <div class="fb-meta-row">
        ${fb.client_version ? `<span>版本 <b>${escapeHtml(fb.client_version)}</b></span>` : ""}
        ${fb.os ? `<span>系统 ${escapeHtml(fb.os)}</span>` : ""}
        ${replyCount ? `<span>互动 ${replyCount} 条</span>` : ""}
      </div>
      <div class="fb-item-body" style="display:none;">
        <div class="fb-content">${escapeHtml(fb.content)}</div>
        ${imgs}
        <div class="fb-timeline">${timelineHtml(fb)}</div>
        <form class="comment-box" data-id="${fb.id}">
          <input class="input comment-input" placeholder="追问 / 补充信息（管理员可见并会回复）" maxlength="2000" />
          <button class="btn" type="submit">发送</button>
        </form>
      </div>
    </div>`;
}

function renderMine() {
  const list = mineFilter === "all" ? mine : mine.filter((f) => f.status === mineFilter);
  if (!list.length) {
    const hint = mine.length ? "该状态下暂无反馈" : "还没有提交过反馈，左边写下第一条吧";
    els.mineList.innerHTML = `<div class="empty"><h3>${hint}</h3></div>`;
    return;
  }
  els.mineList.innerHTML = list.map(fbCard).join("");

  // 展开 / 收起
  els.mineList.querySelectorAll(".fb-fold").forEach((btn) => {
    btn.addEventListener("click", () => {
      const body = btn.closest(".fb-item").querySelector(".fb-item-body");
      const open = body.style.display !== "none";
      body.style.display = open ? "none" : "block";
      btn.textContent = open ? "展开 ▸" : "收起 ▾";
    });
  });

  // 追加留言
  els.mineList.querySelectorAll(".comment-box").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = form.dataset.id;
      const input = form.querySelector(".comment-input");
      const content = input.value.trim();
      if (!content) return;
      const btn = form.querySelector("button");
      btn.disabled = true;
      try {
        const res = await fetch(`/api/feedback/${id}/comment`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: getClientId(), content }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
        toast("已追加留言", "success");
        loadMine();
      } catch (err) {
        toast("发送失败：" + err.message, "error");
        btn.disabled = false;
      }
    });
  });
}

// ---------- 大图查看（lightbox） ----------
let lbStack = []; // { url, caption }[] 当前点击的反馈所有图
let lbIndex = 0;

function openLb(fbId, imgIndex) {
  const fb = mine.find((f) => String(f.id) === String(fbId));
  if (!fb || !(fb.images || []).length) return;
  lbStack = fb.images.map((im) => ({ url: imgUrl(im.stored), caption: `${im.name} · ${fmtSize(im.size)}` }));
  lbIndex = imgIndex;
  showLb();
}
function showLb() {
  els.lbImg.src = lbStack[lbIndex].url;
  els.lbCaption.textContent = `${lbIndex + 1} / ${lbStack.length} · ${lbStack[lbIndex].caption}`;
  els.lightbox.style.display = "flex";
  els.lbPrev.style.display = lbStack.length > 1 ? "block" : "none";
  els.lbNext.style.display = lbStack.length > 1 ? "block" : "none";
}
function closeLb() { els.lightbox.style.display = "none"; els.lbImg.src = ""; }
els.lbClose.addEventListener("click", closeLb);
els.lightbox.addEventListener("click", (e) => { if (e.target === els.lightbox) closeLb(); });
els.lbPrev.addEventListener("click", (e) => { e.stopPropagation(); lbIndex = (lbIndex - 1 + lbStack.length) % lbStack.length; showLb(); });
els.lbNext.addEventListener("click", (e) => { e.stopPropagation(); lbIndex = (lbIndex + 1) % lbStack.length; showLb(); });
document.addEventListener("keydown", (e) => {
  if (els.lightbox.style.display !== "flex") return;
  if (e.key === "Escape") closeLb();
  if (e.key === "ArrowLeft") lbIndex = (lbIndex - 1 + lbStack.length) % lbStack.length;
  if (e.key === "ArrowRight") lbIndex = (lbIndex + 1) % lbStack.length;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") showLb();
});
// 图片事件委托（含缩略图点击）
document.addEventListener("click", (e) => {
  const th = e.target.closest(".fb-thumb");
  if (th) openLb(th.dataset.fb, +th.dataset.i);
});

prefillFromUrl();
loadMine();
setInterval(loadMine, 90_000); // 每 90s 自动刷新（拿最新回复/状态）
