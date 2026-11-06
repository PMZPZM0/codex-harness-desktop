/**
 * CLI 智能体面板（10-29 新板块；10-30 一键安装；10-31 用户令：
 *   「cli 智能体头像和界面卡片优化展示」⇒ 与专家 / 专家团 / 子智能体同一套**工作证小卡 + 预览弹窗**，
 *   头像用机器人那套卡通图集（与子智能体同风格，因为它们都是"工具型智能体"）。
 *
 * 一级 = 工作证小卡（头像 + 名称 + 分类/安装状态 + 内置标签），点开 = 预览弹窗
 * （安装状态 / 安装命令 / 启停 / 一键安装·卸载 / 检测 / 复制命令 / 编辑 / 移除 + 装卸日志）。
 * 10-30 用户令：装没装实时同步（打开即并行检测、装卸后广播刷新、未安装的 @ 候选置灰）。
 *
 * ⛔ 安装/卸载的**唯一实现**在主进程 `electron/cli-install.ts`（npm/pip 参数数组、不开 shell、
 *   装完复核）。面板只调 IPC —— 本文件出现任何子进程调用都是绕过实现的双份。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, Download, LoaderCircle, PencilLine, Plus, RefreshCw, Search, Terminal, Trash2, X } from "lucide-react";
import { ToggleSwitch } from "../../components/SettingsWidgets";
import { AppSelect } from "../../components/AppSelect";
import { SettingsDialog } from "../../components/SettingsDialog";
import { AgentAvatar } from "../../components/AgentAvatar";
import { AgentBadge } from "../../components/AgentBadge";
import { copyTextToClipboard } from "../../lib/clipboard";
import { countCliAgents, groupCliAgents, type CliCategory } from "../../lib/cli-agents.mjs";

type DetectState = { state: "idle" | "busy" | "ok" | "miss"; version?: string; path?: string };

/**
 * 宿主事件（`onHarnessEvent`）里本屏关心的两种：装卸进度 `cli-agent-install`、目录变更 `cli-agents-changed`。
 * ⛔ preload 的签名参数是 any（生成物，不手改），所以**在这里收窄**：只声明真正读的四个字段，
 *   拿到的是具体类型而不是 any（any 棘轮只许减不许增）。
 */
type CliAgentEvent = { type?: string; id?: string; stage?: string; line?: string };

/** 新增/编辑表单的草稿（id 为空 = 新增）。 */
type Draft = { id: string; name: string; category: string; bin: string; installCmd: string; docs: string; description: string };

const EMPTY_DRAFT = (category: string): Draft => ({ id: "", name: "", category, bin: "", installCmd: "", docs: "", description: "" });

export function CliAgentsPanel({ setNotice }: { setNotice?: (text: string, detail?: string) => void }) {
  const [items, setItems] = useState<CliAgentEntry[]>([]);
  const [categories, setCategories] = useState<CliCategory[]>([]);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");
  const [detect, setDetect] = useState<Record<string, DetectState>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  /** 删除要两段确认（第一段把按钮换成「确认删除」，第二段才真删）。 */
  const [confirmId, setConfirmId] = useState("");
  /** 工作证点开的预览弹窗（10-31 用户令：卡片优化展示） */
  const [previewId, setPreviewId] = useState("");
  /** 一键装卸在跑的条目（busy 期间按钮换 spinner、整行锁操作）。 */
  const [busyId, setBusyId] = useState("");
  /** 当前在跑的动作类型（安装 / 更新 / 卸载）——进度条文案用。 */
  const [busyKind, setBusyKind] = useState<"install" | "update" | "uninstall" | "">("");
  const [busyStart, setBusyStart] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  /** 已安装 CLI 的最新版本（11-06：npm/pip 查一次，缓存 10 分钟）。 */
  const [updates, setUpdates] = useState<Record<string, { current: string; latest: string; hasUpdate: boolean; error?: string }>>({});
  /** 正在检查更新的条目 / 是否在全部检查（11-06 用户：「检测更新按键在哪里」）。 */
  const [checkingId, setCheckingId] = useState("");
  const [checkingAll, setCheckingAll] = useState(false);
  const [logs, setLogs] = useState<{ id: string; text: string }[]>([]);
  /** 卸载确认弹窗（SettingsDialog：设置页里 AppView 的 confirm 会被 sheet 压住看不见）。 */
  const [uninstallId, setUninstallId] = useState("");

  const notify = useCallback((text: string, detail?: string) => { if (text) setNotice?.(detail ? `${text} —— ${detail}` : text); }, [setNotice]);

  const refresh = useCallback(async () => {
    try {
      const res = (await window.codex.listCliAgents()) as { items: CliAgentEntry[]; categories: CliCategory[] };
      setItems(Array.isArray(res?.items) ? res.items : []);
      setCategories(Array.isArray(res?.categories) ? res.categories : []);
    } catch (e) {
      setError(`读取 CLI 列表失败：${(e as Error)?.message ?? e}`);
    }
  }, []);

  const runDetect = useCallback(async (item: CliAgentEntry): Promise<boolean> => {
    setDetect((current) => ({ ...current, [item.id]: { state: "busy" } }));
    try {
      const res = await window.codex.detectCliAgent({ id: item.id });
      const installed = Boolean(res?.installed);
      setDetect((current) => ({
        ...current,
        [item.id]: installed
          ? { state: "ok", version: String(res.version ?? ""), path: String(res.path ?? "") }
          : { state: "miss" },
      }));
      return installed;
    } catch {
      setDetect((current) => ({ ...current, [item.id]: { state: "miss" } }));
      return false;
    }
  }, []);

  /** 查已安装 CLI 的最新版本（npm view / pip index，主进程缓存 10 分钟）。 */
  const refreshUpdates = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    try {
      const res = (await window.codex.checkCliAgentUpdates(ids)) as { items?: Array<{ id: string; current: string; latest: string; hasUpdate: boolean; error?: string }> };
      const map: Record<string, { current: string; latest: string; hasUpdate: boolean; error?: string }> = {};
      for (const item of res?.items ?? []) map[item.id] = { current: item.current, latest: item.latest, hasUpdate: item.hasUpdate, error: item.error };
      setUpdates(map);
    } catch { /* 网络失败静默：没有更新提示不代表不能升级，预览弹窗仍可手动检测 */ }
  }, []);

  /* 10-30 用户令「装没装要实时同步」：打开面板**自动检测一轮**（并行；有子进程，只在本页跑），
     装卸完成后由 cli-agents-changed 广播再刷一轮。 */
  useEffect(() => {
    void (async () => {
      try {
        const res = (await window.codex.listCliAgents()) as { items: CliAgentEntry[]; categories: CliCategory[] };
        const list = Array.isArray(res?.items) ? res.items : [];
        setItems(list);
        setCategories(Array.isArray(res?.categories) ? res.categories : []);
        const installed = (await Promise.all(list.map(async (item) => ((await runDetect(item)) ? item.id : "")))).filter(Boolean);
        void refreshUpdates(installed);
      } catch (e) {
        setError(`读取 CLI 列表失败：${(e as Error)?.message ?? e}`);
      }
    })();
  }, [refreshUpdates, runDetect]);

  /* 进度与变更事件：cli-agent-install（装卸进度）+ cli-agents-changed（目录变了 → 重拉 + 重检测）。 */
  useEffect(() => window.codex.onHarnessEvent?.((payload: CliAgentEvent) => {
    if (payload?.type === "cli-agent-install" && payload.id) {
      const id = String(payload.id);
      if (payload.stage === "start") setBusyId(id);
      if (payload.stage === "log" && payload.line) setLogs((current) => [...current.slice(-9), { id, text: String(payload.line) }]);
      if (payload.stage === "done" || payload.stage === "error") setBusyId((current) => (current === id ? "" : current));
    }
    if (payload?.type === "cli-agents-changed") {
      void (async () => {
        try {
          const res = (await window.codex.listCliAgents()) as { items: CliAgentEntry[]; categories: CliCategory[] };
          const list = Array.isArray(res?.items) ? res.items : [];
          setItems(list);
          setCategories(Array.isArray(res?.categories) ? res.categories : []);
          const installed = (await Promise.all(list.map(async (item) => ((await runDetect(item)) ? item.id : "")))).filter(Boolean);
          void refreshUpdates(installed);
        } catch { /* 面板已挂载过一次成功，事件期失败静默 */ }
      })();
    }
  }), [refreshUpdates, runDetect]);

  const groups = useMemo(() => groupCliAgents(items, categories, query), [items, categories, query]);
  const counts = useMemo(() => countCliAgents(items, categories, query), [items, categories, query]);
  const visible = tab === "all" ? groups : groups.filter((group) => group.key === tab);
  const preview = items.find((item) => item.id === previewId) ?? null;
  const uninstallTarget = items.find((item) => item.id === uninstallId) ?? null;
  const categoryLabelOf = (key: string) => categories.find((cat) => cat.key === key)?.label ?? "未分类";

  /** 检查某一个已安装 CLI 的更新（预览弹窗按钮）。 */
  const checkOne = useCallback(async (item: CliAgentEntry) => {
    if (checkingId || busyId) return;
    setCheckingId(item.id);
    try {
      const res = (await window.codex.checkCliAgentUpdates([item.id])) as { items?: Array<{ id: string; current: string; latest: string; hasUpdate: boolean; error?: string }> };
      const info = (res?.items ?? [])[0];
      if (info) setUpdates((current) => ({ ...current, [info.id]: { current: info.current, latest: info.latest, hasUpdate: info.hasUpdate, error: info.error } }));
      if (!info) notify(`没查到「${item.name}」的版本信息`, "可能不是 npm/pip 装的，或网络不可用");
      else if (info.hasUpdate) notify(`发现新版本 ${info.latest}`, `当前 ${info.current || "未知"}，可直接点「更新到 ${info.latest}」`);
      else notify("已是最新", info.latest ? `${item.name} · ${info.latest}` : undefined);
    } catch (e) {
      notify(`检查更新失败：${(e as Error)?.message ?? e}`);
    } finally {
      setCheckingId("");
    }
  }, [busyId, checkingId, notify]);

  /** 检查所有已安装 CLI 的更新（工具栏按钮）。 */
  const checkAll = useCallback(async () => {
    if (checkingAll || busyId) return;
    const ids = items.filter((item) => detect[item.id]?.state === "ok").map((item) => item.id);
    if (!ids.length) { notify("还没有已安装的 CLI", "先装一个再检查更新"); return; }
    setCheckingAll(true);
    try {
      const res = (await window.codex.checkCliAgentUpdates(ids)) as { items?: Array<{ id: string; current: string; latest: string; hasUpdate: boolean; error?: string }> };
      const map: Record<string, { current: string; latest: string; hasUpdate: boolean; error?: string }> = {};
      for (const info of res?.items ?? []) map[info.id] = { current: info.current, latest: info.latest, hasUpdate: info.hasUpdate, error: info.error };
      setUpdates(map);
      const count = (res?.items ?? []).filter((info) => info.hasUpdate).length;
      notify(count ? `${count} 个 CLI 可更新` : "全部已是最新", `已检查 ${ids.length} 个已安装 CLI`);
    } catch (e) {
      notify(`检查更新失败：${(e as Error)?.message ?? e}`);
    } finally {
      setCheckingAll(false);
    }
  }, [busyId, checkingAll, detect, items, notify]);

  /** 进度计时：装卸期间每秒刷新「已用时」，结束后清零。 */
  useEffect(() => {
    if (!busyId) { setElapsed(0); return; }
    const start = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busyId]);

  const install = useCallback(async (item: CliAgentEntry) => {
    if (busyId) return;
    setBusyId(item.id);
    setBusyKind("install");
    setLogs([]);
    try {
      const res = await window.codex.installCliAgent(item.id);
      if (!res?.ok) notify(res?.error ?? "安装失败");
      else notify(res.detail || `已安装「${item.name}」`);
    } catch (e) {
      notify(`安装失败：${(e as Error)?.message ?? e}`);
    } finally {
      setBusyId("");
      setBusyKind("");
      const installed = await runDetect(item);
      if (installed) void refreshUpdates([item.id]);
    }
  }, [busyId, notify, refreshUpdates, runDetect]);

  const update = useCallback(async (item: CliAgentEntry) => {
    if (busyId) return;
    setBusyId(item.id);
    setBusyKind("update");
    setLogs([]);
    try {
      const res = await window.codex.updateCliAgent(item.id);
      if (!res?.ok) notify(res?.error ?? "更新失败");
      else notify(res.detail || `已更新「${item.name}」`);
    } catch (e) {
      notify(`更新失败：${(e as Error)?.message ?? e}`);
    } finally {
      setBusyId("");
      setBusyKind("");
      const installed = await runDetect(item);
      if (installed) void refreshUpdates([item.id]);
      else setUpdates((current) => { const next = { ...current }; delete next[item.id]; return next; });
    }
  }, [busyId, notify, refreshUpdates, runDetect]);

  /** 取消 = 主进程 kill 子进程（真停）。 */
  const cancelBusy = useCallback(async () => {
    if (!busyId) return;
    try { await window.codex.cancelCliAgentInstall(busyId); } catch { /* 已结束时忽略 */ }
  }, [busyId]);

  const uninstall = useCallback(async (item: CliAgentEntry) => {
    if (busyId) return;
    setBusyId(item.id);
    setBusyKind("uninstall");
    setUninstallId("");
    try {
      const res = await window.codex.uninstallCliAgent(item.id);
      if (!res?.ok) notify(res?.error ?? "卸载失败");
      else notify(res.detail || `已卸载「${item.name}」`);
    } catch (e) {
      notify(`卸载失败：${(e as Error)?.message ?? e}`);
    } finally {
      setBusyId("");
      setBusyKind("");
      await runDetect(item);
      setUpdates((current) => { const next = { ...current }; delete next[item.id]; return next; });
    }
  }, [busyId, notify, runDetect]);

  const toggle = useCallback(async (item: CliAgentEntry, enabled: boolean) => {
    const res = await window.codex.saveCliAgent({ id: item.id, enabled });
    if (!res?.ok) { notify(res?.error ?? "保存失败"); return; }
    setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, enabled } : entry)));
  }, [notify]);

  const save = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      const res = await window.codex.saveCliAgent({
        id: draft.id || undefined,
        name: draft.name,
        category: draft.category,
        bin: draft.bin,
        installCmd: draft.installCmd,
        docs: draft.docs,
        description: draft.description,
      });
      if (!res?.ok) { setError(res?.error ?? "保存失败"); return; }
      setDraft(null);
      await refresh();
      notify(draft.id ? "已更新" : `已接入「${res.item?.name ?? draft.name}」，现在可以在输入框 @ 它`);
    } finally {
      setSaving(false);
    }
  }, [draft, refresh, notify]);

  const remove = useCallback(async (item: CliAgentEntry) => {
    if (confirmId !== item.id) { setConfirmId(item.id); return; }
    const res = await window.codex.removeCliAgent(item.id);
    setConfirmId("");
    if (!res?.ok) { notify(res?.error ?? "删除失败"); return; }
    setPreviewId("");
    await refresh();
    notify(`已移除「${item.name}」`);
  }, [confirmId, refresh, notify]);

  const copyInstall = useCallback(async (item: CliAgentEntry) => {
    if (!item.installCmd) {
      /* 没有一键命令时退到**文档链接**（Harness CLI 这种自建入口就属于这一类）——
         否则这个按钮点了只会在 toast 里说"没有"，什么也没给用户。 */
      if (item.docs) {
        await copyTextToClipboard(item.docs);
        notify("这个 CLI 没有一键安装命令，已复制官方文档链接 —— 按文档装完回来点「检测」");
        return;
      }
      notify("这个 CLI 既没有一键安装命令也没有文档链接 —— 按你自己的分发方式安装，装完点「检测」");
      return;
    }
    await copyTextToClipboard(item.installCmd);
    notify("安装命令已复制（也可以直接点「一键安装」）");
  }, [notify]);

  /* 进度卡：面板顶部与预览弹窗里**各放一份**（弹窗盖住面板时也能看到进度 / 取消）。 */
  const progressNode = busyId ? (() => {
    const busyItem = items.find((entry) => entry.id === busyId);
    const lastLog = [...logs].reverse().find((entry) => entry.id === busyId)?.text ?? "";
    return (
      <div className="cli-install-progress" role="status" aria-live="polite">
        <div className="cli-install-progress-head">
          <LoaderCircle size={14} className="spin" />
          <strong>{busyKind === "update" ? "正在更新" : busyKind === "uninstall" ? "正在卸载" : "正在安装"}「{busyItem?.name || "CLI"}」</strong>
          <span className="cli-install-progress-elapsed">{elapsed}s</span>
          <button type="button" className="secondary-setting cli-install-cancel" onClick={() => void cancelBusy()}>取消</button>
        </div>
        <div className="cli-install-progress-track" aria-hidden="true"><i /></div>
        <small>{lastLog || "准备中…"}</small>
      </div>
    );
  })() : null;

  return (
    <div className="cli-agents">
      <div className="cli-agents-toolbar">
        <label className="cli-agents-search">
          <Search size={13} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索名称 / 命令 / 用途"
            spellCheck={false}
          />
          {query ? (
            <button type="button" className="cli-agents-clear" title="清空搜索" onClick={() => setQuery("")}><X size={12} /></button>
          ) : null}
        </label>
        <button type="button" className="cli-agents-btn" disabled={checkingAll || Boolean(busyId)} title="检查已安装 CLI 的最新版本" onClick={() => void checkAll()}>
          {checkingAll ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />} 检查更新
        </button>
        <button type="button" className="cli-agents-btn primary" onClick={() => setDraft(EMPTY_DRAFT(categories[0]?.key ?? "custom"))}>
          <Plus size={13} /> 新增 CLI
        </button>
      </div>

      <div className="cli-agents-tabs">
        <button type="button" className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>
          全部 <em>{counts.total}</em>
        </button>
        {categories.map((cat) => (
          <button type="button" key={cat.key} className={tab === cat.key ? "on" : ""} onClick={() => setTab(cat.key)} title={cat.hint}>
            {cat.label} <em>{counts.byCategory[cat.key] ?? 0}</em>
          </button>
        ))}
      </div>

      {/* 11-06 用户令：「加一个安装进度条」——装卸期间常驻一条进度卡：已用时 + 不定长滚动条 + 最后一行日志 + 取消（真 kill）。 */}
      {progressNode}

      {draft ? (
        <div className="cli-agent-form">
          <div className="cli-agent-form-title">{draft.id ? "编辑 CLI" : "接入一个 CLI"}</div>
          <div className="cli-agent-form-grid">
            <label>
              <span>名称</span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="例如 Claude Code" />
            </label>
            <label>
              <span>分类</span>
              {/* ⛔ 原生 <select> 全站禁用（【197】）：下拉一律走 AppSelect（统一样式 + portal 弹层） */}
              <AppSelect
                value={draft.category}
                onChange={(value) => setDraft({ ...draft, category: value })}
                options={categories.map((cat) => ({ value: cat.key, label: cat.label }))}
                ariaLabel="CLI 分类"
                className="cli-agent-select"
              />
            </label>
            <label>
              <span>可执行名</span>
              <input value={draft.bin} onChange={(e) => setDraft({ ...draft, bin: e.target.value })} placeholder="PATH 上的命令，例如 claude" spellCheck={false} />
            </label>
            <label>
              <span>安装命令（可空）</span>
              <input value={draft.installCmd} onChange={(e) => setDraft({ ...draft, installCmd: e.target.value })} placeholder="npm / pip 的全局安装命令（可一键执行）" spellCheck={false} />
            </label>
            <label className="wide">
              <span>一句话用途（会出现在 @ 候选和工具描述里）</span>
              <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="例如：Anthropic 官方编码 CLI，读仓库、改代码、跑测试" />
            </label>
            <label className="wide">
              <span>文档链接（可空）</span>
              <input value={draft.docs} onChange={(e) => setDraft({ ...draft, docs: e.target.value })} placeholder="https://…" spellCheck={false} />
            </label>
          </div>
          {error ? <div className="cli-agent-form-error">{error}</div> : null}
          <div className="cli-agent-form-actions">
            <button type="button" className="cli-agents-btn" onClick={() => { setDraft(null); setError(""); }}>取消</button>
            <button type="button" className="cli-agents-btn primary" disabled={saving || !draft.name.trim()} onClick={() => void save()}>
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      ) : null}

      {visible.map((group) => (
        <div className="cli-agent-group" key={group.key}>
          <div className="cli-agent-group-label">
            {group.label}
            <small>{group.hint}</small>
          </div>
          {group.items.length === 0 ? (
            <div className="cli-agent-empty">
              {query ? "没有匹配的条目" : "这一类还没有接入 —— 点右上「新增 CLI」，或切到其它分类"}
            </div>
          ) : (
            <div className="agent-badge-grid">
              {group.items.map((item) => {
                const status = detect[item.id];
                const installed = status?.state === "ok";
                return (
                  <AgentBadge
                    key={item.id}
                    kind="subagent"
                    seed={item.id || item.name}
                    name={item.name}
                    tag={item.builtin ? "内置" : undefined}
                    line={`${categoryLabelOf(item.category)} · ${busyId === item.id ? "处理中…" : installed ? (updates[item.id]?.hasUpdate ? `可更新 · ${updates[item.id].current || "?"} → ${updates[item.id].latest}` : (status?.version ? `已安装 · ${status.version}` : "已安装")) : "未安装"}`}
                    disabled={!item.enabled}
                    onClick={() => setPreviewId(item.id)}
                  />
                );
              })}
            </div>
          )}
        </div>
      ))}

      <div className="cli-agents-foot">
        一键安装只装进<b>应用自己的工具目录</b>（不污染系统 PATH），装完自动复核；
        未安装的 CLI 在输入框 @ 列表里<b>置灰不可选</b>。派活时自动沿用<b>主会话的模型与供应商配置</b>。
      </div>

      {/* ── 预览：工作证点开 = 状态 + 安装命令 + 启停 + 动作 + 装卸日志（10-31 用户令） ── */}
      {preview && (() => {
        const status = detect[preview.id];
        const installed = status?.state === "ok";
        const busy = busyId === preview.id;
        const previewLogs = logs.filter((entry) => entry.id === preview.id).slice(-4);
        return (
          <SettingsDialog
            title={preview.name}
            size="sm"
            icon={<AgentAvatar kind="subagent" seed={preview.id || preview.name} size={24} />}
            hint={`${categoryLabelOf(preview.category)} · ${preview.enabled ? "已接入 @" : "已停用"}`}
            onClose={() => setPreviewId("")}
          >
            <div className="agent-preview">
              <div className="agent-preview-hero">
                <AgentAvatar kind="subagent" seed={preview.id || preview.name} size={72} />
                <div>
                  <strong>{preview.name}<em className="agent-badge-tag">{preview.bin || "未填命令"}</em></strong>
                  <p>{preview.description || "这个 CLI 还没有写说明 —— 派活时模型只能靠名字猜。"}</p>
                </div>
              </div>
              {progressNode}
              <div className="agent-preview-actions">
                {installed && updates[preview.id]?.hasUpdate ? (
                  <button className="primary-setting" disabled={Boolean(busyId)} onClick={() => void update(preview)}>
                    {busy ? <LoaderCircle size={12} className="spin" /> : <RefreshCw size={12} />}更新到 {updates[preview.id].latest}
                  </button>
                ) : null}
                {busy ? (
                  <button className="secondary-setting" onClick={() => void cancelBusy()}><X size={12} />取消</button>
                ) : null}
                {installed ? (
                  <button className="secondary-setting" disabled={busy || checkingId === preview.id} onClick={() => void checkOne(preview)}>
                    {checkingId === preview.id ? <LoaderCircle size={12} className="spin" /> : <RefreshCw size={12} />}检查更新
                  </button>
                ) : null}
                {installed ? (
                  <button className="secondary-setting agent-preview-danger" disabled={busy} onClick={() => setUninstallId(preview.id)}>
                    {busy ? <LoaderCircle size={12} className="spin" /> : <Trash2 size={12} />}卸载
                  </button>
                ) : preview.installCmd ? (
                  <button className="primary-setting" disabled={Boolean(busyId)} onClick={() => void install(preview)}>
                    {busy ? <LoaderCircle size={12} className="spin" /> : <Download size={12} />}一键安装
                  </button>
                ) : null}
                <button className="secondary-setting" disabled={busy} onClick={() => void runDetect(preview)}><RefreshCw size={12} />检测</button>
                <button className="secondary-setting" disabled={busy} onClick={() => void copyInstall(preview)}><Copy size={12} />复制命令</button>
                <button className="secondary-setting" disabled={busy} onClick={() => { setDraft({ id: preview.id, name: preview.name, category: preview.category, bin: preview.bin, installCmd: preview.installCmd, docs: preview.docs, description: preview.description }); setPreviewId(""); }}><PencilLine size={12} />编辑</button>
                {preview.builtin ? null : (
                  <button className={`secondary-setting${confirmId === preview.id ? " agent-preview-danger" : ""}`} disabled={busy} onClick={() => void remove(preview)}>
                    <Trash2 size={12} />{confirmId === preview.id ? "确认删除" : "移除"}
                  </button>
                )}
              </div>
              <div className="agent-preview-section">
                <span className="agent-preview-label">状态</span>
                <div className="agent-preview-meta">
                  <span className={installed ? "is-ok" : ""} title={status?.path || undefined}>
                    {installed ? <Check size={11} /> : <Terminal size={11} />}
                    {status?.state === "busy" ? "检测中…" : installed ? `已安装${status?.version ? ` · ${status.version}` : ""}` : "未安装"}
                  </span>
                  <span>{preview.installCmd ? "支持一键安装 / 更新" : "按官方文档安装"}</span>
                  {updates[preview.id]?.hasUpdate ? <span className="is-warn">可更新 {updates[preview.id].current || "?"} → {updates[preview.id].latest}</span> : null}
                  {preview.builtin ? <span>内置</span> : null}
                </div>
                {status?.path ? <code className="agent-preview-code">{status.path}</code> : null}
                {preview.installCmd ? <code className="agent-preview-code">{preview.installCmd}</code> : null}
              </div>
              <label className="agent-preview-toggle">
                <span>{preview.enabled ? "已接入 @ 与调度" : "已停用：不出现在 @ 候选里"}</span>
                <ToggleSwitch checked={preview.enabled} onChange={(next) => void toggle(preview, next)} title={preview.enabled ? "停用后不再出现在 @ 候选" : "启用后可被 @ 点名"} />
              </label>
              {previewLogs.length > 0 && (
                <pre className="cli-agent-install-log">{previewLogs.map((entry, index) => <span key={index}>{entry.text}{"\n"}</span>)}</pre>
              )}
            </div>
          </SettingsDialog>
        );
      })()}

      {/* ── 卸载确认弹窗（⛔ 设置页里必须用 SettingsDialog：AppView 的 confirm 渲染在 sheet 之下看不见）── */}
      {uninstallTarget && (
        <SettingsDialog size="sm" title={`卸载「${uninstallTarget.name}」`} onClose={() => setUninstallId("")}>
          <div className="cli-agent-confirm">
            <p>会从应用的工具目录卸载 <code>{uninstallTarget.installCmd || uninstallTarget.bin}</code>，
              卸载后它从 @ 候选里置灰（不可选但仍在列表里）。</p>
            <p className="cli-agent-confirm-note">你在系统 npm / Python 里自己装的另一份不会被动。</p>
            <div className="cli-agent-confirm-actions">
              <button type="button" className="cli-agents-btn" onClick={() => setUninstallId("")}>取消</button>
              <button type="button" className="cli-agents-btn danger" onClick={() => void uninstall(uninstallTarget)}>卸载</button>
            </div>
          </div>
        </SettingsDialog>
      )}
    </div>
  );
}
