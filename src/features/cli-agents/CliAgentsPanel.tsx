/**
 * CLI 智能体面板（10-29 新板块；嵌在「设置 → 开发工具」的一级卡片里）。
 *
 * 用户令原文：「在开发工具界面新增一个「CLI 智能体」模块，用于统一管理和接入各类 CLI 工具，
 *   支持安装 Claude CLI、OpenClaw CLI、Harness CLI 及其他主流 CLI。要求按类型对已接入的 CLI
 *   进行分类管理，并提供搜索功能…同时将该 CLI 接入到「@」调用体系中」。
 *
 * 这一屏只做**管理面**：分类分组 / 搜索 / 检测已装 / 复制安装命令 / 启停 / 增改删。
 * 派活不在这里 —— 配好之后它就是一个可调度对象：输入框 `@` 里能选到它，
 * 模型用 `agent_invoke(kind="cli")` 派出（与专家 / 子智能体同一条链路、同一套闸门）。
 *
 * ⛔⛔ **不假装能一键安装**：`installCmd` 只在内置表核实过官方来源时才有值；
 *   没有就显示「按官方文档安装」并只给「复制文档链接」。⛔ 不在这里跑 npm/安装脚本 ——
 *   静默在用户机器上装东西是最不该有的"顺手"。
 * ⛔ 检测是**按需**的（点按钮才跑）：`where/which` 有子进程，开面板就扫一遍会让设置页卡顿。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Code2, Copy, PencilLine, Plus, RefreshCw, Search, Terminal, Trash2, X } from "lucide-react";
import { ToggleSwitch } from "../../components/SettingsWidgets";
import { AppSelect } from "../../components/AppSelect";
import { copyTextToClipboard } from "../../lib/clipboard";
import { countCliAgents, detectLabel, groupCliAgents, type CliCategory } from "../../lib/cli-agents.mjs";

type DetectState = { state: "idle" | "busy" | "ok" | "miss"; version?: string; path?: string };

const CATEGORY_ICON: Record<string, typeof Code2> = { coding: Code2, agent: Bot, custom: Terminal };

/** 新增/编辑表单的草稿（id 为空 = 新增）。 */
type Draft = { id: string; name: string; category: string; bin: string; installCmd: string; docs: string; description: string };

const EMPTY_DRAFT = (category: string): Draft => ({ id: "", name: "", category, bin: "", installCmd: "", docs: "", description: "" });

export function CliAgentsPanel({ setNotice }: { setNotice?: (text: string) => void }) {
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

  const notify = useCallback((text: string) => { if (text) setNotice?.(text); }, [setNotice]);

  const refresh = useCallback(async () => {
    try {
      const res = (await window.codex.listCliAgents()) as { items: CliAgentEntry[]; categories: CliCategory[] };
      setItems(Array.isArray(res?.items) ? res.items : []);
      setCategories(Array.isArray(res?.categories) ? res.categories : []);
    } catch (e) {
      setError(`读取 CLI 列表失败：${(e as Error)?.message ?? e}`);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const groups = useMemo(() => groupCliAgents(items, categories, query), [items, categories, query]);
  const counts = useMemo(() => countCliAgents(items, categories, query), [items, categories, query]);
  const visible = tab === "all" ? groups : groups.filter((group) => group.key === tab);

  /** 检测一个条目（按需触发）。⛔ 失败只写"未检测到"，不当错误弹 —— 没装是常态。 */
  const runDetect = useCallback(async (item: CliAgentEntry) => {
    setDetect((current) => ({ ...current, [item.id]: { state: "busy" } }));
    try {
      const res = await window.codex.detectCliAgent({ id: item.id });
      setDetect((current) => ({
        ...current,
        [item.id]: res?.installed
          ? { state: "ok", version: String(res.version ?? ""), path: String(res.path ?? "") }
          : { state: "miss" },
      }));
    } catch {
      setDetect((current) => ({ ...current, [item.id]: { state: "miss" } }));
    }
  }, []);

  const detectAll = useCallback(async () => {
    for (const item of items) {
      // 串行：并发 fork 一堆 where/--version 在 Windows 上会互相拖慢
      await runDetect(item);
    }
    notify("检测完成：装了的会显示版本号");
  }, [items, runDetect, notify]);

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
    notify("安装命令已复制 —— 贴到终端里跑，装完回来点「检测」");
  }, [notify]);

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
        <button type="button" className="cli-agents-btn" onClick={() => void detectAll()} title="逐条检测是否已装（有子进程，按需点）">
          <RefreshCw size={13} /> 全部检测
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
              <input value={draft.installCmd} onChange={(e) => setDraft({ ...draft, installCmd: e.target.value })} placeholder="没有核实过就留空" spellCheck={false} />
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
          ) : group.items.map((item) => {
            const Icon = CATEGORY_ICON[item.category] ?? Terminal;
            const status = detect[item.id];
            return (
              <div className={`cli-agent-row ${item.enabled ? "" : "off"}`} key={item.id}>
                <span className="cli-agent-icon"><Icon size={14} /></span>
                <div className="cli-agent-main">
                  <div className="cli-agent-title">
                    {item.name}
                    <code>{item.bin || "（未填可执行名）"}</code>
                    {item.builtin ? <em className="cli-agent-tag">内置</em> : null}
                  </div>
                  <div className="cli-agent-desc">{item.description || "（没有写说明 —— 派活时模型只能靠名字猜）"}</div>
                  {status && status.state !== "idle" ? (
                    <div className={`cli-agent-status ${status.state}`}>
                      {detectLabel(status)}
                      {status.path ? <span title={status.path}> · {status.path}</span> : null}
                    </div>
                  ) : null}
                </div>
                <div className="cli-agent-actions">
                  <button type="button" className="cli-agents-btn" onClick={() => void runDetect(item)} title="检测本机是否已装（where/which + --version）">
                    <RefreshCw size={12} /> 检测
                  </button>
                  <button type="button" className="cli-agents-btn" onClick={() => void copyInstall(item)} title={item.installCmd || item.docs || "没有可复制的一键安装命令"}>
                    <Copy size={12} /> 安装命令
                  </button>
                  <button type="button" className="cli-agents-btn" onClick={() => setDraft({ id: item.id, name: item.name, category: item.category, bin: item.bin, installCmd: item.installCmd, docs: item.docs, description: item.description })}>
                    <PencilLine size={12} /> 编辑
                  </button>
                  {item.builtin ? null : (
                    <button type="button" className={`cli-agents-btn ${confirmId === item.id ? "danger" : ""}`} onClick={() => void remove(item)}>
                      <Trash2 size={12} /> {confirmId === item.id ? "确认删除" : "移除"}
                    </button>
                  )}
                </div>
                <ToggleSwitch checked={item.enabled} onChange={(next) => void toggle(item, next)} title={item.enabled ? "已接入 @ 候选" : "已停用：不出现在 @ 候选里"} />
              </div>
            );
          })}
        </div>
      ))}

      <div className="cli-agents-foot">
        这里<b>不会替你安装</b> —— 只给核实过的官方安装命令（复制到终端跑），其余按官方文档装。
        装好后点「检测」确认；启用中的 CLI 会出现在输入框 @ 候选里，与专家、子智能体一起可直接派活。
      </div>
    </div>
  );
}
