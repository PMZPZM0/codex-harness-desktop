/**
 * 共享技能池（09-27 用户需求）：技能中心里的「按项目生效」管理区块。
 *
 * 数据自取（不经 bag/part05）：本区块是自包含的轻管理面板——挂到全局状态树要走
 * 【92】顺序契约与 bag-types 再生成，为一个设置子面板不值当；workspace 从
 * localStorage 直读（与 e2e 同一入口，e2e-harness 也这么注入）。
 *
 * 语义（与 electron/skill-pool.ts 对齐）：
 *  - 「全局停用」= 跨项目停用（所有会话不见）；
 *  - 「本项目禁用」= 只在当前项目不生效，其他项目照常；
 *  - 实际生效 = 全局启用 ∩ 非本项目禁用；每次改动立即投影磁盘（引擎下一请求即生效）。
 */
import { useCallback, useEffect, useState } from "react";
import { FolderKanban, RefreshCw } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { ToggleSwitch } from "../../components/SettingsWidgets";

type PoolSkill = { name: string; globalDisabled: boolean; projectDisabled: boolean; active: boolean };

function readWorkspace(): string {
  try { return localStorage.getItem("workspace") ?? ""; } catch { return ""; }
}

export function SkillPoolSection() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [skills, setSkills] = useState<PoolSkill[]>([]);
  const [workspace, setWorkspace] = useState(readWorkspace);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const cwd = readWorkspace();
    setWorkspace(cwd);
    if (!open || !cwd) return;
    setLoading(true);
    window.codex.describeSkillPool({ cwd })
      .then((r) => setSkills(r.skills ?? []))
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => { refresh(); }, [refresh]);
  // 切换工作区后重新拉取（面板展开时）
  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === "workspace") refresh(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  const patch = (name: string, p: { globalDisabled?: boolean; projectDisabled?: boolean }) => {
    const cwd = readWorkspace();
    if (!cwd) return;
    setBusy(name);
    window.codex.setSkillPoolState({ cwd, name, ...p })
      .then(() => window.codex.describeSkillPool({ cwd }))
      .then((r) => setSkills(r.skills ?? []))
      .catch(() => undefined)
      .finally(() => setBusy(null));
  };

  if (!open) {
    return (
      <div className="resource-toolbar secondary">
        <button className="secondary-setting" onClick={() => setOpen(true)}>
          <FolderKanban size={14} />共享技能池（按项目生效）
        </button>
        <span className="skill-filter-count">管理每个项目里哪些全局技能生效——不勾的技能在其他项目照常可用</span>
      </div>
    );
  }

  const activeCount = skills.filter((s) => s.active).length;
  return (
    <section className="skill-installed-group skill-pool-panel">
      <header>
        <span className="skill-group-dot tag-market" />
        共享技能池 — 按项目生效
        <small>
          当前项目：<code>{workspace || "（未选择工作区）"}</code> · 生效 {activeCount}/{skills.length}
          <button className="icon-button" title="收起面板" onClick={() => setOpen(false)}><FolderKanban size={13} /></button>
        </small>
      </header>
      {!workspace && <p className="muted">先在侧栏选择工作区，再管理该项目的技能生效集。</p>}
      {workspace && loading && <p className="muted"><Spinner /> 读取中…</p>}
      {workspace && !loading && (
        <div className="skill-pool-list">
          {skills.map((s) => {
            const active = s.active;
            return (
              <div className={`skill-pool-row ${active ? "" : "is-off"}`} key={s.name}>
                <strong>{s.name}</strong>
                <span className="skill-pool-states">
                  {s.globalDisabled && <em className="skill-disabled-label">全局停用</em>}
                  <ToggleSwitch
                    checked={active}
                    disabled={busy === s.name}
                    label={`${s.name} 本项目生效开关`}
                    title={s.globalDisabled
                      ? "该技能已全局停用（所有项目不可见）；如需在本项目使用，先在上方卡片把它全局启用"
                      : active ? "在本项目停用该技能（其他项目不受影响）" : "在本项目启用该技能"}
                    onChange={() => patch(s.name, { projectDisabled: active })}
                  />
                </span>
              </div>
            );
          })}
          {!skills.length && <p className="muted">技能目录为空。</p>}
        </div>
      )}
      <p className="muted skill-pool-note">
        生效 = 全局启用 ∩ 非本项目禁用；改动立即写入引擎技能目录，下一次请求（含专家/专家团）即按此注入。
        引擎限制：同一时刻技能目录只有一种全局状态——若同时运行两个不同项目的会话，后启动的一方决定实际清单。
      </p>
    </section>
  );
}
