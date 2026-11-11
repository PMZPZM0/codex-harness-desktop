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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GroupSchedule, MemoryNote, MemoryNoteType, TeamFile, TeamGroup } from "./01-team-types";
import { LOCAL_ACTOR_ID } from "./02-team-store";
import { AlarmClock, AlignLeft, BookOpen, Columns2, FolderOpen, GitBranch, Inbox, ListChecks, MessagesSquare, Play, RefreshCw, Trash2, Users } from "lucide-react";
import { addModeStateOf, resolveManagerId } from "../../lib/team-models.mjs";
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
import { AppSelect } from "../../components/AppSelect";
import { MemberAvatar } from "./13-team-avatar";
import { FlowPreview, FormPreview, LayoutPreview, ReplyPreview } from "./26-team-settings-preview";

type Props = {
  group: TeamGroup;
  /** 体检提示（含"还没有伙伴"这类建议，只在这里展示） */
  issues?: string[];
  limit: number;
  onAddPartner: (partner: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  onRemovePartner: (partnerId: string) => Promise<{ ok: boolean; error?: string }>;
  onMute: (partnerId: string, muted: boolean) => Promise<{ ok: boolean; error?: string }>;
  onSetManager: (memberId: string, managerId: string) => Promise<{ ok: boolean; error?: string }>;
  /** 群管理员（11-09）：空串 = 取消。专家团群由主理人兜底，界面不给入口。 */
  onSetAdmin: (memberId: string) => Promise<{ ok: boolean; error?: string }>;
  onSetMemory: (text: string) => Promise<{ ok: boolean; error?: string }>;
  /** 项目地址（群的工作目录；空串 = 跟随应用默认） */
  onSetWorkspace: (workspace: string) => Promise<{ ok: boolean; error?: string }>;
  onSetFiles: (files: TeamFile[]) => Promise<{ ok: boolean; error?: string }>;
  /** 清空聊天记录（只清群日志；伙伴的子会话不动） */
  onClearMessages?: () => Promise<{ ok: boolean; error?: string; cleared?: number }>;
  /** 解散群（只删群与群日志；伙伴的子会话不动） */
  onDeleteGroup?: () => Promise<{ ok: boolean; error?: string }>;
  /** 记忆条目（带 type + origin） */
  onAddNote: (note: { text: string; type: MemoryNoteType }) => Promise<{ ok: boolean; error?: string }>;
  onRemoveNote: (noteId: string) => Promise<{ ok: boolean; error?: string }>;
  /** 定时任务（整组替换；nextRunAt 由主进程算） */
  onSaveSchedules: (list: unknown[]) => Promise<{ ok: boolean; error?: string }>;
  /** 立刻运行一条定时任务 */
  onRunSchedule: (scheduleId: string) => Promise<{ ok: boolean; error?: string; sent?: number }>;
};

/** 调度目标的一条（与 `listDispatchCatalog()` 的返回一致；这里只声明用得到的字段）。 */
type Target = { kind: string; key: string; name: string; profession?: string; teamId?: string; installed?: boolean };

/* ⛔└ 11-06 用户令：「新增专家团直接调度功能，三种模式：专家模式 / 专家团模式 /
   自定义专家模式，同步我们的后台，专家列表和专家团列表」。
   数据只认 `agents:catalog`（主进程 buildDispatchCatalog 实时读后台 expert-teams.json /
   sub-agents.json / CLI 配置），⛔ 不另建一套池子。
   三种模式 = 同一份目录按 kind 切视图；专家团直派的执行端许可已在 delegation.ts 对
   origin="" 的界面直派合并，⛔ 不再是「选了派不出去」。 */
type AddMode = "expert" | "team" | "custom";
const MODE_KINDS: Record<AddMode, Set<string>> = {
  /* ⛔ 11-08 用户令「专家不管什么时候都要能直接调用」：团成员也是**单个专家**，
     专家模式里一并列出（可只加这一位，不必把整团拉进群）。 */
  expert: new Set(["expert", "member"]),
  team: new Set(["team"]),
  custom: new Set(["subagent", "cli"]),
};
const MODE_LABEL: Record<AddMode, string> = {
  expert: "专家模式",
  team: "专家团模式",
  custom: "自定义专家模式",
};
const MODE_HINT: Record<AddMode, string> = {
  expert: "来自后台「专家中心」的单个专家，点名即派。",
  team: "来自后台「专家团」列表，整团按 SOP 协作；一次派活会拉起多名成员，注意用量。",
  custom: "你在后台自定义的子智能体与本机 CLI（可自建、可配模型与提示词）。",
};
const ADD_MODES: AddMode[] = ["expert", "team", "custom"];

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


/** 群设置 · 三个视图开关卡片（消息排版 / 回复模式 / 群消息形式）。
 *  ⛔ 11-08 用户实测「切起来很卡」：这三块原来和其余 6 个区块在同一个组件里 —— 点一次卡片
 *  就把整页（伙伴/记忆/文件/层级/定时/备注…）重渲染一遍。拆出来后其余区块用 memo 跳过。 */
export function TeamViewModeSettings({ messageLayout, onMessageLayout, replyMode, onReplyMode, messageForm, onMessageForm, dialogFlow, onDialogFlow }: {
  messageLayout: "split" | "left";
  onMessageLayout: (next: "split" | "left") => void;
  replyMode: "process" | "placeholder";
  onReplyMode: (next: "process" | "placeholder") => void;
  messageForm: "chat" | "topic";
  onMessageForm: (next: "chat" | "topic") => void;
  dialogFlow: "simple" | "detail";
  onDialogFlow: (next: "simple" | "detail") => void;
}) {
  return (
    <>
      {/* ── 常用置顶 1/8：layout ─────────────────────────── */}
      {/* ── 消息排版（11-07 用户令：消息左右选项，卡片展示 + 示例演示）────────── */}
      <section className="team-settings__block" data-section="layout">
        <h3>
          <Columns2 size={14} className="ic-blue" />
          消息排版
        </h3>
        <p className="team-settings__hint">
          左右分栏 = 伙伴靠左、你自己靠右；全部靠左 = 专业群聊（人和伙伴同一列）。
          <strong>点卡片立即生效</strong>，只影响这个群的消息列表。
        </p>
        <div className="team-settings__layout-cards" data-group="layout" role="radiogroup" aria-label="群消息排版">
          {([
            { value: "split", label: "左右分栏", desc: "伙伴靠左 · 自己靠右", Icon: Columns2 },
            { value: "left", label: "全部靠左", desc: "所有人同一列", Icon: AlignLeft },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={messageLayout === opt.value}
              className={`team-settings__layout-card${messageLayout === opt.value ? " is-on" : ""}`}
              onClick={() => onMessageLayout(opt.value)}
            >
              <LayoutPreview mode={opt.value} />
              <strong><opt.Icon size={12} />{opt.label}</strong>
              <small>{opt.desc}</small>
            </button>
          ))}
        </div>
        <p className="team-settings__hint team-settings__layout-current">
          当前：<strong>{messageLayout === "left" ? "全部靠左" : "左右分栏"}</strong> · 已保存到这个群（换设备也保留）
        </p>

        {/* ⛔⛔ 11-08 用户令：「做出来两种回复模式」+「在群设置里面加上这个选项」——
            两种模式**只影响"运行过程显不显示"**，产出在两种模式下都会正常上屏。 */}
        <h4 className="team-settings__sub-title">
          <MessagesSquare size={14} className="ic-violet" />
          回复模式
        </h4>
        <p className="team-settings__hint">
          过程模式：运行时展示运行过程（默认折叠，可展开）；占位模式：用户消息下面只挂「头像 + 名字 + 处理中」的小图标，产出出来再上屏。
          <strong>点卡片立即生效</strong>。
        </p>
        <div className="team-settings__layout-cards" data-group="reply" role="radiogroup" aria-label="群回复模式">
          {([
            { value: "process", label: "过程模式", desc: "运行中可展开看步骤", Icon: ListChecks },
            { value: "placeholder", label: "占位模式", desc: "只显示「头像+名字」", Icon: MessagesSquare },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={replyMode === opt.value}
              className={`team-settings__layout-card${replyMode === opt.value ? " is-on" : ""}`}
              onClick={() => onReplyMode(opt.value)}
            >
              <ReplyPreview mode={opt.value} />
              <strong><opt.Icon size={12} />{opt.label}</strong>
              <small>{opt.desc}</small>
            </button>
          ))}
        </div>
        <p className="team-settings__hint team-settings__layout-current">
          当前：<strong>{replyMode === "placeholder" ? "占位模式" : "过程模式"}</strong> · 已保存到这个群（换设备也保留）
        </p>
      </section>

      {/* ⛔⛔ 11-08 用户令：「话题模式要单独选项，不要放在回复模式这样一排，新开一个选项，群消息形式」。
          ⇒ 独立板块 + 独立枚举 messageForm，与 replyMode 正交（形式管"怎么摆"，回复模式管"运行时露什么"）。 */}
      <section className="team-settings__block" data-section="message-form">
        <h3>
          <MessagesSquare size={14} className="ic-violet" />
          群消息形式
        </h3>
        <p className="team-settings__hint">
          对话消息：所有消息按时间平铺；话题消息：伙伴回复收进你的气泡，点开弹窗预览完整话题。<strong>点卡片立即生效</strong>。
        </p>
        <div className="team-settings__layout-cards" data-group="message-form" role="radiogroup" aria-label="群消息形式">
          {([
            { value: "chat", label: "对话消息", desc: "所有消息按时间平铺" },
            { value: "topic", label: "话题消息", desc: "回复收进气泡 · 点开预览" },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={messageForm === opt.value}
              className={`team-settings__layout-card${messageForm === opt.value ? " is-on" : ""}`}
              onClick={() => onMessageForm(opt.value)}
            >
              <FormPreview mode={opt.value} />
              <strong>{opt.label}</strong>
              <small>{opt.desc}</small>
            </button>
          ))}
        </div>
        <p className="team-settings__hint team-settings__layout-current">
          当前：<strong>{messageForm === "topic" ? "话题消息" : "对话消息"}</strong> · 已保存到这个群（换设备也保留）
        </p>
      </section>

      {/* ⛔ 11-09 用户令：「群设置加一个对话流开关，默认折叠，展开后运行过程中就展开流程」。
          与主对话「对话流」同一语义：只影响**运行中**的呈现，收尾后的整轮折叠不变。 */}
      <section className="team-settings__block" data-section="dialog-flow">
        <h3>
          <ListChecks size={14} className="ic-violet" />
          对话流
        </h3>
        <p className="team-settings__hint">
          关闭（默认）：运行中过程收在折叠块里，点标题展开；
          打开：运行中直接把过程步骤铺开（主对话框「详细对话流」的手感）。
          <strong>只影响运行中</strong>，跑完仍按一轮折叠展示。
        </p>
        {/* ⛔ 11-09 用户：「把对话流也改成上面一样卡片展示，切换」——原来是单个胶囊开关，
            和上面三组不是一套语言。这里换成同样的双卡片（示意也走真实内容）。 */}
        <div className="team-settings__layout-cards" data-group="dialog-flow" role="radiogroup" aria-label="群对话流">
          {([
            { value: "simple", label: "收在折叠块", desc: "运行中点标题才展开" },
            { value: "detail", label: "直接铺开", desc: "运行中平铺每一步" },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={dialogFlow === opt.value}
              className={`team-settings__layout-card${dialogFlow === opt.value ? " is-on" : ""}`}
              onClick={() => onDialogFlow(opt.value)}
            >
              <FlowPreview mode={opt.value} />
              <strong><ListChecks size={12} />{opt.label}</strong>
              <small>{opt.desc}</small>
            </button>
          ))}
        </div>
        <p className="team-settings__hint team-settings__layout-current">
          当前：<strong>{dialogFlow === "detail" ? "直接铺开" : "收在折叠块"}</strong> · 已保存到这个群（换设备也保留）
        </p>
      </section>
    </>
  );
}

/** 群设置页：伙伴、群记忆、文件、定时任务与解散群等分区（视图开关已拆到 TeamViewModeSettings）。 */
function TeamSettingsImpl({ group, issues, limit, onAddPartner, onRemovePartner, onMute, onSetManager, onSetAdmin, onSetMemory, onSetWorkspace, onSetFiles, onClearMessages, onDeleteGroup, onAddNote, onRemoveNote, onSaveSchedules, onRunSchedule }: Props) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [pick, setPick] = useState("");
  const [addMode, setAddMode] = useState<AddMode>("expert");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  /* 群记忆 / 群文件：本地草稿 + 脏标记（保存才落盘，避免每敲一个字就写文件） */
  const [memoryDraft, setMemoryDraft] = useState(group.memory ?? "");
  const [filesDraft, setFilesDraft] = useState<TeamFile[]>(group.files ?? []);

  /* 记忆条目（豆包 §2.②）：一条一个结论 + 类型 + 来源，与上面的"群简介"分开 */
  const [noteText, setNoteText] = useState("");
  const [noteType, setNoteType] = useState<MemoryNoteType>("fact");
  /* 定时任务草稿（豆包 §③）：频率/时间/派给谁，提交时整组替换 */
  const [schedName, setSchedName] = useState("");
  const [schedPrompt, setSchedPrompt] = useState("");
  const [schedTargets, setSchedTargets] = useState<string[]>([]);
  const [schedKind, setSchedKind] = useState<"interval" | "daily" | "weekly" | "once">("daily");
  const [schedTime, setSchedTime] = useState("09:00");
  const [schedDays, setSchedDays] = useState<number[]>([1]);
  const [schedAt, setSchedAt] = useState("");

  const partners = group.members.filter((m) => m.kind === "bot");
  /* ⛔ 11-10 用户：「给成员列表里面管理员加一个管理员标签」。
     判据与 `defaultRouteCandidates` 同口径：专家团群不启用管理员 ⇒ 也不显示这个标签，
     免得挂着一个实际不生效的身份。 */
  const adminId = group.members.some((m) => m.targetKind === "team") ? "" : String(group.adminId ?? "");
  /* 默认上级 = 群主（11-06 用户令：「专家团的时候，默认上级就是主会话那个」）。
     ⛔ 只有群主自己不该有上级。 */
  const leadMember = group.members.find((m) => m.id === group.leadId);
  const leadName = leadMember?.name ?? "群主";
  const notes: MemoryNote[] = group.memoryNotes ?? [];

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
    setSchedName("");
    setSchedPrompt("");
    setSchedTargets([]);
  }, [group.id, group.memory, group.files]);

  const memoryDirty = memoryDraft.trim() !== String(group.memory ?? "").trim();
  const filesDirty = JSON.stringify(filesDraft) !== JSON.stringify(group.files ?? []);

  /* ⛔ 伙伴**必须**是真实调度目标：手打出来的名字派不了活。
     ⇒ 这里拉一次 `agents:catalog`（与模型自己派活用的是同一份清单，⛔ 不另建一套池子）。 */
  const reloadCatalog = useCallback(async () => {
    try {
      const res = await window.codex.listDispatchCatalog();
      const list = Array.isArray(res?.targets) ? (res.targets as Target[]) : [];
      setTargets(list.filter((t) => t && t.kind && t.name && t.installed !== false));
      setCatalogError("");
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  /* ⛔ 后台新建专家/团后这里能手动刷新（原来只挂载拉一次，列表会停在旧快照） */
  useEffect(() => { void reloadCatalog(); }, [reloadCatalog]);

  /** 已经在这个群里的目标不重复列（按 目标身份 判，不按显示名） */
  const options = useMemo(() => {
    const taken = new Set(partners.map((p) => `${p.targetKind}:${p.targetKey}`));
    return targets
      .map((t, index) => ({ index, t }))
      .filter(({ t }) => !taken.has(`${t.kind}:${t.key}`))
      .filter(({ t }) => MODE_KINDS[addMode].has(t.kind))
      .map(({ index, t }) => ({
        value: String(index),
        label: `${KIND_LABEL[t.kind] ?? t.kind} · ${t.name}${t.profession ? `（${t.profession}）` : ""}`,
        disabled: partners.length >= limit,
      }));
  }, [targets, partners, addMode, limit]);

  /* ⛔└ 11-06 用户令：「专家团，就要纯新群聊才能加，已经自定义了，就不能专家团」
     正反向联动的唯一真相源在 lib/team-models.mjs（有单测）；这里按最新伙伴表实时重算，
     移除伙伴后自动恢复，⛔ 不缓存、不在两处各写一套判据。 */
  const modeStates = useMemo(() => ({
    expert: addModeStateOf(partners, "expert"),
    team: addModeStateOf(partners, "team"),
    custom: addModeStateOf(partners, "custom"),
  }), [partners]);
  const activeModeState = modeStates[addMode];

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
    if (activeModeState.blocked) return;
    const chosen = options.find((o) => o.value === pick);
    if (!chosen || chosen.disabled) return;
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

  /** 选项目地址（选完即落盘：这是一个明确的动作，⛔ 不做"草稿再保存"） */
  const pickWorkspace = async () => {
    setMsg("");
    setDone("");
    try {
      const picked = group.workspace
        ? await window.codex.chooseDirectoryAt(group.workspace)
        : await window.codex.chooseDirectory();
      if (!picked) return;
      await run(() => onSetWorkspace(picked), "项目地址已更新 —— 下次派活就在这个目录里");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    }
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
    <>
      {/* ── 常用置顶 2/8：partners ─────────────────────────── */}
      {/* ── 伙伴 ───────────────────────────────────────────────────────── */}
      {/* ⛔⛔ 11-09 用户令：「无需 @ 成员时可直接发消息」「为普通群聊增加设置管理员功能」。
          后端（IPC + store + 默认路由）早就 Ready，但**界面没有入口** ⇒ 用户被错误文案
          「在群设置里设个管理员」指过来却找不到地方。这里补上。
          ⛔ 专家团群不显示入口：由团主理人兜底（与 defaultRouteCandidates 同一口径）。 */}
      <section className="team-settings__block" data-section="admin">
        <h3><Users size={14} className="ic-violet" />群管理员</h3>
        <p className="team-settings__hint">
          不 @ 任何人直接发消息时，先交给上一位回复的伙伴；没有上下文就交给<strong>管理员</strong>推进进度。
          设好之后，普通群里直接打字也能开工。
        </p>
        {/* ⛔⛔ 11-12 用户：「管理员设置就不能再展示普通标了」。
            管理员是**群级身份**：团群里天然由团主理人担任（不是"不需要管理员"），
            这里把身份说清楚，只是不给改的入口（改了会和团队调度打架）。 */}
        {group.members.some((m) => String(m.targetKind ?? "") === "team") ? (
          <p className="team-settings__hint">
            管理员：<strong>{group.members.find((m) => String(m.targetKind ?? "") === "team")?.name ?? "团主理人"}</strong>
            （由团主理人担任，不需要另设）。用户没 @ 人时由它接话、拆解、派活、收口。
          </p>
        ) : (
          <span className="team-settings__select">
            <AppSelect
              value={String(group.adminId ?? "")}
              onChange={(value) => void run(
                () => onSetAdmin(value),
                value ? `管理员已设为 ${partners.find((p) => p.id === value)?.name ?? value}` : "已取消管理员",
              )}
              options={[
                { value: "", label: "不设置（只按上下文接话）" },
                ...partners.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </span>
        )}
        <p className="team-settings__hint team-settings__layout-current">
          当前：<strong>{group.adminId ? (partners.find((p) => p.id === group.adminId)?.name ?? "已移出群") : "不设置"}</strong>
        </p>
      </section>
      <section className="team-settings__block" data-section="partners">
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
              <span className="team-settings__avatar has-agent" aria-hidden><MemberAvatar member={p} size={22} /></span>
              <span className="team-settings__name">
                <span className="team-settings__name-text" title={p.name}>{p.name}</span>
                {p.id === group.leadId && <em className="team-settings__tag">群主</em>}
                {p.id === adminId && <em className="team-settings__tag team-settings__tag--admin" title="没 @ 时由它接话推进进度">管理员</em>}
                {p.muted && <em className="team-settings__tag team-settings__tag--muted">已静音</em>}
                {p.targetKind
                  ? <em className="team-settings__tag" title={`后台调度目标：${p.targetKind}`}>{KIND_LABEL[p.targetKind] ?? p.targetKind}</em>
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
        <div className="team-settings__modes" role="tablist" aria-label="伙伴添加模式">
          {ADD_MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={addMode === m}
              aria-disabled={modeStates[m].blocked}
              title={modeStates[m].blocked ? modeStates[m].reason : undefined}
              className={`team-settings__mode${addMode === m ? " is-on" : ""}${modeStates[m].blocked ? " is-blocked" : ""}`}
              onClick={() => { setAddMode(m); setPick(""); }}
            >{MODE_LABEL[m]}</button>
          ))}
          <button type="button" className="team-settings__mode-refresh" title="重新读取后台专家 / 专家团列表" onClick={() => void reloadCatalog()}>刷新</button>
        </div>
        <p className="team-settings__hint">{MODE_HINT[addMode]}</p>
        {activeModeState.blocked ? (
          <p className="team-settings__mode-block" role="status">
            <strong>{MODE_LABEL[addMode]}暂不可用</strong> · {activeModeState.reason}
          </p>
        ) : (
        /* ⛔ 没有可选项时**不渲染**下拉与「添加伙伴」：原来是「两行灰字 + 一个点不动的按钮」
           挤在一行，既占位又误导（用户截图红框）。空态改用一块带引导的卡片：
           说明为什么没有 + 下一步去哪 + 就地重新读取。 */
        options.length ? (
          <div className="team-settings__add">
            <AppSelect
              value={pick}
              onChange={setPick}
              /* ⛔ 满员时不再把整个下拉禁掉：三种模式各有什么对象仍要看得见，
                 改成逐项置灰 + 下面「已达上限」的提示，用户先移除再加即可。 */
              options={[{ value: "", label: "选一个智能体…" }, ...options]}
              ariaLabel="选择要加入的智能体"
              disabled={busy}
            />
            <button type="button" onClick={() => void addPartner()} disabled={busy || !pick || partners.length >= limit}>
              添加伙伴
            </button>
          </div>
        ) : (
          <div className="team-settings__empty-card">
            <Inbox size={20} aria-hidden />
            <div className="team-settings__empty-text">
              <strong>{catalogError ? "读不到智能体清单" : `「${MODE_LABEL[addMode]}」下暂无可加对象`}</strong>
              <span>
                {catalogError
                  ? catalogError
                  : "到「设置 → 智能体团队」新建后再回来，点「重新读取」即可。"}
              </span>
            </div>
            <button type="button" onClick={() => void reloadCatalog()} disabled={busy} title="重新读取后台专家 / 专家团 / 子智能体列表">
              <RefreshCw size={13} /> 重新读取
            </button>
          </div>
        )
        )}
        {partners.length >= limit && <p className="team-settings__hint">已达上限（最多 {limit} 个伙伴）</p>}
      </section>

      {/* ── 常用置顶 4/8：memory ─────────────────────────── */}
      {/* ── 群记忆 ─────────────────────────────────────────────────────── */}
      <section className="team-settings__block" data-section="memory">
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

      {/* ── 常用置顶 5/8：workspace ─────────────────────────── */}
      {/* ── 项目地址（群的工作目录）──────────────────────────────────────────
          用户 11-06：「然后群项目地址选项」—— 群里派活必须知道"在哪个仓库干活"，
          否则伙伴在应用默认目录里找相对路径，然后如实回你"没这个文件"。 */}
      <section className="team-settings__block" data-section="workspace">
        <h3>
          <FolderOpen size={14} className="ic-blue" />
          项目地址
          <span className="team-settings__count">{group.workspace ? "已设" : "跟随默认"}</span>
        </h3>
        <p className="team-settings__hint">
          伙伴在这个目录里干活（派活时作为子会话的工作目录）。不设就跟随应用默认目录。
          <strong>改完只影响之后派出去的活</strong>，已经跑着的子会话不会中途换目录。
        </p>
        <div className="team-settings__path">
          <code className="team-settings__path-text" title={group.workspace || "（跟随应用默认目录）"}>
            {group.workspace || "（跟随应用默认目录）"}
          </code>
          <button type="button" className="team-settings__mini" onClick={() => void pickWorkspace()} disabled={busy}>
            选择目录…
          </button>
          {group.workspace && (
            <button
              type="button"
              className="team-settings__mini"
              onClick={() => void run(() => onSetWorkspace(""), "已清空项目地址 —— 之后跟随应用默认目录")}
              disabled={busy}
            >
              清空
            </button>
          )}
        </div>
      </section>

      {/* ── 常用置顶 6/8：files ─────────────────────────── */}
      {/* ── 群文件 ─────────────────────────────────────────────────────── */}
      <section className="team-settings__block" data-section="files">
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

      {/* ── 常用置顶 7/8：hierarchy ─────────────────────────── */}
      {/* ── 上下级（豆包 managerId）：真生效 —— 派活时会把这个伙伴的上级/可派对象写进 prompt ── */}
      <section className="team-settings__block" data-section="hierarchy">
        <h3>
          <GitBranch size={14} className="ic-green" />
          谁向谁汇报
          <span className="team-settings__count">
            {partners.filter((p) => p.managerId).length
              ? `${partners.filter((p) => p.managerId).length} 已改 · 其余默认向${leadName}`
              : `默认全部向${leadName}汇报`}
          </span>
        </h3>
        <p className="team-settings__hint">
          伙伴<strong>默认向{leadName}（群主 · 主会话）汇报</strong>，不用一个个填；
          要改成别的伙伴当上级在这里选。派活时会把这段关系写进 prompt ——
          它就能把子任务派给下级（走既有的调度闸），不只是画个图。
        </p>
        <ul className="team-settings__list">
          {partners.map((p) => (
            <li key={p.id} className="team-settings__row">
              <span className="team-settings__avatar has-agent" aria-hidden><MemberAvatar member={p} size={22} /></span>
              <span className="team-settings__name">
                <span className="team-settings__name-text" title={p.name}>{p.name}</span>
                {p.targetProfession && <em className="team-settings__tag">{p.targetProfession}</em>}
              </span>
              <span className="team-settings__meta">上级</span>
              {/* ⛔ 下拉必须放进**固定宽度**的槽里：`.app-select-trigger` 是 `width:100%`，
                  直接当 flex 子项会吃光整行 ⇒ 名字被压到 0 宽，中文一字一行（11-06 用户截图）。 */}
              <span className="team-settings__select">
                <AppSelect
                  /* ⛔ 显示的是**生效上级**（显式值 or 默认群主）：只读 `p.managerId` 会让
                     默认态显示「(无)」，用户以为没生效、又去逐个手填一遍。 */
                  value={resolveManagerId(group, p.id)}
                  onChange={(value) => {
                    /* ⛔ 选「群主」= 回到**默认**，存空串：写一条"等于默认"的显式值会让
                       「N 已改」计数和落盘数据一起说谎（用户没改任何人的层级）。 */
                    const back = value === group.leadId;
                    void run(
                      () => onSetManager(p.id, back ? "" : value),
                      back ? `已恢复默认（向${leadName}汇报）` : `上级已改为 ${group.members.find((x) => x.id === value)?.name ?? value}`,
                    );
                  }}
                  options={[
                    ...(p.id !== group.leadId ? [{ value: group.leadId, label: `${leadName}（群主 · 默认）` }] : []),
                    ...partners
                      .filter((x) => x.id !== p.id && x.id !== group.leadId)
                      .map((x) => ({ value: x.id, label: x.name })),
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

      {/* ── 常用置顶 8/8：schedules ─────────────────────────── */}
      {/* ── 定时任务（豆包 §③「自动化定时任务」：prompt 里写死收件人）──────────── */}
      <section className="team-settings__block" data-section="schedules">
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

      {/* ── 体检（只在真有问题时出现；"还没有伙伴"这类建议也写在这里，但语气是建议） ── */}
      {issues && issues.length > 0 && (
        <section className="team-settings__block">
          <h3><Users size={14} className="ic-cyan" />这个群还差什么</h3>
          <ul className="team-settings__issues">
            {issues.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </section>
      )}

      {/* ── 聊天记录（11-06 用户：「没有清空记录功能」）──────────────────────────
          ⛔ 只清**群日志**（群视图的投影索引）；伙伴的子会话与它们的真实产出一条都不动，
             和「解散群」同一个口径 —— 群是视图，子会话是资产。 */}
      {onClearMessages && (
        <section className="team-settings__block">
          <h3><Trash2 size={14} className="ic-amber" />聊天记录</h3>
          <div className="team-settings__inline-row">
            <span className="team-settings__hint team-settings__hint--inline">
              清空群里的消息记录（只是一个索引）。<strong>伙伴的会话和你之前的派活记录一条都不会删</strong>，
              清完还能重新 @ 派活。
            </span>
            {confirmClear ? (
              <>
                <span className="team-settings__meta">确定清空？清完不能恢复</span>
                <button type="button" className="team-settings__mini" onClick={() => setConfirmClear(false)} disabled={busy}>取消</button>
                <button
                  type="button"
                  className="team-settings__mini team-settings__mini--danger"
                  onClick={() => void run(async () => {
                    const r = await onClearMessages();
                    if (r.ok) setConfirmClear(false);
                    return r;
                  }, "聊天记录已清空")}
                  disabled={busy}
                >
                  确认清空
                </button>
              </>
            ) : (
              <button type="button" className="team-settings__mini team-settings__mini--danger" onClick={() => setConfirmClear(true)} disabled={busy}>
                清空记录
              </button>
            )}
          </div>
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
              删群会连同<strong>这个群里派出去的会话</strong>一起删除（11-07 用户令：外面不该还留着）。
            </span>
            {confirmDelete ? (
              <>
                <span className="team-settings__meta">确定解散「{group.name}」？会话也会一起删。</span>
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
    </>
  );
}

/* ⛔ memo 比较：只比**真正显示的字段**。三个视图开关已移到 TeamViewModeSettings，
   切它们时这些字段一个都没变 ⇒ 不再重渲染伙伴/记忆/文件/层级/定时/备注 6 个区块。 */
export const TeamSettings = memo(TeamSettingsImpl, (a, b) => (
  a.issues === b.issues && a.limit === b.limit
  && a.group.id === b.group.id && a.group.name === b.group.name && a.group.leadId === b.group.leadId
  && a.group.members === b.group.members && a.group.files === b.group.files
  /* ⛔ 11-09：管理员只改这一个字段，漏比会让设置完界面纹丝不动（用户判「选不了」）。 */
  && a.group.adminId === b.group.adminId
  && a.group.memory === b.group.memory && a.group.memoryNotes === b.group.memoryNotes
  && a.group.schedules === b.group.schedules && a.group.workspace === b.group.workspace
));
