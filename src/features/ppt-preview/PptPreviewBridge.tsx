/**
 * PPT 实时预览桥（11-24 用户令：「侧边栏要有 PPT 实时预览，标签页那种可以随时叉掉；
 * codex 要知道侧边栏可以展示 PPT 进度；要支持用电脑其他应用打开」）。
 *
 * 数据流（全在渲染层，没有新 IPC 通道）：
 *   模型调 `slide_show` 工具 → 工具分发处写 ppt-preview-store →
 *   本桥把整份 deck 渲染成自包含 HTML 写到会话工作区 → 右栏浏览器开一个页签（file://）→
 *   后续每页重写同一文件并广播重载信号（BrowserPane 收到就 reload，⛔ 不新开页签）。
 *
 * ⛔ 复用右栏浏览器面板：它本来就有多标签 + 关闭按钮，"随时叉掉"是现成能力。
 * ⛔ 只认当前会话的 workspace：别的会话生成 PPT 不该抢用户的右栏。
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { toFileUrl } from "../../lib/file-url.mjs";
import {
  getSlideDeck,
  notifySlideReload,
  renderSlideHtml,
  setSlidePreviewUrl,
  subscribeSlideDeck,
} from "../../lib/ppt-preview-store.mjs";

/** 本板块用到的宿主能力（结构化 props，⛔ 不深链 HarnessAppApi —— 守卫【130】）。 */
export type PptPreviewHost = {
  workspace: string;
  openInBrowserPane: (url: string) => void;
  setPanelWidth: (width: number) => void;
  panelWidth: number;
};

/** 右栏加宽目标：PPT 是 16:9，太窄看不清要点；与 html-preview 同带上限，避免把对话挤没。 */
const PANEL_RATIO = 0.42;
const PANEL_MIN = 380;
const PANEL_MAX = 560;

/** 预览页固定落在会话工作区（同一路径反复覆盖 ⇒ 右栏一个页签足够）。 */
function previewFilePath(workspace: string): string {
  return `${workspace.replace(/[\\/]+$/, "")}/.codex-harness/ppt-preview.html`;
}

/** PPT 预览桥：deck 变化 → 写 HTML → 开页签 / 刷新页签。返回 null（纯桥，不渲染 DOM）。 */
export function PptPreviewBridge({ app }: { app: PptPreviewHost }) {
  const deck = useSyncExternalStore(subscribeSlideDeck, getSlideDeck, getSlideDeck);
  const openedUrlRef = useRef("");
  const lastSigRef = useRef("");
  const hostRef = useRef(app);
  hostRef.current = app;

  useEffect(() => {
    if (!deck || !deck.pages.length) return;
    const workspace = String(hostRef.current.workspace ?? "").trim();
    if (!workspace) return;
    /* 同一页重复渲染没有意义（工具重试、父组件重渲都会触发）⇒ 用「deck id + 页数 + 时间戳」去重。 */
    const signature = `${deck.id}|${deck.pages.length}|${deck.updatedAt}`;
    if (signature === lastSigRef.current) return;
    lastSigRef.current = signature;
    const file = previewFilePath(workspace);
    const url = toFileUrl(file);
    void (async () => {
      try {
        await window.codex.writeFile(file, renderSlideHtml(deck), workspace);
      } catch {
        return;   // 写盘失败（工作区不可写）就不开预览：宁可没有，也不要开个空白页
      }
      setSlidePreviewUrl(url);
      if (openedUrlRef.current !== url) {
        openedUrlRef.current = url;
        hostRef.current.openInBrowserPane(url);
        const target = Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(window.innerWidth * PANEL_RATIO)));
        if (hostRef.current.panelWidth < target) hostRef.current.setPanelWidth(target);
        return;
      }
      notifySlideReload();
    })();
  /* ⛔ 依赖里必须有 workspace：新会话刚建时 workspace 可能还是空串（桥先跑一次拿不到路径），
     等它到位必须重跑 —— 否则用户切到有工作区的会话后，PPT 预览永远不会出现。 */
  }, [deck, app.workspace]);

  return null;
}
