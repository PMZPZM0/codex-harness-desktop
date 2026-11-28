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
import type { ReactNode } from "react";
import { CircleCheck, ExternalLink, Eye, FolderOpen, Info, PackageOpen, RefreshCw, Trash2 } from "lucide-react";
import { Spinner } from "../../components/CardShell";
import { SettingsDialog } from "../../components/SettingsDialog";
import { PredictionCard } from "../settings-devtools";

const errText = (error: unknown) => String((error as { message?: unknown })?.message ?? error);

/** 主进程事件：下载阶段带真实字节进度（percent/speed/host），界面不再只有一句「安装中…」。 */
type PackEvent = { type?: string; packId?: string; stage?: string; message?: string; percent?: number; speed?: string; host?: string };

type SkillPackRow = {
  id: string; name: string; repo: string; license: string; licenseUrl: string; size: string;
  description: string; companion: string; installed: boolean; installedSkills: string[]; installedAt: string; skillsRoot: string;
  /* 11-19：分类分组 / 包内技能（「拆开」后逐条可见）/ 配套专家 */
  category?: string; skills?: string[]; experts?: string[]; bundled?: boolean; bundledMarket?: boolean; version?: string;
  /* 11-21：随包源里**可装**的技能清单（⛔ 不是装态；装态看 installed / installedSkills） */
  bundledSkills?: string[];
  /* 11-20：第三方内容的使用声明（风险边界 / 署名 / 许可限制），原样展示、不在这里改写 */
  notice?: string;
};

/** 分类展示顺序（先工程、再设计、再内容，浏览器自动化与视频各自归口）。 */
/* 分类展示顺序（11-28 补「电商视觉」）：新增分类**必须**加到这里 —— `indexOf` 拿不到会排到末尾，
   与目录里的书写顺序不一致，界面分组会莫名跳到最后一组。 */
const PACK_CATEGORY_ORDER = ["工程流程", "图表与可视化", "网页设计", "前端动效", "浏览器自动化", "视频与内容", "电商视觉", "生活指南"];

type Result = { tone: "ok" | "warn" | "error"; text: string };

/** 技能包面板：列出技能包与安装状态，可安装/更新（带阶段进度）。 */
export function SkillPacksPanel({ setNotice }: { setNotice?: (title: string, detail?: string) => void }) {
  const [rows, setRows] = useState<SkillPackRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [stage, setStage] = useState("");
  const [percent, setPercent] = useState(0);
  const [speed, setSpeed] = useState("");
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
    if (typeof event.percent === "number") setPercent(Math.max(0, Math.min(100, event.percent)));
    if (typeof event.speed === "string") setSpeed(event.speed);
  }), [busy]);

  /* 更新 = 重新下载并覆盖**本包自己装的**目录（凭据 packId 相同才覆盖；用户自有同名技能仍跳过）。 */
  const install = async (row: SkillPackRow, update = false) => {
    setBusy(row.id);
    setStage("正在选择最快的下载源…");
    setPercent(0);
    setSpeed("");
    setDone((prev) => {
      const next = { ...prev };
      delete next[row.id];
      return next;
    });
    try {
      const result = await window.codex.installSkillPack({ id: row.id, update });
      const downloaded = result.bytes ? `${(result.bytes / 1048576).toFixed(1)} MB` : "未知大小";
      let verdict: Result;
      if (result.cancelled) {
        verdict = { tone: "warn", text: "已取消本次安装（临时文件与本次已写入的目录已清理）" };
      } else if (result.installed.length) {
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
      setNotice?.(`${row.name} ${update ? "更新" : "安装"}${result.installed.length ? "完成" : "结果"}`, verdict.text);
      await refresh();
    } catch (err) {
      const message = errText(err);
      setDone((prev) => ({ ...prev, [row.id]: { tone: "error", text: `安装失败：${message}` } }));
      setNotice?.(`${row.name} 安装失败`, message.slice(0, 400));
    } finally {
      setBusy(null);
      setStage("");
      setPercent(0);
      setSpeed("");
    }
  };

  /** 取消安装：只发中止信号，界面等 install 的 Promise 回执（返回 cancelled）再收尾，避免双写状态。 */
  const cancel = async (row: SkillPackRow) => {
    setStage("正在取消…");
    try { await window.codex.cancelSkillPack({ id: row.id }); } catch { /* 已在收尾 */ }
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

  const groupedRows = rows ? [...rows].sort((a, b) => {
    const ai = PACK_CATEGORY_ORDER.indexOf(String(a.category ?? ""));
    const bi = PACK_CATEGORY_ORDER.indexOf(String(b.category ?? ""));
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  }) : null;

  /* 11-19 用户令：「这个精选技能包加一个预览弹窗，跟飞书 CLI 一样弹窗界面」。
     ⛔ 只记 id 不存整行快照：装完 refresh() 会换掉 rows，存快照会显示旧状态。 */
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = previewId ? rows?.find((row) => row.id === previewId) ?? null : null;

  /** 一行右侧的动作（列表行与预览弹窗共用同一份 —— ⛔ 不各写一份，否则两处口径迟早漂移）。
   *  列表行前面固定一枚「预览」图标键（用户 11-19：「加上预览按键图标」）；
   *  弹窗底部那道动作条里 ⛔ 不再重复放它（人已经在预览里了，再点一次没有任何意义）。 */
  const renderAction = (row: SkillPackRow, withPreview = true) => {
    const isBusy = busy === row.id;
    let action = null as ReactNode;
    if (row.bundled && row.bundledMarket) action = <em className="skill-pack-state">随包内置 · 随应用更新</em>;
    else if (isBusy) action = <button type="button" className="secondary-setting skill-pack-cancel" onClick={() => void cancel(row)}>取消</button>;
    else if (row.installed) {
      /* 装了（不论随包还是下载）：给「更新 + 卸载」。
         ⛔ 11-21 修「安装了也不更新状态」：旧实现把 bundled 包**一律**显示成
         「更新 + 随包内置」，装没装一个样（后端把源目录当装态）；现在装态来自用户技能目录，
         所以已经装了的随包包也走这一支，卸载对随包包同样有效（删本包拷贝、不动源文件）。 */
      action = (
        <span className="skill-pack-actions-pair">
          <button type="button" className="secondary-setting" disabled={isBusy} title="重新同步本包技能（随包包从安装目录拷，下载型走镜像）" onClick={() => void install(row, true)}>
            <RefreshCw size={13} />更新
          </button>
          <button type="button" className="secondary-setting skill-pack-remove" disabled={isBusy} onClick={() => void uninstall(row)}>
            <Trash2 size={13} />卸载
          </button>
        </span>
      );
    } else if (row.bundled) {
      /* 随包但**还没装**到技能目录 ⇒ 主按钮就是「安装」（技能源在安装包里，不需要下载）。 */
      action = (
        <span className="skill-pack-actions-pair">
          <button type="button" className="primary-setting" disabled={isBusy} title="把随包技能安装到本机技能目录（不下载，直接从安装包拷贝）" onClick={() => void install(row)}>
            安装
          </button>
          <em className="skill-pack-state">随包内置</em>
        </span>
      );
    } else action = <button type="button" className="primary-setting" onClick={() => void install(row)}>安装</button>;
    return (
      <span className="skill-pack-actions-group">
        {withPreview ? (
          <button
            type="button"
            className="skill-pack-preview-btn"
            title={`预览 ${row.name}`}
            aria-label={`预览 ${row.name}`}
            disabled={isBusy}
            onClick={() => setPreviewId(row.id)}
          >
            <Eye size={14} />
          </button>
        ) : null}
        {action}
      </span>
    );
  };

  return (
    <div className="settings-section stack">
      <div className="skill-pack-head-row">
        <p className="settings-card-hint">
          第三方技能包：装到本机技能目录，Codex 在合适的任务里自动照它做。下载走国内镜像，装完自动重启引擎。点右侧眼睛看预览。
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
      {groupedRows === null ? <p className="settings-card-hint">正在读取…</p> : (
        <div className="skill-pack-list">
          {groupedRows.map((row, index, all) => {
            const isBusy = busy === row.id;
            const result = done[row.id];
            /* 11-19：分类分组头 —— 与 Craft 全家桶同口径：同一分类的包聚在一起，标题只出现一次。 */
            const prevCategory = index > 0 ? (all[index - 1].category ?? "") : "";
            const showGroup = (row.category ?? "") !== prevCategory;
            return (
              <div key={row.id} className="skill-pack-group-wrap">
              {showGroup ? <p className="skill-pack-group">{row.category || "其它"}</p> : null}
              <div className="skill-pack-row" data-pack={row.id}>
                <span className="skill-pack-icon">{row.installed ? <CircleCheck size={15} /> : <PackageOpen size={15} />}</span>
                <span className="skill-pack-main">
                  <span className="skill-pack-line1">
                    <strong>{row.name}</strong>
                    {row.category ? <em className="skill-pack-cat">{row.category}</em> : null}
                    {row.version ? <em className="skill-pack-cat">{row.version}</em> : null}
                    {row.installed ? <em className="skill-pack-state">已装 {row.installedSkills.length} 个</em> : null}
                  </span>
                  <span className="skill-pack-line2" title={row.description}>{row.description}</span>
                  {row.skills?.length ? (
                    /* 「拆开」：包内技能逐条列出（停用单个技能去技能页，不用整包卸载） */
                    <span className="skill-pack-line3" title={row.skills.join("、")}>
                      含 {row.skills.length} 个技能：{row.skills.join(" / ")}
                    </span>
                  ) : null}
                  {row.experts?.length ? (
                    <span className="skill-pack-line3">配套专家：{row.experts.join("、")}</span>
                  ) : null}
                  <span className="skill-pack-line3">
                    {row.companion} · {row.license} · {row.size}
                    {row.repo ? (
                      <>
                        {" · "}
                        <button type="button" className="skill-pack-link" title="打开仓库" onClick={(event) => { event.stopPropagation(); void window.codex.openExternal(`https://github.com/${row.repo}`); }}>
                          {row.repo}<ExternalLink size={10} />
                        </button>
                      </>
                    ) : null}
                  </span>
                  {/* 11-20 用户令：第三方内容要带声明（非医疗 / 署名 / 非商业限制），与清单同源展示 */}
                  {row.notice ? <span className="skill-pack-notice" role="note">{row.notice}</span> : null}
                  {isBusy ? (
                    <span className="skill-pack-stage">
                      <span className="runtime-progress-bar" role="progressbar" aria-label={`${row.name} 安装进度`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                        <i style={{ width: `${percent}%` }} />
                      </span>
                      <em className="runtime-progress"><Spinner />{stage}{percent ? ` · ${percent}%` : ""}{speed ? ` · ${speed}` : ""}</em>
                    </span>
                  ) : null}
                  {result ? <span className={`skill-pack-result ${result.tone}`}>{result.text}</span> : null}
                </span>
                <span className="skill-pack-actions">{renderAction(row)}</span>
              </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 预览弹窗（11-19）：版式与「飞书 CLI」那张卡一致 —— 同款标题栏（图标 + 名称 + 副标题 + 关闭）
          + 独立滚动的正文；正文只写这一行为准的事实（清单字段），⛔ 不在这里另写一份仓库/许可文案。 */}
      {preview ? (
        <SettingsDialog
          elevated
          size="md"
          title={preview.name}
          icon={preview.installed ? <CircleCheck size={15} /> : <PackageOpen size={15} />}
          hint={[preview.category, preview.version].filter(Boolean).join(" · ") || "精选技能包"}
          onClose={() => setPreviewId(null)}
        >
          <div className="settings-section stack skill-pack-preview">
            {/* 一行定位 + 元信息：先给「这是什么」，再给可核对的字段（许可 / 体积 / 仓库）。 */}
            <p className="skill-pack-preview-lead">{preview.description}</p>
            {/* 使用声明：第三方内容的风险边界与许可限制（文案来自清单，⛔ 不在组件里另写） */}
            {preview.notice ? (
              <div className="skill-pack-notice-card" role="note">
                <Info size={13} />
                <span>{preview.notice}</span>
              </div>
            ) : null}
            <p className="skill-pack-meta">
              <span className="skill-pack-chip">{preview.category || "其它"}</span>
              <span className="skill-pack-chip">{preview.version || "随包"}</span>
              <span>{preview.companion}</span>
              <span>· {preview.license} · {preview.size}</span>
              {preview.repo ? (
                <button type="button" className="skill-pack-link" title="打开仓库" onClick={() => void window.codex.openExternal(`https://github.com/${preview.repo}`)}>
                  {preview.repo}<ExternalLink size={10} />
                </button>
              ) : null}
            </p>

            {preview.skills?.length || preview.experts?.length ? (
              <div className="skill-pack-preview-cols">
                {preview.skills?.length ? (
                  <div className="skill-pack-preview-block">
                    <div className="feishu-cli-guide-head"><strong>包内技能（{preview.skills.length}）</strong><small>装完逐个可见，可按需停用某一个</small></div>
                    <span className="skill-pack-chips">
                      {preview.skills.map((skill) => <em className="skill-pack-chip" key={skill}>{skill}</em>)}
                    </span>
                  </div>
                ) : null}
                {preview.experts?.length ? (
                  <div className="skill-pack-preview-block">
                    <div className="feishu-cli-guide-head"><strong>配套专家</strong><small>装好后做对应任务会自动用上</small></div>
                    <span className="skill-pack-chips">
                      {preview.experts.map((expert) => <em className="skill-pack-chip" key={expert}>{expert}</em>)}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* 「怎么用」按步骤写（与飞书 CLI 同一套 feishu-cli-guide-steps），不堆成一段话。 */}
            <div className="skill-pack-preview-block">
              <div className="feishu-cli-guide-head"><strong>怎么用</strong><small>三步，不用记命令</small></div>
              <ol className="feishu-cli-guide-steps">
                <li><b>{preview.installed ? "已就位" : "安装"}</b><span>{preview.installed
                  ? (preview.bundled ? "随包内置，技能已在本机技能目录；应用升级后点「更新」同步新拷贝。" : "已装在本机技能目录；上游更新后点「更新」覆盖。")
                  : (preview.bundled ? "点「安装」从安装包直接拷贝到本机技能目录（不下载），装完自动重启引擎。" : "点「安装」下载到本机技能目录（走国内镜像），装完自动重启引擎。")}</span></li>
                <li><b>生效</b><span>引擎重启后自动加载，不需要手动配路径或改配置。</span></li>
                <li><b>使用</b><span>在对话里用 # 引用技能，Codex 碰到合适的任务就照它做。</span></li>
              </ol>
            </div>

            {preview.id === "cheat-on-content" ? (
              /* 知微的本机检测与修复指引默认收起：它是排障用的，不该盖过「装什么 / 怎么用」。 */
              <details className="skill-pack-extra">
                <summary>本机检测与修复指引（知微专用）</summary>
                <PredictionCard />
              </details>
            ) : null}
          </div>

          {/* 动作条固定在弹窗底部（body 滚动、动作不跟着滚走）。 */}
          <div className="skill-pack-dialog-actions">
            <button type="button" className="secondary-setting" onClick={() => preview.skillsRoot && void window.codex.shellReveal(preview.skillsRoot)}>
              <FolderOpen size={13} />打开技能目录
            </button>
            {preview.repo ? (
              /* 11-20 用户令：GitHub 跳转做成显式按钮（不只藏在行尾小字里） */
              <button type="button" className="secondary-setting" onClick={() => void window.codex.openExternal(`https://github.com/${preview.repo}`)}>
                <ExternalLink size={13} />GitHub 仓库
              </button>
            ) : null}
            <span className="skill-pack-actions">{renderAction(preview, false)}</span>
          </div>
        </SettingsDialog>
      ) : null}
    </div>
  );
}
