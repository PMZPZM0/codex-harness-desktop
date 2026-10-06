/**
 * 共享技能池（09-27 用户需求）：技能中心里的「按项目生效」管理区块。
 *
 * 视觉：完全复用技能中心现有组件类（skill-card-grid compact / skill-card-compact /
 * resource-toolbar / SearchField / ToggleSwitch）；项目切换器复用记忆中心的
 * memory-project-picker 组件类（同是「当前管理项目」语义，不发明新样式）——DESIGN.md「照着找」。
 *
 * 语义（与 electron/skill-pool.ts 对齐）：
 *  - 「全局停用」= 跨项目停用（所有会话不见，卡片置灰 + 徽标）；
 *  - 「本项目停用」= 只在该项目不生效（徽标 + 开关关）；
 *  - 实际生效 = 全局启用 ∩ 非该项目停用；每次改动立即投影磁盘（下一请求即生效）。
 *  - 管理对象（项目）可切换：默认当前工作区，可切到其他已知项目改它的池配置
 *    （09-27 用户需求「方便快速切换其他项目，进行技能禁用」）；只切管理目标，
 *    不改当前会话工作区。
 *
 * 数据自取（不经 bag/part05）：自包含轻面板，避开【92】顺序契约与 bag-types 再生成；
 * workspace 从 localStorage 直读（与 e2e-harness 同一入口）；项目清单由父级穿
 * props.projects（bag.projectGroups 的 [cwd, threads][]，免自建 IPC）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, FolderKanban, FolderOpen, RefreshCw, X } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { SearchField, ToggleSwitch } from "../../components/SettingsWidgets";
import { CJK_TEXT_RE, SKILL_ZH_NOTES } from "../app-view/constants";

type PoolSkill = { name: string; globalDisabled: boolean; projectDisabled: boolean; active: boolean };

/** 技能的中文注释（09-30 用户：「注释呢」—— 共享技能池的卡片此前只有名字没有说明）：
 *  注释表命中优先；描述里带中文就直接用；都没有再走通用兜底。 */
function poolZhNote(name: string): string {
  const key = String(name ?? "").toLowerCase().trim();
  const note = SKILL_ZH_NOTES[key];
  if (note) return note;
  return "已安装技能（在「我的技能」卡片看完整说明）";
}

function readWorkspace(): string {
  try { return localStorage.getItem("workspace") ?? ""; } catch { return ""; }
}

function basename(cwd: string): string {
  return cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || cwd;
}

export function SkillPoolSection({ projects, onNotice }: { projects?: [string, unknown][]; onNotice?: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [skills, setSkills] = useState<PoolSkill[]>([]);
  const [currentWs, setCurrentWs] = useState(readWorkspace);
  /** 正在管理哪个项目的池（默认 = 当前工作区；可切换到其他项目）。 */
  const [target, setTarget] = useState(readWorkspace);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback((cwd = target) => {
    setCurrentWs(readWorkspace());
    if (!open || !cwd) return;
    setLoading(true);
    window.codex.describeSkillPool({ cwd })
      .then((r) => setSkills(r.skills ?? []))
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, [open, target]);

  useEffect(() => { refresh(target); }, [refresh, target]);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === "workspace") { setCurrentWs(readWorkspace()); refresh(); } };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  // 项目选择菜单：点击外部 / Esc 关闭（同记忆中心 memory-project-picker 的交互）
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      const node = event.target;
      if (!(node instanceof Node) || !pickerRef.current?.contains(node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => { document.removeEventListener("pointerdown", close, true); document.removeEventListener("keydown", onKeyDown, true); };
  }, [menuOpen]);

  /* ⛔ 每次拨动都要回执（10-06 用户：「很多开发都没有通知提醒，全部检查一下」）。
     此前这里是 `.catch(() => undefined)` —— **成功静默、失败也静默**：开关看着拨过去了，
     磁盘/引擎那边成没成完全不知道（而"控制台·回复风格"是同一个技能的另一入口，同样静默）。
     ⛔ 回执走父级穿透的 `onNotice`（本面板按 09-27 的设计**自取数据、不经 bag**，
        所以不能直接拿 bag.setNotice；保持自包含的同时把结果报上去）。 */
  const patch = (name: string, p: { globalDisabled?: boolean; projectDisabled?: boolean }) => {
    if (!target) return;
    setBusy(name);
    const what = p.globalDisabled === false ? "已全局恢复"
      : p.globalDisabled === true ? "已全局停用"
      : p.projectDisabled === true ? "已在该项目停用" : "已在该项目启用";
    window.codex.setSkillPoolState({ cwd: target, name, ...p })
      .then(() => window.codex.describeSkillPool({ cwd: target }))
      .then((r) => {
        setSkills(r.skills ?? []);
        onNotice?.(`技能「${name}」${what}`);
      })
      .catch((error: any) => onNotice?.(`技能「${name}」切换失败：${error?.message ?? String(error)}`))
      .finally(() => setBusy(null));
  };

  // 项目清单 = 当前工作区 ∪ 已知项目（按最近活动排序，来自 bag.projectGroups）
  const knownProjects = Array.from(new Set([currentWs, ...(projects ?? []).map(([cwd]) => cwd)].filter(Boolean))) as string[];

  if (!open) {
    return (
      <div className="resource-toolbar secondary">
        <button className="secondary-setting" onClick={() => setOpen(true)}>
          <FolderKanban size={14} />共享技能池（按项目生效）
        </button>
        <span className="skill-filter-count">选择项目里哪些全局技能生效——关掉的在其他项目照常可用，可切换项目管理不同项目</span>
      </div>
    );
  }

  const keyword = query.trim().toLowerCase();
  const shown = skills.filter((s) => !keyword || s.name.toLowerCase().includes(keyword));
  const activeCount = skills.filter((s) => s.active).length;
  const managingOther = Boolean(target && currentWs && target !== currentWs);

  return (
    <section className="skill-installed-group">
      <header>
        <span className="skill-group-dot tag-market" />
        共享技能池 — 按项目生效
        <small>
          生效 {activeCount}/{skills.length}{target ? <> · 管理对象 <code>{basename(target)}</code></> : null}
        </small>
        <div className="skill-card-compact-tools">
          <button className="icon-button" title="刷新" onClick={() => refresh()}>{loading ? <Spinner /> : <RefreshCw size={13} />}</button>
          <button className="icon-button" title="收起面板" onClick={() => setOpen(false)}><X size={13} /></button>
        </div>
      </header>
      {!target && <p className="muted">从下方选一个项目，管理它的技能生效集；或在侧栏打开工作区后自动选中。</p>}
      <div className="memory-project-context skill-pool-context">
        <div className="memory-project-context-copy"><FolderOpen size={14} /><div><strong>管理项目</strong><span>{!target ? "选择项目后即列出其技能生效集" : managingOther ? "正在管理其他项目 · 该项目下次开会话时生效" : "切换项目可分别管理各自生效集"}</span></div></div>
        <div className={`memory-project-picker ${menuOpen ? "open" : ""}`} ref={pickerRef}>
          <button type="button" className="memory-project-picker-button" aria-haspopup="listbox" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
            <FolderOpen size={14} aria-hidden="true" />
            <span className="memory-project-picker-current"><strong>{target ? basename(target) : "选择项目"}</strong><small title={target}>{target || "从已打开过工作区的项目里选"}</small></span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {menuOpen && <div className="memory-project-picker-menu" role="listbox" aria-label="选择要管理的项目">
            {knownProjects.map((cwd) => (
              <button type="button" role="option" aria-selected={target === cwd} className={`memory-project-option ${target === cwd ? "selected" : ""}`} key={cwd}
                onClick={() => { setTarget(cwd); setMenuOpen(false); }}>
                <span className="memory-project-option-icon"><FolderOpen size={14} /></span>
                <span className="memory-project-option-copy"><strong>{basename(cwd)}{cwd === currentWs ? "（当前）" : ""}</strong><small title={cwd}>{cwd}</small></span>
                {target === cwd && <Check size={14} />}
              </button>
            ))}
            {!knownProjects.length && <div className="memory-project-option-empty">还没有发现项目，请先打开一个工作区</div>}
          </div>}
        </div>
      </div>
      {target && (
        <>
          <div className="resource-toolbar secondary">
            <SearchField value={query} onChange={setQuery} placeholder="搜索技能名称" />
            <span className="skill-filter-count">生效 = 全局启用 ∩ 非该项目停用 · 改动立即写入引擎，下一次请求（含专家/专家团）即生效</span>
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
                      {!globalOff && projectOff && <em className="skill-disabled-label">{managingOther ? "该项目停用" : "本项目停用"}</em>}
                    </div>
                    <ToggleSwitch
                      checked={active}
                      /* ⛔ 「全局停用」时**不再禁用开关**（10-06 修正）：原先这里 disable 掉并提示
                         「先在上方『我的技能』卡片把它全局启用」，但**内置技能在「我的技能」里
                         本来就不可停用/启用**（那张卡片的开关对 builtin 是 disabled）⇒ 死胡同。
                         此前这个分支等于是死代码（界面上没有任何入口能产生 globalDisabled）；
                         10-06 控制台加了「回复风格」开关后它成了活路径，所以在这里补上恢复入口：
                         全局停用态下点开关 = **恢复全局启用**（清全局停用集），不是只改本项目。 */
                      disabled={busy === s.name}
                      label={`${s.name} 项目生效开关`}
                      title={globalOff
                        ? "该技能已全局停用（所有项目不可见）——点开即全局恢复；内置技能在「我的技能」里不可停用，这里是恢复入口"
                        : active ? (managingOther ? "在该项目停用该技能（其他项目不受影响）" : "在本项目停用该技能（其他项目不受影响）") : (managingOther ? "在该项目启用该技能" : "在本项目启用该技能")}
                      onChange={() => patch(s.name, globalOff ? { globalDisabled: false } : { projectDisabled: active })}
                    />
                  </div>
                  <strong>{s.name}</strong>
                  <p className="skill-card-zh-note">{CJK_TEXT_RE.test(poolZhNote(s.name)) ? poolZhNote(s.name) : ""}</p>
                  <div className="skill-card-compact-foot">
                    <span className="skill-card-path" title={active ? "该项目会话清单会注入该技能" : "引擎清单不注入该技能（该项目）"}>
                      {active ? "该项目生效" : "该项目不生效"}
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
