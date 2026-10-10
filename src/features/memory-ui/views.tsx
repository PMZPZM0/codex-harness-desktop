/**
 * memory-ui —— **七类记忆的差异化视图**（10-05 用户要求「各类记忆应有各自差异化的
 * 信息结构与交互方式，如层级展示、卡片/时间线、标签体系、状态标识」）。
 *
 * ── 每类为什么用不同的结构（都是被数据形状逼出来的，不是为了花哨）──────────
 * ① 金字塔   → **层级树 + 水位条**：它本质是 7 层有容量上下文的栈，⛔ 平铺成列表
 *              就丢掉了"哪层快满了"这个唯一有用的信息。
 * ② 本地 MCP → **状态卡**：⛔ 它不是一种记忆内容，是"记忆存在哪"的后端开关 ⇒
 *              界面必须如实这么显示，⛔ 硬画成记忆列表 = 骗用户。
 * ③ 主会话   → **私有卡片流**：一个执行体一份，最简单的形态。
 * ④ 子智能体 → **身份卡 + 私有记忆**：子智能体数量多 ⇒ 身份识别比内容更重要。
 * ⑤ 专家     → **身份卡 + 私有记忆**：同上，但强调"这位专家是谁"。
 * ⑥ 专家团   → **成员矩阵 + 团内共享**：⛔ 团内记忆的可见范围**等于成员名单**
 *              ⇒ 必须把成员和记忆并排显示，用户才看得出"谁能读到"。
 * ⑦ 被调度   → **时间线**：调度是**有先后的过程**（派发→运行→产出）⇒ 时间线
 *              比表格更贴合；且要能点进去看那次派出的产出。
 */
import { useMemo, useState } from "react";
import {
  Activity, Brain, CheckCircle2, CircleSlash, Clock, Cpu, FolderTree, Gauge, Plug,
  Sparkles, Star, TriangleAlert, User, Users, Zap,
} from "lucide-react";
import {
  MemoryBadge, MemoryList, MemorySection, MemoryState, MemoryTag, MemoryTime, MemoryWeight,
} from "./primitives";
import { SCOPE_META, type ActorMemory, type DispatchedSession, type McpBackendMemory, type PyramidMemory } from "./types";

/* ══ ① 金字塔记忆：层级树 + 水位 ═══════════════════════════════════════ */

export function PyramidView({ data }: { data: PyramidMemory }) {
  /* ⛔⛔ 三重防御：① data ② layers ③ archive 各自独立兜底。
     上午那次白屏就是 `data.archive.files` —— 字段在契约里写着，主进程却没返回。
     ⛔ 一处 `?.` 只能挡住一层；这里每层都挡，是因为"缺字段 ⇒ 整页白屏"的
     代价（用户只看到"界面发生错误"）远大于多写三行。 */
  const layers = Array.isArray(data?.layers) ? data.layers : [];
  const archive = data?.archive ?? { files: 0, bytes: 0 };
  return (
    <MemorySection
      title="金字塔记忆"
      hint="七层结构 · 越靠下越稳定，满了会提示蒸馏"
      icon={<Gauge size={14} />}
      stat={[
        { label: "层", value: layers.length },
        { label: "需蒸馏", value: layers.filter((l) => l.needDistill).length, hint: "水位到 90% 的层" },
        { label: "归档", value: archive.files, hint: `${(archive.bytes / 1024).toFixed(1)} KB` },
      ]}
    >
      <ol className="mui-pyramid">
        {layers.map((layer) => (
          <li key={layer.id} className={`mui-pyramid-row${layer.needDistill ? " is-hot" : ""}`}>
            <div className="mui-pyramid-head">
              <span className="mui-pyramid-id">{layer.id}</span>
              <span className="mui-pyramid-name">{layer.name}</span>
              {layer.needDistill && <MemoryBadge tone="warn">该蒸馏了</MemoryBadge>}
              <span className="mui-pyramid-usage">
                {layer.ratio == null ? "未测量" : `${Math.round(layer.ratio * 100)}%`}
              </span>
            </div>
            {/* ⛔ 水位条：⛔ 无测量值时不画空条（画一条空的会被读成"用量 0"） */}
            <div className="mui-pyramid-bar" role="img" aria-label={`${layer.name} 水位 ${layer.ratio == null ? "未测量" : Math.round(layer.ratio * 100) + "%"}`}>
              {layer.ratio != null && (
                <i
                  className={layer.ratio >= 0.9 ? "is-hot" : layer.ratio >= 0.7 ? "is-warm" : ""}
                  style={{ width: `${Math.min(100, Math.round(layer.ratio * 100))}%` }}
                />
              )}
            </div>
            <dl className="mui-pyramid-meta">
              <div><dt>存哪</dt><dd>{layer.where}</dd></div>
              <div><dt>谁写</dt><dd>{layer.writer}</dd></div>
              <div><dt>满了会怎样</dt><dd>{layer.sink}</dd></div>
            </dl>
          </li>
        ))}
      </ol>
    </MemorySection>
  );
}

/* ══ ② 本地 MCP 记忆：后端状态卡（⛔ 如实反映"它是开关不是内容"）═══════ */

export function McpBackendView({ data, state, error, onRetry }: {
  data: McpBackendMemory; state: "idle" | "loading" | "ready" | "error"; error?: string; onRetry?: () => void;
}) {
  const on = data?.active === "mcp";
  /* ⛔ 字段兜底同 PyramidView：`connector`/`sinkLabel` 是 10-05 上午凭空造的字段名，
     主进程一个都没返回 ⇒ 界面上是空白。宁可显示"未标注"也不能崩。 */
  const connector = data?.connector || "未标注";
  const sinkLabel = data?.sinkLabel || (on ? "MCP 记忆服务" : "内置记忆金字塔");
  return (
    <MemorySection
      title="本地 MCP 记忆"
      hint="这不是另一份记忆，而是「记忆存在哪」的后端开关"
      icon={<Plug size={14} />}
      stat={[{ label: "生效后端", value: on ? "MCP" : "内置" }]}
    >
      <MemoryState state={state} error={error} onRetry={onRetry}
        empty="还没读到后端状态" emptyHint="后端状态由主进程持有，切到设置 → 记忆里查看。" />
      {state === "ready" && data && (
        <div className={`mcp-card ${on ? "is-on" : "is-off"}`}>
          <div className="mcp-card-head">
            {/* ⛔ 状态用「图标 + 文字」双编码 */}
            {on ? <CheckCircle2 size={15} /> : <CircleSlash size={15} />}
            <strong>{on ? "记忆走 MCP" : "记忆走内置金字塔"}</strong>
            <MemoryBadge tone={on ? "accent" : "neutral"}>{on ? "MCP 生效中" : "内置生效"}</MemoryBadge>
          </div>
          <p className="mcp-card-body">
            {on
              ? <>引擎通过连接器 <code>{connector}</code> 调用 MCP 记忆工具，写入不进金字塔文件。</>
              : <>连接器 <code>{connector}</code> 处于停用状态，引擎看不到它，写入照旧进金字塔。</>}
          </p>
          <dl className="mcp-card-meta">
            <div><dt>连接器</dt><dd><code>{connector}</code></dd></div>
            <div><dt>就绪</dt><dd>{data.ready ? "已就绪" : "未就绪"}</dd></div>
            <div><dt>记忆去向</dt><dd>{sinkLabel}</dd></div>
          </dl>
          {/* ⛔⛔ 选了 MCP 却回退内置时**必须说出来**：这是用户唯一能知道
              "我明明开了为什么没生效"的线索（09-25 定的口径：宁可回退也不丢记忆）。
              不显示 = 用户以为生效了，去排查一个不存在的问题。 */}
          {data.fallbackReason && (
            <p className="mcp-card-warn"><TriangleAlert size={12} />{data.fallbackReason}</p>
          )}
          {data.installCommand && !on && (
            <p className="mcp-card-note">
              装服务（在项目目录执行，用应用自带 node）：
              <code className="mcp-card-cmd">{data.installCommand}</code>
            </p>
          )}
          {/* ⛔ 明说"不会双份"：09-25 用户明确不要两份记忆，这里必须让他放心 */}
          <p className="mcp-card-note">同一时刻只有一个后端生效 —— 不会出现「两边都写、双份记忆」。</p>
        </div>
      )}
    </MemorySection>
  );
}

/* ══ ③④⑤ 私有记忆卡片流（主会话 / 子智能体 / 专家 共用，⛔ 标题与图标不同）══ */

export function ActorMemoryView({
  kind, data, state, error, onRetry, onOpenThread,
}: {
  kind: "main" | "subagent" | "expert";
  data: ActorMemory;
  state: "idle" | "loading" | "ready" | "error";
  error?: string;
  onRetry?: () => void;
  onOpenThread?: (threadId: string) => void;
}) {
  const META = {
    main: { title: "主会话记忆", hint: "只有你这个会话读得到 —— 派出去的智能体看不到", sessions: "会话来源：你这个会话 + 项目共享层（全体可见）", icon: <User size={14} />, empty: "这个会话还没有私有记忆" },
    subagent: { title: "子智能体记忆", hint: "每个子智能体一份，彼此互不可见", sessions: "会话来源：每个子智能体各自一个会话", icon: <Cpu size={14} />, empty: "还没有子智能体写下记忆" },
    expert: { title: "专家记忆", hint: "每位专家一份，彼此互不可见", sessions: "会话来源：每位专家自己的会话", icon: <Sparkles size={14} />, empty: "还没有专家写下记忆" },
  }[kind];

  const [scopeFilter, setScopeFilter] = useState<"all" | "private" | "team" | "project">("all");
  const entries = useMemo(
    () => (data?.entries ?? []).filter((e) => scopeFilter === "all" || e?.scope === scopeFilter),
    [data?.entries, scopeFilter],
  );
  /* ⛔ stats 同型防御：它由 statOf 产出、必有值，⛔ 但 `data` 若来自别处（未来加第八类时）
     漏了 stats 就是 `undefined.total` 白屏。归一化 + 这里 = 两道。 */
  const stats = data?.stats ?? { total: 0, pinned: 0, archived: 0, chars: 0 };

  /* ── 关联会话（10-10 新增需求）────────────────────────────────────────────
     「每个记忆分类下列出关联会话，可查看每个会话产生的记忆」= 层级
       **来源（本视图）→ 会话 → 记忆条目**。
     · 分组键：originThreadId（这条记忆是谁写的）优先，回退 sessionId（属于哪路会话）；
     · 排序：条目数降序 → 同数按最近更新降序（⛔ 排序规则写死在 UI 上要说明，见下面 hint）；
     · 交互：点会话 = 只看它产出的记忆（再点取消）；会话名右侧可跳回对话。 */
  const [sessionFilter, setSessionFilter] = useState("");
  const sessionGroups = useMemo(() => {
    const map = new Map();
    for (const e of data?.entries ?? []) {
      const id = String(e?.originThreadId || e?.sessionId || "");
      if (!id) continue;
      const row = map.get(id) ?? { id, count: 0, updatedAt: 0, pinned: 0 };
      row.count += 1;
      row.updatedAt = Math.max(row.updatedAt, Number(e?.updatedAt ?? 0));
      if (e?.pinned) row.pinned += 1;
      map.set(id, row);
    }
    return [...map.values()].sort((a, b) => b.count - a.count || b.updatedAt - a.updatedAt);
  }, [data?.entries]);
  const shortThread = (id: string) => (id.length > 24 ? id.slice(0, 12) + "…" + id.slice(-6) : id);
  /* 会话筛选后的可见条目（⛔ 空态判据也用它 —— 否则"筛出来的会话没有条目"时会同时
     显示空态与列表，10-05 探针抓到过同型问题）。 */
  const visible = useMemo(
    () => entries.filter((e) => !sessionFilter || String(e?.originThreadId || e?.sessionId || "") === sessionFilter),
    [entries, sessionFilter],
  );

  return (
    <MemorySection
      title={META.title}
      hint={META.hint}
      icon={META.icon}
      stat={data ? [
        { label: "条目", value: stats.total },
        { label: "钉住", value: stats.pinned, hint: "蒸馏与裁剪时永不删除" },
        { label: "已归档", value: stats.archived, hint: "内容保留但不再被读到" },
      ] : undefined}
      tools={
        <div className="mui-scope-filter" role="tablist" aria-label="按作用域筛选">
          {(["all", "private", "team", "project"] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={scopeFilter === s}
              className={`mui-chip${scopeFilter === s ? " is-on" : ""}`}
              onClick={() => setScopeFilter(s)}>
              {s === "all" ? "全部" : SCOPE_META[s].short}
            </button>
          ))}
        </div>
      }
    >
      {data && (
        <div className="mui-actor-strip">
          <span className="mui-actor-name">{data.actorName}</span>
          <code className="mui-actor-id" title="稳定 id —— 改名不会丢记忆">{data.actorId}</code>
          {/* ⛔ 名字必须说清这一块到底是什么：「项目共享层」被并进主会话区
              （它不属于任何执行体），⛔ 只写 actorId=project 会让人以为是某个会话的记忆。 */}
          {data.actorId === "project" && (
            <span className="mui-actor-note">这一块是项目共享层：所有会话与智能体都能读到它</span>
          )}
        </div>
      )}
      {/* ⛔⛔ 空态只在**真的没条目**时显示：state=ready 但 entries 非空时也显示它，
         会和下面的列表并存（探针抓到：标题说"还没有记忆"、下面列着 6 条）。 */}
      {/* 关联会话：这一类记忆**分别由哪些会话产出**（点了只看它） */}
      {state === "ready" && !!sessionGroups.length && (
        <div className="mui-sessions" data-count={sessionGroups.length}>
          <div className="mui-sessions-head">
            <span>关联会话 · {sessionGroups.length}</span>
            <span className="mui-sessions-hint">按条目数排序；点一个只看它写下的记忆</span>
          </div>
          <div className="mui-sessions-list">
            {sessionGroups.map((g) => (
              <div className={"mui-session" + (sessionFilter === g.id ? " is-on" : "")} key={g.id} data-session={g.id}>
                <button type="button" className="mui-session-main" title={g.id}
                  onClick={() => setSessionFilter(sessionFilter === g.id ? "" : g.id)}>
                  <span className="mui-session-name">{shortThread(g.id)}</span>
                  <span className="mui-session-meta">
                    {g.count} 条{g.pinned ? ` · 钉住 ${g.pinned}` : ""}
                    {g.updatedAt ? ` · 最后更新 ${new Date(g.updatedAt).toLocaleDateString("zh-CN")}` : ""}
                  </span>
                </button>
                {onOpenThread && (
                  <button type="button" className="mui-session-open" title="打开这个会话" onClick={() => onOpenThread(g.id)}>打开</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {state !== "ready" || !visible.length ? (
      <MemoryState
        state={state === "ready" ? "ready" : state} error={error} onRetry={onRetry}
        empty={META.empty}
        emptyHint={kind === "main" ? "在对话里说「记住这个」，或让助手自己判断什么值得记。" : "派它去干活，它自己决定什么值得记 —— 你不能手动添加。"}
      />
      ) : null}
      {state === "ready" && !!visible.length && (
        <MemoryList
          items={visible} estimateRow={92} keyOf={(e) => e.id}
          renderItem={(e) => <MemoryEntryRow entry={e} onOpenThread={onOpenThread} />}
        />
      )}
    </MemorySection>
  );
}

/** 记忆条目行：⛔ 三层信息层次 = 徽标行 / 正文 / 元信息行。 */
export function MemoryEntryRow({ entry, onOpenThread }: { entry: import("./types").MemoryEntry; onOpenThread?: (id: string) => void }) {
  /* ⛔ 同型防御：`SCOPE_META[entry.scope]` 在 scope 是后端新加的字面量时是 undefined
     ⇒ 下一行 `scope.label` 必崩。作用域枚举会扩，⛔ 视图不能假设它已经登记过。 */
  const scope = SCOPE_META[entry?.scope] ?? { label: "未知作用域", short: "未知", hint: "" };
  const archived = entry?.archivedAt != null;
  const agent = entry?.sourceAgent ?? { kind: "unknown", id: "", label: undefined };
  return (
    <article className={`mui-entry${archived ? " is-archived" : ""}`}>
      <div className="mui-entry-head">
        {/* ⛔ 作用域徽标 = 文字（⛔ 颜色只做辅助） */}
        <MemoryBadge tone={entry?.scope === "private" ? "neutral" : entry?.scope === "team" ? "accent" : "success"}>
          {scope.label}
        </MemoryBadge>
        <MemoryTag>{entry?.category ?? "未分类"}</MemoryTag>
        {entry?.pinned && <MemoryBadge tone="warn" title="蒸馏与裁剪时永不删除"><Star size={10} /> 钉住</MemoryBadge>}
        {archived && <MemoryBadge title="内容保留，但不再被模型读到">已归档</MemoryBadge>}
        <span className="mui-entry-spacer" />
        <MemoryWeight value={entry?.weight ?? 0} />
        <MemoryTime ts={entry?.createdAt ?? 0} />
      </div>
      <p className="mui-entry-content">{entry?.content ?? ""}</p>
      <div className="mui-entry-foot">
        <span className="mui-entry-source" title={`来源：${agent.label ?? agent.kind}（${agent.id}）`}>
          <Brain size={11} />{agent.label || agent.kind}
        </span>
        {entry?.scope !== "private" && entry?.sessionId && (
          <button type="button" className="mui-link" onClick={() => onOpenThread?.(entry.sessionId!)}>
            源会话 {entry.sessionId.slice(0, 8)}
          </button>
        )}
        {(entry?.useCount ?? 0) > 0 && <span className="mui-entry-used">被读到 {entry.useCount} 次</span>}
        {entry?.lastUsedAt != null && <MemoryTime ts={entry.lastUsedAt} prefix="最近" />}
      </div>
    </article>
  );
}

/* ══ ⑥ 专家团：成员矩阵 + 团内共享 ════════════════════════════════════ */

export function TeamMemoryView({
  data, state, error, onRetry, onOpenThread,
}: {
  data: import("./types").ActorMemory;
  state: "idle" | "loading" | "ready" | "error";
  error?: string;
  onRetry?: () => void;
  onOpenThread?: (id: string) => void;
}) {
  const teamEntries = useMemo(() => (data?.entries ?? []).filter((e) => e.scope === "team"), [data?.entries]);
  const otherEntries = useMemo(() => (data?.entries ?? []).filter((e) => e.scope !== "team"), [data?.entries]);

  return (
    <MemorySection
      title="专家团记忆"
      hint="团内成员互通，团外读不到"
      icon={<Users size={14} />}
      stat={data ? [
        { label: "成员", value: data.members?.length ?? 0 },
        { label: "团内记忆", value: teamEntries.length, hint: "同团成员都能读到" },
        { label: "其他", value: otherEntries.length },
      ] : undefined}
    >
      {/* ⛔⛔ 同 ActorMemoryView：⛔ 空态必须判"真的没条目" ——
          只看 state 会让"还没有专家团的记忆"和下面的 8 条并存（探针抓到）。 */}
      {state !== "ready" || !data?.entries.length ? (
        <MemoryState
          state={state === "ready" ? "ready" : state} error={error} onRetry={onRetry}
          empty="还没有专家团的记忆" emptyHint="派团去干活，成员之间会共享彼此的经验。"
        />
      ) : null}

      {state === "ready" && data && (
        <>
          {/* ⛔ 成员矩阵：团内记忆的可见范围**就是这个名单** ⇒ 必须并排显示 */}
          <div className="mui-team-members">
            <div className="mui-team-members-head">
              <Users size={13} />
              <span>团内成员</span>
              <small>下面这些{teamEntries.length} 条团内记忆，他们每个人都能读到</small>
            </div>
            <div className="mui-member-grid">
              {(data.members ?? []).map((m) => (
                <div key={m.id} className={`mui-member${m.running ? " is-running" : ""}`}>
                  <span className="mui-member-dot" aria-hidden />
                  <span className="mui-member-name">{m.name}</span>
                  {m.profession && <span className="mui-member-prof">{m.profession}</span>}
                  {m.running && <MemoryBadge tone="accent">运行中</MemoryBadge>}
                </div>
              ))}
              {!(data.members ?? []).length && <p className="mui-team-no-members">这个团还没有成员。</p>}
            </div>
          </div>

          {!!teamEntries.length && (
            <>
              <h4 className="mui-subhead"><Users size={12} />团内共享的记忆</h4>
              <MemoryList items={teamEntries} estimateRow={92} keyOf={(e) => e.id}
                renderItem={(e) => <MemoryEntryRow entry={e} onOpenThread={onOpenThread} />} />
            </>
          )}

          {!!otherEntries.length && (
            <>
              <h4 className="mui-subhead"><FolderTree size={12} />该团其它作用域的记忆</h4>
              <MemoryList items={otherEntries} estimateRow={92} keyOf={(e) => e.id}
                renderItem={(e) => <MemoryEntryRow entry={e} onOpenThread={onOpenThread} />} />
            </>
          )}
        </>
      )}
    </MemorySection>
  );
}

/* ══ ⑦ 被调度会话：时间线 ═════════════════════════════════════════════ */

export function DispatchedTimelineView({
  items, state, error, onRetry, onOpenThread,
}: {
  items: DispatchedSession[];
  state: "idle" | "loading" | "ready" | "error";
  error?: string;
  onRetry?: () => void;
  onOpenThread?: (id: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  /* ⛔⛔ `items` 曾经是 `undefined` 就直接 `.filter` ⇒ 必崩。上午那版把
     `listDelegates()` 的 `{records:[...]}` 当数组用，切到这个 tab 100% 白屏。
     归一化层已修根因，这里再挡一层：⛔ tab 切换不该让整页崩。 */
  const list = Array.isArray(items) ? items : [];
  const running = list.filter((i) => i?.status === "running").length;
  const failed = list.filter((i) => i?.status === "failed").length;

  const KIND_LABEL: Record<string, string> = {
    subagent: "子智能体", expert: "专家", team: "专家团", member: "团成员",
  };

  return (
    <MemorySection
      title="被调度会话"
      hint="每次派出的执行记录与产出 · 它们的记忆与主会话隔离"
      icon={<Activity size={14} />}
      stat={[
        { label: "总次数", value: list.length },
        { label: "运行中", value: running },
        ...(failed ? [{ label: "失败", value: failed }] : []),
      ]}
    >
      <MemoryState state={state} error={error} onRetry={onRetry} empty="还没有派出去过任务" emptyHint="在对话里说「派个专家去看看」，这里会留下它的执行记录。" />

      {state === "ready" && !!list.length && (
        <ol className="mui-timeline">
          {list.map((d) => {
            const open = openId === d.threadId;
            const dur = d.endedAt ? Math.max(0, d.endedAt - d.startedAt) : null;
            return (
              <li key={d.threadId} className={`mui-tl-item status-${d.status}`}>
                {/* ⛔ 时间线节点：状态用「图标 + 文字 + 颜色」三重编码 */}
                <span className="mui-tl-dot" aria-hidden>
                  {d.status === "running" ? <Zap size={11} />
                    : d.status === "failed" ? <TriangleAlert size={11} />
                    : <CheckCircle2 size={11} />}
                </span>
                <div className="mui-tl-card">
                  <button type="button" className="mui-tl-head" onClick={() => setOpenId(open ? null : d.threadId)}
                    aria-expanded={open}>
                    <span className="mui-tl-name">{d.name}</span>
                    <MemoryTag>{KIND_LABEL[d.dispatchKind] ?? d.dispatchKind}</MemoryTag>
                    <MemoryBadge tone={d.status === "running" ? "accent" : d.status === "failed" ? "danger" : "neutral"}>
                      {d.status === "running" ? "运行中" : d.status === "failed" ? "失败" : "已完成"}
                    </MemoryBadge>
                    {d.depth > 1 && <MemoryBadge tone="warn" title="被另一个被调度会话再次派出">嵌套 第 {d.depth} 层</MemoryBadge>}
                    {d.archived && <MemoryBadge>已归档</MemoryBadge>}
                    <span className="mui-tl-spacer" />
                    <span className="mui-tl-dur" title="从派发到结束">
                      <Clock size={11} />{dur == null ? "进行中" : dur < 1000 ? `${dur}ms` : `${(dur / 1000).toFixed(1)}s`}
                    </span>
                    <MemoryTime ts={d.startedAt} />
                  </button>
                  {open && (
                    <div className="mui-tl-body">
                      <dl className="mui-tl-meta">
                        <div><dt>发起方会话</dt><dd><code>{String(d.originThreadId ?? "未知").slice(0, 12)}</code></dd></div>
                        <div><dt>调度层级</dt><dd>第 {d.depth ?? 1} 层</dd></div>
                        <div><dt>它自己的记忆</dt><dd>{d.memoryCount ?? 0} 条<span className="mui-hint">（与你的会话隔离）</span></dd></div>
                        {d.error && <div><dt>失败原因</dt><dd className="is-error">{d.error}</dd></div>}
                      </dl>
                      {d.output ? (
                        <pre className="mui-tl-output">{d.output}</pre>
                      ) : (
                        <p className="mui-tl-nooutput">这次调度还没有产出。</p>
                      )}
                      <button type="button" className="mui-link" onClick={() => onOpenThread?.(d.threadId)}>
                        打开这个会话
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </MemorySection>
  );
}
