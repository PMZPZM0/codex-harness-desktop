/**
 * 开发工具 · 精选技能包（10-30，用户令：榜单里挑有用的放进开发工具页按需下载）。
 *
 * 自包含板块（不进程 bag，样板同 component-library / codex-official-market）：
 * 数据全部来自主进程 `skill-packs:list`（单一真相源 electron/skill-packs-catalog.ts），
 * 这里只负责画列表 + 调安装/卸载，⛔ 不抄一份仓库/许可文案。
 *
 * ⛔ 形态：与「运行时与工具链」同一套**单行列表**（一处分隔线、不套卡片边框）——
 *   10-30 用户实测「界面乱糟糟」：每行套一层卡片 + 两段长文 + 三个按钮 ⇒ 现在每行
 *   名称 / 一句说明 / 一行小字（配套 · 许可 · 体积 · 仓库） + 右侧一个动作。
 */
import { useEffect, useMemo, useState } from "react";
import { CircleCheck, ExternalLink, PackageOpen, RefreshCw, Trash2 } from "lucide-react";
import { Spinner } from "../../components/CardShell";

const errText = (error: unknown) => String((error as { message?: unknown })?.message ?? error);

type HabitEvent = { type?: string; packId?: string; message?: string };

type SkillPackRow = {
  id: string; name: string; repo: string; license: string; licenseUrl: string; size: string;
  description: string; companion: string; installed: boolean; installedSkills: string[]; installedAt: string;
};

export function SkillPacksPanel({ setNotice }: { setNotice?: (title: string, detail?: string) => void }) {
  const [rows, setRows] = useState<SkillPackRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [stage, setStage] = useState("");
  const [done, setDone] = useState<Record<string, string>>({});

  const refresh = useMemo(() => async () => {
    try {
      setRows(await window.codex.listSkillPacks());
      setError("");
    } catch (error) {
      setError(errText(error));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /* 安装进度走主进程广播的 harness 事件（与技能安装同口径），只认本板块的 type。 */
  useEffect(() => window.codex.onHarnessEvent?.((payload) => {
    const event = payload as HabitEvent;
    if (event?.type !== "skill-pack-install" || event.packId !== busy) return;
    if (typeof event.message === "string") setStage(event.message);
  }), [busy]);

  const install = async (row: SkillPackRow) => {
    setBusy(row.id);
    setStage("准备中…");
    try {
      const result = await window.codex.installSkillPack({ id: row.id });
      const parts = [`已装 ${result.installed.length} 个技能`];
      if (result.skipped.length) parts.push(`跳过 ${result.skipped.length} 个（同名已存在）`);
      if (result.rejected.length) parts.push(`拒绝 ${result.rejected.length} 个：${result.rejected.join("；")}`);
      setDone((prev) => ({ ...prev, [row.id]: parts.join(" · ") }));
      setNotice?.(`${row.name} 安装完成`, parts.join(" · "));
      await refresh();
    } catch (error) {
      setNotice?.(`${row.name} 安装失败`, errText(error).slice(0, 400));
      setDone((prev) => ({ ...prev, [row.id]: `安装失败：${errText(error).slice(0, 120)}` }));
    } finally {
      setBusy(null);
      setStage("");
    }
  };

  const uninstall = async (row: SkillPackRow) => {
    setBusy(row.id);
    setStage("正在卸载…");
    try {
      const result = await window.codex.uninstallSkillPack({ id: row.id });
      setDone((prev) => ({ ...prev, [row.id]: `已删除 ${result.removed.length} 个技能` }));
      setNotice?.(`${row.name} 已卸载`, `删除 ${result.removed.length} 个技能目录`);
      await refresh();
    } catch (error) {
      setNotice?.(`${row.name} 卸载失败`, errText(error).slice(0, 400));
    } finally {
      setBusy(null);
      setStage("");
    }
  };

  return (
    <div className="settings-section stack">
      <p className="settings-card-hint">
        第三方技能包：装到本机技能目录，Codex 在合适的任务里自动照它做。下载走国内镜像，装完自动重启引擎。
      </p>
      {error ? (
        <p className="settings-card-hint skill-pack-error">
          <RefreshCw size={13} />读取失败：{error}
          <button type="button" className="secondary-setting" onClick={() => void refresh()}>重试</button>
        </p>
      ) : null}
      {rows === null ? <p className="settings-card-hint">正在读取…</p> : (
        <div className="skill-pack-list">
          {rows.map((row) => {
            const isBusy = busy === row.id;
            return (
              <div key={row.id} className="skill-pack-row" data-pack={row.id}>
                <span className="skill-pack-icon">{isBusy ? <Spinner /> : row.installed ? <CircleCheck size={15} /> : <PackageOpen size={15} />}</span>
                <span className="skill-pack-main">
                  <span className="skill-pack-line1">
                    <strong>{row.name}</strong>
                    {row.installed ? <em className="skill-pack-state">已装 {row.installedSkills.length} 个</em> : null}
                  </span>
                  <span className="skill-pack-line2" title={row.description}>{row.description}</span>
                  <span className="skill-pack-line3">
                    {row.companion} · {row.license} · {row.size} ·{" "}
                    <button type="button" className="skill-pack-link" title="打开仓库" onClick={() => void window.codex.openExternal(`https://github.com/${row.repo}`)}>
                      {row.repo}<ExternalLink size={10} />
                    </button>
                  </span>
                  {isBusy && stage ? <span className="skill-pack-stage">{stage}</span> : null}
                  {done[row.id] ? <span className="skill-pack-result">{done[row.id]}</span> : null}
                </span>
                <span className="skill-pack-actions">
                  {row.installed ? (
                    <button type="button" className="secondary-setting skill-pack-remove" disabled={isBusy} onClick={() => void uninstall(row)}>
                      <Trash2 size={13} />卸载
                    </button>
                  ) : (
                    <button type="button" className="primary-setting" disabled={isBusy} onClick={() => void install(row)}>
                      {isBusy ? <Spinner /> : null}{isBusy ? "安装中…" : "安装"}
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
