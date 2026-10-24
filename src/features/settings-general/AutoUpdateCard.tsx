/**
 * 控制台 · 组件更新（10-13 用户令：「统一到控制台」+「覆盖全部同类组件的统一更新体系」）。
 *
 * 这一张卡名义上是「更新入口」，实际上负责四件事：
 *   ① **开关**：每类组件的后台自动更新开关（写 app-settings，重启后保持）；
 *   ② **清单**：全部可更新组件 + 它们当前的版本（含**不可单独更新**的那批及其原因）；
 *   ③ **操作**：检测更新 / 更新单个 / 一键更新全部；
 *   ④ **反馈**：进度输出 + 逐项结果（updated / unchanged / failed / skipped）。
 *
 * ⛔⛔ **本组件不持有任何真相源**：清单、包名、版本号、每个开关的缺省语义全在主进程 ——
 *    · 清单在 `electron/update-registry.ts`（含「不支持更新」的条目及其原因）；
 *    · 判据在 `electron/update-backends.ts`（手动与后台共用同一个 updateComponent）；
 *    · 缺省值在 `electron/app-settings.ts` 的 readAutoUpdateRowSwitch（唯一一处）。
 *    ⇒ 界面不判平台、不硬编码包名、不自己定默认值。Mac 电脑操作在 Windows 上根本不会返回。
 *
 * ⛔ 开关走共享 ToggleSwitch（原生 checkbox 在暗色下被 UA 画成浅底，见 08/13/18 惯例）；
 *    乐观更新 + 失败回滚（开关手感不该等一次磁盘往返）。
 * ⛔ 进度复用既有的 `runtime:progress` 事件通道（主进程按行 id 推），不为此单开一条。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Boxes, Check, Cpu, Globe2, Monitor, Package, Puzzle, RefreshCw, ScanSearch, ShieldCheck, Sparkles, Wand2 } from "lucide-react";
import { ToggleSwitch } from "../../components/SettingsWidgets";
import { refreshWithReceipt } from "../../lib/refresh-receipt.mjs";

type SwitchRow = {
  id: string;
  kind: "tool" | "engine" | "skill" | "plugin";
  label: string;
  pkg: string;
  enabled: boolean;
  current: string;
  latest: string;
  hasUpdate: boolean;
  error: string;
};

type ComponentRow = {
  id: string;
  specId: string;
  label: string;
  group: string;
  pkg: string;
  mirror: boolean;
  reason: string;
  installed: boolean;
  /** 后台自动更新开关的生效值（主进程算的，界面不自己定默认值） */
  enabled: boolean;
  current: string;
  latest: string;
  hasUpdate: boolean;
  detectable: boolean;
  unsupported: string;
  error: string;
};

type Outcome = {
  id: string;
  label: string;
  action: "updated" | "unchanged" | "failed" | "skipped";
  before: string;
  after: string;
  message: string;
};

/** 行图标：纯外观，不对清单做判断（未知 id 回落通用图标）。 */
const ICONS: Record<string, any> = {
  nuphus: Monitor, "computer-use": ShieldCheck, "ego-lite": Globe2, rea: ScanSearch,
  engine: Cpu, skill: Sparkles, "market-skill": Sparkles, "expert-skill": Wand2, ponytail: Package,
  "market-plugin": Puzzle, "official-plugin": Puzzle, soul: Wand2,
  markitdown: Boxes, laya: Boxes, "phone-harness": Boxes,
};

const ACTION_TEXT: Record<Outcome["action"], string> = {
  updated: "已更新",
  unchanged: "无需更新",
  failed: "失败",
  skipped: "跳过",
};

/** 每行的状态说明（版本信息来自主进程，这里只组织语言 + 交代清影响面）。 */
function describeComponent(row: ComponentRow): string {
  if (row.specId === "ego-lite") {
    if (!row.installed) return "未安装 —— 到「设置 → 开发工具」安装并完成首次引导。";
    return `${row.current || "已安装"}（更新由 Ego 官方更新器执行，可能下载约 600MB 并重启浏览器；暂无第三方国内镜像）`;
  }
  if (row.error) return row.error;
  if (row.unsupported) return row.unsupported;
  if (!row.installed) return "未安装 —— 装了之后这里才会出现更新入口。";
  if (row.hasUpdate) return `${row.current || "旧版本"} → ${row.latest || "最新版"}（有可用更新）`;
  if (row.current && row.latest) return `${row.current}（已是最新）`;
  if (row.current) return `已装 ${row.current}`;
  return row.detectable ? "等待检测…" : "已安装（该源不提供版本号，可执行「更新」重新拉取）";
}

const SOURCE_LABEL: Record<string, string> = { auto: "国内镜像优先", mirror: "国内镜像", direct: "官方源直连", proxy: "代理隧道", ghproxy: "国内镜像优先", ghfast: "国内镜像优先" };

export function AutoUpdateCard({ onNotice, downloadSource }: { onNotice?: (text: string) => void; downloadSource?: string }) {
  const [switches, setSwitches] = useState<SwitchRow[]>([]);
  const [rows, setRows] = useState<ComponentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  // 订阅回调里要读最新 rows（闭包会过期 ⇒ 用 ref 兜住）
  const rowsRef = useRef<ComponentRow[]>([]);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  const push = useCallback((line: string) => {
    setLog((current) => [...current.slice(-199), `[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${line}`]);
  }, []);

  const loadSwitches = useCallback(async () => {
    try {
      const list = await window.codex.readAutoUpdateStatus();
      setSwitches(Array.isArray(list) ? list : []);
    } catch (err: any) {
      setError(`读取自动更新开关失败：${err?.message ?? err}`);
    }
  }, []);

  const scan = useCallback(async () => {
    setScanning(true);
    setError("");
    try {
      const list = await window.codex.scanAutoUpdateComponents();
      setRows(Array.isArray(list) ? list : []);
      push(`检测完成：共 ${Array.isArray(list) ? list.length : 0} 个组件`);
      return "";
    } catch (err: any) {
      setError(`检测更新失败：${err?.message ?? err}`);
      // ⛔ 失败原因交回调用方（吞异常了，按钮侧回执靠它区分成败）
      return String(err?.message ?? err);
    } finally {
      setScanning(false);
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    void loadSwitches();
    void scan();
    // 进度订阅：主进程按**行 id** 推送 runtime:progress，这里只挑我们关心的那些 id
    const unsubscribe = window.codex.onRuntimeProgress?.((event: any) => {
      const id = String(event?.id ?? "");
      if (!id || id.startsWith("upd:")) return;
      if (!rowsRef.current.some((row) => row.id === id)) return;
      if (event?.message) push(`${event.message}`);
    });
    return () => { unsubscribe?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // 日志区自动贴底
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [log]);

  async function toggle(row: { id: string; label: string }, enabled: boolean) {
    setBusy((current) => ({ ...current, [row.id]: true }));
    // 乐观更新（开关手感不该等一次磁盘往返）：失败再回滚
    setSwitches((current) => current.map((entry) => (entry.id === row.id ? { ...entry, enabled } : entry)));
    setRows((current) => current.map((entry) => (entry.id === row.id ? { ...entry, enabled } : entry)));
    try {
      const result: any = await window.codex.setAutoUpdate(row.id, enabled);
      const applied = Boolean(result?.enabled);
      setSwitches((current) => current.map((entry) => (entry.id === row.id ? { ...entry, enabled: applied } : entry)));
      setRows((current) => current.map((entry) => (entry.id === row.id ? { ...entry, enabled: applied } : entry)));
      onNotice?.(applied ? `已开启「${row.label}」的自动更新` : `已关闭「${row.label}」的自动更新，后台不再检查`);
    } catch (err: any) {
      setSwitches((current) => current.map((entry) => (entry.id === row.id ? { ...entry, enabled: !enabled } : entry)));
      setRows((current) => current.map((entry) => (entry.id === row.id ? { ...entry, enabled: !enabled } : entry)));
      setError(`「${row.label}」开关保存失败：${err?.message ?? err}`);
    } finally {
      setBusy((current) => ({ ...current, [row.id]: false }));
    }
  }

  async function updateOne(row: ComponentRow) {
    setBusy((current) => ({ ...current, [row.id]: true }));
    push(`开始更新：${row.label}`);
    try {
      const outcome: any = await window.codex.runAutoUpdateComponent(row.id);
      const action = String(outcome?.action ?? "skipped") as Outcome["action"];
      push(`${row.label} · ${ACTION_TEXT[action]}${outcome?.message ? ` — ${outcome.message}` : ""}`);
      onNotice?.(`${row.label}：${ACTION_TEXT[action]}`);
    } catch (err: any) {
      push(`${row.label} · 失败 — ${err?.message ?? err}`);
      onNotice?.(`${row.label} 更新失败：${err?.message ?? err}`);
    } finally {
      setBusy((current) => ({ ...current, [row.id]: false }));
      void scan();
    }
  }


  const updatable = useMemo(() => rows.filter((row) => !row.unsupported && row.installed), [rows]);
  const noMirror = useMemo(() => rows.filter((row) => !row.mirror), [rows]);
  const primarySwitches = useMemo(() => switches.filter((row) => row.kind === "skill" || row.kind === "plugin"), [switches]);


  const renderSwitch = (row: SwitchRow) => {
    const Icon = ICONS[row.id] ?? RefreshCw;
    const off = "已关闭 —— 后台不会发起更新检查（既不比版本也不下载）。";
    const text = row.error
      ? row.error
      : row.kind === "skill"
        ? (row.enabled
          ? "后台静默比对市场技能内容（技能没有版本号），有变化才更新；本地导入的技能不参与。开启后会覆盖你技能目录里的文件。"
          : `${off}开启后会覆盖你技能目录里的文件。`)
        : row.kind === "plugin"
          ? (row.enabled
            ? "后台检查 Gitee 镜像与 Codex 官方市场里已安装插件的版本，有新版才重装；本地导入的插件不参与。"
            : `${off}开启后会改写插件目录并重启引擎。`)
          : row.id === "ego-lite"
            ? (row.enabled
              ? `已装 ${row.current || "版本未知"} · 后台会运行官方 ego-browser upgrade（可能下载数百 MB），升级后自动接管新版本`
              : `${off}Ego Lite 由官方应用自更新；开启后后台才会运行 ego-browser upgrade。`)
            : `${row.current ? `已装 ${row.current}` : "未检测到已装版本"}${row.latest ? ` · 最新 ${row.latest}` : ""}${row.pkg ? ` · ${row.pkg}` : ""}${row.enabled ? "" : ` —— ${off}`}`;
    return (
      <div className="settings-toggle-row" key={`sw-${row.id}`}>
        <span className="settings-toggle-icon"><Icon size={16} /></span>
        <span className="settings-toggle-text">
          <strong>{row.kind === "skill" ? "技能自动更新" : row.kind === "plugin" ? "插件自动更新" : row.label}</strong>
          <small>{text}</small>
        </span>
        <ToggleSwitch
          checked={row.enabled}
          disabled={Boolean(busy[row.id])}
          label={`${row.label} 自动更新`}
          title={row.enabled ? `关闭「${row.label}」的自动更新` : `开启「${row.label}」的自动更新`}
          onChange={(next: boolean) => void toggle(row, next)}
        />
      </div>
    );
  };

  return (
    <div className="settings-card">
      <div className="settings-card-head">
        <RefreshCw size={15} />
        <strong>技能与插件更新</strong>
        <span className="settings-subhead-hint">
          技能 / 插件各一个总开关；逐项清单已收起
        </span>
      </div>

      <div className="settings-card-body settings-toggle-list">
        {/* ── ① 开关区：藏在 typed 列表里，数据源与主进程判据同源 ───────────── */}
        {primarySwitches.map(renderSwitch)}
        <details className="settings-exp-advanced auto-update-advanced">
          <summary>其他组件更新（引擎 / 工具链）<small>检测、单个更新与日志</small></summary>
          <div className="settings-heading-actions auto-update-advanced-actions">
            <button type="button" className="icon-button" disabled={scanning} title="重新检测全部组件的版本" onClick={() => void refreshWithReceipt(onNotice, "重新检测组件版本", scan)}>
              {scanning ? <RefreshCw size={13} className="spin" /> : <RefreshCw size={13} />}
            </button>
          </div>
        {/* ── ② 全组件清单：按 group 分段，含「不可单独更新」那批及其原因 ─────── */}
        <div className="auto-update-groups">
          {["工具", "引擎", "不可单独更新"].map((group) => {
            const groupRows = rows.filter((row) => row.group === group);
            if (!groupRows.length) return null;
            return (
              <section className="auto-update-group" key={group}>
                <h4>
                  {group}
                  <small>{group === "不可单独更新" ? "结论，不是待办" : `${groupRows.filter((r) => r.installed).length}/${groupRows.length} 已安装`}</small>
                </h4>
                {groupRows.map((row) => {
                  const Icon = ICONS[row.specId] ?? (row.unsupported ? Boxes : Package);
                  return (
                    <div className="auto-update-row" key={row.id}>
                      <span className="settings-toggle-icon"><Icon size={15} /></span>
                      <span className="auto-update-row-text">
                        <strong>
                          {row.label}
                          {row.hasUpdate ? <em className="auto-update-badge">有更新</em> : null}
                          {!row.mirror && row.specId !== "ego-lite" ? <em className="auto-update-badge warn">无可用镜像源</em> : null}
                        </strong>
                        <small>{describeComponent(row)}</small>
                      </span>
                      {row.unsupported ? null : (
                        <button
                          type="button"
                          className="ghost-button tiny"
                          disabled={Boolean(busy[row.id]) || !row.installed}
                          title={row.installed ? `更新「${row.label}」` : "未安装，无需更新"}
                          onClick={() => void updateOne(row)}
                        >
                          {busy[row.id] ? "更新中…" : "更新"}
                        </button>
                      )}
                      {row.unsupported ? null : (
                        <ToggleSwitch
                          checked={row.enabled}
                          disabled={Boolean(busy[row.id])}
                          label={`${row.label} 自动更新`}
                          title={`「${row.label}」的后台自动更新`}
                          onChange={(next: boolean) => void toggle({ id: row.id, label: row.label }, next)}
                        />
                      )}
                    </div>
                  );
                })}
              </section>
            );
          })}
          {loading && <p className="settings-card-hint">正在读取组件清单…</p>}
          {!loading && !rows.length && <p className="settings-card-hint">暂时取不到组件清单，点右上角的刷新按钮重试。</p>}
        </div>

        {/* ── ③ 反馈：进度与结果 ──────────────────────────────────────────── */}
        <div className="auto-update-log" ref={logRef}>
          {log.length
            ? log.map((line, index) => <div key={index}>{line}</div>)
            : <div className="auto-update-log-empty">更新进度与结果会输出在这里。</div>}
        </div>

        <p className="settings-card-hint">
          后台自动更新由主进程在启动后一次 + 每 6 小时一次执行（各开关互相独立；关掉哪一类，后台连版本比对都不做）。
          引擎更新取源跟随「开发工具 → 下载源」设置（当前：{SOURCE_LABEL[String(downloadSource ?? "auto")] ?? "国内镜像优先"}）。
          更新源一律国内镜像：npm → npmmirror、pip → 清华源、GitHub → gh-proxy/ghfast 加速通道，失败自动回落下一档。
          每项更新前都会快照，失败自动回滚；内容与市场一致时不重复安装。共 {updatable.length} 项可更新
          {noMirror.length ? `，其中 ${noMirror.length} 项在结果里标注了「无可用镜像源」的原因` : ""}。
        </p>
        {error ? <p className="settings-card-hint">{error}</p> : null}
        </details>
      </div>
    </div>
  );
}
