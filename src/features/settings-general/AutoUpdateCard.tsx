/**
 * 控制台 · 自动更新卡片（10-13 用户令：「开关都统一放到控制台里面」）。
 *
 * ⛔⛔ **所有自动更新开关的唯一 UI 落点**（技能 / 桌面自动化 / 浏览器自动化 / Mac 电脑操作 / Codex 引擎）。
 *    技能中心与自动化页**不再**各放一个开关 —— 同一状态两个入口，用户会以为两边不一致。
 *
 * ⛔ 数据与写入**全走主进程**（autoUpdate:status / autoUpdate:set）：
 *    · 清单、包名、版本号、**每个开关的缺省值语义**都在主进程（见 electron/app-settings.ts 的
 *      readAutoUpdateSwitch：四类装包的缺省=开，技能内容更新缺省=关）。
 *    · ⇒ 本组件**不判断平台、不硬编码清单、不自己定默认值**：Mac 电脑操作在 Windows 上
 *      根本不会返回，卡片自然少一行。
 *    · ⇒ 一次请求拿到全部开关，不存在「两个端点两套默认值」。
 *
 * ⛔ 开关走共享 ToggleSwitch（原生 checkbox 在暗色下被 UA 画成浅底，见 08/13/18 惯例）；
 *    乐观更新 + 失败回滚（开关手感不该等一次磁盘往返）。
 */
import { useCallback, useEffect, useState } from "react";
import { Cpu, Globe2, Monitor, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { ToggleSwitch } from "../../components/SettingsWidgets";

type AutoUpdateRow = {
  id: string;
  kind: "tool" | "engine" | "skill";
  label: string;
  pkg: string;
  enabled: boolean;
  current: string;
  latest: string;
  hasUpdate: boolean;
  error: string;
};

/** 行图标：纯外观，不是真相源（清单/标签/包名全在主进程）。未知 id 回落到通用图标。 */
const ICONS: Record<string, any> = { nuphus: Monitor, "playwright-cli": Globe2, "computer-use": ShieldCheck, engine: Cpu, skill: Sparkles };

/**
 * 每行的说明文案 = 名称之外的**状态反馈**（版本信息由主进程给，这里只组织语言）。
 * ⛔ 关闭态必须写清「不会发起更新检查」——这是开关的**语义**，不是装饰：
 *    关掉之后后台连版本比对都不做（不是「查到了但不装」）。
 */
function describe(row: AutoUpdateRow): string {
  if (row.error) return row.error;
  const noCheck = "已关闭 —— 后台不会发起更新检查（既不比版本也不下载）。";
  if (row.kind === "skill") {
    const on = "后台静默比对市场技能的内容变化（技能没有版本号，比的是文件内容），有变化才更新；本地导入的技能不参与。";
    return row.enabled
      ? `${on}开启后会覆盖你技能目录里的已装技能。`
      : `${noCheck}开启后会覆盖你技能目录里的已装技能。`;
  }
  const version = row.current ? `已装 ${row.current}` : "未检测到已装版本";
  const latest = row.latest ? ` · 最新 ${row.latest}` : "";
  const pkg = row.pkg ? ` · ${row.pkg}` : "";
  if (!row.enabled) return `${version}${latest}${pkg} —— ${noCheck}`;
  const suffix = row.kind === "engine"
    ? "；更新时先等正在跑的任务结束，装完自动重启引擎"
    : "；装完自动刷新引擎";
  return `${version}${latest}${pkg}${suffix}。`;
}

export function AutoUpdateCard({ onNotice }: { onNotice?: (text: string) => void }) {
  const [rows, setRows] = useState<AutoUpdateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await window.codex.readAutoUpdateStatus();
      setRows(Array.isArray(list) ? list : []);
      setError("");
    } catch (err: any) {
      setError(`读取自动更新状态失败：${err?.message ?? err}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function toggle(row: AutoUpdateRow, enabled: boolean) {
    setBusy((current) => ({ ...current, [row.id]: true }));
    // 乐观更新：失败再回滚
    setRows((current) => current.map((entry) => (entry.id === row.id ? { ...entry, enabled } : entry)));
    try {
      const result: any = await window.codex.setAutoUpdate(row.id, enabled);
      const applied = Boolean(result?.enabled);
      setRows((current) => current.map((entry) => (entry.id === row.id ? { ...entry, enabled: applied } : entry)));
      // 状态反馈：写盘成功才提示，且文案直接说清「关掉之后不再检查」
      onNotice?.(applied ? `已开启「${row.label}」的自动更新` : `已关闭「${row.label}」的自动更新，后台不再检查`);
    } catch (err: any) {
      setRows((current) => current.map((entry) => (entry.id === row.id ? { ...entry, enabled: !enabled } : entry)));
      setError(`「${row.label}」开关保存失败：${err?.message ?? err}`);
      onNotice?.(`「${row.label}」开关保存失败，已恢复原状态`);
    } finally {
      setBusy((current) => ({ ...current, [row.id]: false }));
    }
  }

  return (
    <div className="settings-card">
      <div className="settings-card-head">
        <RefreshCw size={15} />
        <strong>自动更新</strong>
        <span className="settings-subhead-hint">后台静默 · 走国内镜像</span>
        <button type="button" className="icon-button auto-update-refresh" title="重新读取版本与开关状态" disabled={loading} onClick={() => void load()}>
          {loading ? <RefreshCw size={13} className="spin" /> : <RefreshCw size={13} />}
        </button>
      </div>
      <div className="settings-card-body settings-toggle-list">
        {rows.map((row) => {
          const Icon = ICONS[row.id] ?? RefreshCw;
          return (
            <div className="settings-toggle-row" key={row.id}>
              <span className="settings-toggle-icon"><Icon size={16} /></span>
              <span className="settings-toggle-text">
                <strong>{row.label}</strong>
                <small>{describe(row)}</small>
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
        })}
        {!rows.length && <p className="settings-card-hint">{loading ? "正在读取自动更新状态…" : "暂时取不到更新状态，点卡头右侧的刷新按钮重试。"}</p>}
        <p className="settings-card-hint">
          开启后由主进程在后台静默检查并更新（启动后一次 + 每 6 小时一次），从国内镜像拉取，成功会发系统通知；各开关互相独立，关掉哪一个都不影响其余。
          引擎更新会先等正在跑的任务结束；技能与 Mac 电脑操作以外的三类默认开启，技能内容更新默认关闭（它会覆盖你技能目录里的文件）。
        </p>
        {error ? <p className="settings-card-hint">{error}</p> : null}
      </div>
    </div>
  );
}
