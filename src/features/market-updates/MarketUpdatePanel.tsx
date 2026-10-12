/**
 * 市场更新面板（10-12 用户要求「技能和插件加一个更新功能」）—— 技能页与插件页**共用同一个组件**。
 *
 * ⛔ 为什么单独成板块、而不是塞进两个既有页面各写一遍：
 *   取数口径 / 三态判据 / 文案必须**一模一样**，各写一遍必然漂移（本项目栽过多次「两处各写一套」）。
 * ⛔ 判据**全在主进程**（`skills:update-check` / `plugins:update-check` /
 *   `codex-official-market:update-check`）：本组件只渲染 + 触发，**不自己判「有没有更新」**。
 * ⛔ 两个市场的语义本来就不同，如实呈现差异：
 *   · 技能市场**没有版本号** ⇒ 三态 `update`/`current`/`unresolved`（内容比对）；
 *   · 插件市场**有版本号** ⇒ 显示「已装 x → 最新 y」，版本缺失标「无法判定」。
 *   **绝不允许**把 `unresolved` / `无法判定` 显示成「已是最新」。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, CircleCheck, Download, RefreshCw } from "lucide-react";
import { Spinner } from "../../components/CardShell";

export type MarketUpdateKind = "skills" | "plugins" | "official";

export type MarketUpdatePanelProps = {
  kind: MarketUpdateKind;
  /** 面板标题下的一句话说明（各页可微调措辞） */
  hint?: string;
};

type Row = {
  /** 技能 = 目录名；插件 = slug */
  key: string;
  name: string;
  state: "update" | "current" | "unresolved";
  /** 插件侧用：已装 / 最新版本 */
  current?: string;
  latest?: string;
  detail: string;
};

/** 三个市场的接口与事件名（唯一映射处，⛔ 不要在调用方再写一遍）。 */
function apiOf(kind: MarketUpdateKind) {
  if (kind === "skills") {
    return {
      title: "技能更新",
      eventType: "skill-install",
      check: () => window.codex.checkSkillUpdates(),
      update: (key: string) => window.codex.updateSkill(key),
      keyOf: (row: any) => String(row.folder ?? ""),
      empty: "还没有从市场安装的技能（本地导入的技能不参与在线更新）",
    };
  }
  if (kind === "plugins") {
    return {
      title: "插件更新",
      eventType: "plugin-install",
      check: () => window.codex.checkPluginUpdates(),
      update: (key: string) => window.codex.updatePlugin(key),
      keyOf: (row: any) => String(row.slug ?? ""),
      empty: "还没有从该市场安装的插件",
    };
  }
  return {
    title: "官方插件更新",
    eventType: "official-plugin-install",
    check: () => window.codex.checkOfficialPluginUpdates(),
    update: (key: string) => window.codex.updateOfficialPlugin(key),
    keyOf: (row: any) => String(row.slug ?? ""),
    empty: "还没有从 Codex 官方市场安装的插件",
  };
}

export function MarketUpdatePanel(props: MarketUpdatePanelProps) {
  const api = apiOf(props.kind);
  const [rows, setRows] = useState<Row[]>([]);
  const [checking, setChecking] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [stage, setStage] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const liveKeys = useRef<Set<string>>(new Set());

  const check = useCallback(async () => {
    setChecking(true);
    setError("");
    try {
      const list: any = await api.check();
      const next: Row[] = (Array.isArray(list) ? list : []).map((row: any) => {
        const key = api.keyOf(row);
        // 技能侧给的是三态 state；插件侧给的是 comparable/hasUpdate
        if (props.kind === "skills") {
          return { key, name: String(row.name ?? key), state: row.state, detail: String(row.detail ?? "") };
        }
        const comparable = row.comparable !== false;
        const hasUpdate = comparable && Boolean(row.hasUpdate);
        return {
          key,
          name: String(row.name ?? key),
          state: hasUpdate ? "update" : comparable ? "current" : "unresolved",
          current: String(row.current ?? ""),
          latest: String(row.latest ?? ""),
          detail: comparable ? "" : "版本信息缺失，无法判定（重装一次该插件即可恢复检测）",
        };
      });
      setRows(next);
      liveKeys.current = new Set(next.map((row) => row.key));
    } catch (err: any) {
      setError(`检查更新失败：${err?.message ?? err}`);
      setRows([]);
    } finally {
      setChecking(false);
    }
  }, [api, props.kind]);

  useEffect(() => { void check(); }, [check]);

  // 进度：复用市场安装的既有事件（三个市场各自的 type），只认本面板管的那批 key
  useEffect(() => {
    const off = window.codex.onHarnessEvent?.((event: any) => {
      if (!event || event.type !== api.eventType) return;
      const key = String(event.skillId ?? event.pluginId ?? "");
      if (!key || !liveKeys.current.has(key)) return;
      if (event.message) setStage((current) => ({ ...current, [key]: String(event.message) }));
    });
    return () => { try { off?.(); } catch { /* 忽略 */ } };
  }, [api.eventType]);

  async function runUpdate(key: string) {
    setBusyKey(key);
    setStage((current) => ({ ...current, [key]: "" }));
    setResult((current) => ({ ...current, [key]: "" }));
    try {
      const res: any = await api.update(key);
      setResult((current) => ({ ...current, [key]: res?.to ? `已更新到 ${res.to}` : "更新完成" }));
    } catch (err: any) {
      setResult((current) => ({ ...current, [key]: `更新失败：${err?.message ?? err}` }));
    } finally {
      setBusyKey("");
      await check();
    }
  }

  async function runAll() {
    const pending = rows.filter((row) => row.state === "update").map((row) => row.key);
    for (const key of pending) await runUpdate(key);
  }

  const updatable = rows.filter((row) => row.state === "update").length;

  return (
    <section className="settings-section stack market-update-panel">
      <div className="settings-copy">
        <h2>{api.title}</h2>
        <p>{props.hint ?? "对照市场当前内容检查你已装的那些，有变化才提示；更新走与安装完全相同的链路。"}</p>
      </div>
      <div className="settings-heading-actions">
        <button className="secondary-setting" disabled={checking || Boolean(busyKey)} onClick={() => void check()}>
          {checking ? <Spinner /> : <RefreshCw size={13} />}{checking ? "检查中…" : "检查更新"}
        </button>
        {updatable > 1
          ? <button className="primary-setting" disabled={Boolean(busyKey)} onClick={() => void runAll()}><ArrowDown size={14} />全部更新（{updatable}）</button>
          : null}
      </div>
      {error ? <div className="settings-actions"><span>{error}</span></div> : null}
      <div className="runtime-list">
        {rows.map((row) => {
          const busy = busyKey === row.key;
          const failed = (result[row.key] ?? "").startsWith("更新失败");
          return <div className={`runtime-row ${busy ? "busy" : "installed"}`} key={row.key}>
            <span className="runtime-icon">{busy ? <Spinner /> : row.state === "update" ? <ArrowDown size={16} /> : row.state === "current" ? <CircleCheck size={16} /> : <Download size={16} />}</span>
            <span className="runtime-copy">
              <strong>{row.name}</strong>
              <small>
                {props.kind === "skills"
                  ? row.detail
                  : `已装 ${row.current || "未知"}${row.latest ? ` · 最新 ${row.latest}` : ""}`}
              </small>
              {busy
                ? <em className="runtime-progress">{stage[row.key] || "正在更新…"}</em>
                : failed
                  ? <em className="runtime-hint">{result[row.key]}</em>
                  : row.state === "current" && result[row.key]
                    ? <em className="runtime-hint">{result[row.key]}</em>
                    : row.state === "unresolved"
                      ? <em className="runtime-hint">{props.kind === "skills" ? row.detail : row.detail}</em>
                      : null}
            </span>
            <div className="runtime-actions">
              {busy
                ? <span className="runtime-badge busy">更新中…</span>
                : row.state === "update"
                  ? <button className="primary-setting runtime-install" disabled={Boolean(busyKey)} onClick={() => void runUpdate(row.key)}><ArrowDown size={14} />更新</button>
                  : row.state === "current"
                    ? <span className="runtime-badge installed">已是最新</span>
                    : <span className="runtime-badge">无法判定</span>}
            </div>
          </div>;
        })}
        {!rows.length && !checking ? <div className="runtime-loading">{api.empty}</div> : null}
      </div>
    </section>
  );
}
