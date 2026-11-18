import { useEffect, useState } from "react";
import { Copy, Download, ExternalLink, RefreshCw, Wrench } from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard";
import { AgentAvatar } from "../../components/AgentAvatar";

export type GuideExpert = { team: ExpertTeamConfig; member: ExpertTeamMember };
type Caps = { tools?: string[]; skills?: string[] };
import { expertEquipment, equipmentState } from "../../lib/expert-equipment";
import { matchesGuideDirection, type GuideDirection } from "./guide-direction";

/** 选择专家并检查其角色所需的开发工具。 */
export function ExpertSetup({ value, onChange, install, direction, restoreKey }: { value: GuideExpert | null; onChange: (value: GuideExpert | null) => void; install: (id: string) => Promise<boolean>; direction: GuideDirection | null; restoreKey: string | null }) {
  const [teams, setTeams] = useState<ExpertTeamConfig[]>([]);
  const [rows, setRows] = useState<DevRuntimeEntry[] | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true;
    setNotice(""); setRows(null);
    void Promise.all([window.codex.listExpertTeams(), window.codex.listRuntimes()]).then(([teams, runtimes]) => {
      if (live) { setTeams(teams.filter(t => t.enabled !== false)); setRows(runtimes); }
    }).catch(() => { if (live) setNotice("专家或工具清单读取失败"); });
    return () => { live = false; };
  }, [revision]);
  const key = (v: GuideExpert) => JSON.stringify([v.team.teamId, v.member.id]);
  const experts = teams.flatMap(team => [team.lead, ...team.members].filter(member => matchesGuideDirection(direction, team.category, member.profession)).map(member => ({ team, member })));
  const current = value && experts.find(v => key(v) === key(value));
  useEffect(() => {
    if (!rows) return;
    if (restoreKey) onChange(experts.find(v => key(v) === restoreKey) ?? null);
    else if (value && !current) onChange(null);
  }, [rows, restoreKey, experts, value, current, onChange]);
  const team = current?.team as (ExpertTeamConfig & Caps) | undefined;
  const member = current?.member as (ExpertTeamMember & Caps) | undefined;
  const { tools, skills } = expertEquipment(team ?? {}, member ?? {});
  const run = async (id: string) => {
    setBusy(id); setNotice("");
    try {
      if (equipmentState(id, rows).state === "manual") {
        const result: { guide?: string; runtimes: DevRuntimeEntry[] } = await window.codex.installRuntime(id);
        setRows(result.runtimes);
        setNotice(result.guide ? "已打开官网，完成安装后请重新检测。" : "此平台没有下载页，请参考该工具的安装说明。");
        return;
      }
      const ok = await install(id);
      const fresh = await window.codex.listRuntimes(); setRows(fresh);
      setNotice(ok && fresh.some(r => r.id === id && r.installed) ? "安装完成，已重新检测" : "安装未完成，可重试或到开发工具查看详情");
    } catch { setNotice("无法确认安装结果，请重新检测"); } finally { setBusy(""); }
  };
  return <section className="profile-guide-expert">
    <div className="profile-guide-expert-heading"><strong>与专家开始工作</strong><button type="button" disabled={!!busy} title="重新检测专家和工具" aria-label="重新检测专家和工具" onClick={() => setRevision(v => v + 1)}><RefreshCw size={14} /></button></div>
    {(value || restoreKey) && <button type="button" className="profile-guide-no-expert" disabled={!!busy} onClick={() => onChange(null)}>暂不使用专家</button>}
    <details className="profile-guide-picker" open={!current}><summary>{current?.member.name ?? (rows ? "选择专家" : "等待检测")}</summary>
      <div className="profile-guide-start-grid">{experts.map(v => <button key={key(v)} type="button" className="profile-guide-pick" disabled={!!busy || !rows} aria-pressed={!!current && key(v) === key(current)} onClick={() => { setNotice(""); onChange(v); }}>
        <AgentAvatar kind="expert" seed={v.member.id} size={26} /><span><strong>{v.member.name}</strong><small>{v.member.profession.zh || v.team.displayName.zh}</small></span>
      </button>)}</div>{rows && !experts.length && <p>{direction ? "该方向暂无匹配的专家" : "暂无已启用的专家"}</p>}
    </details>
    {member && team && <><div className="profile-guide-expert-id"><AgentAvatar kind="expert" seed={member.id} size={38} /><div><strong>{member.name}</strong><small>{member.profession.zh || team.profession.zh} · {team.displayName.zh}</small></div></div>
      <p>{member.description || team.description.zh}</p><h4><Wrench size={14} />配套开发工具</h4>
      {!tools.length && <p>此专家未声明额外工具。</p>}
      {tools.map(id => {
        const tool = equipmentState(id, rows);
        const prompt = tool.fallbackPrompt;
        return <div className="profile-guide-tool" key={id} data-tool-id={id}>
          <span><strong>{tool.name}</strong><small>{tool.description}</small></span>
          {tool.state === "missing" || tool.state === "manual" ? <button type="button" disabled={!!busy} onClick={() => void run(id)}>
            {tool.state === "manual" ? <ExternalLink size={13} /> : <Download size={13} />}
            {tool.state === "manual" ? "去官网安装" : busy === id ? "安装中" : tool.bundled ? "修复安装" : "下载安装"}
          </button> : <span>{({ready: "已就绪", unknown: "待检测", unavailable: id === "cheat-on-content" && prompt ? "随包文件缺失，查看修复指引" : "当前环境未提供", installing: "安装中"})[tool.state]}</span>}
          {prompt && <details className="profile-guide-tool-prompt"><summary>让 Codex 帮我安装</summary>
            <pre>{prompt}</pre><button type="button" aria-label={`复制 ${tool.name} 的安装提示词`} onClick={async () => {
              try { await copyTextToClipboard(prompt); setNotice(`已复制「${tool.name}」的安装提示词，粘贴到 Codex 会话即可。`); }
              catch { setNotice("复制失败，请选中上方提示词手动复制。"); }
            }}><Copy size={13} />复制安装提示词</button>
          </details>}
        </div>;
      })}
      {skills.length > 0 && <p>配套技能：{skills.join("、")}</p>}
    </>}
    <small role="status">{notice}</small>
  </section>;
}
