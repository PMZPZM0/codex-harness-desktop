/**
 * 共享技能池（09-27 用户需求）：技能中心里的「按项目生效」管理区块。
 *
 * 视觉：完全复用技能中心现有组件类（skill-card-grid compact / skill-card-compact /
 * resource-toolbar / SearchField / ToggleSwitch）——DESIGN.md「照着找」纪律，不发明新样式。
 *
 * 语义（与 electron/skill-pool.ts 对齐）：
 *  - 「全局停用」= 跨项目停用（所有会话不见，卡片置灰 + 徽标）；
 *  - 「本项目停用」= 只在当前项目不生效（徽标 + 开关关）；
 *  - 实际生效 = 全局启用 ∩ 非本项目停用；每次改动立即投影磁盘（下一请求即生效）。
 *
 * 数据自取（不经 bag/part05）：自包含轻面板，避开【92】顺序契约与 bag-types 再生成；
 * workspace 从 localStorage 直读（与 e2e-harness 同一入口）。
 */
import { useCallback, useEffect, useState } from "react";
import { FolderKanban, RefreshCw, X } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { SearchField, ToggleSwitch } from "../../components/SettingsWidgets";

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
  const [query, setQuery] = useState("");

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
        <span className="skill-filter-count">选择当前项目里哪些全局技能生效——关掉的在其他项目照常可用</span>
      </div>
    );
  }

  const keyword = query.trim().toLowerCase();
  const shown = skills.filter((s) => !keyword || s.name.toLowerCase().includes(keyword));
  const activeCount = skills.filter((s) => s.active).length;

  return (
    <section className="skill-installed-group">
      <header>
        <span className="skill-group-dot tag-market" />
        共享技能池 — 按项目生效
        <small>
          当前项目 <code>{workspace || "（未选择工作区）"}</code> · 生效 {activeCount}/{skills.length}
        </small>
        <div className="skill-card-compact-tools">
          <button className="icon-button" title="刷新" onClick={refresh}>{loading ? <Spinner /> : <RefreshCw size={13} />}</button>
          <button className="icon-button" title="收起面板" onClick={() => setOpen(false)}><X size={13} /></button>
        </div>
      </header>
      {!workspace && <p className="muted">先在侧栏选择工作区，再管理该项目的技能生效集。</p>}
      {workspace && (
        <>
          <div className="resource-toolbar secondary">
            <SearchField value={query} onChange={setQuery} placeholder="搜索技能名称" />
            <span className="skill-filter-count">生效 = 全局启用 ∩ 非本项目停用 · 改动立即写入引擎，下一次请求（含专家/专家团）即生效</span>
          </div>
          <div className="skill-card-grid compact">
            {shown.map((s) => {
              const globalOff = s.globalDisabled;
              const projectOff = s.projectDisabled;
              const active = s.active;
              return (
                <article className={`skill-card-compact ${globalOff ? "is-disabled" : ""}`} key={s.name}>
                  <div className="skill-card-compact-head">
                    <div className="skill-card-head-left">
                      {globalOff && <em className="skill-disabled-label">全局停用</em>}
                      {!globalOff && projectOff && <em className="skill-disabled-label">本项目停用</em>}
                    </div>
                    <ToggleSwitch
                      checked={active}
                      disabled={globalOff || busy === s.name}
                      label={`${s.name} 本项目生效开关`}
                      title={globalOff
                        ? "该技能已全局停用（所有项目不可见）——如需在本项目使用，先在上方「我的技能」卡片把它全局启用"
                        : active ? "在本项目停用该技能（其他项目不受影响）" : "在本项目启用该技能"}
                      onChange={() => patch(s.name, { projectDisabled: active })}
                    />
                  </div>
                  <strong>{s.name}</strong>
                  <div className="skill-card-compact-foot">
                    <span className="skill-card-path" title={active ? "本会话清单会注入该技能" : "引擎清单不注入该技能（本项目）"}>
                      {active ? "本项目生效" : "本项目不生效"}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
          {!shown.length && <p className="muted">{keyword ? "没有匹配的技能。" : "技能目录为空。"}</p>}
          <p className="muted">
            引擎限制：同一时刻技能目录只有一种全局状态——若同时运行两个不同项目的会话，后启动的一方决定实际清单。
          </p>
        </>
      )}
    </section>
  );
}
