/**
 * 前端与设计卡片（11-20，嵌在「设置 → 开发工具」）。
 *
 * 用户：「这三个（组件库 / 前端画布 / AI 画布工作流）看看 GitHub 仓库，好像都没有更新通道，
 * 在开发工具里面加上，按开发工具里面的规则来，跟飞书 CLI 界面布局一样」。
 *
 * 三个能力都是**内置资源**，不像 npm 工具可以热更：
 *   · 组件库 = Uiverse Galaxy（https://github.com/uiverse-io/galaxy，MIT，无 Release/Tag）；
 *   · 前端画布 = m3e-canvas（https://github.com/lnkiai/m3e-canvas，MIT，无 Release/Tag）；
 *   · AI 画布工作流 = 本应用内置工作流（没有独立上游仓库）。
 * 因此更新通道按开发工具规则做成「检查上游最新提交 + 随应用更新」：
 *   ⛔ 不做假更新按钮（点了不换资源只会让用户以为坏了）；真正升级随应用版本发布。
 *   ⛔ 上游两个仓库都没有 Release，只能比 `commits?per_page=1` 的 SHA/日期。
 */
import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Library, LoaderCircle, MousePointerClick, RefreshCw, TriangleAlert, Wand2 } from "lucide-react";

type Phase = "idle" | "checking" | "done" | "error";
type CheckState = { phase: Phase; text: string };

/** 组件库的打包快照日期（与 scripts/gen-ui-skin-library.mjs 的 ingest 批次对应）。 */
const UIVERSE = {
  repo: "uiverse-io/galaxy",
  snapshot: "2026-10-15",
  url: "https://github.com/uiverse-io/galaxy",
} as const;

/** 前端画布的固定上游提交（内置产物来自这一版；页面加载时会读 CANVAS-BUILD.json 校准）。 */
const M3E = {
  repo: "lnkiai/m3e-canvas",
  fallbackVersion: "0.1.0",
  fallbackPinned: "039ec311acc33dd0c76a54cbc16af4fc8ab9b491",
  url: "https://github.com/lnkiai/m3e-canvas",
} as const;

type LatestCommit = { sha: string; date: string };

/** 查上游默认分支的最新提交（两个仓库都没有 Release，只能看 commit）。 */
async function latestCommit(repo: string): Promise<LatestCommit> {
  const response = await fetch(`https://api.github.com/repos/${repo}/commits?per_page=1`, {
    headers: { accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(response.status === 403 ? "GitHub 接口限流，稍后再试（或点项目主页查看）" : `GitHub 返回 HTTP ${response.status}`);
  }
  /* ⛔ 不写 any（守卫按文件统计 any 数）：GitHub commits 列表只需要 sha 与提交时间。 */
  const list = (await response.json()) as Array<{ sha?: unknown; commit?: { committer?: { date?: unknown } } }>;
  const first = Array.isArray(list) ? list[0] : null;
  if (!first?.sha) throw new Error("没有拿到最新提交");
  return { sha: String(first.sha), date: String(first.commit?.committer?.date ?? "") };
}

const short = (value: string) => value.slice(0, 7);

/** 前端与设计卡片：三个内置能力的上游仓库、当前版本与「检查更新」通道。 */
export function FrontendDesignCard() {
  const [checks, setChecks] = useState<Record<"uiverse" | "m3e", CheckState>>({
    uiverse: { phase: "idle", text: "点「检查更新」查上游最新提交" },
    m3e: { phase: "idle", text: "点「检查更新」查上游最新提交" },
  });
  /* ⛔ 必须显式给泛型：`M3E.fallbackVersion` 是 as const 的字面量（"0.1.0" / 提交哈希），
     不写泛型时 useState 会把 state 推断成那两个**字面量类型** ⇒ 后面 setCanvas 传
     `String(data.upstreamVersion || …)` 就报 `Type 'string' is not assignable to type '"0.1.0"'`。 */
  const [canvas, setCanvas] = useState<{ version: string; pinned: string }>({
    version: M3E.fallbackVersion,
    pinned: M3E.fallbackPinned,
  });

  /* 内置产物自带 CANVAS-BUILD.json（上游版本 + 固定提交），优先用它显示真实版本。 */
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}sketch/CANVAS-BUILD.json`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { upstreamVersion?: unknown; fork?: { pinnedCommit?: unknown } } | null) => {
        if (!data) return;
        setCanvas({
          version: String(data.upstreamVersion || M3E.fallbackVersion),
          pinned: String(data.fork?.pinnedCommit || M3E.fallbackPinned),
        });
      })
      .catch(() => undefined);
  }, []);

  const runCheck = useCallback(async (which: "uiverse" | "m3e") => {
    setChecks((current) => ({ ...current, [which]: { phase: "checking", text: "正在检查上游最新提交…" } }));
    try {
      const latest = await latestCommit(which === "uiverse" ? UIVERSE.repo : M3E.repo);
      if (which === "uiverse") {
        const newer = new Date(latest.date).getTime() > new Date(`${UIVERSE.snapshot}T00:00:00Z`).getTime();
        setChecks((current) => ({
          ...current,
          uiverse: {
            phase: "done",
            text: newer
              ? `上游有新提交 ${short(latest.sha)}（${latest.date.slice(0, 10)}）· 资源随应用打包，更新应用后生效`
              : `已是最新（快照 ${UIVERSE.snapshot} · ${short(latest.sha)}）`,
          },
        }));
      } else {
        const newer = latest.sha !== canvas.pinned;
        setChecks((current) => ({
          ...current,
          m3e: {
            phase: "done",
            text: newer
              ? `上游有新提交 ${short(latest.sha)}（当前固定 ${short(canvas.pinned)}）· 需重新构建画布，随应用更新`
              : `已是最新（${short(canvas.pinned)}）`,
          },
        }));
      }
    } catch (error) {
      const message = String((error as { message?: unknown })?.message ?? error);
      setChecks((current) => ({ ...current, [which]: { phase: "error", text: `检查失败：${message}` } }));
    }
  }, [canvas.pinned]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void runCheck("uiverse");
      void runCheck("m3e");
    }, 500);
    return () => window.clearTimeout(timer);
  }, [runCheck]);

  const openRepo = (url: string) => { void window.codex.openExternal(url).catch(() => undefined); };
  const statusIcon = (state: CheckState) =>
    state.phase === "checking" ? <LoaderCircle size={15} className="spin" />
      : state.phase === "error" ? <TriangleAlert size={15} />
        : <Check size={15} />;

  return (
    <>
      <section className="settings-section stack feishu-cli-card">
        <div className="feishu-cli-list">
          <div className="runtime-row installed">
            <span className="runtime-icon"><Library size={15} /></span>
            <span className="runtime-copy">
              <strong>组件库 · Uiverse</strong>
              <small>已内置 3802 个组件 / 11 类 · MIT · 上游 <b>{UIVERSE.repo}</b>（无 Release，按最新提交判断）</small>
              <em className={`runtime-hint ${checks.uiverse.phase === "error" ? "is-error" : ""}`}>{statusIcon(checks.uiverse)} {checks.uiverse.text}</em>
            </span>
            <div className="runtime-actions">
              <button type="button" className="secondary-setting" disabled={checks.uiverse.phase === "checking"} onClick={() => void runCheck("uiverse")}>
                <RefreshCw size={13} />检查更新
              </button>
              <button type="button" className="secondary-setting" onClick={() => openRepo(UIVERSE.url)}><ExternalLink size={13} />项目主页</button>
            </div>
          </div>

          <div className="runtime-row installed">
            <span className="runtime-icon"><MousePointerClick size={15} /></span>
            <span className="runtime-copy">
              <strong>前端画布 · m3e-canvas</strong>
              <small>内置 v{canvas.version} · 固定提交 {short(canvas.pinned)} · MIT · 上游 <b>{M3E.repo}</b>（无 Release，按最新提交判断）</small>
              <em className={`runtime-hint ${checks.m3e.phase === "error" ? "is-error" : ""}`}>{statusIcon(checks.m3e)} {checks.m3e.text}</em>
            </span>
            <div className="runtime-actions">
              <button type="button" className="secondary-setting" disabled={checks.m3e.phase === "checking"} onClick={() => void runCheck("m3e")}>
                <RefreshCw size={13} />检查更新
              </button>
              <button type="button" className="secondary-setting" onClick={() => openRepo(M3E.url)}><ExternalLink size={13} />项目主页</button>
            </div>
          </div>

          <div className="runtime-row installed">
            <span className="runtime-icon"><Wand2 size={15} /></span>
            <span className="runtime-copy">
              <strong>AI 画布工作流</strong>
              <small>内置生图 / 视频 / 短剧工作流（卡片连线把上一张结果喂给下一步）· 没有独立上游仓库</small>
              <em className="runtime-hint">随应用更新：工作流模板与画布功能跟应用版本一起发布</em>
            </span>
            <div className="runtime-actions"><span className="runtime-badge installed">随应用更新</span></div>
          </div>
        </div>

        <section className="feishu-cli-guide">
          <div className="feishu-cli-guide-head">
            <strong>能做什么</strong>
            <small>三块都是内置能力，不占额外安装；检查更新只查上游有没有新提交，真正升级随应用版本发布</small>
          </div>
          <div className="feishu-cli-cap-grid">
            <div className="feishu-cli-cap"><span className="feishu-cli-cap-icon"><Library size={15} /></span><span className="feishu-cli-cap-copy"><strong>3800+ 现成控件</strong><small>按 11 类浏览，真实预览 + HTML/CSS 源码，一键复制</small></span></div>
            <div className="feishu-cli-cap"><span className="feishu-cli-cap-icon"><MousePointerClick size={15} /></span><span className="feishu-cli-cap-copy"><strong>可视化画布</strong><small>拖 Material 3 组件，摆手机 / 电脑 / 网页，一键预览</small></span></div>
            <div className="feishu-cli-cap"><span className="feishu-cli-cap-icon"><Wand2 size={15} /></span><span className="feishu-cli-cap-copy"><strong>AI 画布工作流</strong><small>生图 / 视频 / 短剧，卡片连线，上一张结果喂给下一步</small></span></div>
          </div>
          <ul className="feishu-cli-notes">
            <li>组件库与前端画布是开源项目（均 MIT），上游只更新 <b>main 分支</b>，没有 Release/Tag，因此「检查更新」比较的是最新提交。</li>
            <li>内置资源随应用打包：检查到上游有更新时，需要等下一次应用版本发布才会带上新内容。</li>
            <li>AI 画布工作流是本应用自己的功能，没有独立仓库，不存在单独的更新通道。</li>
          </ul>
        </section>
      </section>
    </>
  );
}

export default FrontendDesignCard;
