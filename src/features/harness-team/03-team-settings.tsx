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
import { useEffect, useMemo, useState } from "react";
import type { TeamFile, TeamGroup } from "./01-team-types";
import { LOCAL_ACTOR_ID } from "./02-team-store";
import { BookOpen, FolderOpen, Trash2, Users } from "lucide-react";
import { AppSelect } from "../../components/AppSelect";

type Props = {
  group: TeamGroup;
  /** 体检提示（含"还没有伙伴"这类建议，只在这里展示） */
  issues?: string[];
  limit: number;
  onAddPartner: (partner: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  onRemovePartner: (partnerId: string) => Promise<{ ok: boolean; error?: string }>;
  onMute: (partnerId: string, muted: boolean) => Promise<{ ok: boolean; error?: string }>;
  onSetMemory: (text: string) => Promise<{ ok: boolean; error?: string }>;
  onSetFiles: (files: TeamFile[]) => Promise<{ ok: boolean; error?: string }>;
  /** 解散群（只删群与群日志；伙伴的子会话不动） */
  onDeleteGroup?: () => Promise<{ ok: boolean; error?: string }>;
};

/** 调度目标的一条（与 `listDispatchCatalog()` 的返回一致；这里只声明用得到的字段）。 */
type Target = { kind: string; key: string; name: string; profession?: string; teamId?: string; installed?: boolean };

/** 这类目标派活要「专家团」许可（主进程 dispatchKindAllowed：team/member 同一把闸） */
const needsTeamGate = (kind: string) => kind === "member" || kind === "team";

const KIND_LABEL: Record<string, string> = {
  member: "专家团成员",
  expert: "专家",
  team: "专家团",
  subagent: "子智能体",
  cli: "本机 CLI",
};

const MEMORY_MAX = 4000;
const FILES_MAX = 20;

const fileNameOf = (path: string) => path.split(/[\\/]/).pop() || path;

export function TeamSettings({ group, issues, limit, onAddPartner, onRemovePartner, onMute, onSetMemory, onSetFiles, onDeleteGroup }: Props) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  /* 群记忆 / 群文件：本地草稿 + 脏标记（保存才落盘，避免每敲一个字就写文件） */
  const [memoryDraft, setMemoryDraft] = useState(group.memory ?? "");
  const [filesDraft, setFilesDraft] = useState<TeamFile[]>(group.files ?? []);

  const partners = group.members.filter((m) => m.kind === "bot");

  /* 切群时把草稿同步回该群的真实值（⛔ 否则会把上一条群的编辑带过来） */
  useEffect(() => {
    setMemoryDraft(group.memory ?? "");
    setFilesDraft(group.files ?? []);
    setMsg("");
    setDone("");
    setConfirmDelete(false);
  }, [group.id, group.memory, group.files]);

  const memoryDirty = memoryDraft.trim() !== String(group.memory ?? "").trim();
  const filesDirty = JSON.stringify(filesDraft) !== JSON.stringify(group.files ?? []);

  /* ⛔ 伙伴**必须**是真实调度目标：手打出来的名字派不了活。
     ⇒ 这里拉一次 `agents:catalog`（与模型自己派活用的是同一份清单，⛔ 不另建一套池子）。 */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await window.codex.listDispatchCatalog();
        if (!alive) return;
        const list = Array.isArray(res?.targets) ? (res.targets as Target[]) : [];
        setTargets(list.filter((t) => t && t.kind && t.name && t.installed !== false));
        setCatalogError("");
      } catch (err) {
        if (alive) setCatalogError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { alive = false; };
  }, []);

  /** 已经在这个群里的目标不重复列（按 目标身份 判，不按显示名） */
  const options = useMemo(() => {
    const taken = new Set(partners.map((p) => `${p.targetKind}:${p.targetKey}`));
    return targets
      .map((t, index) => ({ index, t }))
      .filter(({ t }) => !taken.has(`${t.kind}:${t.key}`))
      .map(({ index, t }) => ({
        value: String(index),
        /* ⛔ 需要"专家团"许可的类别（member/team）在**选之前**就标注出来：
           等用户 @ 完发送失败才告诉他，等于把人当测试机。 */
        label: `${KIND_LABEL[t.kind] ?? t.kind} · ${t.name}${t.profession ? `（${t.profession}）` : ""}${needsTeamGate(t.kind) ? " · 需开启专家团" : ""}`,
      }));
  }, [targets, partners]);

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
      });
      if (r.ok) setPick("");
      return r;
    }, "已加入");
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
    <div className="team-settings">
      {/* ── 伙伴 ───────────────────────────────────────────────────────── */}
      <section className="team-settings__block">
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
              <span className="team-settings__avatar" aria-hidden>{p.name.slice(0, 1)}</span>
              <span className="team-settings__name">
                {p.name}
                {p.id === group.leadId && <em className="team-settings__tag">群主</em>}
                {p.muted && <em className="team-settings__tag team-settings__tag--muted">已静音</em>}
                {p.targetKind
                  ? (
                    <em
                      className={`team-settings__tag${needsTeamGate(p.targetKind) ? " team-settings__tag--warn" : ""}`}
                      title={needsTeamGate(p.targetKind) ? "这类目标要先在顶栏「调度」里打开「专家团」，否则派活会被挡下" : undefined}
                    >
                      {KIND_LABEL[p.targetKind] ?? p.targetKind}
                      {needsTeamGate(p.targetKind) ? " ·需开专家团" : ""}
                    </em>
                  )
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
        <div className="team-settings__add">
          {options.length ? (
            <AppSelect
              value={pick}
              onChange={setPick}
              options={[{ value: "", label: "选一个智能体…" }, ...options]}
              ariaLabel="选择要加入的智能体"
              disabled={busy || partners.length >= limit}
            />
          ) : (
            <span className="team-settings__empty">
              {catalogError ? `读不到智能体清单：${catalogError}` : "没有可加的智能体（先在专家团 / 子智能体里建一个）"}
            </span>
          )}
          <button type="button" onClick={() => void addPartner()} disabled={busy || !pick || partners.length >= limit}>
            添加伙伴
          </button>
        </div>
        {partners.length >= limit && <p className="team-settings__hint">已达上限（最多 {limit} 个伙伴）</p>}
        <p className="team-settings__hint">
          「专家 / 子智能体 / 本机 CLI」开箱可派；<strong>「专家团成员」要先在顶栏调度面板里打开「专家团」</strong>，否则派活会被主进程挡下。
        </p>
      </section>

      {/* ── 群记忆 ─────────────────────────────────────────────────────── */}
      <section className="team-settings__block">
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
      </section>

      {/* ── 群文件 ─────────────────────────────────────────────────────── */}
      <section className="team-settings__block">
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

      {/* ── 体检（只在真有问题时出现；"还没有伙伴"这类建议也写在这里，但语气是建议） ── */}
      {issues && issues.length > 0 && (
        <section className="team-settings__block">
          <h3><Users size={14} className="ic-cyan" />这个群还差什么</h3>
          <ul className="team-settings__issues">
            {issues.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </section>
      )}

      {/* ── 解散群 ─────────────────────────────────────────────────────── */}
      {onDeleteGroup && (
        <section className="team-settings__block team-settings__block--danger">
          <h3><Trash2 size={14} className="ic-pink" />解散这个群</h3>
          <p className="team-settings__hint">
            只删群和群里的消息记录；<strong>伙伴自己的会话一条都不会动</strong>（那些会话还在侧栏里）。
          </p>
          {confirmDelete ? (
            <div className="team-settings__savebar">
              <span className="team-settings__meta">确定解散「{group.name}」？</span>
              <button type="button" className="team-settings__mini" onClick={() => setConfirmDelete(false)} disabled={busy}>取消</button>
              <button
                type="button"
                className="team-settings__mini team-settings__mini--danger"
                onClick={() => void run(() => onDeleteGroup())}
                disabled={busy}
              >
                确认解散
              </button>
            </div>
          ) : (
            <button type="button" className="team-settings__mini team-settings__mini--danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
              解散群
            </button>
          )}
        </section>
      )}

      {done && <p className="team-settings__done" role="status">{done}</p>}
      {msg && <p className="team-settings__error" role="status">{msg}</p>}
    </div>
  );
}
