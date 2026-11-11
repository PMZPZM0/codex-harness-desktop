/**
 * 团队模式 · 新建群弹窗（11-06 用户：「这个新建群里展示也不好看，做成弹窗，功能丰富一点」）
 *
 * ⛔ 为什么不再用左栏内联输入框：那块只有「名字 + 创建」，塞在 176px 的窄栏里 ——
 *   名字输入和「创建」按钮挤成两截，群简介 / 项目地址 / 初始伙伴全都没地方放，
 *   用户建完群还得再点进群设置补一遍。做成弹窗后**一次填完**。
 *
 * ⛔ 只做真会生效的东西（项目纪律：不做装饰）：
 *   · 群简介 → `memory`，每次派活拼在用户那句话前面注入；
 *   · 项目地址 → `workspace`，派活时作为子会话 cwd（主进程当场校验必须是存在的绝对目录）；
 *   · 初始伙伴 → `members[]`，与设置页「添加伙伴」同一份 `agents:catalog`、同一个 `id` 口径
 *     （`tgt:<kind>:<key>` ⇒ 同一目标重复加会被纯函数判重，不会出现两个同名伙伴）。
 *
 * ⛔ 模式互斥判据走 `addModeStateOf`（唯一真相源，有单测）：纯新群可加专家团；
 *   已经选了别的伙伴就不能再加团，反之亦然 —— 与设置页行为一致。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, FolderOpen, Search, Sparkles, Users, X } from "lucide-react";
import { LOCAL_ACTOR_ID } from "./02-team-store";
import { addModeStateOf } from "../../lib/team-models.mjs";
import { useEscapeLayer } from "../../hooks/useEscapeLayer";

type Target = { kind: string; key: string; name: string; profession?: string; installed?: boolean };

type AddMode = "expert" | "team" | "custom";
const MODE_KINDS: Record<AddMode, Set<string>> = {
  /* ⛔ 11-08 用户（截图）：「创建群里…专家还是很少」—— 专家模式原来只筛 kind=expert，
     专家团里的成员（问需/构梁/键客…）全被挡掉 ⇒ 只剩十来个「主理人 + 单人专家」。
     ⇒ 团成员也是**单个专家**，一并列出（与群设置页「添加伙伴」同口径）。 */
  expert: new Set(["expert", "member"]),
  team: new Set(["team"]),
  custom: new Set(["subagent", "cli"]),
};
const MODE_LABEL: Record<AddMode, string> = { expert: "专家模式", team: "专家团模式", custom: "自定义专家模式" };
const MODE_HINT: Record<AddMode, string> = {
  expert: "后台「专家中心」里的单个专家（含专家团里的角色），点名即派。",
  team: "后台「专家团」列表，整团按 SOP 协作；只能在纯新群加。",
  custom: "你自己建的子智能体，或本机 CLI。",
};
const ADD_MODES: AddMode[] = ["expert", "team", "custom"];
const KIND_SHORT: Record<string, string> = { expert: "专家", team: "专家团", subagent: "子智能体", cli: "CLI", member: "团成员" };

/** 群名建议（点一下就填）—— 只是省打字，⛔ 不限制用户自己起名 */
const NAME_IDEAS = ["内容生产组", "数据分析组", "前端攻坚组", "运营支持组"];

/** 建群入参：与主进程 `createGroup` 同字段（名字 + 初始伙伴 + 群简介 + 项目地址）。 */
export type TeamCreateInput = {
  name: string;
  memory?: string;
  workspace?: string;
  leadId?: string;
  members?: Array<Record<string, unknown>>;
};

type Props = {
  open: boolean;
  /** 已有群数 / 上限（达上限时不允许再建） */
  count: number;
  limit: number;
  onClose: () => void;
  onCreate: (input: TeamCreateInput) => Promise<{ ok: boolean; error?: string; id?: string }>;
  /** 建完把新群选中（父层负责读它的消息） */
  onCreated?: (id: string) => void;
  /** ⛔ 11-12 用户：「这里还不能直接设置管理员？」—— 建完就在这一屏设，别让人再跑一趟群设置。 */
  onSetAdmin?: (groupId: string, memberId: string) => Promise<{ ok?: boolean; error?: string }>;
};

/** 建群弹窗：群名、记忆、工作区与初始成员（受成员数上限约束）。 */
export function TeamCreateDialog({ open, count, limit, onClose, onCreate, onCreated, onSetAdmin }: Props) {
  const [name, setName] = useState("");
  const [memory, setMemory] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [mode, setMode] = useState<AddMode>("expert");
  const [picked, setPicked] = useState<Target[]>([]);
  const [query, setQuery] = useState("");
  const [targets, setTargets] = useState<Target[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** ⛔ 建群成功后的那一屏（群 id + 群名）：给"成员名单 + 管理员提醒"，⛔ 不是直接关窗。 */
  const [done, setDone] = useState<{ id: string; name: string } | null>(null);
  /* ⛔ 11-12 用户：「这里还不能直接设置管理员？」—— 就在完成屏选，选完立刻存。 */
  const [adminPick, setAdminPick] = useState("");
  const [adminSaving, setAdminSaving] = useState(false);
  const [adminError, setAdminError] = useState("");

  /* 每次打开都从干净状态开始（⛔ 不要留着上次填了一半的群名） */
  useEffect(() => {
    if (!open) return;
    setName("");
    setMemory("");
    setWorkspace("");
    setMode("expert");
    setPicked([]);
    setQuery("");
    setError("");
    setDone(null);
    setAdminPick("");
    setAdminError("");
  }, [open]);

  const reloadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.codex.listDispatchCatalog();
      const list = Array.isArray(res?.targets) ? (res.targets as Target[]) : [];
      setTargets(list.filter((t) => t && t.kind && t.name && t.installed !== false));
      setCatalogError("");
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void reloadCatalog();
  }, [open, reloadCatalog]);

  useEscapeLayer(open, onClose);

  const hasTeam = picked.some((t) => t.kind === "team");
  const blocked: Record<AddMode, { blocked: boolean; reason: string }> = useMemo(
    () => ({
      expert: addModeStateOf(picked, "expert"),
      team: addModeStateOf(picked, "team"),
      custom: addModeStateOf(picked, "custom"),
    }),
    [picked],
  );
  const activeBlocked = blocked[mode];
  /* ⛔ 判据仍走 `addModeStateOf`（唯一真相源），但它的 reason 是写给**已有群**的
     （"先移除他们或新建一个群"），在"新建群"里说"已有"会让人以为已经建好了。
     ⇒ 这里只换文案、⛔ 不另写判据。 */
  const hintOf = (m: AddMode) => {
    const st = blocked[m];
    if (!st.blocked) return MODE_HINT[m];
    if (m === "team") {
      return picked.some((t) => t.kind === "team")
        ? "已选一个专家团，整团就是全部伙伴；要换团请先移除它"
        : `已选 ${picked.length} 位伙伴，专家团只能在纯新群加 —— 要加团请先「清空已选」`;
    }
    return picked.some((t) => t.kind === "team")
      ? "已选专家团，团内成员由它统一编排；要加单独角色请先移除团"
      : st.reason;
  };

  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      targets
        .filter((t) => MODE_KINDS[mode].has(t.kind))
        .filter((t) => !q || t.name.toLowerCase().includes(q) || (t.profession ?? "").toLowerCase().includes(q)),
    [targets, mode, q],
  );

  const isPicked = (t: Target) => picked.some((p) => p.kind === t.kind && p.key === t.key);

  const togglePick = (t: Target) => {
    if (isPicked(t)) {
      setPicked((prev) => prev.filter((p) => !(p.kind === t.kind && p.key === t.key)));
      return;
    }
    if (activeBlocked.blocked) return;
    /* 专家团是「整团」单位：选第二个就顶掉前一个（多团同群 = 重复派活） */
    if (t.kind === "team") setPicked([t]);
    else setPicked((prev) => [...prev.filter((p) => p.kind !== "team"), t]);
  };

  const pickDirectory = async () => {
    try {
      const dir = workspace ? await window.codex.chooseDirectoryAt(workspace) : await window.codex.chooseDirectory();
      if (dir) setWorkspace(dir);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const full = count >= limit;
  const canCreate = Boolean(name.trim()) && !busy && !full;

  const submit = async () => {
    if (!canCreate) return;
    setBusy(true);
    setError("");
    const members = [
      { id: LOCAL_ACTOR_ID, kind: "human", name: "我" },
      ...picked.map((t) => ({
        /* ⛔ id 由目标身份决定：与设置页「添加伙伴」同口径（重复加会被判重） */
        id: `tgt:${t.kind}:${t.key}`,
        kind: "bot",
        name: t.name,
        targetKind: t.kind,
        targetKey: t.key,
        targetProfession: t.profession ?? "",
      })),
    ];
    const input: TeamCreateInput = {
      name: name.trim(),
      memory: memory.trim(),
      workspace: workspace.trim(),
      leadId: LOCAL_ACTOR_ID,
      members,
    };
    const r = await onCreate(input);
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "建群失败");
      return;
    }
    /* ⛔⛔ 11-12 用户：「创建完成普通专家群之后，弹窗提醒+成员名单」。
       原来建完直接关窗，用户进群看到一堆人名却不知道下一步做什么（更不知道该设管理员）。
       ⇒ 先给一屏"建好了 + 都有谁 + 还缺一个管理员（它管什么）"，再进群。 */
    setDone({ id: r.id ?? "", name: name.trim() });
  };

  /* ⛔ 完成屏直接设管理员：选完立刻落盘（走 store 的 setAdminOf → 主进程），
     失败就把选择退回「不设」并说明，⛔ 不假装成功。 */
  const pickAdmin = async (memberId: string) => {
    setAdminPick(memberId);
    setAdminError("");
    if (!memberId || !done?.id || !onSetAdmin) return;
    setAdminSaving(true);
    try {
      const r = await onSetAdmin(done.id, memberId);
      if (r && r.ok === false) {
        setAdminError(r.error ?? "没设上，可进群后在「群设置 → 群管理员」再设");
        setAdminPick("");
      }
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : String(err));
      setAdminPick("");
    } finally {
      setAdminSaving(false);
    }
  };

  if (!open) return null;

  /* ⛔⛔ 11-12 用户：「创建完成普通专家群之后，弹窗提醒+成员名单」。
     建完先给一屏：**都有谁**（名单）+ **还缺一个管理员**（它管什么），再进群。 */
  if (done) {
    return (
      <div className="team-sheet" role="dialog" aria-modal="true" aria-label="群已创建">
        <div className="team-sheet__card team-created">
          <h2 className="team-created__title">群已建好：{done.name}</h2>
          <p className="team-created__lead">成员（{picked.length} 位伙伴 + 你）：</p>
          {picked.length > 0 ? (
            <ul className="team-created__members">
              {picked.map((p) => (
                <li key={`${p.kind}:${p.key}`}>
                  <strong>{p.name}</strong>
                  {p.profession && <em>{p.profession}</em>}
                </li>
              ))}
            </ul>
          ) : (
            /* ⛔ 审查补：允许"先建群、之后再加伙伴" ⇒ 空名单要给一句话，别留一个空 ul。 */
            <p className="team-created__lead">还没有伙伴 —— 进群后在「群设置 → 添加伙伴」里加。</p>
          )}
          <div className="team-created__hint">
            <strong>{adminPick ? "管理员已设好" : "还差一个管理员"}</strong>
            <p>
              管理员是群里的<strong>默认推进人</strong>：你不 @ 任何人时由它接话、拆解、分派、验收、收口；
              出问题也找它，不用你追着每个人问。
            </p>
            {onSetAdmin && done.id && picked.length > 0 ? (
              <label className="team-created__admin">
                <span>现在就设</span>
                <select
                  value={adminPick}
                  disabled={adminSaving}
                  onChange={(e) => void pickAdmin(e.target.value)}
                >
                  <option value="">不设（进群后也可在群设置里改）</option>
                  {picked.map((p) => (
                    <option key={`${p.kind}:${p.key}`} value={`tgt:${p.kind}:${p.key}`}>
                      {p.name}{p.profession ? ` · ${p.profession}` : ""}
                    </option>
                  ))}
                </select>
                {adminSaving && <em className="team-created__admin-state">保存中…</em>}
                {adminError && <em className="team-created__admin-state is-warn">{adminError}</em>}
              </label>
            ) : (
              <p>进群后输入框上方会提示你设置，也可以在「群设置 → 群管理员」里随时改。</p>
            )}
          </div>
          <footer className="team-sheet__foot">
            <span className="team-sheet__foot-hint">团群不用设：由团主理人担任</span>
            <button
              type="button"
              className="is-primary"
              /* ⛔ 审查修：`create()` 的 id 来自 `res.group?.id`，后端 ok 但没带 group 时会是空串 ——
                 原来这里照样 onCreated("") ⇒ 主列选中一个不存在的群（空白）。没有 id 就只关窗，
                 让用户从左侧列表里点它。 */
              onClick={() => { if (done.id) onCreated?.(done.id); onClose(); }}
            >{done.id ? "进群" : "完成"}</button>
          </footer>
        </div>
      </div>
    );
  }

  return (
    <div
      className="team-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="新建群"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="team-sheet__card">
        <header className="team-sheet__head">
          <div className="team-sheet__title">
            <Users size={15} className="ic-violet" />
            <strong>新建群</strong>
            <span className="esc-hint" title="按 ESC 关闭">ESC</span>
          </div>
          <button type="button" className="icon-button" title="关闭（Esc）" aria-label="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="team-sheet__body">
          {/* ⛔ 两栏：左边「基本信息」（名字/简介/地址），右边「初始伙伴」列表。
              单栏时一屏放不下（实测内容 646px / 可视 534px），用户要滚才知道有「项目地址」。
              ⇒ 宽屏两栏一屏看完；<820px 自动回单栏、列表自己滚。 */}
          <div className="team-sheet__col">
          {/* ── 群名 ── */}
          <section className="team-sheet__block">
            <label className="team-sheet__label" htmlFor="team-create-name">群名字</label>
            <input
              id="team-create-name"
              className="team-sheet__input"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void submit(); }}
              placeholder="例如：内容生产组"
              maxLength={40}
            />
            <div className="team-sheet__ideas">
              {NAME_IDEAS.map((idea) => (
                <button key={idea} type="button" onClick={() => setName(idea)} disabled={name === idea}>{idea}</button>
              ))}
            </div>
          </section>

          {/* ── 群简介 ── */}
          <section className="team-sheet__block">
            <label className="team-sheet__label" htmlFor="team-create-memory">
              群简介<span className="team-sheet__opt">可选，每次派活都会带上</span>
            </label>
            <textarea
              id="team-create-memory"
              className="team-sheet__textarea"
              value={memory}
              onChange={(e) => setMemory(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="这个群一起干什么、有什么约定（例如：所有产出都放 D:\项目\周报，标题用「门店+月份」）"
            />
            <span className="team-sheet__count">{memory.length} 字</span>
          </section>

          {/* ── 项目地址 ── */}
          <section className="team-sheet__block">
            <label className="team-sheet__label" htmlFor="team-create-ws">
              项目地址<span className="team-sheet__opt">可选，决定伙伴在哪个目录干活</span>
            </label>
            <div className="team-sheet__dir">
              <input
                id="team-create-ws"
                className="team-sheet__input"
                value={workspace}
                onChange={(e) => setWorkspace(e.target.value)}
                placeholder="留空 = 跟随应用默认目录"
              />
              <button type="button" onClick={() => void pickDirectory()}><FolderOpen size={13} /> 选择</button>
              {workspace && <button type="button" onClick={() => setWorkspace("")}>清空</button>}
            </div>
          </section>

          </div>

          <div className="team-sheet__col">
          {/* ── 初始伙伴 ── */}
          <section className="team-sheet__block">
            <div className="team-sheet__label-row">
              <span className="team-sheet__label">初始伙伴<span className="team-sheet__opt">可选，建完也能再加</span></span>
              {picked.length > 0 && (
                <button type="button" className="team-sheet__link" onClick={() => setPicked([])}>清空已选</button>
              )}
            </div>

            <div className="team-sheet__modes" role="tablist" aria-label="伙伴来源">
              {ADD_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  aria-disabled={blocked[m].blocked}
                  title={hintOf(m)}
                  className={`team-sheet__mode${mode === m ? " is-on" : ""}${blocked[m].blocked ? " is-blocked" : ""}`}
                  onClick={() => { setMode(m); setQuery(""); }}
                >{MODE_LABEL[m]}</button>
              ))}
            </div>
            <p className="team-sheet__hint">{hintOf(mode)}</p>

            <div className="team-sheet__search">
              <Search size={13} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`搜索${MODE_LABEL[mode].replace("模式", "")}`} aria-label="搜索伙伴" />
              <button type="button" onClick={() => void reloadCatalog()} disabled={loading} title="重新读取后台列表">
                {loading ? "读取中…" : "刷新"}
              </button>
            </div>

            <div className="team-sheet__list" role="listbox" aria-multiselectable>
              {rows.map((t) => {
                const on = isPicked(t);
                const dim = !on && activeBlocked.blocked;
                return (
                  <button
                    key={`${t.kind}:${t.key}`}
                    type="button"
                    role="option"
                    aria-selected={on}
                    disabled={dim}
                    className={`team-sheet__row${on ? " is-on" : ""}${dim ? " is-dim" : ""}`}
                    onClick={() => togglePick(t)}
                  >
                    <span className="team-sheet__check" aria-hidden>{on ? <Check size={12} /> : null}</span>
                    <span className="team-sheet__row-text">
                      <strong>{t.name}</strong>
                      <small>{KIND_SHORT[t.kind] ?? t.kind}{t.profession ? ` · ${t.profession}` : ""}</small>
                    </span>
                  </button>
                );
              })}
              {!rows.length && (
                <p className="team-sheet__empty">
                  {catalogError ? `读不到智能体清单：${catalogError}` : `「${MODE_LABEL[mode]}」下没有可加对象`}
                </p>
              )}
            </div>

            {picked.length > 0 && (
              <div className="team-sheet__picked">
                {picked.map((t) => (
                  <span key={`${t.kind}:${t.key}`} className="team-sheet__chip">
                    <Sparkles size={11} /> {t.name}
                    <button type="button" aria-label={`移除 ${t.name}`} onClick={() => togglePick(t)}><X size={11} /></button>
                  </span>
                ))}
              </div>
            )}
            {hasTeam && (
              <p className="team-sheet__warn">已选专家团：整团按 SOP 协作，不再叠加其它伙伴（避免重复派活）。</p>
            )}
          </section>

          </div>

          {/* 错误跨两栏显示（提交失败要一眼看到） */}
          <div className="team-sheet__col-span">
            {error && <p className="team-sheet__error" role="alert">{error}</p>}
          </div>
        </div>

        <footer className="team-sheet__foot">
          <span className="team-sheet__foot-hint">
            {full
              ? `已达上限 ${limit} 个群，先解散一个再建`
              : picked.length
                ? `将拉入 ${picked.length} 位伙伴`
                : "先建群，之后在群设置里加伙伴也行"}
          </span>
          <button type="button" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="is-primary" onClick={() => void submit()} disabled={!canCreate}>
            {busy ? "创建中…" : "创建群"}
          </button>
        </footer>
      </div>
    </div>
  );
}
