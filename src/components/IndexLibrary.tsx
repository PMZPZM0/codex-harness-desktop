import { useMemo, useState } from "react";
import { Archive, Bot, ChevronDown, Clock3, ExternalLink, Inbox, MessagesSquare, Search, Zap } from "lucide-react";
import { cleanThreadDisplayTitle } from "../lib/user-refs";
import { SearchField } from "./SettingsWidgets";

export type IndexThread = { id: string; title?: string | null; preview?: string | null; updatedAt?: number; turnCount?: number; archived?: boolean };
export type IndexMemory = { id: string; category: string; content: string; sourceThreadId?: string; createdAt?: number };
export type IndexTask = { id: string; name?: string; title?: string; prompt?: string; enabled?: boolean; schedule?: string };
export type IndexSkill = { name: string; description?: string };

/** 搜索结果命中项：点开即「预览全文」，预览弹窗底部再提供跳转到管理位置 */
export type SearchPreviewTarget =
  | { kind: "thread"; id: string; title: string; updatedAt?: number }
  | { kind: "memory"; id: string; category: string; content: string; sourceThreadId?: string; createdAt?: number }
  | { kind: "task"; id: string; name: string; prompt: string; schedule?: string; enabled?: boolean }
  | { kind: "skill"; name: string; description?: string };

type Hit = {
  key: string;
  kind: SearchPreviewTarget["kind"];
  title: string;
  summary: string;
  meta: string;
  target: SearchPreviewTarget;
};

type SessionGroup = {
  key: string;
  kind: "session" | "orphan" | "other";
  title: string;
  sub: string;
  threadId?: string;
  updatedAt: number;
  hits: Hit[];
};

function ago(value?: number) {
  if (!value) return "";
  const ms = value > 1e12 ? value : value * 1000;
  const minutes = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return new Date(ms).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function kindIcon(kind: Hit["kind"]) {
  return kind === "thread" ? <MessagesSquare size={14} /> : kind === "memory" ? <Archive size={14} /> : kind === "task" ? <Clock3 size={14} /> : <Bot size={14} />;
}

/**
 * 全局搜索（记忆中心内「搜索」视图）：关键词检索会话 / 记忆 / 定时任务 / 技能，
 * 命中结果按所属会话折叠分组，点任一条目弹出全文预览（会话全文由主进程读 rollout 提供）。
 * 只读视窗——不做任何存储与重建；无会话归属的条目收进「未关联」区。
 */
export function GlobalSearchView({
  threads,
  memories,
  tasks,
  skills = [],
  onPreview,
  onOpenThread,
  onOpenSettings,
}: {
  threads: IndexThread[];
  memories: IndexMemory[];
  tasks: IndexTask[];
  skills?: IndexSkill[];
  onPreview: (target: SearchPreviewTarget) => void;
  onOpenThread: (id: string) => void;
  onOpenSettings: (page: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const counts = {
    threads: threads.length,
    memories: memories.length,
    tasks: tasks.length,
    skills: skills.length,
  };

  const groups = useMemo<SessionGroup[]>(() => {
    const keyword = query.trim().toLowerCase();
    const groups = new Map<string, SessionGroup>();
    const touch = (group: SessionGroup) => {
      const existing = groups.get(group.key);
      if (!existing) groups.set(group.key, group);
      return groups.get(group.key)!;
    };
    const match = (...parts: (string | null | undefined)[]) => !keyword || parts.some((part) => (part ?? "").toLowerCase().includes(keyword));

    if (keyword) {
      const threadById = new Map(threads.map((entry) => [String(entry.id).toLowerCase(), entry]));
      for (const thread of threads) {
        if (!match(thread.title, thread.preview)) continue;
        const displayTitle = cleanThreadDisplayTitle(thread.title, { preview: thread.preview });
        const target: SearchPreviewTarget = { kind: "thread", id: thread.id, title: displayTitle, updatedAt: thread.updatedAt };
        touch({
          key: `session:${thread.id}`, kind: "session", title: displayTitle,
          sub: [thread.turnCount ? `${thread.turnCount} 个回合` : "", ago(thread.updatedAt), thread.archived ? "已归档" : ""].filter(Boolean).join(" · "),
          threadId: thread.id, updatedAt: thread.updatedAt ?? 0, hits: [],
        }).hits.push({
          key: `thread-${thread.id}`,
          kind: "thread",
          title: displayTitle,
          summary: thread.preview ?? "",
          meta: `整个会话 · ${thread.turnCount ? `${thread.turnCount} 回合` : ""} · ${ago(thread.updatedAt)}`,
          target,
        });
      }
      for (const entry of memories) {
        if (!match(entry.content, entry.category)) continue;
        const firstLine = entry.content.split("\n")[0].trim();
        const target: SearchPreviewTarget = { kind: "memory", id: entry.id, category: entry.category, content: entry.content, sourceThreadId: entry.sourceThreadId, createdAt: entry.createdAt };
        const sourceId = entry.sourceThreadId?.toLowerCase();
        const owner = sourceId ? threadById.get(sourceId) : undefined;
        const groupKey = owner ? `session:${owner.id}` : sourceId ? `orphan:${sourceId}` : "other";
        const hit: Hit = {
          key: `memory-${entry.id}`,
          kind: "memory",
          title: firstLine.slice(0, 80) || "(空记忆)",
          summary: entry.content.length > 80 ? entry.content.slice(80) : "",
          meta: `${entry.category || "未分类"} · ${owner ? "来自该会话" : entry.sourceThreadId ? `来自会话 ${entry.sourceThreadId.slice(0, 8)}` : "手动保存"}`,
          target,
        };
        if (owner) {
          touch({
            key: groupKey, kind: "session", title: cleanThreadDisplayTitle(owner.title, { preview: owner.preview }),
            sub: [owner.turnCount ? `${owner.turnCount} 个回合` : "", ago(owner.updatedAt)].filter(Boolean).join(" · "),
            threadId: owner.id, updatedAt: owner.updatedAt ?? 0, hits: [],
          }).hits.push(hit);
        } else if (entry.sourceThreadId) {
          touch({
            key: groupKey, kind: "orphan", title: `会话 ${entry.sourceThreadId.slice(0, 8)}`,
            sub: "不在当前侧栏列表，点击预览可看来自它的记忆", updatedAt: entry.createdAt ?? 0, hits: [],
          }).hits.push(hit);
        } else {
          touch({ key: "other", kind: "other", title: "未关联内容", sub: "手动保存的记忆、定时任务与技能", updatedAt: 0, hits: [] }).hits.push(hit);
        }
      }
      for (const task of tasks) {
        const name = (task.name ?? task.title ?? "").trim();
        if (!match(name, task.prompt)) continue;
        touch({ key: "other", kind: "other", title: "未关联内容", sub: "手动保存的记忆、定时任务与技能", updatedAt: 0, hits: [] }).hits.push({
          key: `task-${task.id}`,
          kind: "task",
          title: name || "未命名任务",
          summary: task.prompt ?? "",
          meta: [task.schedule ?? "", task.enabled === false ? "已停用" : "已启用"].filter(Boolean).join(" · "),
          target: { kind: "task", id: task.id, name: name || "未命名任务", prompt: task.prompt ?? "", schedule: task.schedule, enabled: task.enabled },
        });
      }
      for (const skill of skills) {
        if (!match(skill.name, skill.description)) continue;
        touch({ key: "other", kind: "other", title: "未关联内容", sub: "手动保存的记忆、定时任务与技能", updatedAt: 0, hits: [] }).hits.push({
          key: `skill-${skill.name}`,
          kind: "skill",
          title: skill.name,
          summary: skill.description ?? "",
          meta: "已安装技能",
          target: { kind: "skill", name: skill.name, description: skill.description },
        });
      }
    }

    const ordered: SessionGroup[] = [...groups.values()];
    ordered.sort((a, b) => {
      if (a.kind === "other" || b.kind === "other") return a.kind === "other" ? 1 : -1;
      return b.updatedAt - a.updatedAt;
    });
    return ordered.slice(0, 40);
  }, [query, threads, memories, tasks, skills]);

  const hitsCount = groups.reduce((sum, group) => sum + group.hits.length, 0);

  return (
    <div className="memory-center-pane" style={{ gap: 12 }}>
      <div className="memory-center-block">
        <div className="memory-center-block-head">
          <div>
            <strong>全局搜索</strong>
            <span>一次检索会话、记忆、定时任务与技能；结果按所属会话折叠成组，无来源的收进「未关联」。点任意命中条目即可预览全文——会话全文直接读原档，不影响当前对话。</span>
          </div>
        </div>
        <div className="index-search-head">
          <SearchField value={query} onChange={setQuery} placeholder="输入关键词，按会话分组显示命中…" width={320} />
          <div className="index-search-counts">
            <span><MessagesSquare size={12} />{counts.threads} 会话</span>
            <span><Archive size={12} />{counts.memories} 记忆</span>
            <span><Clock3 size={12} />{counts.tasks} 任务</span>
            <span><Zap size={12} />{counts.skills} 技能</span>
          </div>
        </div>
      </div>

      {!query.trim() && (
        <div className="index-empty">
          <Search size={22} />
          <strong>输入关键词开始检索</strong>
          <p>可以搜会话标题与摘要、记忆正文、定时任务名与技能名；结果会按所属会话折叠成组，点命中条目即可预览全文。</p>
        </div>
      )}

      {query.trim() && !groups.length && (
        <div className="index-empty">
          <Inbox size={22} />
          <strong>没有匹配的内容</strong>
          <p>换个关键词试试——会话标题、记忆正文、任务名与技能名都能搜。</p>
        </div>
      )}

      <div className="index-group-list">
        {groups.map((group) => {
          const isCollapsed = collapsed[group.key] === true;
          const groupIcon = group.kind === "other" ? <Inbox size={13} /> : <MessagesSquare size={13} />;
          return (
            <section className={`index-group index-group-${group.kind}`} key={group.key}>
              <div className="index-group-head" role="button" tabIndex={0} onClick={() => setCollapsed((current) => ({ ...current, [group.key]: !isCollapsed }))} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setCollapsed((current) => ({ ...current, [group.key]: !isCollapsed })); } }}>
                <ChevronDown size={14} className={`index-group-chevron ${isCollapsed ? "collapsed" : ""}`} />
                <span className="index-group-icon">{groupIcon}</span>
                <strong className="index-group-title">{group.title}</strong>
                {group.kind === "session" && group.threadId && (
                  <button className="icon-button index-group-open" title="打开该会话继续对话" onClick={(event) => { event.stopPropagation(); onOpenThread(group.threadId!); }}>
                    <ExternalLink size={13} />
                  </button>
                )}
                <span className="index-group-sub">{group.sub}</span>
                <span className="index-group-count">{group.hits.length} 条命中</span>
              </div>
              {!isCollapsed && (
                <div className="index-group-body">
                  {group.hits.map((hit) => (
                    <button type="button" className={`index-result index-result-${hit.kind}`} key={hit.key} onClick={() => onPreview(hit.target)} title="预览全文">
                      <span className="index-result-icon">{kindIcon(hit.kind)}</span>
                      <span className="index-result-body">
                        <strong>{hit.title}</strong>
                        {hit.summary ? <small>{hit.summary}</small> : null}
                      </span>
                      <span className="index-result-meta">
                        <span className="index-result-kind">{hit.kind === "thread" ? "会话" : hit.kind === "memory" ? "记忆" : hit.kind === "task" ? "任务" : "技能"}</span>
                        {hit.meta}
                      </span>
                    </button>
                  ))}
                  {group.kind === "session" && group.threadId && !group.hits.some((hit) => hit.kind === "thread") && (
                    <div className="index-group-foot">
                      会话本身没命中关键词？<button type="button" onClick={() => onOpenThread(group.threadId!)}>打开会话看全部</button>
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {query.trim() && groups.length > 0 && (
        <p className="index-result-total">
          共 {groups.length} 组 · {hitsCount} 条命中（最多显示前 40 组）；任务与技能的管理入口在{""}
          <button type="button" className="linkish" onClick={() => onOpenSettings("schedule")}>自动化</button>
          {""}与{""}
          <button type="button" className="linkish" onClick={() => onOpenSettings("skills")}>技能</button>
        </p>
      )}
    </div>
  );
}
