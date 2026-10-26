/**
 * 群成员**选择器**（10-26 用户令重做拉人面板）。
 *
 * ⛔⛔ 原实现的问题（用户原话：「你这个加入逻辑也不对，光一个名字有啥用」）：
 *   拉人面板只有「名字 + 岗位」两个输入框 ⇒ 用户必须**手打**一个不存在的成员，
 *   拉进来的人**没有任何配置**（没模型、没岗位定义、没 systemPrompt）
 *   ⇒ 派活时只能吃全局默认，甚至压根派不出去。
 *
 * ── 新机制 ───────────────────────────────────────────────────────────────
 * ① 候选来自**真实的专家团登记表**（`boss-groups:pool` → experts）：
 *    组长 + 成员，带完整配置（model / effort / sandbox / approvalPolicy / systemPrompt）。
 * ② 用户**点选**成员卡即加入（不用手打名字）。
 * ③ **CLI 成员不手动加**（用户原话：「cli成员就让Codex添加就行」）——
 *    本机外部 agent 需要命令行模板 + 检测结果，交给 Codex 在群里用
 *    `group_add_member(from="cli")` 拉更合适；面板里只给一行说明。
 * ④ 加完就**能干活**：加入时带上完整配置（主进程 `memberForBoss` 已按专家源带全）。
 *
 * 视觉：头像 + 名字 + 岗位，绿灯表示"正在干活"。
 */
import { useEffect, useMemo, useState } from "react";
import { Bot, Check, Crown, LoaderCircle, Users } from "lucide-react";
import { AVATAR_GRADIENTS, avatarToneOf } from "../../lib/entity-avatar";

export type PoolExpert = {
  teamId: string;
  teamName: string;
  memberId: string;
  name: string;
  role: string;
  description?: string;
  model?: string;
  effort?: string;
  sandbox?: string;
  approvalPolicy?: string;
  isLead?: boolean;
};

export type PoolCliAgent = { name: string; role: string; command: string; detected: boolean };

type Props = {
  /** 候选池（主进程给的真实专家名单） */
  experts: PoolExpert[];
  cliAgents: PoolCliAgent[];
  /** 已经在群里的成员 id（memberId 口径：专家用 memberId，群里存的是带后缀的 id） */
  inGroupNames: string[];
  busy: boolean;
  /** 点选一个专家 → 加入群 */
  onPick: (expert: PoolExpert) => void;
  onClose: () => void;
};

/** 按专家团分组（保持登记表顺序）。 */
function groupByTeam(experts: PoolExpert[]) {
  const map = new Map<string, { teamId: string; teamName: string; members: PoolExpert[] }>();
  for (const e of experts) {
    let g = map.get(e.teamId);
    if (!g) {
      g = { teamId: e.teamId, teamName: e.teamName, members: [] };
      map.set(e.teamId, g);
    }
    g.members.push(e);
  }
  return [...map.values()];
}

export function BossGroupMemberPicker({ experts, cliAgents, inGroupNames, busy, onPick, onClose }: Props) {
  const teams = useMemo(() => groupByTeam(experts), [experts]);
  const [teamId, setTeamId] = useState<string>(teams[0]?.teamId ?? "");
  const active = teams.find((t) => t.teamId === teamId) ?? teams[0];

  /* ⛔ 专家团列表变了（新登记的团）⇒ 选中的团可能已不存在 ⇒ 落回第一个。 */
  useEffect(() => {
    if (!teams.some((t) => t.teamId === teamId)) setTeamId(teams[0]?.teamId ?? "");
  }, [teams, teamId]);

  const inGroup = new Set(inGroupNames);
  const detectedCli = cliAgents.filter((a) => a.detected);

  return (
    <section className="boss-picker" aria-label="选择要加入的成员">
      <header className="boss-picker-head">
        <span className="boss-picker-title"><Users size={13} /> 挑人进群</span>
        <button type="button" className="boss-panel-mini" onClick={onClose}>收起</button>
      </header>

      {!teams.length ? (
        <p className="boss-picker-empty">
          专家名单是空的。到「扩展功能 → 专家团」登记专家团（带职业定义与模型），这里就能挑人。
          <br />
          临时要个自定义成员？对中枢说「拉个 XX 进来，岗位 YY」也行。
        </p>
      ) : (
        <>
          {teams.length > 1 ? (
            <div className="boss-picker-teams">
              {teams.map((t) => (
                <button
                  key={t.teamId}
                  type="button"
                  className={`boss-picker-team${t.teamId === active?.teamId ? " is-active" : ""}`}
                  onClick={() => setTeamId(t.teamId)}
                >
                  {t.teamName}
                  <em>{t.members.length}</em>
                </button>
              ))}
            </div>
          ) : null}

          <div className="boss-picker-grid">
            {(active?.members ?? []).map((m) => {
              const already = inGroup.has(m.name);
              return (
                <button
                  key={`${m.teamId}:${m.memberId}`}
                  type="button"
                  className={`boss-picker-card${already ? " is-in" : ""}`}
                  disabled={busy || already}
                  title={m.description || m.role}
                  onClick={() => onPick(m)}
                >
                  <span className="boss-picker-avatar" style={{ background: AVATAR_GRADIENTS[avatarToneOf(m.memberId || m.name)] }}>
                    {m.isLead ? <Crown size={14} /> : <Bot size={14} />}
                  </span>
                  <span className="boss-picker-info">
                    <strong>{m.name}</strong>
                    <small>{m.role}</small>
                    {m.model ? <em className="boss-picker-model">{m.model}</em> : null}
                  </span>
                  {already ? (
                    <span className="boss-picker-done"><Check size={12} /> 在群里</span>
                  ) : busy ? (
                    <LoaderCircle size={13} className="boss-picker-spin" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </>
      )}

      <footer className="boss-picker-foot">
        <span className="boss-picker-note">
          点一下就进群（模型、岗位、权限一起带过去）。
          {detectedCli.length ? ` 本机 CLI agent（${detectedCli.map((a) => a.name).join("、")}）` : " 本机 CLI agent"}
          交给 Codex 拉更合适 —— 对中枢说「把 XX 拉进群」。
        </span>
      </footer>
    </section>
  );
}
