/**
 * 团队工作模式（10-24）—— 云账号页里的一个独立区块。
 *
 * 为什么需要它：团队记忆 / 团队知识库在云端只是"凭据 + 库"，本机默认什么都没接。
 * 这一块负责把本机切到某个团队：**对话上游换成团队记忆端点**（记忆在请求层自动注入/写入），
 * **团队知识库接成 MCP 连接器**（与个人 cloud-kb 互斥，工具名相同）。
 *
 * ⛔ 三条必须在界面上讲清楚（否则用户会以为"个人记忆坏了"）：
 *   ① 记忆通道是**独占**的：进入团队 = 个人记忆暂停；退出后要回云账号页再同步一次个人记忆。
 *   ② 团队库和个人库**不能同时接**（两个 WeKnora 连接器工具名相同）。
 *   ③ 空间没开通时如实说"未开通"，⛔ 不画一个假装能用的开关。
 */
import { useCallback, useEffect, useState } from "react";
import { LogIn, LogOut, RefreshCw, TriangleAlert, Users } from "lucide-react";
import { AppSelect } from "../../components/AppSelect";

type TeamRow = {
  id: string;
  name: string;
  role: string;
  seats: { used: number; limit: number };
  memoryEnabled: boolean;
  kbEnabled: boolean;
};

type TeamStatus = {
  active: boolean;
  team: { id: string; name: string; role: string; enteredAt: number } | null;
  memory: { on: boolean; scope: "team" | "personal" | "model" };
  kb: { teamConnector: boolean; personalConnector: boolean; url: string };
};

type EnterReply = {
  ok: boolean;
  error?: string;
  team?: { id: string; name: string };
  memory?: { ready: boolean };
  kb?: { ready: boolean; url: string };
  missing?: string[];
};

type TeamApi = {
  teamList?: () => Promise<{ ok: boolean; teams: TeamRow[]; error?: string; policyEnabled?: boolean }>;
  teamEnter?: (input?: { teamId?: string }) => Promise<EnterReply>;
  teamExit?: () => Promise<{ ok: boolean; error?: string; note?: string }>;
  teamStatus?: () => Promise<{ ok: boolean } & TeamStatus>;
};

const teamApi = (): TeamApi => window.codex as unknown as TeamApi;

const ROLE_LABEL: Record<string, string> = { owner: "所有者", admin: "管理员", member: "成员" };

/** 一句话说清现在生效的是什么（⛔ 三态互斥，别让用户自己推）。 */
function scopeText(st: TeamStatus | null): string {
  if (!st) return "读取中…";
  if (st.memory.scope === "team") return "对话已走团队记忆（请求层自动注入 / 写入）";
  if (st.memory.scope === "personal") return "对话走个人记忆（团队记忆未生效）";
  return "对话走纯模型端点（没有记忆）";
}

export function TeamModeSection() {
  const [teams, setTeams] = useState<TeamRow[] | null>(null);
  const [status, setStatus] = useState<TeamStatus | null>(null);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const api = teamApi();
    const [list, st] = await Promise.all([api.teamList?.(), api.teamStatus?.()]);
    if (list && list.ok) {
      setTeams(list.teams);
      setErr("");
    } else {
      setTeams([]);
      setErr(list?.error === "not-logged-in" ? "not-logged-in" : list?.error || "读取团队列表失败");
    }
    if (st && st.ok) {
      setStatus({ active: st.active, team: st.team, memory: st.memory, kb: st.kb });
      if (st.active && st.team) setPick(st.team.id);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const enter = async () => {
    const teamId = pick || status?.team?.id || "";
    if (!teamId) return;
    setBusy("enter");
    setMsg(null);
    try {
      const r = (await teamApi().teamEnter?.({ teamId })) || { ok: false, error: "通道未就绪" };
      if (!r.ok) {
        const map: Record<string, string> = {
          "not-a-member": "你不是这个团队的成员",
          "not-logged-in": "云账号未登录",
          "safe-storage-unavailable": "系统安全存储不可用，无法保存团队凭据",
          "missing-team-id": "没选团队",
        };
        setMsg({ tone: "bad", text: map[r.error || ""] || `进入失败：${r.error || "未知错误"}` });
        return;
      }
      const parts = [
        r.memory?.ready ? "团队记忆已接通" : "团队记忆未接通",
        r.kb?.ready ? "团队知识库已接成本机 MCP" : "团队知识库未接通",
      ];
      setMsg({
        tone: r.memory?.ready || r.kb?.ready ? "ok" : "bad",
        text: parts.join(" · ") + (r.missing?.length ? `（${r.missing.join("；")}）` : ""),
      });
      await load();
    } finally {
      setBusy("");
    }
  };

  const exit = async () => {
    setBusy("exit");
    setMsg(null);
    try {
      const r = (await teamApi().teamExit?.()) || { ok: false, error: "通道未就绪" };
      setMsg({ tone: r.ok ? "ok" : "bad", text: r.ok ? r.note || "已退出团队模式" : `退出失败：${r.error || "未知错误"}` });
      await load();
    } finally {
      setBusy("");
    }
  };

  const active = Boolean(status?.active);
  const notLoggedIn = err === "not-logged-in";

  return (
    <section className="cloud-team-block" data-testid="team-mode-section">
      <div className="cloud-team-head">
        <Users size={16} />
        <b>团队工作模式</b>
        <span className={`cloud-acct-tag ${active ? "on" : "off"}`}>{active ? `已进入：${status?.team?.name || ""}` : "未进入"}</span>
        <button className="cloud-team-refresh" type="button" onClick={() => void load()} title="刷新">
          <RefreshCw size={13} />
        </button>
      </div>

      <p className="cloud-team-note">
        进入后：<b>对话上游切到团队记忆</b>（记忆在请求层自动注入 / 写入，队友进入同一团队即共享），
        <b>团队知识库接成本机 MCP</b>（模型可检索团队文档）。多人开发同一个项目时，大家进入同一个团队 = 同一份项目记忆与文档。
      </p>

      {notLoggedIn ? (
        <p className="cloud-team-hint">先在页面上方登录云账号，团队列表才会出来。</p>
      ) : (
        <div className="cloud-team-row">
          {/* ⛔ 渲染层禁用原生 select（守卫【197】）：用 AppSelect（自带弹层/键盘/翻转） */}
          <AppSelect
            className="cloud-team-pick"
            value={pick}
            onChange={setPick}
            ariaLabel="选择团队"
            options={[
              { value: "", label: teams === null ? "读取中…" : teams.length ? "选择团队…" : "没有可用的团队" },
              ...(teams || []).map((t) => ({
                value: t.id,
                label: `${t.name}（${ROLE_LABEL[t.role] || t.role} · 席位 ${t.seats.used}/${t.seats.limit}）`,
              })),
            ]}
          />
          <button className="cloud-team-btn primary" type="button" disabled={!pick || Boolean(busy)} onClick={() => void enter()}>
            <LogIn size={14} />{busy === "enter" ? "正在进入…" : "进入团队模式"}
          </button>
          <button className="cloud-team-btn" type="button" disabled={!active || Boolean(busy)} onClick={() => void exit()}>
            <LogOut size={14} />{busy === "exit" ? "正在退出…" : "退出"}
          </button>
        </div>
      )}

      {err && !notLoggedIn ? (
        <p className="cloud-team-bad"><TriangleAlert size={13} />{err === "unauthorized" ? "登录已过期，请重新登录云账号" : err}</p>
      ) : null}

      <div className="cloud-team-state">
        <span>记忆通道：{scopeText(status)}</span>
        <span>团队知识库：{status?.kb.teamConnector ? "已接（cloud-kb-team）" : "未接"}</span>
        <span>个人知识库：{status?.kb.personalConnector ? "已接（进入团队时会暂时让位）" : "未接"}</span>
      </div>

      <p className="cloud-team-hint">
        ⛔ 记忆通道是独占的：进入团队后<b>个人记忆暂停</b>；退出后回本页点一次「同步记忆」即可恢复个人记忆。
        团队空间由团队 owner 在网页端「团队概览 → 开通 / 修复团队空间」创建。
      </p>

      {msg ? <p className={msg.tone === "ok" ? "cloud-team-ok" : "cloud-team-bad"}>{msg.text}</p> : null}
    </section>
  );
}
