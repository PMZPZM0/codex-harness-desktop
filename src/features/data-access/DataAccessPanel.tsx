/**
 * DataAccessPanel（10-29）：**会话级**数据授权面板。
 *
 * 用户定的权限模型（原话）：
 *  「一次授权粒度：按"会话 + 模块 + 读/写"三元组授权，结束会话即失效。
 *   收藏夹 / 开发日记：会话级开关（默认关）。开启后允许 read + append。
 *   密码本：默认永不进模型上下文；仅允许 copy / 存在性查询；任何写入需一次性确认弹窗。
 *   删除类操作永远不开放给模型。」
 *
 * 这个面板就是那套授权的**唯一开关入口**：
 *  · 每个模块两个开关（读 / 写），默认全关；
 *  · 状态存在主进程内存里（`dataaccess:*`），关掉应用或删除会话即失效 —— 不在任何磁盘文件里；
 *  · 面板顶部永远写明"只对当前会话生效"，避免用户以为是全局开关。
 *
 * ⛔ 密码本的「写」不等于"每次都能写"：它只是允许模型**发起**写入，真正落盘前还会弹一次
 *    一次性确认框（VaultWriteConfirm）。这里要在副标题里讲清楚，不然用户以为开了就能随便写。
 */
import { useCallback, useEffect, useState } from "react";
import { Bookmark, KeyRound, NotebookPen, ShieldCheck } from "lucide-react";
import { ToggleSwitch } from "../../components/SettingsWidgets";

export type DataModule = "favorites" | "journal" | "vault";
export type DataLevel = "read" | "write";
type Grants = Record<DataModule, Record<DataLevel, boolean>>;

const EMPTY: Grants = {
  favorites: { read: false, write: false },
  journal: { read: false, write: false },
  vault: { read: false, write: false },
};

const ROWS: Array<{
  module: DataModule;
  label: string;
  icon: typeof Bookmark;
  readHint: string;
  writeHint: string;
}> = [
  {
    module: "favorites",
    label: "收藏夹",
    icon: Bookmark,
    readHint: "读取你收藏的文本/链接",
    writeHint: "追加新收藏（⛔ 不能改或删已收藏的）",
  },
  {
    module: "journal",
    label: "开发日记",
    icon: NotebookPen,
    readHint: "读取 / 检索日记内容",
    writeHint: "追加一条记录（⛔ 不能覆盖或删除历史）",
  },
  {
    module: "vault",
    label: "密码本",
    icon: KeyRound,
    readHint: "查询账号是否存在、把密码复制到剪贴板（⛔ 拿不到明文）",
    writeHint: "发起写入（⛔ 每次都要你再确认一次）",
  },
];

/** 数据访问授权面板：按会话给出收藏/日记/密码本的读/写开关。 */
export function DataAccessPanel({ threadId, onClose }: { threadId: string; onClose: () => void }) {
  const [grants, setGrants] = useState<Grants>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!threadId) { setGrants(EMPTY); return; }
    try {
      const state = await window.codex.dataaccessState?.(threadId);
      if (state?.grants) setGrants(state.grants as Grants);
    } catch (loadError: unknown) {
      setError(String((loadError as Error)?.message ?? loadError));
    }
  }, [threadId]);

  useEffect(() => { void load(); }, [load]);

  const toggle = useCallback(async (module: DataModule, level: DataLevel, on: boolean) => {
    if (!threadId) { setError("当前还没有会话：先发一条消息，再回来授权"); return; }
    setBusy(true);
    setError("");
    try {
      const next = await window.codex.dataaccessGrant?.({ threadId, module, level, on });
      if (next?.grants) setGrants(next.grants as Grants);
    } catch (toggleError: unknown) {
      setError(String((toggleError as Error)?.message ?? toggleError));
    } finally {
      setBusy(false);
    }
  }, [threadId]);

  const revokeAll = useCallback(async () => {
    if (!threadId) return;
    setBusy(true);
    try {
      const next = await window.codex.dataaccessRevokeAll?.(threadId);
      setGrants((next?.grants as Grants) ?? EMPTY);
    } catch (revokeError: unknown) {
      setError(String((revokeError as Error)?.message ?? revokeError));
    } finally {
      setBusy(false);
    }
  }, [threadId]);

  const enabledCount = (Object.keys(grants) as DataModule[]).reduce(
    (sum, module) => sum + (grants[module].read ? 1 : 0) + (grants[module].write ? 1 : 0),
    0,
  );

  return (
    <div className="crp-body da-body">
        <p className="da-lead">
          {threadId
            ? <>下面的开关只对<strong>当前这个会话</strong>生效；关掉应用或删除会话就自动失效，不会写进任何配置文件。</>
            : "当前还没有会话：先发一条消息，再回来授权。"}
        </p>

        <div className="da-scroll">
          {ROWS.map((row) => {
            const Icon = row.icon;
            const grant = grants[row.module];
            const anyOn = grant.read || grant.write;
            return (
              <section className={`da-row${anyOn ? " is-on" : ""}`} key={row.module}>
                <div className="da-row-head">
                  <span className="da-icon"><Icon size={15} /></span>
                  <strong>{row.label}</strong>
                  <span className={`da-state${anyOn ? " is-on" : ""}`}>
                    {anyOn ? "已授权" : "未授权"}
                  </span>
                </div>
                <div className="da-switches">
                  {(["read", "write"] as const).map((level) => {
                    const on = grant[level];
                    const title = level === "read" ? "读取" : "写入";
                    const hint = level === "read" ? row.readHint : row.writeHint;
                    const blocked = busy || !threadId;
                    return (
                      <div
                        key={level}
                        className="da-switch"
                        /* 整行可点（开关自己会 stopPropagation，不会点一次翻两次） */
                        onClick={() => { if (!blocked) void toggle(row.module, level, !on); }}
                      >
                        <span className="da-switch-copy">
                          <b>{title}</b>
                          <em>{hint}</em>
                        </span>
                        <ToggleSwitch
                          checked={on}
                          disabled={blocked}
                          onChange={(next) => void toggle(row.module, level, next)}
                          label={`${row.label} ${title}`}
                          className="da-toggle"
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}

          {error ? <p className="da-error">{error}</p> : null}
        </div>

        <div className="da-footer">
          <span className="da-count">已开启 {enabledCount} / 6 项</span>
          <button type="button" className="da-revoke" disabled={busy || enabledCount === 0} onClick={() => void revokeAll()}>
            全部关闭
          </button>
        </div>
    </div>
  );
}
