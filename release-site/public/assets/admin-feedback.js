// public/assets/admin-feedback.js
// 管理端「反馈中心」：统计 / 筛选 / 列表 / 抽屉详情（回复、状态流转、备注、删除）
// 依赖 admin.js 提供的全局：TOKEN_KEY、showLogin()、toast()、fmtTime()、escapeHtml()、fmtSize()

window.fbAdmin = (() => {
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
  const PRIO_META = {
    low: { label: "低优先级", cls: "low" },
    normal: { label: "普通", cls: "normal" },
    high: { label: "高优先级", cls: "high" },
  };

  const statCards = document.getElementById("stat-cards");
  const typeFilter = document.getElementById("fb-type-filter");
  const qInput = document.getElementById("fb-q");
  const listEl = document.getElementById("fb-list");
  const listCount = document.getElementById("fb-list-count");
  const badge = document.getElementById("fb-badge");
  const fbTabs = document.querySelectorAll(".admin-tab");

  let statusFilter = "all"; // all / today / 具体状态
  let rows = [];
  let current = null; // 当前打开的详情

  function token() { return localStorage.getItem(TOKEN_KEY) || ""; }

  function imgUrl(stored) {
    return `/api/feedback/images/${encodeURIComponent(stored)}?t=${encodeURIComponent(token())}`;
  }

  async function api(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (opts.body && !(opts.body instanceof FormData)) headers["Content-Type"] = "application/json";
    const res = await fetch(path, { ...opts, headers: { Authorization: `Bearer ${token()}`, ...headers } });
    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      showLogin();
      throw new Error("unauthorized");
    }
    return res;
  }

  // ---------- 列表 ----------
  async function load() {
    const params = new URLSearchParams();
    if (statusFilter !== "all" && statusFilter !== "today") params.set("status", statusFilter);
    const type = typeFilter.value;
    if (type) params.set("type", type);
    const q = qInput.value.trim();
    if (q) params.set("q", q);
    const res = await api(`/api/admin/feedback?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    rows = j.feedbacks || [];
    renderStats(j.stats);
    renderList();
  }

  function renderStats(st) {
    const set = (id, n) => { document.getElementById(id).textContent = n; };
    set("st-all", st.all);
    set("st-pending", st.pending);
    set("st-in_progress", st.in_progress);
    set("st-resolved", st.resolved);
    set("st-today", st.today);
    // 徽章 = 待处理数
    if (st.pending > 0) { badge.style.display = "inline-flex"; badge.textContent = st.pending; }
    else badge.style.display = "none";
  }

  function renderList() {
    listCount.textContent = `共 ${rows.length} 条`;
    if (!rows.length) {
      listEl.innerHTML = `<div class="empty"><h3>没有符合条件的反馈</h3><p>试试切换筛选条件，或等用户来提交第一条。</p></div>`;
      return;
    }
    listEl.innerHTML = rows.map((f) => {
      const tp = TYPE_META[f.type] || TYPE_META.other;
      const st = STATUS_META[f.status] || STATUS_META.pending;
      const imgs = (f.images || []).length;
      const pendingN = (f.events || []).filter((e) => e.kind === "reply").length;
      return `
      <div class="fb-row" data-id="${f.id}">
        <div class="fb-row-main">
          <div class="fb-row-title">
            <span class="type-tag ${tp.cls}">${tp.ic} ${tp.label}</span>
            <span class="fb-row-text">${escapeHtml(f.title)}</span>
          </div>
          <div class="fb-row-meta">
            <span class="mono">#${f.id}</span>
            ${f.client_version ? `<span>版本 <b>${escapeHtml(f.client_version)}</b></span>` : ""}
            ${f.os ? `<span>${escapeHtml(f.os)}</span>` : ""}
            ${f.contact ? `<span class="mono">📮 ${escapeHtml(f.contact)}</span>` : ""}
            ${imgs ? `<span>🖼️ ${imgs} 张截图</span>` : ""}
            <span>${fmtTime(f.created_at)}</span>
          </div>
        </div>
        <div class="fb-row-side">
          ${f.priority === "high" ? `<span class="prio high">高</span>` : ""}
          <span class="fb-status ${st.cls}">${st.label}</span>
          ${pendingN ? `<span class="reply-n">回复 ${pendingN}</span>` : ""}
          <span class="arrow">›</span>
        </div>
      </div>`;
    }).join("");

    listEl.querySelectorAll(".fb-row").forEach((row) => {
      row.addEventListener("click", () => openDetail(row.dataset.id));
    });
  }

  // ---------- 详情抽屉 ----------
  const drawer = document.getElementById("drawer");
  const drawerMask = document.getElementById("drawer-mask");
  const drawerBody = document.getElementById("dr-body");
  const drawerTitle = document.getElementById("dr-title");

  async function openDetail(id) {
    const res = await api(`/api/admin/feedback/${id}`);
    if (!res.ok) { toast("加载详情失败", "error"); return; }
    const j = await res.json();
    current = j.feedback;
    renderDrawer();
    drawer.style.display = "flex";
    drawerMask.style.display = "block";
    document.body.style.overflow = "hidden";
  }
  function closeDrawer() {
    drawer.style.display = "none";
    drawerMask.style.display = "none";
    document.body.style.overflow = "";
    current = null;
  }

  function timelineHtml(fb) {
    const evs = [...(fb.events || [])].sort((a, b) => a.at - b.at);
    return evs.map((ev) => {
      const t = `<span class="ev-time">${fmtTime(ev.at)}</span>`;
      if (ev.kind === "status") {
        return `<div class="ev ev-status">${t}<span>状态：<b>${STATUS_META[ev.from] ? STATUS_META[ev.from].label : ev.from}</b> → <b>${STATUS_META[ev.to] ? STATUS_META[ev.to].label : ev.to}</b>（${escapeHtml(ev.by)}）</span></div>`;
      }
      const admin = ev.kind === "reply";
      return `<div class="ev ${admin ? "ev-admin" : "ev-user"}">
        <div class="ev-role">${admin ? `🛡️ 官方回复（${escapeHtml(ev.by)}）` : "🙋 用户留言"}</div>
        <div class="ev-bubble">${escapeHtml(ev.content)}</div>${t}
      </div>`;
    }).join("") || `<div class="ev ev-status"><span>暂无互动记录</span></div>`;
  }

  function renderDrawer() {
    const f = current;
    const tp = TYPE_META[f.type] || TYPE_META.other;
    const st = STATUS_META[f.status] || STATUS_META.pending;
    drawerTitle.innerHTML = `<span class="type-tag ${tp.cls}">${tp.ic} ${tp.label}</span> <span class="fb-status ${st.cls}">${st.label}</span> <span class="mono">#${f.id}</span>`;

    const imgs = (f.images || []).length
      ? `<div class="dr-imgs">${f.images.map((im, i) =>
          `<div class="dr-img" data-i="${i}"><img src="${imgUrl(im.stored)}" loading="lazy" alt="截图 ${i + 1}" /><span>${escapeHtml(im.name)}</span></div>`
        ).join("")}</div>`
      : "";

    drawerBody.innerHTML = `
      <div class="dr-section">
        <div class="dr-meta">
          ${f.client_version ? `<span>客户端版本 <b class="mono">${escapeHtml(f.client_version)}</b></span>` : ""}
          ${f.os ? `<span>系统 <b>${escapeHtml(f.os)}</b></span>` : ""}
          ${f.contact ? `<span>联系方式 <b class="mono">${escapeHtml(f.contact)}</b></span>` : ""}
          <span>提交于 <b>${fmtTime(f.created_at)}</b></span>
        </div>
        <h3 class="dr-title">${escapeHtml(f.title)}</h3>
        <div class="dr-content">${escapeHtml(f.content)}</div>
        ${imgs}
      </div>

      <div class="dr-section">
        <div class="dr-h">处理操作</div>
        <div class="dr-actions">
          <div class="status-btn-group">
            ${Object.entries(STATUS_META).map(([k, v]) =>
              `<button class="status-btn ${k} ${f.status === k ? "active" : ""}" data-status="${k}">${v.label}</button>`
            ).join("")}
          </div>
          <div class="dr-prio-row">
            <span class="dr-h2">优先级</span>
            <select class="select prio-select" id="prio-select" style="width:auto;">
              ${Object.entries(PRIO_META).map(([k, v]) =>
                `<option value="${k}" ${f.priority === k ? "selected" : ""}>${v.label}</option>`).join("")}
            </select>
          </div>
        </div>
      </div>

      <div class="dr-section">
        <div class="dr-h">时间线</div>
        <div class="fb-timeline">${timelineHtml(f)}</div>
      </div>

      <div class="dr-section">
        <div class="dr-h">回复用户（将显示在对方的反馈页）</div>
        <textarea class="textarea" id="dr-reply" rows="3" placeholder="输入回复内容…"></textarea>
        <button class="btn btn-primary" id="btn-dr-reply" style="width:100%;">发送回复</button>
      </div>

      <div class="dr-section">
        <div class="dr-h">内部备注（仅管理员可见）</div>
        <textarea class="textarea" id="dr-note" rows="2" placeholder="备注处理进度 / 根因分析…">${escapeHtml(f.admin_note || "")}</textarea>
        <button class="btn" id="btn-dr-note" style="width:100%;">保存备注</button>
      </div>

      <div class="dr-danger">
        <button class="btn btn-danger" id="btn-dr-delete">🗑️ 删除这条反馈（截图一并删除）</button>
      </div>
    `;

    // 绑定事件
    drawerBody.querySelectorAll(".status-btn").forEach((b) => {
      b.addEventListener("click", () => setStatus(b.dataset.status, b));
    });
    document.getElementById("prio-select").addEventListener("change", (e) => {
      patch({ priority: e.target.value }, { silent: true }).then(() => toast("优先级已更新", "success")).catch((err) => toast("更新失败：" + err.message, "error"));
    });
    document.getElementById("btn-dr-reply").addEventListener("click", async () => {
      const content = document.getElementById("dr-reply").value.trim();
      if (!content) return toast("请输入回复内容", "error");
      const btn = document.getElementById("btn-dr-reply");
      btn.disabled = true;
      try {
        const res = await api(`/api/admin/feedback/${f.id}/reply`, {
          method: "POST", body: JSON.stringify({ content }),
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        toast("已回复用户", "success");
        await openDetail(f.id); // 重新拉取
      } catch (e) { toast("回复失败：" + e.message, "error"); btn.disabled = false; }
    });
    document.getElementById("btn-dr-note").addEventListener("click", async () => {
      const note = document.getElementById("dr-note").value;
      try {
        await patch({ admin_note: note }, { silent: true });
        toast("备注已保存", "success");
      } catch (e) { toast("保存失败：" + e.message, "error"); }
    });
    document.getElementById("btn-dr-delete").addEventListener("click", async () => {
      if (!confirm(`确定删除反馈 #${f.id}？其 ${(f.images || []).length} 张截图也会一并删除，不可恢复。`)) return;
      const res = await api(`/api/admin/feedback/${f.id}`, { method: "DELETE" });
      if (!res.ok) { toast("删除失败", "error"); return; }
      toast("已删除", "success");
      closeDrawer();
      load();
    });
    // 管理端大图
    drawerBody.querySelectorAll(".dr-img img").forEach((imgEl) => {
      imgEl.addEventListener("click", () => openLb(f.images.map((im) => imgUrl(im.stored)), imgEl.src));
    });
  }

  async function patch(body, opts = {}) {
    const res = await api(`/api/admin/feedback/${current.id}`, {
      method: "PATCH", body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const j = await res.json();
    current = j.feedback;
    if (!opts.silent) renderDrawer(); // 默认重绘；silent 时调用方自行更新局部 UI（避免清空输入框）
    return j;
  }

  async function setStatus(to, btnEl) {
    if (to === current.status) return;
    const prev = current.status;
    try {
      await patch({ status: to }, { silent: true });
      // 局部更新：标题徽章 + 按钮组高亮，不清空已填的回复/备注
      drawerBody.querySelectorAll(".status-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.status === to);
      });
      const headBadge = drawerTitle.querySelector(".fb-status");
      if (headBadge) {
        headBadge.className = `fb-status ${to}`;
        headBadge.textContent = STATUS_META[to].label;
      }
      toast(`状态：${STATUS_META[prev].label} → ${STATUS_META[to].label}`, "success");
      load();
    } catch (e) { toast("更新失败：" + e.message, "error"); }
  }

  // ---------- 管理端大图 ----------
  const lb = document.getElementById("lb");
  const lbImg = document.getElementById("lb-img");
  const lbCaption = document.getElementById("lb-caption");
  let lbUrls = [], lbIdx = 0;
  function openLb(urls, cur) {
    lbUrls = urls; lbIdx = Math.max(0, urls.indexOf(cur));
    lbImg.src = lbUrls[lbIdx];
    lbCaption.textContent = `${lbIdx + 1} / ${lbUrls.length}`;
    lb.style.display = "flex";
  }
  document.getElementById("lb-close").addEventListener("click", () => { lb.style.display = "none"; lbImg.src = ""; });
  lb.addEventListener("click", (e) => { if (e.target === lb) { lb.style.display = "none"; lbImg.src = ""; } });
  lbImg.addEventListener("click", (e) => {
    e.stopPropagation();
    lbIdx = (lbIdx + 1) % lbUrls.length;
    lbImg.src = lbUrls[lbIdx];
    lbCaption.textContent = `${lbIdx + 1} / ${lbUrls.length}`;
  });

  // ---------- 事件 ----------
  document.getElementById("dr-close").addEventListener("click", closeDrawer);
  drawerMask.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

  statCards.addEventListener("click", (e) => {
    const c = e.target.closest(".stat-card");
    if (!c) return;
    statusFilter = c.dataset.s === "today" ? "today" : c.dataset.s;
    statCards.querySelectorAll(".stat-card").forEach((x) => x.classList.remove("active"));
    c.classList.add("active");
    load();
  });
  document.getElementById("btn-fb-search").addEventListener("click", load);
  qInput.addEventListener("keydown", (e) => { if (e.key === "Enter") load(); });
  typeFilter.addEventListener("change", load);
  document.getElementById("btn-fb-refresh").addEventListener("click", () => { toast("刷新中…"); load(); });

  fbTabs.forEach((t) => {
    t.addEventListener("click", () => {
      fbTabs.forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      const v = t.dataset.view;
      document.getElementById("view-releases").style.display = v === "releases" ? "" : "none";
      document.getElementById("view-feedback").style.display = v === "feedback" ? "" : "none";
      if (v === "feedback") load();
    });
  });

  return {
    onShown() {
      // 进入管理视图：切回发布管理 tab，静默拉一次反馈更新徽章
      fbTabs.forEach((x) => x.classList.remove("active"));
      fbTabs[0].classList.add("active");
      document.getElementById("view-releases").style.display = "";
      document.getElementById("view-feedback").style.display = "none";
      load().catch(() => {});
    },
  };
})();
