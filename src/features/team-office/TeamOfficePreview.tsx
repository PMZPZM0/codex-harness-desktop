/**
 * 专家团像素办公室 · 整屏浮层（v19 像素版）
 *
 * 数据边界（⛔ 事件驱动的接法）：本组件**不订阅引擎** —— 成员运行态由宿主（AppView）
 * 传入，宿主的 railRuns 本身就是引擎事件流归约出来的，所以这里的画面会随任务
 * 开始/结束**实时变化**（开始 → 坐下敲键盘 + 气泡；结束 → 完成气泡 → 待机）。
 * 交互只有一条：点角色 → 打开该成员会话。
 */
import { useMemo } from "react";
import { OfficeCanvas } from "./OfficeCanvas";
import type { OfficeMemberState } from "./office-format";

export type TeamOfficePreviewProps = {
  teamId: string | null;
  onClose: () => void;
  teams: ExpertTeamConfig[];
  runningByMember: Record<string, TeamMemberRunRecord>;
  lastByMember: Record<string, TeamMemberRunRecord>;
  openThread: (threadId: string) => void;
  /** ⭐ 2026-10-04：普通会话里「我派出的子会话」=办公室成员来源。
   *  已在宿主侧按 `originThreadId === 当前会话` 过滤好（`bag.delegatedRailRuns`）。
   *  ⛔ 可选（`?`）：专家团那条路径不传也不受影响。 */
  delegatedRuns?: DelegateRecordEntry[];
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

export function TeamOfficePreview({ teamId, onClose, teams, runningByMember, lastByMember, openThread, delegatedRuns }: TeamOfficePreviewProps) {
  const team = useMemo(() => teams.find((t) => t.teamId === teamId) ?? null, [teams, teamId]);

  const members: OfficeMemberState[] = useMemo(() => {
    /* ── 普通会话模式（2026-10-04 用户要求「给普通会话也加上」）──
     * ⛔ 原来只有 `team`（专家团）一条来源 ⇒ 普通会话里办公室永远是空的。
     * ✅ 改为两条来源：
     *   · `team` 存在 ⇒ 专家团成员（原有行为，不变）
     *   · 否则⇒ **本会话派出的子会话**（`delegatedRuns` = `bag.delegatedRailRuns`，
     *     已在宿主里按 `originThreadId === 当前会话` 过滤好，正是"我调度了谁"）
     * ⛔ 只取 `status === "running"`：跑完的子会话不再占位（人下班了，办公室该空出来）。
     *   ⚠️ 也不保留"最近完成"的成员 —— 那样办公室会越积越多直到 6 个满。
     */
    if (!team) {
      return (delegatedRuns ?? [])
        .filter((r) => r.status === "running")
        .slice(0, 6)
        .map((r) => ({
          //⛔ id 用 threadId（唯一且稳定）而不是数组下标 —— 下标会随列表变化导致人物"换位"。
          id: r.threadId,
          name: delegateNameOf(r),
          // 职业名留空：普通会话没有"专业"概念，冒牌反而不像
          profession: r.kind === "subagent" ? "子智能体" : r.kind === "expert" ? "专家" : "组员",
          running: true,
          hasThread: true,
        }));
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
  }, [team, runningByMember, lastByMember, delegatedRuns]);

  /** 点角色 → 该成员最近的会话（跑过才有；没跑过不开）。 */
  const openMember = (memberId: string) => {
    /* ① 普通会话模式：成员的 id **就是 threadId**（见 members 的构造）⇒ 直接打开。
     *  ⛔ 别只按 threadId 判空：专家团成员的 id 是 memberId，不是 threadId，
     *     两者恰好相等时才会误入这条分支（几乎不可能，但不能靠"运气"）。 */
    if (!team) {
      const del = (delegatedRuns ?? []).find((r) => r.threadId === memberId);
      if (del) { onClose(); openThread(del.threadId); }
      return;
    }
    const rec = lastByMember[memberId] ?? runningByMember[memberId];
    if (rec?.memberThreadId) {
      onClose();
      openThread(rec.memberThreadId);
    }
  };

  /* ── 10-04 事件驱动（用户选「跟真实事件挂钩」）──
   * ⛔ 不订阅引擎、不读引擎的"思考"事件 —— `TeamMemberRunRecord.query` 是**主进程轨道里
   *   记录的真实派发任务**，比订阅便宜得多，且天然与成员一一对应。
   * ⚠️ 关键词命中是**降级**方案：将来轨道若补上 `kind` 字段，优先用它（本函数留了接口）。 */
  const activityOf = (query: string): null | "book" | "water" | "toilet" | "run" | "gym" => {
    const q = (query ?? "").toLowerCase();
    if (/查|找资料|搜索|search|调研|读一下|看看文档/.test(q)) return "book";
    if (/洗手间|厕所|toilet|wc|restroom/.test(q)) return "toilet";
    if (/跑|run|跑步/.test(q)) return "run";
    if (/举铁|哑铃|健身|gym|力量/.test(q)) return "gym";
    if (/喝|water|倒水|接水/.test(q)) return "water";
    return null;
  };

  /** 每成员的真实事件状态（供显示器画内容 + sim 派单）。 */
  const eventStateOf = (memberId: string) => {
    /*⛔ 普通会话模式（`!team`）：成员 id 是 **threadId**，`runningByMember` 里查不到
     *   ⇒ 原逻辑会返回 null ⇒ 屏幕永远"熄屏"。
     * ✅ 改为按委托记录给一个**合理的默认活动**：
     *   DelegateRecordEntry 没有 query（那是专家团才有的），⛔ 也不该假装有。
     *   按 kind 映射一个"这个人大概在干嘛"，至少让屏幕是亮的、在动。
     * ⚠️ 这一条是**显示层的合理默认**，不是真实事件 —— 真实事件到位后应替换。 */
    if (!team) {
      const del = (delegatedRuns ?? []).find((r) => r.threadId === memberId);
      if (!del) return null;
      // ⚠️ 显式标注：⛔ 不写的话 TS 把三元推成 `string | null`，
      //   与 `eventStateOf` 声明的联合类型不兼容（tsc2322）。⛔ 别用 `as any` 绕过。
      const byKind: null | "book" | "water" =
        del.kind === "subagent" ? "book"      // 子智能体 ⇒ 多半在翻资料/读代码
        : del.kind === "expert" ? "water"    // 专家 ⇒ 常在取资料
        : null;                                 // team/member ⇒ 敲代码屏
      return { activity: byKind, thinking: byKind === "book", waiting: false, reporting: byKind === null };
    }
    const run = runningByMember[memberId];
    if (!run) return null;
    const act = activityOf(run.query);
    return {
      activity: act,
      /** 轨道里没有"思考"这个字段 ⇒ 派了查资料任务就算在"翻资料"（搜索屏）；
       *  其余在跑 ⇒ 敲代码屏；跑完（不在 runningByMember 里）⇒ 熄屏。 */
      thinking: act === "book",
      waiting: false,
      reporting: act === null,
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
      <div className="office-overlay-body">
        <OfficeCanvas members={members} onOpenMember={openMember} eventStateOf={eventStateOf} />
        {members.length === 0 && (
          <p className="office-overlay-empty">
            {team ? "这个团队还没有成员。" : "还没有调度任何子会话 —— 派一个子智能体或专家出去，这里就会多一个人。"}
          </p>
        )}
      </div>
    </div>
  );
}
