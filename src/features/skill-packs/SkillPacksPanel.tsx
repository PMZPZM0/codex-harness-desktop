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
 * ⛔ 10-30 二次反馈「安装卸载太快了，要真安装真卸载」：
 *   · 进度显示**真实下载字节**（主进程流式下载推 MB），不写"安装中…"糊过去；
 *   · 结果以**磁盘回读**为准：装完报「磁盘确认已写入 N 个」，卸载报「磁盘确认已不存在」；
 *   · 装 0 个（全都同名已存在）是中性结果，不许显示成成功；
 *   · 有删不掉的目录必须报红（不能假装卸载成功）。
 */
import { useEffect, useMemo, useState } from "react";
import { CircleCheck, ExternalLink, FolderOpen, PackageOpen, RefreshCw, Trash2 } from "lucide-react";
import { Spinner } from "../../components/CardShell";

const errText = (error: unknown) => String((error as { message?: unknown })?.message ?? error);

type PackEvent = { type?: string; packId?: string; message?: string };

type SkillPackRow = {
  id: string; name: string; repo: string; license: string; licenseUrl: string; size: string;
  description: string; companion: string; installed: boolean; installedSkills: string[]; installedAt: string; skillsRoot: string;
};

type Result = { tone: "ok" | "warn" | "error"; text: string };

export function SkillPacksPanel({ setNotice }: { setNotice?: (title: string, detail?: string) => void }) {
  const [rows, setRows] = useState<SkillPackRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [stage, setStage] = useState("");
  const [done, setDone] = useState<Record<string, Result>>({});

  const refresh = useMemo(() => async () => {
    try {
      setRows(await window.codex.listSkillPacks());
      setError("");
    } catch (err) {
      setError(errText(err));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /* 安装进度走主进程广播的 harness 事件（与技能安装同口径），只认本板块的 type。 */
  useEffect(() => window.codex.onHarnessEvent?.((payload) => {
    const event = payload as PackEvent;
    if (event?.type !== "skill-pack-install" || event.packId !== busy) return;
    if (typeof event.message === "string") setStage(event.message);
  }), [busy]);

  const install = async (row: SkillPackRow) => {
    setBusy(row.id);
    setStage("正在连接下载源…");
    setDone((prev) => {
      const next = { ...prev };
      delete next[row.id];
      return next;
    });
    try {
      const result = await window.codex.installSkillPack({ id: row.id });
      const downloaded = result.bytes ? `${(result.bytes / 1048576).toFixed(1)} MB` : "未知大小";
      let verdict: Result;
      if (result.installed.length) {
        verdict = { tone: "ok", text: `磁盘确认已写入 ${result.installed.length} 个技能（下载 ${downloaded}）${result.skipped.length ? `；${result.skipped.length} 个同名已存在，未覆盖` : ""}` };
      } else if (result.skipped.length) {
        verdict = { tone: "warn", text: `没有新技能：${result.skipped.length} 个同名已存在（未覆盖）。要强制重装请先在技能页卸载` };
      } else {
        verdict = { tone: "warn", text: "仓库里没有可安装的技能" };
      }
      if (result.rejected.length) {
        verdict = { tone: "error", text: `${verdict.text}；拒绝 ${result.rejected.length} 个：${result.rejected.join("；")}` };
      }
      setDone((prev) => ({ ...prev, [row.id]: verdict }));
      setNotice?.(`${row.name} 安装${result.installed.length ? "完成" : "结果"}`, verdict.text);
      await refresh();
    } catch (err) {
      const message = errText(err);
      setDone((prev) => ({ ...prev, [row.id]: { tone: "error", text: `安装失败：${message}` } }));
      setNotice?.(`${row.name} 安装失败`, message.slice(0, 400));
    } finally {
      setBusy(null);
      setStage("");
    }
  };

  const uninstall = async (row: SkillPackRow) => {
    setBusy(row.id);
    setStage("正在删除技能目录…");
    try {
      const result = await window.codex.uninstallSkillPack({ id: row.id });
      const kept = result.kept?.length ? `；另有 ${result.kept.length} 个不是本包安装的目录，已保留未动` : "";
      const verdict: Result = result.remaining.length
        ? { tone: "error", text: `已删 ${result.removed.length} 个，但还有 ${result.remaining.length} 个删不掉（可能被占用）：${result.remaining.join("、")}${kept}` }
        : { tone: result.kept?.length ? "warn" : "ok", text: `已删除 ${result.removed.length} 个技能，磁盘确认已不存在${kept}` };
      setDone((prev) => ({ ...prev, [row.id]: verdict }));
      setNotice?.(`${row.name} 卸载结果`, verdict.text);
      await refresh();
    } catch (err) {
      const message = errText(err);
      setDone((prev) => ({ ...prev, [row.id]: { tone: "error", text: `卸载失败：${message}` } }));
      setNotice?.(`${row.name} 卸载失败`, message.slice(0, 400));
    } finally {
      setBusy(null);
      setStage("");
    }
  };

  return (
    <div className="settings-section stack">
      <div className="skill-pack-head-row">
        <p className="settings-card-hint">
          第三方技能包：装到本机技能目录，Codex 在合适的任务里自动照它做。下载走国内镜像，装完自动重启引擎。
        </p>
        <button
          type="button"
          className="secondary-setting"
          disabled={!rows?.length}
          title="在文件管理器里打开技能目录（装了什么一眼能看到）"
          onClick={() => rows?.[0]?.skillsRoot && void window.codex.shellReveal(rows[0].skillsRoot)}
        >
          <FolderOpen size={13} />打开技能目录
        </button>
      </div>
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
            const result = done[row.id];
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
                  {isBusy && stage ? <span className="skill-pack-stage"><Spinner />{stage}</span> : null}
                  {result ? <span className={`skill-pack-result ${result.tone}`}>{result.text}</span> : null}
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
