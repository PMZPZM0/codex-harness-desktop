/**
 * 记忆域（从 src/App.tsx 原样搬来，纯搬迁零行为改动）。
 *
 * 公开面见同目录 index.ts。
 */

import { ChevronRight, ChevronDown, MessageSquare, Edit3, Trash2, Star, BookOpen, CircleCheck, Check, Sparkles, Cloud, X, User, Info, Wifi, Layers3, Copy, AlertTriangle, ArrowDown, RefreshCw, Eye, FolderOpen } from "lucide-react";
import { MemoryGroup, MemoryRecord, MemoryPriority, MemoryGatewayState } from "../../hooks/useMemory";
import { Spinner } from "../../components/CardShell";
import { createPortal } from "react-dom";
import { useState, useMemo, useEffect } from "react";

/** 记忆整洁报告（来自主进程 memory:hygiene:plan；规则表也在里面 —— 唯一真相源在 electron/memory-hygiene.ts） */
type HygienePlan = {
  rules: { layer: string; name: string; when: string; action: string; protect: string; trace: string }[];
  labels: Record<string, { title: string; danger: string }>;
  actions: string[];
  issues: { severity: "info" | "warn"; layer: string; code: string; message: string; count?: number }[];
  layers: { id: string; name: string; where: string; writer: string; sink: string; budget: number; used: number; ratio: number | null; needDistill: boolean }[];
  archive: { files: number; bytes: number };
  pool: { total: number; pinned: number; expiring: number; max: number; ttlDays: number };
};
type HygieneActionId = "prune-pool" | "tidy-lessons" | "purge-archive";
const HYGIENE_ACTION_ORDER: HygieneActionId[] = ["prune-pool", "tidy-lessons", "purge-archive"];

const PRIORITY_LABELS: Record<MemoryPriority, { label: string; hint: string; accent: string }> = {
  P0: { label: "P0 · 核心", hint: "置顶 + 长期保留，召回时永远优先", accent: "var(--green)" },
  P1: { label: "P1 · 重要", hint: "项目背景 / 工作流 SOP，长期可复用", accent: "var(--blue, #4a90e2)" },
  P2: { label: "P2 · 一般", hint: "任务经验与事实，按工作区可复用", accent: "var(--amber, #d99000)" },
  P3: { label: "P3 · 临时", hint: "临时上下文，自动衰减 / 可清理", accent: "var(--muted)" },
};

function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  if (diff < 2 * 60_000) return "刚刚";
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * 24 * 60 * 60_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function MemoryFunnel({ groups, emptyHint, onShowAll, onPreview, onTogglePin, onDeleteOne, onDeleteGroup, onOpenThread }: {
  groups: MemoryGroup[];
  /** 空列表时的解释（09-23 加）：区分「真的没记忆」与「当前项目下没有、别处还有」—— 后者原先只显示"暂无记忆"，把用户带偏。 */
  emptyHint?: { totalElsewhere: number; scopeLabel: string } | null;
  /** 空状态里的「切到全部项目」回调（联动） */
  onShowAll?: () => void;
  onPreview: (entry: MemoryRecord) => void;
  onTogglePin: (id: string) => void;
  onDeleteOne: (id: string) => void;
  onDeleteGroup: (group: MemoryGroup) => void;
  onOpenThread: (threadId: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // 层级别折叠：P0 默认展开（核心一眼可见），P1/P2/P3 默认整层收起
  const [collapsedLayers, setCollapsedLayers] = useState<Record<string, boolean>>({ P1: true, P2: true, P3: true });
  const buckets = useMemo(() => {
    const map: Record<MemoryPriority, MemoryGroup[]> = { P0: [], P1: [], P2: [], P3: [] };
    for (const g of groups) map[g.priority].push(g);
    return map;
  }, [groups]);
  const totalItems = useMemo(() => groups.reduce((sum, g) => sum + g.items.length, 0), [groups]);
  const totalPinned = useMemo(() => groups.reduce((sum, g) => sum + g.items.filter((it) => (it as any).pinned).length, 0), [groups]);

  /** 分组维度（09-23 用户要求「按项目归类」）：project = 按工作区一级分组，priority = 按 P0–P3 分层 */
  const [groupMode, setGroupMode] = useState<"project" | "priority">("project");
  /** 会话组按项目归拢（组内第一个带 workspace 的条目决定归属；都没有的归「未归属项目」） */
  const byProject = useMemo(() => {
    const map = new Map<string, MemoryGroup[]>();
    for (const g of groups) {
      const ws = g.items.find((it) => it.workspace)?.workspace ?? "";
      const key = ws || "__global";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(g);
    }
    return [...map.entries()].sort((a, b) => b[1].reduce((s, g) => s + g.items.length, 0) - a[1].reduce((s, g) => s + g.items.length, 0));
  }, [groups]);

  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleLayer = (p: MemoryPriority) => setCollapsedLayers((prev) => ({ ...prev, [p]: !prev[p] }));

  if (!groups.length) {
    if (emptyHint && emptyHint.totalElsewhere > 0) {
      return (
        <div className="memory-funnel-empty">
          <p>当前范围（<strong>{emptyHint.scopeLabel}</strong>）下没有条目，但<strong>其它项目还有 {emptyHint.totalElsewhere} 条</strong> —— 不是没有记忆，是被项目筛选挡住了。</p>
          {onShowAll && <button className="primary-setting" onClick={onShowAll}>切到「全部项目」查看</button>}
        </div>
      );
    }
    return <div className="memory-funnel-empty"><p>暂无记忆。开启自动捕获后，新会话的关键内容会按 P 级沉淀到这里；或者上方手动保存一条。</p></div>;
  }

  /** 会话组渲染（09-23 提取：按项目 / 按重要度两种分组共用同一段，避免复制 40 行 JSX） */
  const renderGroup = (group: MemoryGroup) => {
                const isOpen = expanded[group.key] !== false; // 默认展开（09-23 用户要求：不要一条条点开）
                return (
                  <article key={group.key} className={`memory-group ${isOpen ? "open" : ""}`}>
                    <header className="memory-group-head" onClick={() => toggle(group.key)}>
                      <div className="memory-group-title">
                        {group.threadId
                          ? <button className="memory-group-open-thread" title="打开会话" onClick={(event) => { event.stopPropagation(); onOpenThread(group.threadId!); }}><MessageSquare size={12} /></button>
                          : <span className="memory-group-manual" title="手动保存"><Edit3 size={12} /></span>}
                        <span className="memory-group-name">{group.threadTitle}</span>
                      </div>
                      <div className="memory-group-meta">
                        {group.categories.map((cat) => <span key={cat} className="memory-category-pill">{cat}</span>)}
                        <span className="memory-group-time" title={new Date(group.latestAt).toLocaleString()}>{formatRelativeTime(group.latestAt)}</span>
                        <span className="memory-group-count">{group.items.length} 条</span>
                        <button className="icon-button" title="删除整个会话记忆" onClick={(event) => { event.stopPropagation(); onDeleteGroup(group); }}><Trash2 size={12} /></button>
                        <button className={`memory-group-chevron ${isOpen ? "open" : ""}`} title={isOpen ? "收起" : "展开"}>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                      </div>
                    </header>
                    {isOpen && (
                      <div className="memory-group-items">
                        {group.items.map((entry) => (
                          <article className={`memory-card ${(entry as any).pinned ? "pinned" : ""}`} key={entry.id} onClick={() => onPreview(entry)} title="点击查看全文">
                            <div className="memory-card-head">
                              <span className="memory-category-pill">{entry.category}</span>
                              {(entry as any).pinned && <span className="memory-pin-badge" title="核心记忆，不被自动清理">★ 核心</span>}
                              {(entry as any).workspace && <span className="memory-ws-badge" title="项目记忆">{(entry as any).workspace.split(/[\\/]/).pop()}</span>}
                              <span className="memory-card-time" title={new Date(entry.updatedAt).toLocaleString()}>{formatRelativeTime(entry.updatedAt)}</span>
                              {entry.sourceThreadId && <button className="icon-button" title="打开源会话" onClick={(event) => { event.stopPropagation(); onOpenThread(entry.sourceThreadId!); }}><MessageSquare size={12} /></button>}
                              <button className={`icon-button ${(entry as any).pinned ? "pin-on" : ""}`} title={(entry as any).pinned ? "取消置顶" : "置顶为核心记忆"} onClick={(event) => { event.stopPropagation(); onTogglePin(entry.id); }}><Star size={12} /></button>
                              <button className="icon-button" title="删除" onClick={(event) => { event.stopPropagation(); onDeleteOne(entry.id); }}><Trash2 size={12} /></button>
                            </div>
                            <p className="memory-card-preview">{entry.content}</p>
                          </article>
                        ))}
                      </div>
                    )}
                  </article>
                );
  };

  const order: MemoryPriority[] = ["P0", "P1", "P2", "P3"];
  return (
    <div className="memory-funnel">
      <div className="memory-funnel-summary">
        <strong>{totalItems}</strong> 条记忆 · <strong>{groups.length}</strong> 个会话 · <strong>{totalPinned}</strong> 个置顶
        <div className="memory-funnel-modes" role="tablist" aria-label="记忆分组方式">
          <button role="tab" aria-selected={groupMode === "project"} className={`memory-funnel-chip ${groupMode === "project" ? "active" : ""}`} onClick={() => setGroupMode("project")}>按项目</button>
          <button role="tab" aria-selected={groupMode === "priority"} className={`memory-funnel-chip ${groupMode === "priority" ? "active" : ""}`} onClick={() => setGroupMode("priority")}>按重要度</button>
        </div>
      </div>
      {groupMode === "project" && byProject.map(([ws, list]) => (
        <section key={ws} className="memory-funnel-layer memory-funnel-project">
          <header className="memory-funnel-layer-head" style={{ borderLeftColor: "var(--blue, #4a90e2)" }}>
            <div className="memory-funnel-layer-title"><span className="memory-funnel-layer-tag" style={{ background: "var(--blue, #4a90e2)" }}>项目</span>
            <div className="memory-funnel-layer-count">{ws === "__global" ? "未归属项目" : ws.split(/[\\/]/).filter(Boolean).pop()}<span className="memory-project-path" title={ws}>{ws}</span> · {list.length} 个会话 · {list.reduce((s, g) => s + g.items.length, 0)} 条</div>
            </div>
          </header>
          <div className="memory-funnel-groups">{list.map(renderGroup)}</div>
        </section>
      ))}
      {groupMode === "priority" && order.map((p) => {
        const list = buckets[p];
        if (!list.length) return null;
        const meta = PRIORITY_LABELS[p];
        const count = list.reduce((sum, g) => sum + g.items.length, 0);
        const layerCollapsed = !!collapsedLayers[p];
        return (
          <section key={p} className={`memory-funnel-layer memory-funnel-${p} ${layerCollapsed ? "collapsed" : ""}`}>
            <header className="memory-funnel-layer-head" style={{ borderLeftColor: meta.accent }} onClick={() => toggleLayer(p)} role="button" aria-expanded={!layerCollapsed} title={layerCollapsed ? "展开该层级" : "折叠该层级"}>
              <div className="memory-funnel-layer-title"><span className="memory-funnel-layer-tag" style={{ background: meta.accent }}>{meta.label}</span><span className="memory-funnel-layer-hint">{meta.hint}</span></div>
              <div className="memory-funnel-layer-count">{list.length} 个会话 · {count} 条
                <button className={`memory-group-chevron ${layerCollapsed ? "" : "open"}`} title={layerCollapsed ? "展开" : "收起"}>{layerCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button>
              </div>
            </header>
            {!layerCollapsed && (
            <div className="memory-funnel-groups">
              {list.map(renderGroup)}
            </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function MemoryLayersEditor({ snapshot, scope, draft, dirty, distilling, hasWorkspace, savedAt, onScope, onDraft, onSave, onDistill }: {
  snapshot: MemoryLayersSnapshot | null;
  scope: "user" | "background" | "project";
  draft: string;
  dirty: boolean;
  distilling: boolean;
  hasWorkspace: boolean;
  savedAt: number | null;
  onScope: (scope: "user" | "background" | "project") => void;
  onDraft: (value: string) => void;
  onSave: () => void;
  onDistill: () => void;
}) {
  if (!snapshot) return <div className="memory-layers"><p className="memory-layers-loading">正在读取记忆分层…</p></div>;
  const over = snapshot.budget.over;
  const pending = snapshot.pendingDistill.dates.length;
  return (
    <div className="memory-layers">
      <div className="memory-layers-head">
        <div className="memory-layers-title">
          <span className="memory-layers-icon"><BookOpen size={15} /></span>
          <div>
            <strong>常驻记忆</strong>
          <span>每轮对话自动前置。用户档案跨项目生效，项目背景与项目记忆只跟随当前工作区。</span>
          </div>
        </div>
        <div className={`memory-budget ${over ? "over" : ""}`} title="超过预算会在注入时截断并提示蒸馏">
          <span>用户 {snapshot.budget.user}/1500</span>
          <span>背景 {snapshot.budget.background}/2000</span>
          <span>项目 {snapshot.budget.project}/3000</span>
          <span>日志 {snapshot.budget.logs}</span>
          {over && <span className="memory-budget-warn">超预算</span>}
        </div>
        {snapshot.entries && (
          <div className="memory-budget" title={`碎片池（按需召回的条目）：临时记忆 ${snapshot.entries.ttlDays} 天未更新会自动归档进当日日志，再由蒸馏接进项目记忆；置顶条目永久保留。`}>
            <span>碎片 {snapshot.entries.total}/{snapshot.entries.max}</span>
            <span>置顶 {snapshot.entries.pinned}</span>
            {!!snapshot.entries.expiring && <span className="memory-budget-warn">待清理 {snapshot.entries.expiring}</span>}
            {!!snapshot.entries.expiringSoon && <span>即将归档 {snapshot.entries.expiringSoon}</span>}
            {!!snapshot.entries.prunedTotal && <span>本次已清理 {snapshot.entries.prunedTotal}</span>}
          </div>
        )}
      </div>

      <div className="memory-layer-tabs" role="tablist" aria-label="记忆分层">
        <button role="tab" aria-selected={scope === "user"} className={`memory-layer-tab ${scope === "user" ? "active" : ""}`} onClick={() => onScope("user")}>用户档案</button>
        <button role="tab" aria-selected={scope === "background"} className={`memory-layer-tab ${scope === "background" ? "active" : ""}`} disabled={!hasWorkspace} title={hasWorkspace ? "所有该项目会话都会读取" : "先选择一个工作区"} onClick={() => onScope("background")}>项目背景</button>
        <button role="tab" aria-selected={scope === "project"} className={`memory-layer-tab ${scope === "project" ? "active" : ""}`} disabled={!hasWorkspace} title={hasWorkspace ? "跟随当前工作区" : "先选择一个工作区"} onClick={() => onScope("project")}>项目记忆</button>
        <span className="memory-layer-path" title={scope === "user" ? snapshot.paths.user : scope === "background" ? snapshot.paths.background : snapshot.paths.project}>{scope === "user" ? snapshot.paths.user : (scope === "background" ? (snapshot.paths.background || "未选择工作区") : (snapshot.paths.project || "未选择工作区"))}</span>
      </div>

      <textarea
        className="memory-layer-editor"
        rows={9}
        value={draft}
        onChange={(event) => onDraft(event.target.value)}
        placeholder={scope === "user"
          ? "跨所有项目生效的规则与偏好。一行一条，只写不看会再踩的：\n- 回答用中文，先给结论再给依据\n- 不要主动提交 git，未经确认不 push"
          : scope === "background"
            ? "这个项目是做什么的、目录怎么分、运行前必须知道什么。新会话会优先读取这里：\n- 项目目标：\n- 关键目录：\n- 启动/构建方式：\n- 不能做的事："
            : "这个项目的长期约束与踩过的坑。一行一条：\n- 改完源码必须 npm run build，否则「没生效」多半是没构建\n- Windows 沙箱下 exec_command 全被拦，改用 npm pre/post 钩子"}
      />

      {scope === "user" && !snapshot.user.trim() && (
        <p className="memory-layer-hint memory-layer-empty-hint">还没有用户档案。这里写的称呼、习惯、禁忌跨所有项目生效，每个新会话都会前置读取；第一次见面时的引导也会写进这里。</p>
      )}

      <div className="memory-layer-actions">
        <button className={`primary-setting ${savedAt ? "memory-save-success" : ""}`} disabled={!dirty} onClick={onSave}>{savedAt ? <CircleCheck size={14} /> : <Check size={14} />}{savedAt ? "已保存" : `保存${scope === "user" ? "用户档案" : scope === "background" ? "项目背景" : "项目记忆"}`}</button>
        <button className="secondary-setting" disabled={distilling || !hasWorkspace || !pending} title={!hasWorkspace ? "先选择一个工作区" : pending ? `有 ${pending} 天日志满 30 天，可蒸馏进项目记忆` : "暂无满 30 天的日志"} onClick={onDistill}>
          {distilling ? <Spinner /> : <Sparkles size={14} />}蒸馏日志{pending ? `（${pending} 天）` : ""}
        </button>
        {dirty && <span className="memory-layer-dirty">有未保存的修改</span>}
        {snapshot.lastDistillAt && <span className="memory-layer-hint">上次蒸馏 {new Date(snapshot.lastDistillAt).toLocaleString()}</span>}
      </div>

      {!!snapshot.logs.length && (
        <div className="memory-layer-logs">
          <span className="memory-layer-logs-label">近期日志</span>
          {snapshot.logs.map((entry) => <span key={entry.date} className="memory-layer-log-chip" title={`${entry.chars} 字`}>{entry.date} · {entry.chars} 字</span>)}
        </div>
      )}
    </div>
  );
}

export function MemoryConfigModal({ gateway, setGateway, action, onClose, onTest, onSave }: {
  gateway: MemoryGatewayState;
  setGateway: (g: MemoryGatewayState) => void;
  action: "save" | "test" | null;
  onClose: () => void;
  onTest: () => void;
  onSave: () => void;
}) {
  const valid = Boolean(gateway.endpoint.trim());
  return createPortal(
    <div className="modal-backdrop memory-config-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="connector-setup-modal memory-config-modal" role="dialog" aria-modal="true" aria-label="云端记忆配置">
        <header>
          <div className="connector-setup-title">
            <span><Cloud size={17} /></span>
            <div><strong>云端记忆配置</strong><p>配置 TencentDB Gateway 后，启用云端记忆时 Codex 会优先从云端召回与保存。</p></div>
          </div>
          <button className="icon-button relay-modal-close" title="关闭" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="connector-form">
          <label><span>TencentDB Gateway 地址 <em>必填</em></span><input autoFocus value={gateway.endpoint} onChange={(event) => setGateway({ ...gateway, endpoint: event.target.value })} placeholder="http://127.0.0.1:8420" /></label>
          <div className="settings-grid three memory-config-row"><label><span>Session Key</span><input value={gateway.sessionKey} onChange={(event) => setGateway({ ...gateway, sessionKey: event.target.value })} placeholder="codex-harness" /></label><label><span>User ID</span><input value={gateway.userId} onChange={(event) => setGateway({ ...gateway, userId: event.target.value })} /></label><label><span>API Key <small>加密保存</small></span><input type="password" value={gateway.apiKey} onChange={(event) => setGateway({ ...gateway, apiKey: event.target.value })} placeholder={gateway.hasApiKey ? "已安全保存，留空不修改" : "可选"} /></label></div>
          <div className="connector-example"><Info size={14} /><span>默认 Endpoint <code>http://127.0.0.1:8420</code>；开启云端后会自动写回 Codex 引擎的 <code>memory_recall / memory_save</code> 工具。</span></div>
        </div>
        <footer>
          <button className="secondary-setting" onClick={onClose}>取消</button>
          <button className="secondary-setting" disabled={!valid || action !== null} onClick={onTest}>{action === "test" ? <Spinner /> : <Wifi size={14} />}测试连接</button>
          <button className="primary-setting" disabled={action !== null} onClick={onSave}>{action === "save" ? <Spinner /> : <Check size={15} />}保存并启用云端</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

/**
 * 记忆整洁（09-22 用户：「记忆管理和记忆整洁，记忆清理规则都要写好」）。
 * 八层水位 + 分类计数 + 待办清单 + 三个清理动作（**危险动作走二次确认**：点一次 = 展开确认条，
 * 再点「确认」才发 IPC，且 IPC 层还要求 confirm=true 双保险）。
 * 规则表来自主进程（`memory:hygiene:plan`）⇒ 界面与后端永远同一份规则。
 */
export function MemoryHygienePanel({ snapshot, workspace, onStatus }: {
  snapshot: MemoryLayersSnapshot | null;
  workspace?: string;
  onStatus?: (message: string) => void;
}) {
  const [plan, setPlan] = useState<HygienePlan | null>(null);
  const [pending, setPending] = useState<HygieneActionId | null>(null);
  const [busy, setBusy] = useState<HygieneActionId | null>(null);

  const load = () => {
    void window.codex.planMemoryHygiene(workspace).then((next) => setPlan(next as HygienePlan)).catch(() => setPlan(null));
  };
  /* 工作区变了就重算（水位/归档/碎片都是按工作区算的） */
  useEffect(() => { load(); }, [workspace]);

  const run = async (action: HygieneActionId) => {
    setBusy(action);
    try {
      const { result } = await window.codex.applyMemoryHygiene({ action, workspace, confirm: true });
      const note = action === "purge-archive"
        ? `已清空冷存档：${result?.removed ?? 0} 个文件 / ${Math.round((result?.bytes ?? 0) / 1024)} KB`
        : action === "tidy-lessons"
          ? `已整理纪律格式：${result?.changed ?? 0}/${result?.files ?? 0} 个文件有改动`
          : `已清理过期碎片：${result?.pruned ?? 0} 条`;
      onStatus?.(note);
      setPending(null);
      load();
    } catch (error: any) {
      onStatus?.(`清理失败：${error?.message ?? error}`);
    } finally {
      setBusy(null);
    }
  };

  const layers = plan?.layers ?? snapshot?.layers ?? [];
  const issues = plan?.issues ?? [];
  const hot = layers.filter((layer) => layer.needDistill).length;

  return (
    <div className="memory-hygiene">
      <div className="memory-center-block-head">
        <div>
          <strong>记忆整洁</strong>
          <span>
            {hot ? `⚠️ ${hot} 层已到 90% 蒸馏线` : "八层水位正常"} ·
            碎片池 {plan?.pool.total ?? 0} 条（pinned {plan?.pool.pinned ?? 0} / 过期 {plan?.pool.expiring ?? 0}）·
            冷存档 {plan?.archive.files ?? 0} 个文件
          </span>
        </div>
        <button className="secondary-setting" onClick={load}>重新检查</button>
      </div>

      <div className="memory-hygiene-layers">
        {layers.map((layer) => (
          <div key={layer.id} className={`memory-hygiene-layer ${layer.needDistill ? "hot" : ""}`} title={`${layer.where} · ${layer.writer} · 满了沉到：${layer.sink}`}>
            <span className="memory-hygiene-id">{layer.id}</span>
            <span className="memory-hygiene-name">{layer.name}</span>
            <span className="memory-hygiene-bar">
              <i style={{ width: layer.ratio === null ? "0%" : `${Math.min(100, Math.round(layer.ratio * 100))}%` }} />
            </span>
            <span className="memory-hygiene-pct">{layer.ratio === null ? "—" : `${Math.round(layer.ratio * 100)}%`}</span>
          </div>
        ))}
      </div>

      {snapshot?.lessonGroups?.length ? (
        <div className="memory-hygiene-groups">
          {snapshot.lessonGroups.map((group) => (
            <span key={group.category} className={`memory-hygiene-group ${group.category === "用户纠错" ? "key" : ""}`}>
              {group.category} <b>{group.count}</b>
            </span>
          ))}
        </div>
      ) : null}

      {issues.length ? (
        <ul className="memory-hygiene-issues">
          {issues.map((issue, index) => (
            <li key={`${issue.code}-${index}`} className={issue.severity === "warn" ? "warn" : "info"}>
              <span className="memory-hygiene-tag">{issue.layer}</span>
              {issue.message}
              {typeof issue.count === "number" ? <b>（{issue.count}）</b> : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="memory-hygiene-ok"><CircleCheck size={14} /> 没有需要整理的项</div>
      )}

      <div className="memory-hygiene-actions">
        {HYGIENE_ACTION_ORDER.map((action) => {
          const label = plan?.labels?.[action];
          const suggested = plan?.actions?.includes(action);
          return (
            <div key={action} className="memory-hygiene-action">
              <button
                className={`secondary-setting ${suggested ? "suggested" : ""}`}
                disabled={busy !== null}
                onClick={() => setPending(pending === action ? null : action)}
              >
                {busy === action ? <Spinner /> : null}{label?.title ?? action}{suggested ? " · 建议" : ""}
              </button>
              {pending === action && (
                <div className="memory-hygiene-confirm">
                  <span>⚠️ {label?.danger}</span>
                  <button className="secondary-setting" onClick={() => setPending(null)}>取消</button>
                  <button className="primary-setting" disabled={busy !== null} onClick={() => void run(action)}>确认执行</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <details className="memory-hygiene-rules">
        <summary>清理规则（八层，规则唯一真相源在主进程）</summary>
        <table>
          <thead><tr><th>层</th><th>何时清理</th><th>动作</th><th>保护项</th><th>留痕</th></tr></thead>
          <tbody>
            {(plan?.rules ?? []).map((rule) => (
              <tr key={rule.layer}>
                <td>{rule.layer} {rule.name}</td>
                <td>{rule.when}</td>
                <td>{rule.action}</td>
                <td>{rule.protect}</td>
                <td>{rule.trace}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}



/** ─────────────────────────────────────────────────────────────
 *  记忆金字塔仪表盘（09-23 新增）
 *
 *  为什么加：后端 `memory:layers:read` 早就返回八层水位（id / name / where / budget /
 *  used / ratio / needDistill / writer / sink）+ L2 分类计数 + 待蒸馏天数，但前端只用到了
 *  三个数字（用户 / 背景 / 项目），八层与 90% 蒸馏线从来没画出来过。
 *  这里把它变成可看、可点、可联动的金字塔：水位条 + 蒸馏线 + 流转去向 + 跳转。
 *  真相源 = electron/memory-layers.ts 的 MEMORY_PYRAMID（守卫【104】），前端只做呈现。
 *  ───────────────────────────────────────────────────────────── */
export function MemoryPyramid({ snapshot, distilling, records, onJump, onDistill, onReveal, onOpenThread }: {
  snapshot: MemoryLayersSnapshot | null;
  distilling: boolean;
  onJump: (layerId: string) => void;
  onDistill: () => void;
  /** 全部记忆条目（供分类速览弹窗用；不受项目筛选影响） */
  records?: MemoryRecord[];
  onOpenThread?: (threadId: string) => void;
  /** 定位到该层的真实文件（shellReveal；只给 paths 里确实有的层） */
  onReveal?: (path: string) => void;
}) {
  const [previewCategory, setPreviewCategory] = useState<string | null>(null); // 分类速览弹窗（hook 必须在 early return 之前）
  if (!snapshot?.layers?.length) return null;
  const layers = snapshot.layers;
  const need = layers.filter((layer) => layer.needDistill);
  const pending = snapshot.pendingDistill;
  const groups = snapshot.lessonGroups ?? [];
  /** 层 → 真实路径。L5/L6/L7 的路径不在 paths 里（卷宗/存档/碎片池），返回 null 不显示定位按钮。 */
  const pathOf = (layerId: string): string | null => {
    const paths = snapshot.paths;
    if (!paths) return null;
    if (layerId === "L0") return paths.user;
    if (layerId === "L1") return paths.project;
    if (layerId === "L2") return paths.lessons;
    if (layerId === "L3") return paths.background;
    if (layerId === "L4") return paths.logDir;
    return null;
  };
  return (
    <div className="memory-pyramid">
      <div className="memory-pyramid-head">
        <div className="memory-pyramid-title">
          <span className="memory-pyramid-icon"><Layers3 size={15} /></span>
          <div>
            <strong>记忆金字塔</strong>
            <span>L0–L7 八层，满 90% 往下沉一层。点任一层跳到它的编辑器 / 条目。</span>
          </div>
        </div>
        <div className="memory-pyramid-badges">
          {need.length > 0 && <span className="memory-pyramid-alert"><AlertTriangle size={12} />{need.length} 层已达蒸馏线</span>}
          {pending.dates.length > 0 && <span className="memory-pyramid-pending">待蒸馏 {pending.dates.length} 天 · {pending.chars} 字</span>}
        </div>
      </div>

      <ol className="memory-pyramid-layers">
        {layers.map((layer) => {
          const pct = layer.ratio === null ? null : Math.round(layer.ratio * 100);
          const width = pct === null ? 0 : Math.min(100, pct);
          return (
            <li key={layer.id} className={`memory-pyramid-layer${layer.needDistill ? " need-distill" : ""}`}>
              <button
                className="memory-pyramid-row"
                onClick={() => onJump(layer.id)}
                title={`${layer.where}\n写入：${layer.writer}\n满 90% → ${layer.sink}`}
              >
                <span className="memory-pyramid-id">{layer.id}</span>
                <span className="memory-pyramid-name">{layer.name}</span>
                <span className="memory-pyramid-bar">
                  <span className={`memory-pyramid-bar-fill${layer.needDistill ? " hot" : ""}`} style={{ width: `${width}%` }} />
                  <span className="memory-pyramid-line" />
                </span>
                <span className="memory-pyramid-pct">{pct === null ? "—" : `${pct}%`}</span>
                <span className="memory-pyramid-usage">{layer.budget ? `${layer.used}/${layer.budget}` : `${layer.used} 字`}</span>
                <ChevronRight size={13} className="memory-pyramid-go" />
              </button>
              <span className="memory-pyramid-flow"><ArrowDown size={11} />满 90% → {layer.sink}{onReveal && pathOf(layer.id) && <button className="memory-pyramid-reveal" title={pathOf(layer.id) || ""} onClick={() => onReveal(pathOf(layer.id) as string)}><FolderOpen size={11} />定位文件</button>}</span>
            </li>
          );
        })}
      </ol>

      {groups.length > 0 && (
        <div className="memory-pyramid-groups">
          <span className="memory-pyramid-groups-label">L2 纪律与记忆 · 按分类（点开就地速览，不跳页）</span>
          <div className="memory-pyramid-group-cards">
            {groups.map((group) => (
              <button key={group.category} className="memory-pyramid-group-card" onClick={() => setPreviewCategory(group.category)} title={`在记忆条目里筛出「${group.category}」`}>
                <strong>{group.count}</strong>
                <span>{group.category}</span>
                <small>{group.chars} 字</small>
              </button>
            ))}
          </div>
        </div>
      )}

      {need.length > 0 && (
        <div className="memory-pyramid-actions">
          <button className="primary-setting" disabled={distilling} onClick={onDistill}>
            {distilling ? <Spinner /> : <Sparkles size={14} />}
            立即蒸馏（{need.map((layer) => layer.id).join(" / ")} 已达线）
          </button>
        </div>
      )}
      {previewCategory && (
        <MemoryCategoryModal
          category={previewCategory}
          records={(records ?? []).filter((entry) => entry.category === previewCategory)}
          onClose={() => setPreviewCategory(null)}
          onOpenThread={onOpenThread}
        />
      )}
    </div>
  );
}

/** 常驻记忆注入预览（09-23 新增）：把 `memory:layers:context` 的真实输出摊开给用户看。
 *  此前前端从不调它 ⇒ 用户看不到「这一轮到底往模型里塞了什么」，只能靠猜。
 *  分节展示 + 字数 + 超预算提示 + 一键复制。 */
export function MemoryInjectPreview({ workspace }: { workspace?: string }) {
  const [data, setData] = useState<{ text: string; stats: { chars: number; over: boolean } } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    void window.codex.readMemoryContext(workspace || undefined, true)
      .then((result) => { if (!cancelled) setData(result); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [workspace]);

  const reload = () => {
    setBusy(true);
    void window.codex.readMemoryContext(workspace || undefined, true)
      .then((result) => setData(result))
      .catch(() => setData(null))
      .finally(() => setBusy(false));
  };

  const text = data?.text ?? "";
  const chars = data?.stats.chars ?? 0;

  return (
    <div className="memory-inject">
      <div className="memory-inject-head">
        <div className="memory-inject-title">
          <span className="memory-inject-icon"><Eye size={15} /></span>
          <div>
            <strong>常驻记忆预览</strong>
            <span>这就是每轮对话真正注入模型的那段文本（含工作区层）。</span>
          </div>
        </div>
        <div className="memory-inject-stats">
          <span>{chars} 字</span>
          {data?.stats.over && <span className="memory-budget-warn">超预算</span>}
          <button className="secondary-setting" disabled={busy} onClick={reload} title="重新读取"><RefreshCw size={13} /></button>
          {!!text && <button className="secondary-setting" onClick={() => setOpen((value) => !value)}>{open ? "收起" : "展开全文"}</button>}
          {!!text && (
            <button
              className="secondary-setting"
              onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }).catch(() => undefined); }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "已复制" : "复制"}
            </button>
          )}
        </div>
      </div>
      {busy && !text && <p className="memory-inject-empty">正在读取…</p>}
      {!busy && !text && <p className="memory-inject-empty">暂无常驻记忆（先选一个工作区，或在下方写入用户档案 / 项目背景）。</p>}
      {!!text && <pre className={`memory-inject-body${open ? " open" : ""}`}>{text}</pre>}
    </div>
  );
}

/** 分类速览弹窗（09-23 加，用户要求）：点 L2 分类卡片**就地**看该类全部条目 —— 不跳走、不用一条条点开。
 *  与「记忆库」的分工：这里只按分类聚一次、内容直接铺开，用于快速通读某一类。 */
export function MemoryCategoryModal({ category, records, onClose, onOpenThread }: {
  category: string;
  records: MemoryRecord[];
  onClose: () => void;
  onOpenThread?: (threadId: string) => void;
}) {
  const chars = records.reduce((sum, entry) => sum + (entry.content?.length ?? 0), 0);
  return createPortal(
    <div className="modal-backdrop memory-category-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="memory-category-modal" role="dialog" aria-modal="true" aria-label={`${category} 速览`}>
        <header className="memory-category-head">
          <div>
            <strong>{category}</strong>
            <span>{records.length} 条 · 共 {chars} 字 · 内容全部展开</span>
          </div>
          <button className="icon-button" title="关闭" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="memory-category-body">
          {!records.length && <p className="memory-category-empty">这一类暂时没有条目。</p>}
          {records.map((entry) => (
            <article key={entry.id} className="memory-category-item">
              <div className="memory-category-item-head">
                {(entry as any).pinned && <span className="memory-pin-badge" title="核心记忆，不被自动清理">★ 核心</span>}
                {entry.workspace && <span className="memory-ws-badge" title={entry.workspace}>{entry.workspace.split(/[\\/]/).filter(Boolean).pop()}</span>}
                <span className="memory-card-time" title={new Date(entry.updatedAt).toLocaleString()}>{new Date(entry.updatedAt).toLocaleString()}</span>
                {entry.sourceThreadId && onOpenThread && (
                  <button className="secondary-setting" title="打开产生这条记忆的会话" onClick={() => onOpenThread(entry.sourceThreadId as string)}><MessageSquare size={12} />源会话</button>
                )}
              </div>
              <p className="memory-category-content">{entry.content}</p>
            </article>
          ))}
        </div>
      </section>
    </div>,
    document.body,
  );
}