/**
 * 专家团像素办公室 · 整屏浮层（v19 像素版）
 *
 * 数据边界（⛔ 事件驱动的接法）：本组件**不订阅引擎** —— 成员运行态由宿主（AppView）
 * 传入，宿主的 railRuns 本身就是引擎事件流归约出来的，所以这里的画面会随任务
 * 开始/结束**实时变化**（开始 → 坐下敲键盘 + 气泡；结束 → 完成 ✓ → 待机时钟屏保）。
 * 交互只有一条：点角色 → 打开该成员会话。
 *
 * ⛔⛔ 2026-10-05 晚：**事件状态反馈链路补齐** —— 用户报「事件状态反馈未接通，
 *   导致操作后没有任何响应」。根因不是"没接线"，而是**线上传的是编造的信号**：
 *   上一版 `eventStateOf` 返 `{ activity, thinking, waiting, reporting }` 三个布尔，
 *   而宿主手里根本没有对应数据 ⇒ 只能编（`thinking` 只在关键词命中时才有、
 *   `waiting` 恒 false、`reporting` 在"关键词没命中"时恒 true）。
 *   后果：`code`（敲代码）屏**永远不出现**，而 `rest`（近乎纯黑）反而是常态；
 *   委托跑完只会"从 runningByMember 消失" ⇒ **完成 / 失败没有任何反馈**。
 *   ⇒ 现在改为按 run 记录如实推导 **`RunPhase`**（见 `phaseOfRun`），
 *     并且**两条成员来源（专家团 / 普通会话委托）共用同一份推导**，不会各写一套。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfficeCanvas, type OfficeEventState } from "./OfficeCanvas";
import { activityElapsedMs, officeActivityOf } from "./office-activity";
import { REPORT_CHARS, WAIT_AFTER_MS, type RunPhase } from "./office-screen";
import type { OfficeMemberState } from "./office-format";

export type TeamOfficePreviewProps = {
  teamId: string | null;
  onClose: () => void;
  teams: ExpertTeamConfig[];
  runningByMember: Record<string, TeamMemberRunRecord>;
  lastByMember: Record<string, TeamMemberRunRecord>;
  openThread: (threadId: string) => void;
  /** ⭐ 普通会话里「我派出的子会话」= 办公室成员来源。
   *  已在宿主侧按 `originThreadId === 当前会话` 过滤好，并且是**委托登记表**（含已完成），
   *  ⛔ 不是头像轨的 live 表 —— 那条跑完只停留 20 秒。
   *  ⛔ 可选（`?`）：专家团那条路径不传也不受影响。 */
  delegatedRuns?: DelegateRecordEntry[];
  /** ⭐ 「我自己」的那个工位（10-05 晚，仅非专家团模式）。
   *  ⛔ 为什么必须把"我"放进来：用户要求「把对话框里出现的所有事件接入显示器统一展示」——
   *    专家团里主理人（lead）本来就有工位，而**普通会话 / 专家会话 / 调度会话**里
   *    成员全都只是"派出去的子会话" ⇒ 本会话自己干了什么**根本没有显示器可演**，
   *    办公室与对话框就对不上了。 */
  self?: { threadId: string; name: string; running: boolean } | null;
};

/* ── 随机取名（2026-10-04 用户要求「卡通人物名字就随机取一个就行」）──
 * ⛔ **必须按 id 确定性取**，⛔ 不能每次渲染重随：
 *   否则 React 重渲染一次名字就变了 ⇒ 画面上人物"每帧改名"，且名牌与点击目标对不上。
 *   ⇒ 用 id 的哈希选下标：同一子会话恒定同名，不同子会话自然分散。
 * ⚠️ 名字池刻意用"职能"而非"人名"：办公室里坐的是"数据分析师/后端工程师"这类角色，
 *   比随机人名更贴像素办公室的调性，也避免重名尴尬。 */
const ROLE_NAMES = [
  "数据分析师", "后端工程师", "前端工程师", "测试工程师", "产品经理",
  "UI 设计师", "运维工程师", "算法工程师", "文案策划", "技术文档",
  "安全审计", "性能调优",
];
function delegateNameOf(run: DelegateRecordEntry): string {
  // 优先用宿主给的名字；为空时才用随机角色名
  const given = String(run.name ?? "").trim();
  if (given) return given.length > 8 ? `${given.slice(0, 8)}…` : given;
  let h = 2166136261;
  for (let i = 0; i < run.threadId.length; i++) {
    h ^= run.threadId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ROLE_NAMES[(h >>> 0) % ROLE_NAMES.length];
}

/** 一次运行的**客观事实**（两个来源的记录结构不同，但都存在这四个字段）。 */
type RunFacts = {
  status?: string;
  output?: string;
  startedAt?: number;
  endedAt?: number;
  /** 专家团的委派号（被调度会话没有这个字段 ⇒ 用起始时刻代替，见 `key`） */
  runId?: string;
};

/**
 * run 记录 ⇒ 真实阶段（⭐ 这是"显示器反映真实状态"的**唯一推导点**）。
 *
 * ⛔⛔ 判据全部来自记录里真实存在的字段，⛔ 一个都不许编：
 *   · `status === "running"` + 尚无 `output`  → thinking / waiting（超 `WAIT_AFTER_MS` 未吐字）
 *   · `status === "running"` + 已有 `output`  → writing / reporting（超 `REPORT_CHARS` 即成稿）
 *   · `done` / `failed`                       → 完成 / 失败（用时 = endedAt - startedAt，真实值）
 * ⛔ 别再用"任务描述里有没有『查/搜』"去反推状态 —— 那只能说明**任务类型**，
 *   说明不了**此刻在干什么**（上一版就是这么错的，见文件头）。
 *   （关键词只用于"要不要派人去书架"这个**表演**决策，见 `activityOf`。）
 */
export function phaseOfRun(run: RunFacts | null | undefined, now: number): {
  phase: RunPhase; sinceMs: number; durationMs: number; chars: number; key: string;
} {
  if (!run || !run.status) return { phase: "none", sinceMs: 0, durationMs: 0, chars: 0, key: "" };
  const chars = String(run.output ?? "").length;
  const started = Number(run.startedAt) || 0;
  /* ⭐ 委派身份（`key`）：**变化 = 有新任务派下来** ⇒ 办公室播"任务派发"动画。
     专家团有主进程给的 `runId`；被调度会话的记录里没有这个字段
     ⇒ 退回"起始时刻"（同一个会话再次被派单，startedAt 一定不同）。 */
  const key = String(run.runId ?? "") || (started ? `at-${started}` : "");
  if (run.status === "running") {
    const elapsed = started ? now - started : 0;
    if (chars > 0) {
      return { phase: chars >= REPORT_CHARS ? "reporting" : "writing", sinceMs: started, durationMs: 0, chars, key };
    }
    return { phase: elapsed >= WAIT_AFTER_MS ? "waiting" : "thinking", sinceMs: started, durationMs: 0, chars, key };
  }
  const ended = Number(run.endedAt) || 0;
  return {
    phase: run.status === "failed" ? "failed" : "done",
    /* 起算点取结束时刻 ⇒ `effectivePhase` 才能在 DONE_HOLD_MS 后把它收回去（回到屏保）；
       ⛔ 取 startedAt 的话"完成"会永远挂着，办公室就变成一块静态图了。 */
    sinceMs: ended || started,
    durationMs: ended && started ? Math.max(0, ended - started) : 0,
    chars,
    key,
  };
}

export function TeamOfficePreview({ teamId, onClose, teams, runningByMember, lastByMember, openThread, delegatedRuns, self }: TeamOfficePreviewProps) {
  const team = useMemo(() => teams.find((t) => t.teamId === teamId) ?? null, [teams, teamId]);

  /* ⭐ 「点了没反应」的显式反馈（10-05 晚）。
     ⛔ 原来点一个**还没有会话**的成员 = 静默什么都不做 —— 用户看到的就是
       "操作后没有任何响应"（这既不是 bug 也不是配置问题，纯粹是没给反馈）。 */
  const [hint, setHint] = useState("");
  const hintTimer = useRef<number | null>(null);
  const flash = useCallback((text: string) => {
    setHint(text);
    if (hintTimer.current != null) window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(""), 2800);
  }, []);
  useEffect(() => () => { if (hintTimer.current != null) window.clearTimeout(hintTimer.current); }, []);

  const members: OfficeMemberState[] = useMemo(() => {
    /* ── 普通会话模式（10-04 起）──
     * ⛔ 原来只有 `team`（专家团）一条来源 ⇒ 普通会话里办公室永远是空的。
     * ✅ 两条来源：
     *   · `team` 存在 ⇒ 专家团成员（原有行为，不变）
     *   · 否则 ⇒ **本会话派出的委托记录**（宿主按 `originThreadId === 当前会话` 过滤好，
     *     正是"我调度了谁"；正在跑的敲键盘、跑完的坐工位待机、归档后才离场）
     */
    if (!team) {
      /* ⛔⛔ 不许按 `status === "running"` 过滤（10-05 用户报「我调度了一个专家，办公室预览里面
         没有更新成员」）：委托跑得极快（真机实测 3.7 秒），用户点开办公室时它已经不在 running
         ⇒ 办公室里永远是空的。⇒ 成员取**委托记录**（含已完成），跑完的坐工位待机。
         ⛔ 也别改用头像轨的 live 表（`delegatedRailRuns`）：那条表跑完只停留 20 秒就摘掉。 */
      /* ⭐ 「我」的工位排在最前（10-05 晚）：有它，本会话自己的事件才有显示器可演。
         ⛔ 它不占别人的位：先给"我"留一个，剩下的座位按"最近派出的"填。 */
      const mine: OfficeMemberState[] = self?.threadId
        ? [{ id: self.threadId, name: self.name || "本会话", profession: "本会话", running: self.running, hasThread: false }]
        : [];
      return [...mine, ...(delegatedRuns ?? [])
        .slice(-(6 - mine.length))   // 工位只有 6 个；取**最近**的几个 ⇒ 新派的一定看得见，老的先离场
        .map((r) => ({
          //⛔ id 用 threadId（唯一且稳定）而不是数组下标 —— 下标会随列表变化导致人物"换位"。
          id: r.threadId,
          name: delegateNameOf(r),
          // 职业名留空：普通会话没有"专业"概念，冒牌反而不像
          profession: r.kind === "subagent" ? "子智能体" : r.kind === "expert" ? "专家" : "组员",
          // 跑完的坐工位待机（⛔ 不是从名单里消失）
          running: r.status === "running",
          hasThread: true,
        }))];
    }
    const roster = [team.lead, ...team.members].slice(0, 6);
    return roster.map((m) => {
      const run = runningByMember[m.id];
      const last = lastByMember[m.id];
      return {
        id: m.id,
        name: m.name,
        profession: m.profession?.zh ?? "",
        running: Boolean(run),
        hasThread: Boolean(run || last),
      };
    });
  }, [team, runningByMember, lastByMember, delegatedRuns, self]);

  /** 点角色 → 该成员最近的会话（跑过才有；没跑过给出**明确提示**，⛔ 不静默）。 */
  const openMember = (memberId: string) => {
    /* ① 普通会话模式：成员的 id **就是 threadId**（见 members 的构造）⇒ 直接打开。
     *  ⛔ 别只按 threadId 判空：专家团成员的 id 是 memberId，不是 threadId，
     *     两者恰好相等时才会误入这条分支（几乎不可能，但不能靠"运气"）。 */
    if (!team) {
      /* 「我」那个工位点不出会话（本来就在这个会话里）—— 给一句人话，⛔ 不要静默 */
      if (self?.threadId && memberId === self.threadId) { flash("这就是你当前打开的会话"); return; }
      const del = (delegatedRuns ?? []).find((r) => r.threadId === memberId);
      if (del) { onClose(); openThread(del.threadId); }
      else flash("这个成员还没有会话");
      return;
    }
    const rec = lastByMember[memberId] ?? runningByMember[memberId];
    if (rec?.memberThreadId) {
      onClose();
      openThread(rec.memberThreadId);
    } else {
      flash(`${members.find((m) => m.id === memberId)?.name ?? "该成员"}还没有会话 —— 它还没被调度过`);
    }
  };

  /* ⛔ 这里曾经有一段 （按任务描述里的关键词判断要不要派人去书架/饮水机）。
     10-05 晚用户明确「**有工作就不要闲逛**」⇒ 整条去掉：在跑的成员一律留在工位，
     出门只剩 sim 内部空闲成员的随机休息。⛔ 别把它加回来 —— 那是用关键词编状态的老毛病。 */

  /** 取该 **threadId** 当前该演的真实事件（`office-activity` 事件面；null = 没有/已过期）。 */
  const eventOf = (threadId: string, now: number): OfficeEventState["event"] => {
    const act = officeActivityOf(threadId, now);
    return act ? { kind: act.kind, detail: act.detail, elapsedMs: activityElapsedMs(act, now) } : null;
  };

  /** 每成员的**真实事件状态**（供显示器画内容 + sim 派单）。 */
  const eventStateOf = (memberId: string): OfficeEventState | null => {
    const now = Date.now();
    /* ① 「我」的工位（仅非专家团）：阶段只从"本会话在不在跑"推，
         屏幕内容主要由**事件面**决定 —— 那正是对话框里逐条列出来的东西。 */
    if (!team && self?.threadId && memberId === self.threadId) {
      const evt = eventOf(self.threadId, now);
      const running = Boolean(self.running);
      return {
        /* ⛔ 有事件时阶段不重要（事件画面优先），这里只保证"没事件时不掉进屏保"：
           在跑 ⇒ thinking（过程进行中），不在跑 ⇒ none（屏保）。 */
        phase: running ? "thinking" : "none",
        sinceMs: 0,
        durationMs: 0,
        chars: 0,
        /* 「我」不接任务 ⇒ 没有派发身份（⛔ 别拿别的东西冒充，否则会给自己的工位也播一次派发动画） */
        runId: "",
        event: evt,
      };
    }
    /* ② 专家团：running 的那次优先（并行阶段可能多个成员同时跑）；
         否则用最近一次 —— 它带着"完成/失败 + 真实用时"，正是用户要的反馈。 */
    if (team) {
      const run = runningByMember[memberId] ?? lastByMember[memberId];
      const facts = phaseOfRun(run, now);
      return {
        phase: facts.phase, sinceMs: facts.sinceMs, durationMs: facts.durationMs, chars: facts.chars,
        runId: facts.key,
        /* ⛔⛔ 2026-10-05 晚 用户明确「**有工作就不要闲逛**」：
           在跑的成员一律留在工位（不再按任务关键词派人去书架/饮水机表演），
           屏幕照实演他手上的事（浏览器/写文件/跑命令…由事件面驱动）。 */
        /* 事件面按**成员线程**取（`memberThreadId`）—— 成员线程才是引擎真正在跑的那个会话；
           ⛔ 拿 memberId 去查一定查不到（它不是 threadId）。 */
        event: run?.memberThreadId ? eventOf(String(run.memberThreadId), now) : null,
      };
    }
    /* ③ 普通会话 / 专家会话 / 调度会话：成员 id 就是 threadId；委托登记表里带着
         status/output/起止时间，经同一份 `phaseOfRun` 推导 —— ⛔ 不再按 kind **编**
         一个"他大概在干嘛"（那正是上一版"事件状态未接通"的来源）。 */
    const del = (delegatedRuns ?? []).find((r) => r.threadId === memberId);
    const facts = phaseOfRun(del, now);
    return {
      phase: facts.phase, sinceMs: facts.sinceMs, durationMs: facts.durationMs, chars: facts.chars,
      runId: facts.key,
      event: eventOf(memberId, now),
    };
  };

  /* ⛔ 门槛：必须有 `teamId`（= 有人显式打开了这个浮层）。
     ⛔ 但**不再要求 `team` 存在** —— 普通会话模式没有 team（成员来自 delegatedRuns），
        原来那个 `|| !team` 会把普通会话的浮层直接挡掉、永远不显示。 */
  if (!teamId) return null;

  const title = team
    ? team.displayName?.zh || team.displayName?.en || "办公室"
    : "我的办公室";
  const subtitle = team
    ? "成员状态实时联动 · 点角色打开会话"
    : "调度出去的子会话会变成办公室里的人 · 点角色打开子会话";

  return (
    <div className="office-overlay" role="dialog" aria-label="像素办公室">
      <header className="office-overlay-bar">
        <div className="office-overlay-title">
          <span className="office-overlay-name">{title}</span>
          <span className="office-overlay-sub">{subtitle}</span>
        </div>
        <button type="button" className="office-overlay-close" onClick={onClose} aria-label="关闭办公室预览">
          ✕
        </button>
      </header>
      <div className="office-overlay-stage">
        <OfficeCanvas members={members} onOpenMember={openMember} eventStateOf={eventStateOf} />
        {members.length === 0 && (
          <p className="office-overlay-empty">
            {team ? "这个团队还没有成员。" : "还没有调度任何子会话 —— 派一个子智能体或专家出去，这里就会多一个人。"}
          </p>
        )}
        {/* 「点了没反应」的显式反馈：⛔ 不许静默 */}
        {hint && <p className="office-overlay-hint" role="status">{hint}</p>}
      </div>
    </div>
  );
}
