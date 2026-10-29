/**
 * 控制台 · 技能内容更新面板（10-30 用户令：开关之外还要能进入、能装能卸、有下载安装反馈）。
 *
 * 逻辑（主进程真相源，这里不重复判断）：
 *   · 后台循环在 skills-ipc：读 `skillAutoUpdate` 开关，启动 15s 后 + 每 6 小时比对一次；
 *     只处理**市场安装**的技能（有 .cocoloop.json / .skillhub.json），本地导入不参与；
 *   · 比对判据是内容指纹（市场没有版本号），一致 = 已最新，不一致 = 有更新；
 *   · 更新复用市场安装链（下载 → 安全检查 → 解压落盘 → 登记来源），进度事件 type = skill-install。
 * 本面板只做三件事：手动检查 / 逐项更新 / 卸载（安装入口跳技能市场，不另造一套市场）。
 * ⛔ 开关仍在外面那行（同一真相源 app-settings.skillAutoUpdate），这里不再画第二个开关。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CircleCheck, PackageOpen, RefreshCw, Trash2 } from "lucide-react";
import { Spinner } from "../../components/CardShell";

type Row = {
  folder: string;
  name: string;
  state: "update" | "current" | "unresolved";
  detail: string;
  marketId?: string;
  marketSource?: string;
};

type HarnessPayload = { type?: string; skillId?: string; stage?: string; message?: string; updated?: string[]; failed?: number };

const STAGE_TEXT: Record<string, string> = { download: "下载中", extract: "解压中", audit: "安全检查", install: "写入技能目录", register: "登记来源" };
const STATE_TEXT: Record<Row["state"], string> = { update: "有更新", current: "已最新", unresolved: "无法比对" };

export function SkillUpdatePanel({
  setNotice,
  openAppConfirm,
  onOpenMarket,
}: {
  setNotice?: (title: string, detail?: string) => void;
  openAppConfirm?: (title: string, text: string, confirmLabel?: string) => Promise<boolean>;
  onOpenMarket?: () => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [stage, setStage] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [confirmFolder, setConfirmFolder] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  const push = useCallback((line: string) => {
    setLog((current) => [...current.slice(-99), `[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${line}`]);
  }, []);

  const check = useCallback(async () => {
    setError("");
    setRows(null);
    push("正在检查市场技能内容…");
    try {
      const list = await window.codex.checkSkillUpdates();
      setRows(list);
      const updates = list.filter((row) => row.state === "update").length;
      push(`检查完成：${list.length} 个市场技能，${updates} 个有更新`);
    } catch (err) {
      setError(`检查失败：${String((err as { message?: unknown })?.message ?? err)}`);
      setRows([]);
    }
  }, [push]);

  useEffect(() => { void check(); }, [check]);

  /* 进度与后台结果都走 harness 事件：per-row 进度（skill-install）+ 后台自动更新的结果汇总。 */
  useEffect(() => window.codex.onHarnessEvent?.((payload) => {
    const event = payload as HarnessPayload;
    if (event?.type === "skill-install" && event.skillId) {
      const name = (rows ?? []).find((row) => row.folder === event.skillId)?.name ?? event.skillId;
      setStage(`${name} · ${STAGE_TEXT[event.stage ?? ""] ?? "处理中"}${event.message ? `（${event.message}）` : ""}`);
      return;
    }
    if (event?.type === "skill-auto-update") {
      const updated = event.updated ?? [];
      const line = updated.length ? `后台自动更新：${updated.join("、")}${event.failed ? `；${event.failed} 个失败` : ""}` : `后台自动更新失败 ${event.failed ?? 0} 个`;
      push(line);
      setNotice?.("技能自动更新", line);
    }
  }), [rows, push, setNotice]);

  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [log]);

  const performUpdate = async (row: Row) => {
    setBusy(row.folder);
    setStage(`${row.name} · 准备中`);
    push(`开始更新：${row.name}`);
    try {
      await window.codex.updateSkill(row.folder);
      push(`${row.name} · 已更新`);
      return true;
    } catch (err) {
      const message = String((err as { message?: unknown })?.message ?? err);
      push(`${row.name} · 更新失败 — ${message}`);
      setNotice?.(`${row.name} 更新失败`, message);
      return false;
    } finally {
      setBusy("");
      setStage("");
    }
  };

  const update = async (row: Row) => {
    if (busy) return;
    if (await performUpdate(row)) setNotice?.(`${row.name} 已更新`, "已按市场当前内容重装，进度见日志");
    await check();
  };

  const updateAll = async () => {
    const targets = (rows ?? []).filter((row) => row.state === "update");
    if (!targets.length || busy) return;
    let done = 0;
    for (const row of targets) { if (await performUpdate(row)) done += 1; }
    setNotice?.("技能批量更新", `已更新 ${done} / ${targets.length} 个`);
    await check();
  };

  const remove = async (row: Row) => {
    /* ⛔ 不用原生 confirm（原生模态框关闭后会吞焦点，【191】明令禁止）：
       宿主给了 openAppConfirm 就用它；否则按钮本身就是两步确认（卸载 → 确认卸载）。 */
    const ok = openAppConfirm
      ? await openAppConfirm(`卸载技能 ${row.name}`, "将删除该技能的本地目录，Codex 不再加载它；市场上还能再装回来。", "卸载")
      : true;
    if (!ok) return;
    setBusy(row.folder);
    try {
      await window.codex.removeLocalSkill({ folder: row.folder, name: row.name });
      push(`${row.name} · 已卸载`);
      setNotice?.(`${row.name} 已卸载`, "需要时可在技能市场重新安装");
      await check();
    } catch (err) {
      const message = String((err as { message?: unknown })?.message ?? err);
      push(`${row.name} · 卸载失败 — ${message}`);
      setNotice?.(`${row.name} 卸载失败`, message);
    } finally {
      setBusy("");
    }
  };

  const updatable = (rows ?? []).filter((row) => row.state === "update");

  return (
    <div className="settings-section stack skill-update-panel">
      <p className="settings-card-hint">
        只检查「市场安装」的技能（本地导入不参与）。市场技能没有版本号，比对的是内容；更新会按市场当前内容重装并重新过安全检查。
      </p>
      <div className="skill-update-actions">
        <button type="button" className="primary-setting" disabled={rows === null} onClick={() => void check()}>
          {rows === null ? <Spinner /> : <RefreshCw size={13} />}检查更新
        </button>
        <button type="button" className="secondary-setting" disabled={!updatable.length || Boolean(busy)} onClick={() => void updateAll()}>
          更新全部（{updatable.length}）
        </button>
        <button type="button" className="secondary-setting" onClick={() => onOpenMarket?.()}>
          <PackageOpen size={13} />去技能市场安装
        </button>
      </div>
      {stage ? <p className="skill-update-stage"><Spinner />{stage}</p> : null}
      {error ? <p className="skill-update-error"><AlertTriangle size={13} />{error}</p> : null}
      <div className="skill-update-list">
        {rows === null ? <p className="settings-card-hint">正在检查…</p> : rows.length === 0 ? (
          <p className="settings-card-hint">没有市场安装的技能。到「技能 → 市场浏览」装一个，之后就能在这里检查更新。</p>
        ) : rows.map((row) => (
          <div className="skill-update-row" key={row.folder} data-state={row.state}>
            <span className={`skill-update-state ${row.state}`}>
              {row.state === "current" ? <CircleCheck size={14} /> : row.state === "update" ? <RefreshCw size={14} /> : <AlertTriangle size={14} />}
            </span>
            <span className="skill-update-copy">
              <strong>{row.name}<em>{STATE_TEXT[row.state]}</em></strong>
              <small>{row.detail}</small>
            </span>
            <span className="skill-update-buttons">
              {row.state === "update" ? (
                <button type="button" className="primary-setting" disabled={Boolean(busy)} onClick={() => void update(row)}>
                  {busy === row.folder ? <Spinner /> : null}{busy === row.folder ? "更新中…" : "更新"}
                </button>
              ) : null}
              <button
                type="button"
                className={`secondary-setting skill-update-remove ${confirmFolder === row.folder ? "confirming" : ""}`}
                disabled={Boolean(busy)}
                title="卸载这个技能"
                onClick={() => {
                  if (confirmFolder === row.folder) { setConfirmFolder(""); void remove(row); return; }
                  setConfirmFolder(row.folder);
                  window.setTimeout(() => setConfirmFolder((current) => (current === row.folder ? "" : current)), 4000);
                }}
              >
                <Trash2 size={13} />{confirmFolder === row.folder ? "确认卸载" : "卸载"}
              </button>
            </span>
          </div>
        ))}
      </div>
      {log.length ? (
        <div className="skill-update-log" ref={logRef} role="log" aria-label="技能更新日志">
          {log.map((line, index) => <span key={`${index}-${line.slice(0, 12)}`}>{line}</span>)}
        </div>
      ) : null}
    </div>
  );
}
