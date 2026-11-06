/**
 * 团队模式 · 群设置
 *
 * ⛔⛔ 11-06 重写（用户：「界面太丑了，功能都看不懂，上下级这些…外部是什么」）：
 *   上一版有三个**空壳区块**，是照着飞书/豆包的词抄来的，在我们这里没有对应语义：
 *     · 「群护栏 / 协作范围 / 允许外部成员加入 / 响应 @所有人」
 *       —— 外部 = **跨租户/外部群**（飞书逆向第 30、96 行）、@所有人 = 飞书群的 @all。
 *          本应用没有租户、没有 @所有人 这个动作 ⇒ 这两条永远是常量，改了什么都不会发生。
 *     · 「上下级」—— 豆包里它是**伙伴之间**的委派白名单（主 agent 派给下级）；
 *          我们只有"人 @ 伙伴"，伙伴之间不互相派活 ⇒ 这一块纯粹是装饰。
 *   ⇒ 全删。换成两块**真会生效**的：
 *     · 群记忆：写进去的背景，每次派活拼在用户那句话前面注入给伙伴（豆包 baseline.md 的群级等价物）
 *     · 群文件：只存路径 + 说明，派活时把路径给伙伴，它们自己读（⛔ 不复制文件，避免过期副本）
 *   护栏字段仍留在数据里（兼容老文件 / 将来真做多租户），但**界面不再展示**。
 *
 * ⛔ 权限说明写文案，不用 disabled 表达归属（项目纪律：disabled 是准入，不是说明）。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { GroupSchedule, MemoryNote, MemoryNoteType, MenuPlacement, TeamFile, TeamGroup } from "./01-team-types";
import { LOCAL_ACTOR_ID } from "./02-team-store";
import { AlarmClock, BarChart3, BookOpen, FolderOpen, GitBranch, Play, Puzzle, Trash2, Users } from "lucide-react";
import { addMenuLeaf, flattenMenu, normalizeMenu, removeMenuLeaf, DEFAULT_GROUP_MENU } from "../../lib/team-menu.mjs";
import {
  MAX_GROUP_SCHEDULES,
  MAX_SCHEDULE_PROMPT_CHARS,
  SCHEDULE_KIND_LABELS,
  WEEKDAY_LABELS,
  describeSchedule,
  formatNextRun,
  removeSchedule,
  scheduleBlockers,
  toggleSchedule,
} from "../../lib/team-schedule.mjs";
import { formatChars, formatMs, formatTokens, LEDGER_SOURCE_LABELS } from "../../lib/team-ledger.mjs";
import type { LedgerSummary } from "./02-team-store";
import { AppSelect } from "../../components/AppSelect";

type Props = {
  group: TeamGroup;
  /** 体检提示（含"还没有伙伴"这类建议，只在这里展示） */
  issues?: string[];
  limit: number;
  onAddPartner: (partner: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  onRemovePartner: (partnerId: string) => Promise<{ ok: boolean; error?: string }>;
  onMute: (partnerId: string, muted: boolean) => Promise<{ ok: boolean; error?: string }>;
  onSetManager: (memberId: string, managerId: string) => Promise<{ ok: boolean; error?: string }>;
  onSetMemory: (text: string) => Promise<{ ok: boolean; error?: string }>;
  onSetFiles: (files: TeamFile[]) => Promise<{ ok: boolean; error?: string }>;
  /** 解散群（只删群与群日志；伙伴的子会话不动） */
  onDeleteGroup?: () => Promise<{ ok: boolean; error?: string }>;
  /** 记忆条目（带 type + origin） */
  onAddNote: (note: { text: string; type: MemoryNoteType }) => Promise<{ ok: boolean; error?: string }>;
  onRemoveNote: (noteId: string) => Promise<{ ok: boolean; error?: string }>;
  /** 快捷指令菜单（整份替换） */
  onSaveMenu: (items: unknown[]) => Promise<{ ok: boolean; error?: string }>;
  /** 菜单形态（飞书 INPUT_FIRST / FLOAT） */
  onSaveMenuPlacement: (placement: MenuPlacement) => Promise<{ ok: boolean; error?: string }>;
  /** 定时任务（整组替换；nextRunAt 由主进程算） */
  onSaveSchedules: (list: unknown[]) => Promise<{ ok: boolean; error?: string }>;
  /** 立刻运行一条定时任务 */
  onRunSchedule: (scheduleId: string) => Promise<{ ok: boolean; error?: string; sent?: number }>;
  /** 用量汇总（为空 = 还没拉过） */
  ledger?: LedgerSummary | null;
  onLoadLedger: (days: number) => void;
};

/** 调度目标的一条（与 `listDispatchCatalog()` 的返回一致；这里只声明用得到的字段）。 */
type Target = { kind: string; key: string; name: string; profession?: string; teamId?: string; installed?: boolean };

/**
 * 这类目标派活要「专家团」许可（主进程 `dispatchKindAllowed`：team/member 同一把闸）。
 * ⛔⛔ 11-06 实测：全仓**没有任何 UI 会写 `dispatch.team`**（`dispatchAllowOf` 只读会话配置，
 *   而应用里没有那个开关）⇒ 选进来也永远派不出去。所以**不再列为可选项**，
 *   老群里已经存在的这类伙伴标红说明「不可派」，并给出可操作建议（换成「专家」）。
 *   ⛔ 别把「去顶栏打开专家团」写进文案 —— 那个开关不存在，等于让用户找空气。
 */
const needsTeamGate = (kind: string) => kind === "member" || kind === "team";

/** 能进群当伙伴的类别：只有**默认就允许**的三类（expert / subagent / cli）。 */
const PICKABLE = new Set(["expert", "subagent", "cli"]);

const KIND_LABEL: Record<string, string> = {
  member: "专家团成员",
  expert: "专家",
  team: "专家团",
  subagent: "子智能体",
  cli: "本机 CLI",
};

const MEMORY_MAX = 4000;
const FILES_MAX = 20;
const NOTES_MAX = 40;

/** 记忆类型（与 `MEMORY_TYPE_LABELS` 同源，⛔ 别两处各写一套文案） */
const NOTE_TYPES: Array<{ value: MemoryNoteType; label: string; hint: string }> = [
  { value: "constraint", label: "约束", hint: "必须遵守的硬规矩（金额含税、只按出库算…）" },
  { value: "fact", label: "事实", hint: "已确认的结论（口径、数据来源…）" },
  { value: "runbook", label: "做法", hint: "下次照这个步骤做" },
];
const NOTE_TYPE_LABEL: Record<string, string> = { constraint: "约束", fact: "事实", runbook: "做法" };
const fmtDay = (at: number) => {
  if (!at) return "";
  const d = new Date(at);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const fileNameOf = (path: string) => path.split(/[\\/]/).pop() || path;

export function TeamSettings({ group, issues, limit, onAddPartner, onRemovePartner, onMute, onSetManager, onSetMemory, onSetFiles, onDeleteGroup, onAddNote, onRemoveNote, onSaveMenu, onSaveMenuPlacement, onSaveSchedules, onRunSchedule, ledger, onLoadLedger }: Props) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  /* 群记忆 / 群文件：本地草稿 + 脏标记（保存才落盘，避免每敲一个字就写文件） */
  const [memoryDraft, setMemoryDraft] = useState(group.memory ?? "");
  const [filesDraft, setFilesDraft] = useState<TeamFile[]>(group.files ?? []);

  /* 记忆条目（豆包 §2.②）：一条一个结论 + 类型 + 来源，与上面的"群简介"分开 */
  const [noteText, setNoteText] = useState("");
  const [noteType, setNoteType] = useState<MemoryNoteType>("fact");
  /* 快捷指令：新加一条自定义 */
  const [cmdLabel, setCmdLabel] = useState("");
  const [cmdPrompt, setCmdPrompt] = useState("");
  /* 用量窗口（天） */
  const [ledgerDays, setLedgerDays] = useState(7);
  /* 定时任务草稿（豆包 §③）：频率/时间/派给谁，提交时整组替换 */
  const [schedName, setSchedName] = useState("");
  const [schedPrompt, setSchedPrompt] = useState("");
  const [schedTargets, setSchedTargets] = useState<string[]>([]);
  const [schedKind, setSchedKind] = useState<"interval" | "daily" | "weekly" | "once">("daily");
  const [schedTime, setSchedTime] = useState("09:00");
  const [schedDays, setSchedDays] = useState<number[]>([1]);
  const [schedAt, setSchedAt] = useState("");

  const partners = group.members.filter((m) => m.kind === "bot");
  const notes: MemoryNote[] = group.memoryNotes ?? [];
  /** 菜单摊平（界面里按"分组 → 项"展示；删除按 key） */
  const menuLeaves = flattenMenu(group.menu ?? []);

  /* 只在**切群**时把草稿同步回该群的真实值。
     ⛔⛔ 不能把 group.memory / group.files 放进依赖：群里点一下「静音」也会让 apply() 换掉
       group 对象 ⇒ effect 重跑 ⇒ 正在编辑的群记忆/文件清单被清回旧值（用户打一半的字直接没）。
       用 id 卡住"是否换了群"，依赖仍写全（eslint 诚实），但只在换群时真正重置。 */
  const draftGroupRef = useRef(group.id);
  useEffect(() => {
    if (draftGroupRef.current === group.id) return;
    draftGroupRef.current = group.id;
    setMemoryDraft(group.memory ?? "");
    setFilesDraft(group.files ?? []);
    setMsg("");
    setDone("");
    setConfirmDelete(false);
    setNoteText("");
    setCmdLabel("");
    setCmdPrompt("");
    setSchedName("");
    setSchedPrompt("");
    setSchedTargets([]);
  }, [group.id, group.memory, group.files]);

  const memoryDirty = memoryDraft.trim() !== String(group.memory ?? "").trim();
  const filesDirty = JSON.stringify(filesDraft) !== JSON.stringify(group.files ?? []);

  /* ⛔ 伙伴**必须**是真实调度目标：手打出来的名字派不了活。
     ⇒ 这里拉一次 `agents:catalog`（与模型自己派活用的是同一份清单，⛔ 不另建一套池子）。 */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await window.codex.listDispatchCatalog();
        if (!alive) return;
        const list = Array.isArray(res?.targets) ? (res.targets as Target[]) : [];
        setTargets(list.filter((t) => t && t.kind && t.name && t.installed !== false));
        setCatalogError("");
      } catch (err) {
        if (alive) setCatalogError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { alive = false; };
  }, []);

  /** 已经在这个群里的目标不重复列（按 目标身份 判，不按显示名） */
  const options = useMemo(() => {
    const taken = new Set(partners.map((p) => `${p.targetKind}:${p.targetKey}`));
    return targets
      .map((t, index) => ({ index, t }))
      .filter(({ t }) => !taken.has(`${t.kind}:${t.key}`))
      /* ⛔ 只列默认可派的类别（见 PICKABLE 注释）：列进来却派不出去 = 骗用户 */
      .filter(({ t }) => PICKABLE.has(t.kind))
      .map(({ index, t }) => ({
        value: String(index),
        label: `${KIND_LABEL[t.kind] ?? t.kind} · ${t.name}${t.profession ? `（${t.profession}）` : ""}`,
      }));
  }, [targets, partners]);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, okText = "") => {
    setBusy(true);
    setMsg("");
    setDone("");
    const r = await fn();
    if (r.ok) setDone(okText);
    else setMsg(r.error || "操作失败");
    setBusy(false);
    return r;
  };

  const addPartner = async () => {
    const target = targets[Number(pick)];
    if (!target) return;
    await run(async () => {
      /* ⛔ id 由目标身份决定：同一目标加两次会被纯函数判重复（幂等），不会出现两个「数据师」 */
      const r = await onAddPartner({
        id: `tgt:${target.kind}:${target.key}`,
        kind: "bot",
        name: target.name,
        targetKind: target.kind,
        targetKey: target.key,
        /* ⛔ 角色（profession）必须一起存：群里只显示名字就分不清谁是谁（飞书/豆包都有身份栏） */
        targetProfession: target.profession ?? "",
      });
      if (r.ok) setPick("");
      return r;
    }, "已加入");
  };

  /** 记一条记忆（类型 + 正文；来源由主进程补 `origin`） */
  const addNote = async () => {
    const t = noteText.trim();
    if (!t) return;
    await run(async () => {
      const r = await onAddNote({ text: t, type: noteType });
      if (r.ok) setNoteText("");
      return r;
    }, "已记住 —— 下次派活就带上它");
  };

  /** 菜单：加/删都即时落盘（菜单是一屏能看完的树，⛔ 不做草稿再保存） */
  const addCommand = async () => {
    if (!cmdLabel.trim() || !cmdPrompt.trim()) return;
    const next = addMenuLeaf(group.menu ?? [], { label: cmdLabel, prompt: cmdPrompt });
    await run(async () => {
      const r = await onSaveMenu(next);
      if (r.ok) { setCmdLabel(""); setCmdPrompt(""); }
      return r;
    }, "指令已加");
  };

  const dropCommand = async (key: string) => {
    await run(() => onSaveMenu(removeMenuLeaf(group.menu ?? [], key)), "已删除");
  };

  const resetCommands = async () => {
    await run(() => onSaveMenu([...DEFAULT_GROUP_MENU] as unknown[]), "已恢复默认指令");
  };

  /* ── 定时任务（豆包 §③ 自动化定时）────────────────────────────────────────
     ⛔ 落盘一律走整组替换；`nextRunAt` 由主进程算，这里只负责把"哪天、几点、派给谁"传上去。 */
  const schedules: GroupSchedule[] = group.schedules ?? [];

  const addSchedule = async () => {
    const prompt = schedPrompt.trim();
    if (!prompt || !schedTargets.length) return;
    if (schedules.length >= MAX_GROUP_SCHEDULES) { setMsg(`最多 ${MAX_GROUP_SCHEDULES} 个定时任务`); return; }
    const entry: GroupSchedule = {
      id: `sched_${Date.now().toString(36)}`,
      name: schedName.trim() || prompt.slice(0, 20),
      prompt,
      memberIds: schedTargets,
      kind: schedKind,
      timeOfDay: schedTime,
      weekdays: schedKind === "weekly" ? schedDays : [],
      scheduleType: schedKind === "once" ? "once" : "recurring",
      scheduledAt: schedKind === "once" ? schedAt : "",
      enabled: true,
      nextRunAt: null,
      createdAt: Date.now(),
    };
    await run(async () => {
      const r = await onSaveSchedules([...schedules, entry]);
      if (r.ok) {
        setSchedName("");
        setSchedPrompt("");
        setSchedTargets([]);
      }
      return r;
    }, "定时任务已建 —— 到点它会自己在群里派这一句");
  };

  const dropSchedule = async (id: string) => {
    await run(() => onSaveSchedules(removeSchedule(schedules, id)), "已删除定时任务");
  };

  const flipSchedule = async (id: string, enabled: boolean) => {
    await run(() => onSaveSchedules(toggleSchedule(schedules, id, enabled)), enabled ? "已启用" : "已停用");
  };

  const runScheduleNow = async (id: string) => {
    setBusy(true);
    setMsg("");
    setDone("");
    try {
      const r = await onRunSchedule(id);
      if (r.ok) setDone(`已立刻跑一次${typeof r.sent === "number" ? `（派给 ${r.sent} 个伙伴）` : ""} —— 产出会出现在群聊里`);
      else setMsg(r.error || "运行失败");
    } finally {
      setBusy(false);
    }
  };

  const chooseFiles = async () => {
    try {
      const picked = await window.codex.chooseFiles();
      if (!picked?.length) return;
      const at = Date.now();
      const added = picked
        .filter((path) => !filesDraft.some((f) => f.path === path))
        .map((path) => ({ path, name: fileNameOf(path), note: "", addedBy: LOCAL_ACTOR_ID, at }));
      if (!added.length) return;
      setFilesDraft((prev) => [...prev, ...added].slice(0, FILES_MAX));
      setDone("已加入清单，记得点「保存清单」");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="team-settings">
      {/* ── 伙伴 ───────────────────────────────────────────────────────── */}
      <section className="team-settings__block">
        <h3>
          <Users size={14} className="ic-blue" />
          伙伴 <span className="team-settings__count">{partners.length} / {limit}</span>
        </h3>
        <p className="team-settings__hint">
          伙伴就是 @ 一声就能派活的智能体。<strong>@ 谁，活就落到谁自己的会话里</strong>，这里只是把它们的回复摆在一起。
        </p>
        <ul className="team-settings__list">
          {partners.map((p) => (
            <li key={p.id} className="team-settings__row">
              <span className="team-settings__avatar" aria-hidden>{p.name.slice(0, 1)}</span>
              <span className="team-settings__name">
                <span className="team-settings__name-text" title={p.name}>{p.name}</span>
                {p.id === group.leadId && <em className="team-settings__tag">群主</em>}
                {p.muted && <em className="team-settings__tag team-settings__tag--muted">已静音</em>}
                {p.targetKind
                  ? (
                    <em
                      className={`team-settings__tag${needsTeamGate(p.targetKind) ? " team-settings__tag--warn" : ""}`}
                      title={needsTeamGate(p.targetKind) ? "专家团成员/团要「专家团」许可，应用目前没有这个开关 ⇒ 派不出去。建议移除后改加「专家」。" : undefined}
                    >
                      {KIND_LABEL[p.targetKind] ?? p.targetKind}
                      {needsTeamGate(p.targetKind) ? " ·不可派" : ""}
                    </em>
                  )
                  : <em className="team-settings__tag team-settings__tag--warn" title="手打的名字没有对应的智能体，派不了活">未绑定</em>}
              </span>
              <button type="button" className="team-settings__mini" onClick={() => void run(() => onMute(p.id, !p.muted))} disabled={busy}>
                {p.muted ? "取消静音" : "静音"}
              </button>
              <button type="button" className="team-settings__mini team-settings__mini--danger" onClick={() => void run(() => onRemovePartner(p.id), "已移除")} disabled={busy}>
                移除
              </button>
            </li>
          ))}
          {!partners.length && <li className="team-settings__empty">还没有伙伴 —— 下面从智能体列表里加一个</li>}
        </ul>
        <div className="team-settings__add">
          {options.length ? (
            <AppSelect
              value={pick}
              onChange={setPick}
              options={[{ value: "", label: "选一个智能体…" }, ...options]}
              ariaLabel="选择要加入的智能体"
              disabled={busy || partners.length >= limit}
            />
          ) : (
            <span className="team-settings__empty">
              {catalogError ? `读不到智能体清单：${catalogError}` : "没有可加的智能体（先在专家团 / 子智能体里建一个）"}
            </span>
          )}
          <button type="button" onClick={() => void addPartner()} disabled={busy || !pick || partners.length >= limit}>
            添加伙伴
          </button>
        </div>
        {partners.length >= limit && <p className="team-settings__hint">已达上限（最多 {limit} 个伙伴）</p>}
        <p className="team-settings__hint">
          能加的只有<strong>开箱可派</strong>的三类：专家、子智能体、本机 CLI。
          <strong>专家团成员 / 专家团</strong>需要「专家团」许可，而应用目前还没有提供这个开关，
          所以先不列出来（选了也派不出去）。
        </p>
      </section>

      {/* ── 上下级（豆包 managerId）：真生效 —— 派活时会把这个伙伴的上级/可派对象写进 prompt ── */}
      <section className="team-settings__block">
        <h3>
          <GitBranch size={14} className="ic-green" />
          谁向谁汇报
          <span className="team-settings__count">{partners.filter((p) => p.managerId).length} 已设</span>
        </h3>
        <p className="team-settings__hint">
          给伙伴选一个<strong>上级</strong>。派活时会把这段关系交给它 ——
          它就能把子任务派给下级（走既有的调度闸），汇报关系写进 prompt，不只是画个图。
        </p>
        <ul className="team-settings__list">
          {partners.map((p) => (
            <li key={p.id} className="team-settings__row">
              <span className="team-settings__avatar" aria-hidden>{p.name.slice(0, 1)}</span>
              <span className="team-settings__name">
                <span className="team-settings__name-text" title={p.name}>{p.name}</span>
                {p.targetProfession && <em className="team-settings__tag">{p.targetProfession}</em>}
              </span>
              <span className="team-settings__meta">上级</span>
              {/* ⛔ 下拉必须放进**固定宽度**的槽里：`.app-select-trigger` 是 `width:100%`，
                  直接当 flex 子项会吃光整行 ⇒ 名字被压到 0 宽，中文一字一行（11-06 用户截图）。 */}
              <span className="team-settings__select">
                <AppSelect
                  value={p.managerId}
                  onChange={(value) => void run(() => onSetManager(p.id, value), value ? "汇报关系已保存" : "已清掉上级")}
                  options={[
                    { value: "", label: "（无）" },
                    ...partners.filter((x) => x.id !== p.id).map((x) => ({ value: x.id, label: x.name })),
                  ]}
                  ariaLabel={`${p.name} 的上级`}
                  disabled={busy}
                />
              </span>
            </li>
          ))}
          {!partners.length && <li className="team-settings__empty">先加伙伴，再设汇报关系</li>}
        </ul>
      </section>

      {/* ── 群记忆 ─────────────────────────────────────────────────────── */}
      <section className="team-settings__block">
        <h3>
          <BookOpen size={14} className="ic-violet" />
          群记忆
          <span className="team-settings__count">{memoryDraft.trim() ? `${memoryDraft.trim().length} 字` : "空"}</span>
        </h3>
        <p className="team-settings__hint">
          写这里的背景（<strong>这个群负责什么、有哪些口径和约定</strong>）会在<strong>每次派活时带给伙伴</strong>。
          这是群共享的，和伙伴自己的记忆分开。
        </p>
        <textarea
          className="team-settings__memory"
          value={memoryDraft}
          onChange={(e) => setMemoryDraft(e.target.value.slice(0, MEMORY_MAX))}
          placeholder={"例：这个群只做「苏泊尔智慧厨房」门店周报。\n口径：销量按出库算，不按订单算；金额一律含税。"}
          rows={5}
          aria-label="群记忆"
        />
        <div className="team-settings__savebar">
          <span className="team-settings__meta">{memoryDraft.length} / {MEMORY_MAX}</span>
          <button
            type="button"
            className="team-settings__mini"
            onClick={() => void run(() => onSetMemory(memoryDraft), "群记忆已保存 —— 下次派活就带上")}
            disabled={busy || !memoryDirty}
          >
            保存群记忆
          </button>
        </div>

        {/* ├ 记忆条目：一条一个结论 + 类型 + 来源（豆包 §2.② 的 `type` / `origin`） */}
        <div className="team-settings__sub">
          <h4 className="team-settings__subhead">
            记忆条目
            <span className="team-settings__count">{notes.length} / {NOTES_MAX}</span>
          </h4>
          <p className="team-settings__hint">
            一条写<strong>一个结论</strong>，带类型和来源。派活时按「约束 → 做法 → 事实」注入，
            和你自己的推断冲突时，以这里为准（这是硬规矩，不是建议）。
          </p>
          <ul className="team-settings__notes">
            {notes.map((n) => (
              <li key={n.id} className={`team-settings__note is-${n.type}`}>
                <em className="team-settings__note-type">{NOTE_TYPE_LABEL[n.type] ?? n.type}</em>
                <span className="team-settings__note-text">{n.text}</span>
                <small
                  className="team-settings__note-origin"
                  title={`来源：${n.origin?.actorId || "?"}${n.origin?.threadId ? ` · 会话 ${n.origin.threadId}` : ""}`}
                >
                  {n.origin?.actorId === LOCAL_ACTOR_ID ? "我" : (n.origin?.actorId || "?")} · {fmtDay(n.at)}
                </small>
                <button
                  type="button"
                  className="team-settings__mini team-settings__mini--danger"
                  onClick={() => void run(() => onRemoveNote(n.id), "已删除")}
                  disabled={busy}
                >
                  删
                </button>
              </li>
            ))}
            {!notes.length && <li className="team-settings__empty">还没有记忆条目 —— 把「这个群认定的结论」记一条</li>}
          </ul>
          <div className="team-settings__add">
            <span className="team-settings__select is-narrow">
              <AppSelect
                value={noteType}
                onChange={(v) => setNoteType(v as MemoryNoteType)}
                options={NOTE_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                ariaLabel="记忆类型"
                disabled={busy || notes.length >= NOTES_MAX}
              />
            </span>
            <input
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="一条结论或约定，如：金额一律含税"
              onKeyDown={(e) => { if (e.key === "Enter") void addNote(); }}
              aria-label="记忆内容"
              disabled={busy || notes.length >= NOTES_MAX}
            />
            <button type="button" onClick={() => void addNote()} disabled={busy || !noteText.trim() || notes.length >= NOTES_MAX}>
              记住
            </button>
          </div>
          {notes.length >= NOTES_MAX && <p className="team-settings__hint">已到上限（{NOTES_MAX} 条）—— 删掉过时的再加</p>}
        </div>
      </section>

      {/* ── 群文件 ─────────────────────────────────────────────────────── */}
      <section className="team-settings__block">
        <h3>
          <FolderOpen size={14} className="ic-amber" />
          群文件
          <span className="team-settings__count">{filesDraft.length} / {FILES_MAX}</span>
        </h3>
        <p className="team-settings__hint">
          放这个群的<strong>参考资料</strong>（表格、文档都行）。只记<strong>本机路径</strong>、不复制文件，
          派活时把路径交给伙伴，它们自己按路径读 —— 所以文件改了不用重新加。
        </p>
        <ul className="team-settings__list">
          {filesDraft.map((f, index) => (
            <li key={f.path} className="team-settings__file">
              <span className="team-settings__file-main">
                <strong>{f.name}</strong>
                <small title={f.path}>{f.path}</small>
              </span>
              <input
                className="team-settings__file-note"
                value={f.note}
                placeholder="说明（可选，如：上周销量）"
                onChange={(e) => {
                  const next = [...filesDraft];
                  next[index] = { ...f, note: e.target.value };
                  setFilesDraft(next);
                }}
                aria-label={`${f.name} 的说明`}
              />
              <button
                type="button"
                className="team-settings__mini team-settings__mini--danger"
                onClick={() => setFilesDraft(filesDraft.filter((x) => x.path !== f.path))}
              >
                移除
              </button>
            </li>
          ))}
          {!filesDraft.length && <li className="team-settings__empty">还没有参考资料</li>}
        </ul>
        <div className="team-settings__savebar">
          <button type="button" className="team-settings__mini" onClick={() => void chooseFiles()} disabled={filesDraft.length >= FILES_MAX}>
            选择文件…
          </button>
          <button
            type="button"
            className="team-settings__mini"
            onClick={() => void run(() => onSetFiles(filesDraft), "文件清单已保存 —— 下次派活就带上")}
            disabled={busy || !filesDirty}
          >
            保存清单
          </button>
        </div>
      </section>

      {/* ── 快捷指令（飞书 §3：`ChatBotMenu` 菜单树 + TriggerMenuEvent）────────── */}
      <section className="team-settings__block">
        <h3>
          <Puzzle size={14} className="ic-green" />
          快捷指令
          <span className="team-settings__count">{menuLeaves.length} 条</span>
        </h3>
        <p className="team-settings__hint">
          那个「指令」按钮里就是这些。<strong>点一项只把指令填进输入框</strong>，
          你确认后再发 —— 不是替你偷偷派活。
        </p>
        {/* 飞书 §3 的两种展示：INPUT_FIRST（贴输入框）/ FLOAT（悬浮面板） */}
        <div className="team-settings__inline-row">
          <span className="team-settings__hint team-settings__hint--inline">
            展示形态{group.menuPlacement === "float" ? "：按钮浮在群视图右下，面板可滚动、分组横向展开" : "：按钮在 @ 行，面板向上弹"}
          </span>
          <div className="team-settings__seg" role="group" aria-label="菜单展示形态">
            {([["input", "贴输入框"], ["float", "悬浮面板"]] as Array<[MenuPlacement, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`team-settings__seg-btn${(group.menuPlacement ?? "input") === value ? " is-on" : ""}`}
                aria-pressed={(group.menuPlacement ?? "input") === value}
                onClick={() => void run(() => onSaveMenuPlacement(value), `已切换为「${label}」`)}
                disabled={busy}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <ul className="team-settings__menu">
          {normalizeMenu(group.menu ?? []).map((g) => (
            <li key={g.key} className="team-settings__menu-group">
              <strong className="team-settings__menu-groupname">{g.label}</strong>
              <ul>
                {(g.children.length ? g.children : [g]).map((c) => (
                  <li key={c.key} className="team-settings__menu-item">
                    <span className="team-settings__menu-label">{c.label}</span>
                    <small className="team-settings__menu-prompt" title={c.prompt}>{c.prompt}</small>
                    <button
                      type="button"
                      className="team-settings__mini team-settings__mini--danger"
                      onClick={() => void dropCommand(c.key)}
                      disabled={busy}
                    >
                      删
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {!menuLeaves.length && <li className="team-settings__empty">还没有指令 —— 加一条，或恢复默认</li>}
        </ul>
        <div className="team-settings__add">
          <input
            className="team-settings__cmd-label"
            value={cmdLabel}
            onChange={(e) => setCmdLabel(e.target.value)}
            placeholder="名称（如：查库存）"
            maxLength={24}
            aria-label="指令名称"
            disabled={busy}
          />
          <input
            value={cmdPrompt}
            onChange={(e) => setCmdPrompt(e.target.value)}
            placeholder="点下去填进输入框的那句话"
            aria-label="指令内容"
            disabled={busy}
          />
          <button type="button" onClick={() => void addCommand()} disabled={busy || !cmdLabel.trim() || !cmdPrompt.trim()}>
            添加
          </button>
        </div>
        <div className="team-settings__savebar">
          <button type="button" className="team-settings__mini" onClick={() => void resetCommands()} disabled={busy}>
            恢复默认指令
          </button>
        </div>
      </section>

      {/* ── 定时任务（豆包 §③「自动化定时任务」：prompt 里写死收件人）──────────── */}
      <section className="team-settings__block">
        <h3>
          <AlarmClock size={14} className="ic-amber" />
          定时任务
          <span className="team-settings__count">{schedules.length}/{MAX_GROUP_SCHEDULES}</span>
        </h3>
        <p className="team-settings__hint">
          到点它<strong>自己把这句话派给选中的伙伴</strong> —— 走的是和 @ 完全同一条链路
          （真实子会话 + 群消息 + 账本里记「自动化」）。<strong>停用 ≠ 删除</strong>：停用后任务还在，只是不再触发。
          <br />
          「下次」与设定时刻可能差几分钟：引擎按任务 id <strong>错峰打散</strong>，避免所有任务同一秒一起打上游。
        </p>
        <ul className="team-settings__sched">
          {schedules.map((s) => {
            const blockers = scheduleBlockers(group, s);
            const names = s.memberIds.map((id) => partners.find((p) => p.id === id)?.name ?? id).join("、");
            return (
              <li key={s.id} className={`team-settings__sched-row${s.enabled ? "" : " is-off"}`}>
                <span className="team-settings__sched-main">
                  <strong>{s.name}</strong>
                  <small>
                    {describeSchedule(s)} · 派给 {names || "（没人）"}
                    {s.enabled ? ` · 下次 ${formatNextRun(s.nextRunAt, Date.now())}` : " · 已停用"}
                  </small>
                  {blockers.length > 0 && <em className="team-settings__sched-warn">{blockers.join("；")}</em>}
                  {s.lastError && <em className="team-settings__sched-warn">上次失败：{s.lastError}</em>}
                </span>
                <span className="team-settings__sched-acts">
                  <button type="button" className="team-settings__mini" onClick={() => void flipSchedule(s.id, !s.enabled)} disabled={busy}>
                    {s.enabled ? "停用" : "启用"}
                  </button>
                  <button type="button" className="team-settings__mini" onClick={() => void runScheduleNow(s.id)} disabled={busy}>
                    <Play size={11} /> 跑一次
                  </button>
                  <button type="button" className="team-settings__mini team-settings__mini--danger" onClick={() => void dropSchedule(s.id)} disabled={busy}>
                    删
                  </button>
                </span>
              </li>
            );
          })}
          {!schedules.length && <li className="team-settings__empty">还没有定时任务</li>}
        </ul>

        <div className="team-settings__add">
          <input
            className="team-settings__cmd-label"
            value={schedName}
            onChange={(e) => setSchedName(e.target.value)}
            placeholder="名称（如：早间简报）"
            maxLength={20}
            aria-label="定时任务名称"
            disabled={busy}
          />
          <input
            value={schedPrompt}
            onChange={(e) => setSchedPrompt(e.target.value)}
            placeholder="到点派给伙伴的那句话"
            maxLength={MAX_SCHEDULE_PROMPT_CHARS}
            aria-label="定时任务指令"
            disabled={busy}
          />
        </div>
        <div className="team-settings__sched-controls">
          <div className="team-settings__chips" role="group" aria-label="派给谁">
            {partners.map((p) => {
              const on = schedTargets.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`team-settings__chip${on ? " is-on" : ""}${p.muted ? " is-muted" : ""}`}
                  aria-pressed={on}
                  onClick={() => setSchedTargets((prev) => (on ? prev.filter((x) => x !== p.id) : [...prev, p.id]))}
                  disabled={busy || p.muted}
                  title={p.muted ? "已静音：到点也不会跑，先在伙伴列表里取消静音" : `派给 ${p.name}`}
                >
                  @{p.name}
                </button>
              );
            })}
            {!partners.length && <span className="team-settings__empty">先加伙伴</span>}
          </div>
          <span className="team-settings__select">
            <AppSelect
              value={schedKind}
              onChange={(v) => setSchedKind(v as typeof schedKind)}
              options={(["interval", "daily", "weekly", "once"] as const).map((k) => ({ value: k, label: SCHEDULE_KIND_LABELS[k] }))}
              ariaLabel="频率"
              disabled={busy}
            />
          </span>
          {(schedKind === "daily" || schedKind === "weekly") && (
            <input
              type="time"
              className="team-settings__time"
              value={schedTime}
              onChange={(e) => setSchedTime(e.target.value)}
              aria-label="时间"
              disabled={busy}
            />
          )}
          {schedKind === "weekly" && (
            <div className="team-settings__chips" role="group" aria-label="星期几">
              {WEEKDAY_LABELS.map((label, day) => {
                const on = schedDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    className={`team-settings__chip${on ? " is-on" : ""}`}
                    aria-pressed={on}
                    onClick={() => setSchedDays((prev) => (on ? prev.filter((x) => x !== day) : [...prev, day].sort((a, b) => a - b)))}
                    disabled={busy}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
          {schedKind === "once" && (
            <input
              type="datetime-local"
              className="team-settings__time"
              value={schedAt}
              onChange={(e) => setSchedAt(e.target.value)}
              aria-label="运行时刻"
              disabled={busy}
            />
          )}
          <button
            type="button"
            onClick={() => void addSchedule()}
            disabled={busy || !schedPrompt.trim() || !schedTargets.length || (schedKind === "once" && !schedAt)}
          >
            加一条
          </button>
        </div>
      </section>

      {/* ── 用量（豆包 §2.④：维度是 (agent, 触发来源)，不是 (用户)）──────────── */}
      <section className="team-settings__block">
        <h3>
          <BarChart3 size={14} className="ic-blue" />
          用量
          <span className="team-settings__count">{ledger ? `${ledger.total.count} 次` : "—"}</span>
        </h3>
        <p className="team-settings__hint">
          按<strong>（伙伴、触发来源）</strong>两个维度拆 —— 这是「一开始就记、事后补不回来」的那张表。
          <strong>token 是引擎报的真实值</strong>（每轮 `last` 桶）；没拿到时显示「—」，⛔ 不拿字符数冒充。
        </p>
        <div className="team-settings__inline-row">
          <span className="team-settings__select">
            <AppSelect
              value={String(ledgerDays)}
              onChange={(v) => { const d = Number(v) || 7; setLedgerDays(d); onLoadLedger(d); }}
              options={[{ value: "7", label: "近 7 天" }, { value: "30", label: "近 30 天" }, { value: "0", label: "全部" }]}
              ariaLabel="统计窗口"
              disabled={busy}
            />
          </span>
          <button type="button" className="team-settings__mini" onClick={() => onLoadLedger(ledgerDays)} disabled={busy}>
            刷新
          </button>
        </div>
        {ledger && ledger.total.count > 0 ? (
          <>
            <div className="team-settings__stats">
              <span><strong>{ledger.total.count}</strong> 次派活</span>
              <span><strong>{formatTokens(ledger.total.totalTokens)}</strong> tok</span>
              <span>入 <strong>{formatTokens(ledger.total.inputTokens)}</strong> · 出 <strong>{formatTokens(ledger.total.outputTokens)}</strong></span>
              <span>均 <strong>{formatMs(ledger.total.avgMs)}</strong></span>
              {ledger.total.failed > 0 && <span className="is-warn"><strong>{ledger.total.failed}</strong> 次失败</span>}
            </div>
            <ul className="team-settings__usage">
              {ledger.byPartner.map((p) => {
                /* 条形按 token 排（更接近真实成本）；老账本没有 token 时退回字数 */
                const useTok = ledger.total.totalTokens > 0;
                const basis = (x: typeof p) => (useTok ? x.totalTokens : x.chars);
                const max = Math.max(1, basis(ledger.byPartner[0]));
                return (
                  <li key={p.memberId}>
                    <span className="team-settings__usage-name">{p.name}</span>
                    <span className="team-settings__usage-bar"><i style={{ width: `${Math.max(4, Math.round((basis(p) / max) * 100))}%` }} /></span>
                    <span className="team-settings__usage-num" title={`${p.count} 次 · ${formatChars(p.chars)} 字 · ${formatMs(p.avgMs)}`}>
                      {p.count} 次 · {formatTokens(p.totalTokens)} tok · {formatMs(p.avgMs)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="team-settings__sources">
              {ledger.bySource.map((x) => (
                <em key={x.source}>{LEDGER_SOURCE_LABELS[x.source] ?? x.source} · {x.count}</em>
              ))}
            </div>
          </>
        ) : (
          <p className="team-settings__empty">{ledger ? "这段时间还没有派活记录" : "点「刷新」看用量"}</p>
        )}
      </section>

      {/* ── 体检（只在真有问题时出现；"还没有伙伴"这类建议也写在这里，但语气是建议） ── */}
      {issues && issues.length > 0 && (
        <section className="team-settings__block">
          <h3><Users size={14} className="ic-cyan" />这个群还差什么</h3>
          <ul className="team-settings__issues">
            {issues.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </section>
      )}

      {/* ── 解散群 ─────────────────────────────────────────────────────── */}
      {onDeleteGroup && (
        <section className="team-settings__block team-settings__block--danger">
          <h3><Trash2 size={14} className="ic-pink" />解散这个群</h3>
          {/* ⛔ 说明与按钮**同一行**（用户：「这么大空白干嘛」+「删除键右边去」）：
              以前说明单独一行、按钮另起一行右对齐，中间留一大块空。 */}
          <div className="team-settings__inline-row">
            <span className="team-settings__hint team-settings__hint--inline">
              只删群和群里的消息记录；<strong>伙伴的会话一条都不会动</strong>。
            </span>
            {confirmDelete ? (
              <>
                <span className="team-settings__meta">确定解散「{group.name}」？</span>
                <button type="button" className="team-settings__mini" onClick={() => setConfirmDelete(false)} disabled={busy}>取消</button>
                <button
                  type="button"
                  className="team-settings__mini team-settings__mini--danger"
                  onClick={() => void run(() => onDeleteGroup())}
                  disabled={busy}
                >
                  确认解散
                </button>
              </>
            ) : (
              <button type="button" className="team-settings__mini team-settings__mini--danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
                解散群
              </button>
            )}
          </div>
        </section>
      )}

      {done && <p className="team-settings__done" role="status">{done}</p>}
      {msg && <p className="team-settings__error" role="status">{msg}</p>}
    </div>
  );
}
